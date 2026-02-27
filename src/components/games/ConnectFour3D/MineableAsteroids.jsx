// MineableAsteroids.jsx — Mineable asteroid deposits scattered across the moon surface
// Players approach an asteroid, hold E (or X on gamepad) to mine for 3 seconds,
// then receive 2-5 units of a resource. Longer respawn than regular nodes.
//
// ARCHITECTURE: Two exports —
//  • MineableAsteroidSpawner (default) → 3D meshes, runs inside <Canvas>
//  • MiningOverlays (named)            → HTML HUD / progress ring, outside <Canvas>

import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useFBX } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TERRAIN_RADIUS } from './constants';
import { getTerrainHeightXZ } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG, RARITY_COLORS } from './useInventoryStore';

/* ================================================================
   Configuration
   ================================================================ */
const ASTEROID_TYPES = [
  { id: 'moonRock',      weight: 40, minDist: 120,  maxDist: 0.70, yield: [3, 5] },
  { id: 'lunarCrystal',  weight: 25, minDist: 300,  maxDist: 0.85, yield: [2, 4] },
  { id: 'helium3',       weight: 10, minDist: 500,  maxDist: 0.80, yield: [2, 3] },
  { id: 'alienArtifact', weight: 3,  minDist: 800,  maxDist: 0.75, yield: [1, 2] },
];

const TOTAL_ASTEROIDS = 25;
const MINE_RANGE = 10;            // must be this close to mine
const PROMPT_RANGE = 18;          // show "Hold E" prompt at this distance
const MINE_DURATION = 3.0;        // seconds holding E to complete mining
const RESPAWN_TIME = {
  common:   120000,   // 2 min
  uncommon: 240000,   // 4 min
  rare:     420000,   // 7 min
  epic:     600000,   // 10 min
};

const ASTEROID_SCALE_RANGE = [0.015, 0.035]; // FBX scale (asteroid.fbx is large)
const ASTEROID_EMBED_Y = -2.0;               // embed partially in terrain

/* ================================================================
   Seeded RNG
   ================================================================ */
function createSeededRNG(seed = 7777) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/* ================================================================
   Generate asteroid deposit positions
   ================================================================ */
function generateAsteroidPositions(seed) {
  const rng = createSeededRNG(seed);
  const positions = [];
  const totalWeight = ASTEROID_TYPES.reduce((s, r) => s + r.weight, 0);

  for (let i = 0; i < TOTAL_ASTEROIDS; i++) {
    // Pick resource type by weight
    let roll = rng() * totalWeight;
    let type = ASTEROID_TYPES[0];
    for (const at of ASTEROID_TYPES) {
      roll -= at.weight;
      if (roll <= 0) { type = at; break; }
    }

    // Random position
    const maxR = TERRAIN_RADIUS * type.maxDist;
    const minR = type.minDist;
    const angle = rng() * Math.PI * 2;
    const dist = minR + Math.sqrt(rng()) * (maxR - minR);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const terrainY = getTerrainHeightXZ(x, z);
    if (terrainY <= -9000) continue;

    const scale = ASTEROID_SCALE_RANGE[0] + rng() * (ASTEROID_SCALE_RANGE[1] - ASTEROID_SCALE_RANGE[0]);
    const rotY = rng() * Math.PI * 2;
    const tiltX = (rng() - 0.5) * 0.4;
    const tiltZ = (rng() - 0.5) * 0.4;
    const yieldMin = type.yield[0];
    const yieldMax = type.yield[1];
    const yieldAmount = yieldMin + Math.floor(rng() * (yieldMax - yieldMin + 1));

    positions.push({
      id: i,
      resourceId: type.id,
      x,
      y: terrainY + ASTEROID_EMBED_Y,
      z,
      scale,
      rotY,
      tiltX,
      tiltZ,
      yieldAmount,
    });
  }
  return positions;
}

/* ================================================================
   Single Asteroid Deposit (3D)
   ================================================================ */
