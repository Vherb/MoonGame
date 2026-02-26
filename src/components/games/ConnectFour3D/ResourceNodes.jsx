// ResourceNodes.jsx — Collectible resource nodes scattered across the lunar terrain
// Players walk up to glowing pickups, press E to collect, sell at depot for SC.

import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
   Single Resource Node (glowing, bobbing mesh)
   ================================================================ */
function ResourceNode({ node, onCollect, playerDistSq }) {
  const meshRef = useRef();
  const lightRef = useRef();
  const catalog = ITEM_CATALOG[node.resourceId];
  const rarityColor = RARITY_COLORS[catalog?.rarity] || '#ffffff';
  const color = useMemo(() => new THREE.Color(rarityColor), [rarityColor]);

  // Geometry per type
  const geometry = useMemo(() => {
    switch (catalog?.rarity) {
      case 'uncommon': // Crystal shape
        return new THREE.OctahedronGeometry(0.8, 0);
      case 'rare': // Glowing orb
        return new THREE.IcosahedronGeometry(0.7, 1);
      case 'epic': // Complex artifact
        return new THREE.DodecahedronGeometry(0.9, 0);
      default: // Moon rock
        return new THREE.DodecahedronGeometry(0.6, 0);
    }
  }, [catalog?.rarity]);

  // Animate bob + spin
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.position.y = node.y + Math.sin(t * BOB_SPEED + node.id) * BOB_HEIGHT;
    meshRef.current.rotation.y = t * SPIN_SPEED + node.id * 0.5;
    meshRef.current.rotation.x = Math.sin(t * 0.5 + node.id) * 0.15;

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
      <mesh ref={meshRef} position={[0, node.y, 0]} geometry={geometry} castShadow>
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
      <pointLight
        ref={lightRef}
        position={[0, node.y + 1, 0]}
        color={rarityColor}
        intensity={1.0}
        distance={12}
        decay={2}
      />
      {/* Rarity ring on ground */}
      <mesh position={[0, node.y - 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.3, 24]} />
        <meshBasicMaterial color={rarityColor} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ================================================================
   Pickup Prompt HUD (HTML overlay)
   ================================================================ */
function PickupPrompt({ node, visible }) {
  if (!visible || !node) return null;
  const catalog = ITEM_CATALOG[node.resourceId];
  if (!catalog) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '22%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.75)',
      border: `1px solid ${RARITY_COLORS[catalog.rarity] || '#fff'}`,
      borderRadius: 8,
      padding: '8px 18px',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: 14,
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: 9000,
      backdropFilter: 'blur(4px)',
    }}>
      <span style={{ color: RARITY_COLORS[catalog.rarity], fontWeight: 'bold' }}>
        {catalog.glyph} {catalog.label}
      </span>
      <span style={{ opacity: 0.7, marginLeft: 8 }}>({catalog.rarity})</span>
      <br />
      <span style={{ fontSize: 12, opacity: 0.8 }}>Press <b>E</b> to collect • Worth {catalog.sellValue} SC</span>
    </div>
  );
}

/* ================================================================
   Resource HUD (top-right corner showing carried resources)
   ================================================================ */
