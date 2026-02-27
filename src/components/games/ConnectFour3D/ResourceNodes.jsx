// ResourceNodes.jsx — Collectible resource nodes scattered across the lunar terrain
// Players walk up to glowing pickups, press E to collect, sell at depot for SC.
//
// ARCHITECTURE: Two exports —
//  • ResourceSpawner (default)  → 3D meshes, runs inside <Canvas>
//  • ResourceOverlays (named)   → HTML HUD / prompts, rendered OUTSIDE <Canvas>

import React, { useRef, useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { TERRAIN_RADIUS } from './constants';
import { getTerrainHeightXZ } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG, RARITY_COLORS } from './useInventoryStore';

/* ================================================================
   Configuration
   ================================================================ */
const RESOURCE_TYPES = [
  { id: 'moonRock',      weight: 50, minDist: 80,  maxDist: 0.95 }, // common — everywhere
  { id: 'lunarCrystal',  weight: 20, minDist: 200, maxDist: 0.90 }, // uncommon — further out
  { id: 'helium3',       weight: 8,  minDist: 600, maxDist: 0.85 }, // rare — far from center
  { id: 'alienArtifact', weight: 2,  minDist: 1000, maxDist: 0.80 }, // epic — edges of map
];

const TOTAL_NODES = 80;           // total resource nodes on the terrain
const PICKUP_RANGE = 8;           // distance to collect
const PROMPT_RANGE = 16;          // distance to show "Press E" prompt
const RESPAWN_TIME = {            // ms before respawn
  common: 30000,
  uncommon: 60000,
  rare: 180000,
  epic: 300000,
};
const BOB_SPEED = 1.8;
const BOB_HEIGHT = 0.6;
const SPIN_SPEED = 1.2;

/* Per-resource display style:
   yShift  – offset from default spawn Y (terrainY+1.5)
   bob     – whether it floats up/down
   spin    – whether it rotates
   embedded – partially buried in terrain (skip rarity ring)
   tiltX   – permanent tilt on X axis (ore veins sticking out)
*/
const RESOURCE_DISPLAY = {
  moonRock:      { yShift: 0,    bob: true,  bobH: 0.6,  spin: true,  spinSpd: 1.2, embedded: false },
  lunarCrystal:  { yShift: -2.0, bob: false, bobH: 0,    spin: false, spinSpd: 0,   embedded: true, tiltX: 0.25 },
  helium3:       { yShift: -0.8, bob: false, bobH: 0,    spin: false, spinSpd: 0,   embedded: false },
  alienArtifact: { yShift: -1.0, bob: false, bobH: 0,    spin: false, spinSpd: 0,   embedded: false },
};

/* ================================================================
   Seeded RNG (deterministic across all clients in a room)
   ================================================================ */
function createSeededRNG(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/* ================================================================
   Generate spawn positions (seeded, placed on terrain surface)
   ================================================================ */
function generateSpawnPositions(seed, count) {
  const rng = createSeededRNG(seed);
  const positions = [];

  // Build weighted pool
  const totalWeight = RESOURCE_TYPES.reduce((s, r) => s + r.weight, 0);

  for (let i = 0; i < count; i++) {
    // Pick resource type by weight
    let roll = rng() * totalWeight;
    let type = RESOURCE_TYPES[0];
    for (const rt of RESOURCE_TYPES) {
      roll -= rt.weight;
      if (roll <= 0) { type = rt; break; }
    }

    // Pick random position within terrain bounds
    const maxR = TERRAIN_RADIUS * type.maxDist;
    const minR = type.minDist;
    // Random angle + distance (sqrt for uniform area distribution)
    const angle = rng() * Math.PI * 2;
    const dist = minR + Math.sqrt(rng()) * (maxR - minR);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Get terrain height at this position
    const terrainY = getTerrainHeightXZ(x, z);
    if (terrainY <= -9000) continue; // skip if outside terrain

    positions.push({
      id: i,
      resourceId: type.id,
      x,
      y: terrainY + 1.5, // float slightly above surface
      z,
    });
  }

  return positions;
}

/* ================================================================
   GLB model URLs per resource type
   ================================================================ */
const RESOURCE_MODEL_URLS = {
  lunarCrystal:  '/models/props/assets/space_crystal.glb',
  helium3:       '/models/props/assets/Helium_core.glb',
  alienArtifact: '/models/props/assets/alien_artifact.glb',
};

// Scale each model to be visible as pickups on the terrain.
// GLB models from Meshy AI are often very small (~0.01 units) so we scale up a lot.
const RESOURCE_MODEL_SCALE = {
  lunarCrystal:  20,
  helium3:       20,
  alienArtifact: 20,
};

/* ================================================================
   GLB Resource Model (loaded once, cloned per node)
   ================================================================ */
function GLBResourceModel({ url, scale }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    try {
      const c = scene.clone(true);
      // Auto-center: compute bounding box and shift to origin
      const box = new THREE.Box3().setFromObject(c);
      const center = box.getCenter(new THREE.Vector3());
      c.position.sub(center);
      c.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Keep the model's original textures/materials — just clone so
          // each instance is independent
          if (o.material) {
            o.material = o.material.clone();
          }
        }
      });
      return c;
    } catch (e) {
      console.error('GLBResourceModel clone error:', e);
      return new THREE.Group();
    }
  }, [scene]);

  return <primitive object={cloned} scale={[scale, scale, scale]} />;
}