function AsteroidDeposit({ node, clone, miningProgress, isMining }) {
  const meshRef = useRef();
  const glowRef = useRef();
  const catalog = ITEM_CATALOG[node.resourceId];
  const rarityColor = RARITY_COLORS[catalog?.rarity] || '#ffffff';

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    // Subtle idle wobble
    meshRef.current.rotation.y = node.rotY + Math.sin(t * 0.3 + node.id) * 0.02;

    // Mining shrink effect
    if (isMining && miningProgress > 0) {
      const shake = Math.sin(t * 25) * 0.002 * miningProgress;
      meshRef.current.position.x = node.x + shake;
      meshRef.current.position.z = node.z + shake;
    } else {
      meshRef.current.position.x = node.x;
      meshRef.current.position.z = node.z;
    }

    // Glow pulse
    if (glowRef.current) {
      glowRef.current.intensity = THREE.MathUtils.lerp(
        glowRef.current.intensity,
        isMining ? 4.0 : 1.5,
        0.08
      );
    }
  });

  return (
    <group>
      <group
        ref={meshRef}
        position={[node.x, node.y, node.z]}
        rotation={[node.tiltX, node.rotY, node.tiltZ]}
        scale={[node.scale, node.scale, node.scale]}
      >
        {clone && <primitive object={clone} />}
      </group>
      {/* Rarity-colored ground glow */}
      <pointLight
        ref={glowRef}
        position={[node.x, node.y + 3, node.z]}
        color={rarityColor}
        intensity={1.5}
        distance={15}
        decay={2}
      />
      {/* Ground ring indicator */}
      <mesh position={[node.x, node.y + 0.3, node.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.0, 2.5, 24]} />
        <meshBasicMaterial
          color={rarityColor}
          transparent
          opacity={isMining ? 0.7 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Mining particle sparks (simple sphere emitter) */}
      {isMining && (
        <MiningParticles position={[node.x, node.y + 2, node.z]} color={rarityColor} />
      )}
    </group>
  );
}

/* ================================================================
   Mining Particles — simple sparks during mining
   ================================================================ */
function MiningParticles({ position, color }) {
  const ref = useRef();
  const particles = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const count = 20;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      vel[i * 3] = (Math.random() - 0.5) * 4;
      vel[i * 3 + 1] = Math.random() * 5 + 2;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo._velocities = vel;
    geo._timers = new Float32Array(count).map(() => Math.random());
    return geo;
  }, []);

  useFrame((_, dt) => {
    if (!ref.current || !particles) return;
    const posArr = particles.attributes.position.array;
    const vel = particles._velocities;
    const timers = particles._timers;
    for (let i = 0; i < timers.length; i++) {
      timers[i] += dt * 2;
      if (timers[i] > 1) {
        // Respawn
        timers[i] = 0;
        posArr[i * 3] = 0;
        posArr[i * 3 + 1] = 0;
        posArr[i * 3 + 2] = 0;
        vel[i * 3] = (Math.random() - 0.5) * 4;
        vel[i * 3 + 1] = Math.random() * 5 + 2;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 4;
      }
      posArr[i * 3]     += vel[i * 3] * dt;
      posArr[i * 3 + 1] += vel[i * 3 + 1] * dt;
      posArr[i * 3 + 2] += vel[i * 3 + 2] * dt;
      vel[i * 3 + 1] -= 8 * dt; // gravity
    }
    particles.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref} position={position}>
      <primitive object={particles} attach="geometry" />
      <pointsMaterial color={color} size={0.4} transparent opacity={0.8} sizeAttenuation />
    </points>
  );
}

/* ================================================================
   Mineable Asteroid Spawner — 3D (inside Canvas)
   ================================================================ */
