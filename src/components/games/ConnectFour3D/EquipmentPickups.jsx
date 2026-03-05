// EquipmentPickups.jsx — World-placed equipment pickups (jetpack, etc.)
// Players walk up and press E / A-button to collect.
// Jetpack drops at death location as a lootable pickup.
//
// ARCHITECTURE: Two exports —
//  • EquipmentPickups (default)     → 3D meshes, runs inside <Canvas>
//  • EquipmentPickupOverlays (named) → HTML HUD / prompts, rendered OUTSIDE <Canvas>

import React, { useRef, useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useFBX } from '@react-three/drei';
import { getTerrainHeightXZ } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG, RARITY_COLORS } from './useInventoryStore';

/* ================================================================
   Configuration
   ================================================================ */
const PICKUP_RANGE    = 8;      // distance to collect
const PROMPT_RANGE    = 20;     // distance to show prompt
const BOB_SPEED       = 1.5;
const BOB_HEIGHT      = 0.8;
const SPIN_SPEED      = 0.8;
const SPAWN_RESPAWN   = 60000;  // fixed-spawn respawn time (60s)
const DROP_LIFETIME   = 300000; // dropped pickups despawn after 5 min
const JETPACK_SCALE   = 8;     // scale for the pickup model

// Fixed spawn point — near the Connect Four board table
// Player 1 spawns around [2.12, 12], so we place the jetpack slightly offset
const JETPACK_SPAWN_POS = [18, 0, 8];

/* ================================================================
   Jetpack FBX pickup model (loaded once, cloned per instance)
   ================================================================ */
const cat = ITEM_CATALOG.jetpack;

function JetpackPickupModel({ scale = JETPACK_SCALE }) {
  const fbx = useFBX(cat.modelUrl);
  const cloned = useMemo(() => {
    if (!fbx) return new THREE.Group();
    const c = fbx.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const center = box.getCenter(new THREE.Vector3());
    c.position.sub(center);

    // Apply PBR textures
    const loader = new THREE.TextureLoader();
    const diffuse   = loader.load(cat.textureUrl);
    const metallic  = loader.load(cat.metallicUrl);
    const normal    = loader.load(cat.normalUrl);
    const roughness = loader.load(cat.roughnessUrl);
    diffuse.colorSpace = THREE.SRGBColorSpace;

    c.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          map: diffuse,
          metalnessMap: metallic,
          normalMap: normal,
          roughnessMap: roughness,
          metalness: 1.0,
          roughness: 1.0,
          side: THREE.DoubleSide,
        });
        child.castShadow = true;
      }
    });
    return c;
  }, [fbx]);

  return <primitive object={cloned} scale={[scale, scale, scale]} />;
}

/* ================================================================
   Single Equipment Pickup Node (floating, spinning 3D model)
   ================================================================ */
function EquipmentNode({ pickup, playerDistSq }) {
  const meshRef = useRef();
  const lightRef = useRef();
  const rarityColor = RARITY_COLORS[cat.rarity] || '#a855f7';
  const terrainY = useMemo(() => {
    const ty = getTerrainHeightXZ(pickup.x, pickup.z);
    return ty > -9000 ? ty : 0;
  }, [pickup.x, pickup.z]);
  const baseY = terrainY + 3;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.position.y = baseY + Math.sin(t * BOB_SPEED + pickup.id * 0.7) * BOB_HEIGHT;
    meshRef.current.rotation.y = t * SPIN_SPEED + pickup.id * 1.3;

    if (lightRef.current) {
      const inRange = playerDistSq < PROMPT_RANGE * PROMPT_RANGE;
      lightRef.current.intensity = THREE.MathUtils.lerp(
        lightRef.current.intensity,
        inRange ? 4.0 : 1.5,
        0.05
      );
    }
  });

  return (
    <group position={[pickup.x, 0, pickup.z]}>
      <group ref={meshRef} position={[0, baseY, 0]}>
        <Suspense fallback={null}>
          <JetpackPickupModel />
        </Suspense>
      </group>

      {/* Epic glow beacon light */}
      <pointLight
        ref={lightRef}
        position={[0, baseY + 2, 0]}
        color={rarityColor}
        intensity={1.5}
        distance={30}
        decay={2}
      />

      {/* Ground rarity ring */}
      <mesh position={[0, terrainY + 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 2.0, 24]} />
        <meshBasicMaterial color={rarityColor} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Vertical beam */}
      <mesh position={[0, baseY + 6, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 12, 6]} />
        <meshBasicMaterial
          color={rarityColor}
          transparent
          opacity={0.25}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ================================================================
   Equipment Pickups Spawner — 3D component (inside Canvas)
   ================================================================ */