// Preload GLB models
try { useGLTF.preload('/models/props/assets/space_crystal.glb'); } catch {}
try { useGLTF.preload('/models/props/assets/Helium_core.glb'); } catch {}
try { useGLTF.preload('/models/props/assets/alien_artifact.glb'); } catch {}

/* ================================================================
   Single Resource Node (glowing, bobbing mesh — GLB or primitive)
   ================================================================ */
function ResourceNode({ node, onCollect, playerDistSq }) {
  const meshRef = useRef();
  const lightRef = useRef();
  const catalog = ITEM_CATALOG[node.resourceId];
  const rarityColor = RARITY_COLORS[catalog?.rarity] || '#ffffff';
  const color = useMemo(() => new THREE.Color(rarityColor), [rarityColor]);

  const hasModel = !!RESOURCE_MODEL_URLS[node.resourceId];
  const modelUrl = RESOURCE_MODEL_URLS[node.resourceId];
  const modelScale = RESOURCE_MODEL_SCALE[node.resourceId] || 3.0;
  const display = RESOURCE_DISPLAY[node.resourceId] || RESOURCE_DISPLAY.moonRock;

  // Base Y position with per-type shift
  const baseY = node.y + display.yShift;

  // Fallback geometry for moonRock (no GLB model)
  const geometry = useMemo(() => {
    if (hasModel) return null;
    return new THREE.DodecahedronGeometry(0.6, 0); // Moon rock
  }, [hasModel]);

  // Animate bob + spin (per-type settings)
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    // Y position: bob or static
    meshRef.current.position.y = display.bob
      ? baseY + Math.sin(t * BOB_SPEED + node.id) * display.bobH
      : baseY;

    // Rotation
    if (display.spin) {
      meshRef.current.rotation.y = t * display.spinSpd + node.id * 0.5;
    }
    // Tilt for embedded ore
    if (display.tiltX) {
      meshRef.current.rotation.x = display.tiltX + Math.sin(t * 0.3 + node.id) * 0.03;
    } else if (!hasModel) {
      meshRef.current.rotation.x = Math.sin(t * 0.5 + node.id) * 0.15;
    }

    // Pulse glow intensity based on proximity
    if (lightRef.current) {
      const inRange = playerDistSq < PROMPT_RANGE * PROMPT_RANGE;
      lightRef.current.intensity = THREE.MathUtils.lerp(
        lightRef.current.intensity,
        inRange ? 3.0 : 1.0,
        0.05
      );
    }
  });

  return (
    <group position={[node.x, 0, node.z]}>
      <group ref={meshRef} position={[0, baseY, 0]}>
        {hasModel ? (
          <Suspense fallback={null}>
            <GLBResourceModel url={modelUrl} scale={modelScale} />
          </Suspense>
        ) : (
          <mesh geometry={geometry} castShadow>
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.8}
              roughness={0.3}
              metalness={0.6}
              transparent
              opacity={0.9}
            />
          </mesh>
        )}
      </group>
      <pointLight
        ref={lightRef}
        position={[0, baseY + 1, 0]}
        color={rarityColor}
        intensity={1.0}
        distance={12}
        decay={2}
      />
      {/* Rarity ring on ground — skip for embedded resources */}
      {!display.embedded && (
        <mesh position={[0, node.y - 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.0, 1.3, 24]} />
          <meshBasicMaterial color={rarityColor} transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/* ================================================================
   Sell Depot — 3D meshes only (HTML handled by ResourceOverlays)
   ================================================================ */
const DEPOT_POS = [30, 0, 30];
const DEPOT_RANGE = 12;

function SellDepot3D({ groundY }) {
  const meshRef = useRef();

  // Animate depot glow
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.material.emissiveIntensity = 0.3 + Math.sin(t * 2) * 0.15;
  });

  const depotY = getTerrainHeightXZ(DEPOT_POS[0], DEPOT_POS[2]);

  return (
    <group position={[DEPOT_POS[0], (groundY || 0) + (depotY > -9000 ? depotY : 0), DEPOT_POS[2]]}>
      {/* Base platform */}
      <mesh ref={meshRef} position={[0, 0.3, 0]} receiveShadow>
        <cylinderGeometry args={[3, 3.5, 0.6, 16]} />
        <meshStandardMaterial
          color="#1a1a2e"
          emissive="#00d4ff"
          emissiveIntensity={0.3}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      {/* Hologram pillar */}
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 5, 8]} />
        <meshStandardMaterial
          color="#00d4ff"
          emissive="#00d4ff"
          emissiveIntensity={1.5}
          transparent
          opacity={0.4}
        />
      </mesh>
      {/* Top beacon */}
      <pointLight position={[0, 6, 0]} color="#00d4ff" intensity={2} distance={25} decay={2} />
      <mesh position={[0, 5.5, 0]}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