function ResourceHUD() {
  const resources = useInventoryStore(s => s.resources);
  const entries = Object.entries(resources).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 80,
      right: 16,
      background: 'rgba(0,0,0,0.65)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: 8,
      padding: '8px 12px',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: 13,
      zIndex: 8000,
      pointerEvents: 'none',
      backdropFilter: 'blur(4px)',
      minWidth: 100,
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 11, opacity: 0.6 }}>RESOURCES</div>
      {entries.map(([id, count]) => {
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
  );
}

/* ================================================================
   Sell Depot — glowing platform near spawn
   ================================================================ */
function SellDepot({ groundY }) {
  const meshRef = useRef();
  const [showUI, setShowUI] = useState(false);
  const [nearDepot, setNearDepot] = useState(false);
  const resources = useInventoryStore(s => s.resources);
  const scBalance = useInventoryStore(s => s.scBalance);
  const sellAllResources = useInventoryStore(s => s.sellAllResources);
  const sellAllOfResource = useInventoryStore(s => s.sellAllOfResource);

  const DEPOT_POS = useMemo(() => [30, 0, 30], []);
  const DEPOT_RANGE = 12;

  // Check player proximity
  useFrame(() => {
    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;
    const dx = avatar.x - DEPOT_POS[0];
    const dz = avatar.z - DEPOT_POS[2];
    const distSq = dx * dx + dz * dz;
    setNearDepot(distSq < DEPOT_RANGE * DEPOT_RANGE);
  });

  // Animate depot glow
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.material.emissiveIntensity = 0.3 + Math.sin(t * 2) * 0.15;
  });

  // Key handler for interact
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (nearDepot) setShowUI(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nearDepot]);

  // Close when walking away
  useEffect(() => {
    if (!nearDepot && showUI) setShowUI(false);
  }, [nearDepot, showUI]);

  const totalValue = useMemo(() => {
    let total = 0;
    for (const [id, count] of Object.entries(resources)) {
      if (count <= 0) continue;
      const cat = ITEM_CATALOG[id];
      if (cat?.type === 'resource') total += (cat.sellValue || 0) * count;
    }
    return total;
  }, [resources]);

  const depotY = getTerrainHeightXZ(DEPOT_POS[0], DEPOT_POS[2]);

  return (
    <>
      {/* 3D depot marker */}
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
        {/* Label */}
        <mesh position={[0, 7, 0]} rotation={[0, 0, 0]}>
          <planeGeometry args={[4, 0.8]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>

      {/* Proximity prompt */}
      {nearDepot && !showUI && (
        <div style={{
          position: 'fixed',
          bottom: '22%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)',
          border: '1px solid #00d4ff',
          borderRadius: 8,
          padding: '8px 18px',
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: 14,
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 9000,
          backdropFilter: 'blur(4px)',
        }}>
          <span style={{ color: '#00d4ff', fontWeight: 'bold' }}>📡 SELL DEPOT</span>
          <br />
          <span style={{ fontSize: 12, opacity: 0.8 }}>Press <b>E</b> to trade resources</span>
        </div>
      )}

      {/* Sell UI overlay */}
      {showUI && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(10, 10, 30, 0.95)',
          border: '1px solid #00d4ff',
          borderRadius: 12,
          padding: '24px 32px',
          color: '#fff',
          fontFamily: 'monospace',
          width: 340,
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#00d4ff' }}>📡 SELL DEPOT</h3>
            <span style={{ fontSize: 12, opacity: 0.6 }}>SC Balance: {scBalance}</span>
          </div>

          {Object.entries(resources).filter(([, c]) => c > 0).length === 0 ? (
            <p style={{ opacity: 0.5, textAlign: 'center', margin: '20px 0' }}>No resources to sell</p>
          ) : (
            <>
              {Object.entries(resources).filter(([, c]) => c > 0).map(([id, count]) => {
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
            onClick={() => setShowUI(false)}
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

/* ================================================================
   Resource Spawner — main export, manages all nodes + pickup logic
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
  const [nearestNode, setNearestNode] = useState(null);
  const [nearestDistSq, setNearestDistSq] = useState(Infinity);

  // Find nearest active node each frame
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

    setNearestNode(closest);
    setNearestDistSq(closestDSq);
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
        if (nearestNode && nearestDistSq < PICKUP_RANGE * PICKUP_RANGE) {
          collectNode(nearestNode.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nearestNode, nearestDistSq, collectNode]);

  const showPrompt = nearestNode && nearestDistSq < PROMPT_RANGE * PROMPT_RANGE;
  const inPickupRange = nearestNode && nearestDistSq < PICKUP_RANGE * PICKUP_RANGE;

  return (
    <>
      {/* Render all active resource nodes */}
      {Object.values(activeNodes).map(node => (
        <ResourceNode
          key={node.id}
          node={node}
          onCollect={collectNode}
          playerDistSq={
            nearestNode && nearestNode.id === node.id ? nearestDistSq : Infinity
          }
        />
      ))}

      {/* Sell Depot */}
      <SellDepot groundY={groundY} />

      {/* Pickup prompt (HTML overlay) */}
      {showPrompt && inPickupRange && <PickupPrompt node={nearestNode} visible />}
      {showPrompt && !inPickupRange && nearestNode && (
        <div style={{
          position: 'fixed',
          bottom: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          color: RARITY_COLORS[ITEM_CATALOG[nearestNode.resourceId]?.rarity] || '#fff',
          fontFamily: 'monospace',
          fontSize: 12,
          opacity: 0.5,
          pointerEvents: 'none',
          zIndex: 8500,
        }}>
          {ITEM_CATALOG[nearestNode.resourceId]?.glyph} nearby...
        </div>
      )}

      {/* Resource HUD */}
      <ResourceHUD />
    </>
  );
}