export default function MineableAsteroidSpawner({ groundY, roomSeed = 42, wsSend }) {
  const addResource = useInventoryStore(s => s.addResource);

  // Generate deterministic asteroid positions (offset seed from ResourceNodes)
  const initialAsteroids = useMemo(() => generateAsteroidPositions(roomSeed + 5000), [roomSeed]);

  // Active asteroids (not yet mined / respawned)
  const [activeAsteroids, setActiveAsteroids] = useState(() => {
    const map = {};
    initialAsteroids.forEach(n => { map[n.id] = n; });
    return map;
  });

  const respawnTimers = useRef({});
  const nearestRef = useRef({ node: null, distSq: Infinity });
  const miningRef = useRef({ active: false, nodeId: null, progress: 0 });
  const gpXPrev = useRef(false);
  const eHeldRef = useRef(false);

  // Track E key held state with own listeners (PlayerMover doesn't track 'e' in pressed ref)
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'e' || e.key === 'E') eHeldRef.current = true;
    };
    const up = (e) => {
      if (e.key === 'e' || e.key === 'E') eHeldRef.current = false;
    };
    const blur = () => { eHeldRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Load asteroid FBX model
  const asteroidFBX = useFBX('/models/props/asteroid/asteroid.fbx');

  // Create clones for each asteroid
  const clones = useMemo(() => {
    if (!asteroidFBX) return {};
    const map = {};
    initialAsteroids.forEach(node => {
      try {
        map[node.id] = skeletonClone(asteroidFBX);
      } catch {}
    });
    return map;
  }, [asteroidFBX, initialAsteroids]);

  // Find nearest asteroid and handle mining input each frame
  useFrame((_, dt) => {
    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;
    const px = avatar.x;
    const pz = avatar.z;

    // Find nearest active asteroid
    let closest = null;
    let closestDSq = Infinity;
    for (const node of Object.values(activeAsteroids)) {
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

    // Check if player is holding mine key
    const holdingE = eHeldRef.current;
    const gp = navigator.getGamepads?.()[0];
    const holdingX = gp?.buttons?.[2]?.pressed || false;
    const holding = holdingE || holdingX;

    // Edge detect for gamepad (unused here but track for consistency)
    const xNow = holdingX;
    gpXPrev.current = xNow;

    const inRange = closest && closestDSq < MINE_RANGE * MINE_RANGE;
    const buildMode = window.__CF_BUILDING_STATE__?.buildMode;

    if (holding && inRange && !buildMode) {
      // Mining in progress
      if (!miningRef.current.active || miningRef.current.nodeId !== closest.id) {
        // Start mining new asteroid
        miningRef.current = { active: true, nodeId: closest.id, progress: 0 };
      }
      miningRef.current.progress += dt / MINE_DURATION;
      if (miningRef.current.progress >= 1.0) {
        // Mining complete!
        completeMining(closest);
        miningRef.current = { active: false, nodeId: null, progress: 0 };
      }
    } else {
      // Not holding or out of range — reset mining
      if (miningRef.current.active) {
        miningRef.current = { active: false, nodeId: null, progress: 0 };
      }
    }

    // Publish state for HTML overlay
    window.__CF_MINING_STATE__ = {
      nearestNode: closest,
      nearestDistSq: closestDSq,
      mining: miningRef.current.active,
      miningNodeId: miningRef.current.nodeId,
      miningProgress: miningRef.current.progress,
    };
  });

  // Complete mining — add resources, remove asteroid, schedule respawn
  const completeMining = useCallback((node) => {
    if (!node) return;
    const catalog = ITEM_CATALOG[node.resourceId];
    if (!catalog) return;

    // Add yield amount of resource
    for (let i = 0; i < node.yieldAmount; i++) {
      addResource(node.resourceId);
    }

    // Remove from active
    setActiveAsteroids(prev => {
      const next = { ...prev };
      delete next[node.id];
      return next;
    });

    // Broadcast
    if (wsSend) {
      try { wsSend({ type: 'asteroid_mined', nodeId: node.id }); } catch {}
    }

    // Schedule respawn
    const rarity = catalog.rarity || 'common';
    const delay = RESPAWN_TIME[rarity] || 120000;
    respawnTimers.current[node.id] = setTimeout(() => {
      const original = initialAsteroids.find(n => n.id === node.id);
      if (original) {
        setActiveAsteroids(prev => ({ ...prev, [node.id]: original }));
        if (wsSend) {
          try { wsSend({ type: 'asteroid_respawn', nodeId: node.id }); } catch {}
        }
      }
      delete respawnTimers.current[node.id];
    }, delay);
  }, [addResource, initialAsteroids, wsSend]);

  // Listen for remote mining/respawn events
  useEffect(() => {
    const handler = (e) => {
      try {
        const data = e.detail || (typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
        if (data.type === 'asteroid_mined' && data.nodeId != null) {
          setActiveAsteroids(prev => {
            const next = { ...prev };
            delete next[data.nodeId];
            return next;
          });
        }
        if (data.type === 'asteroid_respawn' && data.nodeId != null) {
          const original = initialAsteroids.find(n => n.id === data.nodeId);
          if (original) {
            setActiveAsteroids(prev => ({ ...prev, [data.nodeId]: original }));
          }
        }
      } catch {}
    };
    window.addEventListener('ws_resource_msg', handler);
    return () => window.removeEventListener('ws_resource_msg', handler);
  }, [initialAsteroids]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(respawnTimers.current).forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <>
      {Object.values(activeAsteroids).map(node => (
        <AsteroidDeposit
          key={node.id}
          node={node}
          clone={clones[node.id] || null}
          miningProgress={
            miningRef.current.nodeId === node.id ? miningRef.current.progress : 0
          }
          isMining={miningRef.current.nodeId === node.id && miningRef.current.active}
        />
      ))}
    </>
  );
}

/* ================================================================
   Mining Overlays — HTML HUD (OUTSIDE Canvas)
   Shows hold-to-mine progress ring & prompt
   ================================================================ */
export function MiningOverlays() {
  const [tick, setTick] = useState(0);

  // Poll at ~20fps for smooth progress updates
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 50);
    return () => clearInterval(iv);
  }, []);

  const state = window.__CF_MINING_STATE__ || {};
  const nearestNode = state.nearestNode;
  const nearestDistSq = state.nearestDistSq ?? Infinity;
  const mining = !!state.mining;
  const miningProgress = state.miningProgress || 0;
  const miningNodeId = state.miningNodeId;

  const showPrompt = nearestNode && nearestDistSq < PROMPT_RANGE * PROMPT_RANGE;
  const inRange = nearestNode && nearestDistSq < MINE_RANGE * MINE_RANGE;

  if (!showPrompt) return null;

  const catalog = nearestNode ? ITEM_CATALOG[nearestNode.resourceId] : null;
  if (!catalog) return null;
  const rarityColor = RARITY_COLORS[catalog.rarity] || '#fff';

  return (
    <>
      {/* Mining progress ring */}
      {mining && inRange && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 80, height: 80, pointerEvents: 'none', zIndex: 9500,
        }}>
          <svg width="80" height="80" viewBox="0 0 80 80">
            {/* Background circle */}
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
            {/* Progress arc */}
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke={rarityColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 34}`}
              strokeDashoffset={`${2 * Math.PI * 34 * (1 - miningProgress)}`}
              transform="rotate(-90 40 40)"
              style={{ filter: `drop-shadow(0 0 4px ${rarityColor})` }}
            />
            {/* Center icon */}
            <text x="40" y="44" textAnchor="middle" fill="#fff" fontSize="16" fontFamily="monospace">
              ⛏️
            </text>
          </svg>
          <div style={{
            position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)',
            color: '#fff', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}>
            {Math.floor(miningProgress * 100)}%
          </div>
        </div>
      )}

      {/* Approach prompt — in mine range but not mining */}
      {inRange && !mining && (
        <div style={{
          position: 'fixed', bottom: '22%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)', border: `1px solid ${rarityColor}`,
          borderRadius: 8, padding: '8px 18px', color: '#fff',
          fontFamily: 'monospace', fontSize: 14, textAlign: 'center',
          pointerEvents: 'none', zIndex: 9000, backdropFilter: 'blur(4px)',
        }}>
          <span style={{ color: rarityColor, fontWeight: 'bold' }}>
            🪨 Asteroid Deposit
          </span>
          <span style={{ opacity: 0.7, marginLeft: 8 }}>
            ({catalog.rarity} • ×{nearestNode.yieldAmount} {catalog.label})
          </span>
          <br />
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            Hold <span style={{ fontWeight: 'bold' }}>E</span> / <span style={{ fontWeight: 'bold' }}>X</span> to mine ({MINE_DURATION}s)
          </span>
        </div>
      )}

      {/* Nearby hint */}
      {showPrompt && !inRange && (
        <div style={{
          position: 'fixed', bottom: '18%', left: '50%', transform: 'translateX(-50%)',
          color: rarityColor,
          fontFamily: 'monospace', fontSize: 12, opacity: 0.5,
          pointerEvents: 'none', zIndex: 8500,
        }}>
          🪨 asteroid deposit nearby...
        </div>
      )}
    </>
  );
}