/* ================================================================
   Resource Spawner — 3D component (inside Canvas)
   ================================================================ */
export default function ResourceSpawner({ groundY, roomSeed = 42, wsSend }) {
  const addResource = useInventoryStore(s => s.addResource);

  // Generate deterministic node positions
  const initialNodes = useMemo(() => generateSpawnPositions(roomSeed, TOTAL_NODES), [roomSeed]);

  // Track which nodes are currently active (not collected)
  const [activeNodes, setActiveNodes] = useState(() => {
    const map = {};
    initialNodes.forEach(n => { map[n.id] = n; });
    return map;
  });

  // Track respawn timers
  const respawnTimers = useRef({});

  // Track nearest node for pickup prompt
  const nearestRef = useRef({ node: null, distSq: Infinity });

  // Gamepad X button previous state for edge detection
  const gpXPrev = useRef(false);

  // Find nearest active node each frame & publish to window for HTML overlay
  useFrame(() => {
    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;
    const px = avatar.x;
    const pz = avatar.z;

    let closest = null;
    let closestDSq = Infinity;

    for (const node of Object.values(activeNodes)) {
      const dx = px - node.x;
      const dz = pz - node.z;
      const dsq = dx * dx + dz * dz;
      if (dsq < closestDSq) {
        closestDSq = dsq;
        closest = node;
      }
    }

    nearestRef.current.node = closest;
    nearestRef.current.distSq = closestDSq;

    // Check depot proximity
    const ddx = px - DEPOT_POS[0];
    const ddz = pz - DEPOT_POS[2];
    const depotDistSq = ddx * ddx + ddz * ddz;

    const isNearDepot = depotDistSq < DEPOT_RANGE * DEPOT_RANGE;

    // Publish state for HTML overlay
    window.__CF_RESOURCE_STATE__ = {
      nearestNode: closest,
      nearestDistSq: closestDSq,
      nearDepot: isNearDepot,
    };

    // ── Gamepad X button (button 2) → pickup / depot toggle ──
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const xNow = gp.buttons[2]?.pressed || false;
      const xJust = xNow && !gpXPrev.current;
      gpXPrev.current = xNow;
      if (xJust) {
        // Try resource pickup first
        if (closest && closestDSq < PICKUP_RANGE * PICKUP_RANGE) {
          collectNode(closest.id);
        }
        // Toggle depot UI
        if (isNearDepot) {
          window.dispatchEvent(new CustomEvent('depot_interact'));
        }
      }
    } else {
      gpXPrev.current = false;
    }
  });

  // Collect a node
  const collectNode = useCallback((nodeId) => {
    const node = activeNodes[nodeId];
    if (!node) return;
    const catalog = ITEM_CATALOG[node.resourceId];
    if (!catalog) return;

    // Add to inventory
    addResource(node.resourceId);

    // Remove from active
    setActiveNodes(prev => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });

    // Broadcast to room
    if (wsSend) {
      try {
        wsSend({ type: 'resource_collected', nodeId });
      } catch {}
    }

    // Schedule respawn
    const rarity = catalog.rarity || 'common';
    const delay = RESPAWN_TIME[rarity] || 30000;
    respawnTimers.current[nodeId] = setTimeout(() => {
      const original = initialNodes.find(n => n.id === nodeId);
      if (original) {
        setActiveNodes(prev => ({ ...prev, [nodeId]: original }));
        // Broadcast respawn
        if (wsSend) {
          try { wsSend({ type: 'resource_respawn', nodeId }); } catch {}
        }
      }
      delete respawnTimers.current[nodeId];
    }, delay);
  }, [activeNodes, addResource, initialNodes, wsSend]);

  // Listen for remote collection/respawn events
  useEffect(() => {
    const handler = (e) => {
      try {
        const data = e.detail || (typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
        if (data.type === 'resource_collected' && data.nodeId != null) {
          setActiveNodes(prev => {
            const next = { ...prev };
            delete next[data.nodeId];
            return next;
          });
        }
        if (data.type === 'resource_respawn' && data.nodeId != null) {
          const original = initialNodes.find(n => n.id === data.nodeId);
          if (original) {
            setActiveNodes(prev => ({ ...prev, [data.nodeId]: original }));
          }
        }
      } catch {}
    };
    window.addEventListener('ws_resource_msg', handler);
    return () => window.removeEventListener('ws_resource_msg', handler);
  }, [initialNodes]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(respawnTimers.current).forEach(t => clearTimeout(t));
    };
  }, []);

  // Keyboard handler for collecting
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        const nr = nearestRef.current;
        if (nr.node && nr.distSq < PICKUP_RANGE * PICKUP_RANGE) {
          collectNode(nr.node.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collectNode]);

  return (
    <>
      {/* 3D resource node meshes */}
      {Object.values(activeNodes).map(node => (
        <ResourceNode
          key={node.id}
          node={node}
          onCollect={collectNode}
          playerDistSq={
            nearestRef.current.node && nearestRef.current.node.id === node.id
              ? nearestRef.current.distSq : Infinity
          }
        />
      ))}

      {/* 3D sell depot meshes */}
      <SellDepot3D groundY={groundY} />
    </>
  );
}