export default function EquipmentPickups({ groundY, wsSend }) {
  const addItem = useInventoryStore(s => s.addItem);
  const equipItem = useInventoryStore(s => s.equipItem);
  const hasJetpack = useInventoryStore(s => s.ownedItems.includes('jetpack'));

  // Active pickups: { [id]: { id, itemId, x, z, type: 'spawn'|'drop', createdAt } }
  const [pickups, setPickups] = useState(() => {
    // Start with the fixed spawn-point jetpack
    return {
      jetpack_spawn: {
        id: 'jetpack_spawn',
        itemId: 'jetpack',
        x: JETPACK_SPAWN_POS[0],
        z: JETPACK_SPAWN_POS[2],
        type: 'spawn',
        createdAt: Date.now(),
      },
    };
  });

  const nearestRef = useRef({ pickup: null, distSq: Infinity });
  const gpAPrev = useRef(false);
  const respawnTimers = useRef({});
  const dropCleanupTimers = useRef({});

  // Find nearest pickup each frame
  useFrame(() => {
    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;
    const px = avatar.x;
    const pz = avatar.z;

    let closest = null;
    let closestDSq = Infinity;

    for (const pickup of Object.values(pickups)) {
      const dx = px - pickup.x;
      const dz = pz - pickup.z;
      const dsq = dx * dx + dz * dz;
      if (dsq < closestDSq) {
        closestDSq = dsq;
        closest = pickup;
      }
    }

    nearestRef.current.pickup = closest;
    nearestRef.current.distSq = closestDSq;

    // Publish for HTML overlay
    window.__CF_EQUIPMENT_PICKUP_STATE__ = {
      nearPickup: closest && closestDSq < PROMPT_RANGE * PROMPT_RANGE ? closest : null,
      nearestDistSq: closestDSq,
      inRange: closest && closestDSq < PICKUP_RANGE * PICKUP_RANGE,
      hasJetpack: hasJetpack,
    };

    // Gamepad A button edge detection for pickup
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const aNow = gp.buttons[0]?.pressed || false;
      const aJust = aNow && !gpAPrev.current;
      gpAPrev.current = aNow;
      if (aJust && closest && closestDSq < PICKUP_RANGE * PICKUP_RANGE) {
        collectPickup(closest.id);
      }
    } else {
      gpAPrev.current = false;
    }
  });

  // Collect a pickup
  const collectPickup = useCallback((pickupId) => {
    const pickup = pickups[pickupId];
    if (!pickup) return;
    if (hasJetpack) return; // already have one

    // Grant the item
    addItem(pickup.itemId);
    equipItem(pickup.itemId);

    // Remove from active
    setPickups(prev => {
      const next = { ...prev };
      delete next[pickupId];
      return next;
    });

    // Broadcast
    if (wsSend) {
      try { wsSend({ type: 'equipment_collected', pickupId }); } catch {}
    }

    // If it was a fixed spawn, schedule respawn
    if (pickup.type === 'spawn') {
      respawnTimers.current[pickupId] = setTimeout(() => {
        setPickups(prev => ({
          ...prev,
          [pickupId]: {
            id: pickupId,
            itemId: pickup.itemId,
            x: pickup.x,
            z: pickup.z,
            type: 'spawn',
            createdAt: Date.now(),
          },
        }));
        if (wsSend) {
          try { wsSend({ type: 'equipment_respawn', pickupId }); } catch {}
        }
        delete respawnTimers.current[pickupId];
      }, SPAWN_RESPAWN);
    }
    // Dropped pickups don't respawn — they're one-time lootable
  }, [pickups, hasJetpack, addItem, equipItem, wsSend]);

  // Listen for death-drop events (from useWeaponSystem)
  useEffect(() => {
    const onDrop = (e) => {
      const { itemId, x, z } = e.detail || {};
      if (!itemId || !Number.isFinite(x)) return;
      const dropId = `drop_${itemId}_${Date.now()}`;
      setPickups(prev => ({
        ...prev,
        [dropId]: {
          id: dropId,
          itemId,
          x,
          z,
          type: 'drop',
          createdAt: Date.now(),
        },
      }));

      // Auto-cleanup after lifetime
      dropCleanupTimers.current[dropId] = setTimeout(() => {
        setPickups(prev => {
          const next = { ...prev };
          delete next[dropId];
          return next;
        });
        delete dropCleanupTimers.current[dropId];
      }, DROP_LIFETIME);
    };
    window.addEventListener('equipment_dropped', onDrop);
    return () => window.removeEventListener('equipment_dropped', onDrop);
  }, []);

  // Listen for remote collection/respawn/drop events
  useEffect(() => {
    const handler = (e) => {
      try {
        const data = e.detail || (typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
        if (data.type === 'equipment_collected' && data.pickupId) {
          setPickups(prev => {
            const next = { ...prev };
            delete next[data.pickupId];
            return next;
          });
        }
        if (data.type === 'equipment_respawn' && data.pickupId) {
          // Re-add the fixed spawn
          if (data.pickupId === 'jetpack_spawn') {
            setPickups(prev => ({
              ...prev,
              jetpack_spawn: {
                id: 'jetpack_spawn',
                itemId: 'jetpack',
                x: JETPACK_SPAWN_POS[0],
                z: JETPACK_SPAWN_POS[2],
                type: 'spawn',
                createdAt: Date.now(),
              },
            }));
          }
        }
        if (data.type === 'equipment_dropped' && data.itemId) {
          const dropId = `drop_${data.itemId}_${Date.now()}_remote`;
          setPickups(prev => ({
            ...prev,
            [dropId]: {
              id: dropId,
              itemId: data.itemId,
              x: data.x,
              z: data.z,
              type: 'drop',
              createdAt: Date.now(),
            },
          }));
        }
      } catch {}
    };
    window.addEventListener('ws_equipment_msg', handler);
    return () => window.removeEventListener('ws_equipment_msg', handler);
  }, []);

  // Keyboard E to collect
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        const nr = nearestRef.current;
        if (nr.pickup && nr.distSq < PICKUP_RANGE * PICKUP_RANGE) {
          collectPickup(nr.pickup.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collectPickup]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(respawnTimers.current).forEach(t => clearTimeout(t));
      Object.values(dropCleanupTimers.current).forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <>
      {Object.values(pickups).map(pickup => (
        <EquipmentNode
          key={pickup.id}
          pickup={pickup}
          playerDistSq={
            nearestRef.current.pickup && nearestRef.current.pickup.id === pickup.id
              ? nearestRef.current.distSq : Infinity
          }
        />
      ))}
    </>
  );
}

/* ================================================================
   Equipment Pickup Overlays — HTML component (outside Canvas)
   ================================================================ */
export function EquipmentPickupOverlays() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let raf;
    const poll = () => {
      const s = window.__CF_EQUIPMENT_PICKUP_STATE__;
      if (s) setState({ ...s });
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!state) return null;

  const { nearPickup, inRange, hasJetpack: owned } = state;

  // Don't show prompt if player already owns the equipment
  if (!nearPickup || owned) return null;

  const catalog = ITEM_CATALOG[nearPickup.itemId];
  if (!catalog) return null;
  const rarityColor = RARITY_COLORS[catalog.rarity] || '#fff';

  return (
    <>
      {/* In pickup range */}
      {inRange && (
        <div style={{
          position: 'fixed', bottom: '22%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', border: `2px solid ${rarityColor}`,
          borderRadius: 10, padding: '10px 22px', color: '#fff',
          fontFamily: 'monospace', fontSize: 15, textAlign: 'center',
          pointerEvents: 'none', zIndex: 9100, backdropFilter: 'blur(6px)',
          boxShadow: `0 0 20px ${rarityColor}44`,
        }}>
          <div style={{ fontWeight: 'bold', color: rarityColor, fontSize: 17, marginBottom: 4 }}>
            {catalog.glyph} {catalog.label}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>
            {catalog.rarity.toUpperCase()} Equipment
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {catalog.description}
          </div>
          <div style={{ fontSize: 13, marginTop: 8, opacity: 0.9 }}>
            Press <span style={{ fontWeight: 'bold', color: '#22c55e' }}>E</span> / <span style={{ fontWeight: 'bold', color: '#22c55e' }}>A</span> to pick up
          </div>
        </div>
      )}

      {/* Nearby but not in range */}
      {!inRange && (
        <div style={{
          position: 'fixed', bottom: '18%', left: '50%', transform: 'translateX(-50%)',
          color: rarityColor, fontFamily: 'monospace', fontSize: 12, opacity: 0.5,
          pointerEvents: 'none', zIndex: 8600,
        }}>
          {catalog.glyph} {catalog.label} nearby...
        </div>
      )}
    </>
  );
}