/* ================================================================
   Resource Overlays — HTML component (OUTSIDE Canvas)
   Reads state from window.__CF_RESOURCE_STATE__ set by ResourceSpawner
   ================================================================ */
export function ResourceOverlays() {
  const resources = useInventoryStore(s => s.resources);
  const scBalance = useInventoryStore(s => s.scBalance);
  const sellAllResources = useInventoryStore(s => s.sellAllResources);
  const sellAllOfResource = useInventoryStore(s => s.sellAllOfResource);
  const [showDepotUI, setShowDepotUI] = useState(false);
  const [tick, setTick] = useState(0);

  // Poll the window state at ~20fps for prompt updates
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 50);
    return () => clearInterval(iv);
  }, []);

  const state = window.__CF_RESOURCE_STATE__ || {};
  const nearestNode = state.nearestNode;
  const nearestDistSq = state.nearestDistSq ?? Infinity;
  const nearDepot = !!state.nearDepot;

  const showPrompt = nearestNode && nearestDistSq < PROMPT_RANGE * PROMPT_RANGE;
  const inPickupRange = nearestNode && nearestDistSq < PICKUP_RANGE * PICKUP_RANGE;

  // Depot key handler (keyboard E) + gamepad X event
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (nearDepot) setShowDepotUI(prev => !prev);
      }
    };
    const onGamepadDepot = () => {
      if (nearDepot) setShowDepotUI(prev => !prev);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('depot_interact', onGamepadDepot);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('depot_interact', onGamepadDepot);
    };
  }, [nearDepot]);

  // Refresh inventory from server when depot opens
  useEffect(() => {
    if (showDepotUI && window.__CF_RELOAD_INVENTORY__) {
      window.__CF_RELOAD_INVENTORY__();
    }
  }, [showDepotUI]);

  // Close depot when walking away
  useEffect(() => {
    if (!nearDepot && showDepotUI) setShowDepotUI(false);
  }, [nearDepot, showDepotUI]);

  const totalValue = useMemo(() => {
    let total = 0;
    for (const [id, count] of Object.entries(resources)) {
      if (count <= 0) continue;
      const cat = ITEM_CATALOG[id];
      if (cat?.type === 'resource') total += (cat.sellValue || 0) * count;
    }
    return total;
  }, [resources]);

  // Resource HUD entries
  const resourceEntries = Object.entries(resources).filter(([, count]) => count > 0);

  return (
    <>
      {/* Resource HUD (top-right) */}
      {resourceEntries.length > 0 && (
        <div style={{
          position: 'fixed', top: 80, right: 16,
          background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8, padding: '8px 12px', color: '#fff',
          fontFamily: 'monospace', fontSize: 13, zIndex: 8000,
          pointerEvents: 'none', backdropFilter: 'blur(4px)', minWidth: 100,
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 11, opacity: 0.6 }}>RESOURCES</div>
          {resourceEntries.map(([id, count]) => {
            const cat = ITEM_CATALOG[id];
            if (!cat) return null;
            return (
              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                <span style={{ color: RARITY_COLORS[cat.rarity] }}>{cat.glyph} {cat.label}</span>
                <span style={{ fontWeight: 'bold' }}>×{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pickup prompt — in range */}
      {showPrompt && inPickupRange && nearestNode && (() => {
        const catalog = ITEM_CATALOG[nearestNode.resourceId];
        if (!catalog) return null;
        return (
          <div style={{
            position: 'fixed', bottom: '22%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)', border: `1px solid ${RARITY_COLORS[catalog.rarity] || '#fff'}`,
            borderRadius: 8, padding: '8px 18px', color: '#fff',
            fontFamily: 'monospace', fontSize: 14, textAlign: 'center',
            pointerEvents: 'none', zIndex: 9000, backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: RARITY_COLORS[catalog.rarity], fontWeight: 'bold' }}>
              {catalog.glyph} {catalog.label}
            </span>
            <span style={{ opacity: 0.7, marginLeft: 8 }}>({catalog.rarity})</span>
            <br />
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              Press <span style={{ fontWeight: 'bold' }}>E</span> / <span style={{ fontWeight: 'bold' }}>X</span> to collect • Worth {catalog.sellValue} SC
            </span>
          </div>
        );
      })()}

      {/* Pickup prompt — nearby but not in range */}
      {showPrompt && !inPickupRange && nearestNode && (
        <div style={{
          position: 'fixed', bottom: '18%', left: '50%', transform: 'translateX(-50%)',
          color: RARITY_COLORS[ITEM_CATALOG[nearestNode.resourceId]?.rarity] || '#fff',
          fontFamily: 'monospace', fontSize: 12, opacity: 0.5,
          pointerEvents: 'none', zIndex: 8500,
        }}>
          {ITEM_CATALOG[nearestNode.resourceId]?.glyph} nearby...
        </div>
      )}

      {/* Depot proximity prompt */}
      {nearDepot && !showDepotUI && (
        <div style={{
          position: 'fixed', bottom: '22%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)', border: '1px solid #00d4ff',
          borderRadius: 8, padding: '8px 18px', color: '#fff',
          fontFamily: 'monospace', fontSize: 14, textAlign: 'center',
          pointerEvents: 'none', zIndex: 9000, backdropFilter: 'blur(4px)',
        }}>
          <span style={{ color: '#00d4ff', fontWeight: 'bold' }}>📡 SELL DEPOT</span>
          <br />
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            Press <span style={{ fontWeight: 'bold' }}>E</span> / <span style={{ fontWeight: 'bold' }}>X</span> to trade
          </span>
        </div>
      )}

      {/* Sell depot full UI */}
      {showDepotUI && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(10, 10, 30, 0.95)', border: '1px solid #00d4ff',
          borderRadius: 12, padding: '24px 32px', color: '#fff',
          fontFamily: 'monospace', width: 340, zIndex: 10000, backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#00d4ff' }}>📡 SELL DEPOT</h3>
            <span style={{ fontSize: 12, opacity: 0.6 }}>SC Balance: {scBalance}</span>
          </div>

          {resourceEntries.length === 0 ? (
            <p style={{ opacity: 0.5, textAlign: 'center', margin: '20px 0' }}>No resources to sell</p>
          ) : (
            <>
              {resourceEntries.map(([id, count]) => {
                const cat = ITEM_CATALOG[id];
                if (!cat) return null;
                return (
                  <div key={id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <div>
                      <span style={{ color: RARITY_COLORS[cat.rarity] }}>{cat.glyph} {cat.label}</span>
                      <span style={{ opacity: 0.5, marginLeft: 6 }}>×{count}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#fbbf24' }}>{cat.sellValue * count} SC</span>
                      <button
                        onClick={() => sellAllOfResource(id)}
                        style={{
                          background: '#00d4ff22', border: '1px solid #00d4ff', color: '#00d4ff',
                          borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
                          fontFamily: 'monospace',
                        }}
                      >Sell</button>
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#fbbf24' }}>Total: {totalValue} SC</span>
                <button
                  onClick={() => sellAllResources()}
                  style={{
                    background: '#fbbf2422', border: '1px solid #fbbf24', color: '#fbbf24',
                    borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
                    fontFamily: 'monospace', fontWeight: 'bold',
                  }}
                >Sell All</button>
              </div>
            </>
          )}

          <button
            onClick={() => setShowDepotUI(false)}
            style={{
              marginTop: 16, width: '100%', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
              borderRadius: 6, padding: '6px', cursor: 'pointer', fontSize: 12,
              fontFamily: 'monospace',
            }}
          >Close (E)</button>
        </div>
      )}
    </>
  );
}
