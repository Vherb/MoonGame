// EnemyWaveSystem.jsx — PvE wave defense system
// Alien enemies spawn at map edges every few minutes, path toward the player's
// base (nearest building cluster), attack building pieces, and can be killed by
// turrets, spike traps, and player weapons.
//
// EXPORTS:
//  • EnemyWaveManager (default) → 3D enemy meshes + turret projectiles (Canvas)
//  • WaveOverlays (named)       → HTML HUD for wave countdown, wave cleared (outside Canvas)

import React, { useRef, useMemo, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useFBX } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TERRAIN_RADIUS } from './constants';
import { getTerrainHeightXZ } from './terrainPhysics';
import { CURRENT_BUILDING_PIECES } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG, RARITY_COLORS } from './useInventoryStore';
import { useBuildingStore, PIECE_TYPES, GRID_SIZE } from './useBuildingStore';

/* ================================================================
   Configuration
   ================================================================ */
const WAVE_INTERVAL     = 300;     // seconds between waves (5 min)
const FIRST_WAVE_DELAY  = 120;     // seconds before first wave (2 min grace period)
const WAVE_WARN_TIME    = 30;      // seconds of "incoming!" warning before spawn
const SPAWN_DISTANCE    = 800;     // distance from center where enemies spawn
const BASE_ENEMY_COUNT  = 4;       // enemies in wave 1
const ENEMIES_PER_WAVE  = 2;       // additional enemies per wave
const MAX_ENEMIES       = 20;      // cap

const ENEMY_SPEED       = 12;      // units/second
const ENEMY_HP_BASE     = 80;      // base HP, scaled by wave number
const ENEMY_HP_SCALE    = 20;      // extra HP per wave
const ENEMY_ATTACK_RANGE= 6;       // distance to start attacking a building piece
const ENEMY_ATTACK_DPS  = 8;       // damage per second to building pieces
const ENEMY_MODEL_SCALE = 0.06;    // FBX model display scale
const ENEMY_HEIGHT      = 8;       // approximate visual height

// Turret configuration (matches PIECE_TYPES.turret)
const TURRET_RANGE      = 80;
const TURRET_DAMAGE     = 10;
const TURRET_FIRE_RATE  = 1.5;     // seconds between shots

// Spike trap
const SPIKE_TRAP_RANGE  = 16;      // XZ radius of trap effect (GRID_SIZE / 2)
const SPIKE_TRAP_DPS    = 30;      // damage per second

// Rewards
const REWARD_SC_BASE    = 50;      // SC per wave cleared
const REWARD_SC_SCALE   = 25;      // extra SC per wave number
const RESOURCE_DROP_CHANCE = 0.4;  // chance each enemy drops a resource on death

/* ================================================================
   Zustand - building piece HP (extends existing store)
   We track HP in a lightweight ref map, not in the store, for
   performance (avoids re-rendering the entire building system).
   ================================================================ */
let BUILDING_HP = {}; // { [pieceId]: currentHP }

function initBuildingHP() {
  const pieces = useBuildingStore.getState().pieces || [];
  for (const p of pieces) {
    if (BUILDING_HP[p.id] != null) continue; // already tracked
    const type = PIECE_TYPES[p.type];
    const multiplier = type?.healthMultiplier || 1;
    BUILDING_HP[p.id] = 100 * multiplier;
  }
}

function damageBuildingPiece(pieceId, damage) {
  if (BUILDING_HP[pieceId] == null) {
    // Lazy init
    const pieces = useBuildingStore.getState().pieces || [];
    const p = pieces.find(pp => pp.id === pieceId);
    if (!p) return 0;
    const type = PIECE_TYPES[p.type];
    const multiplier = type?.healthMultiplier || 1;
    BUILDING_HP[pieceId] = 100 * multiplier;
  }
  BUILDING_HP[pieceId] = Math.max(0, BUILDING_HP[pieceId] - damage);
  if (BUILDING_HP[pieceId] <= 0) {
    // Destroy piece
    try {
      useBuildingStore.getState().removePiece(pieceId);
    } catch {}
    delete BUILDING_HP[pieceId];
    return -1; // destroyed
  }
  return BUILDING_HP[pieceId];
}

function getBuildingHP(pieceId) {
  return BUILDING_HP[pieceId] ?? 100;
}

// Expose for potential UI reads
export { getBuildingHP, BUILDING_HP };

/* ================================================================
   Enemy state management (ref-based for performance)
   ================================================================ */
let ENEMY_ID_COUNTER = 0;

function createEnemy(waveNum) {
  const angle = Math.random() * Math.PI * 2;
  const x = Math.cos(angle) * SPAWN_DISTANCE;
  const z = Math.sin(angle) * SPAWN_DISTANCE;
  const terrainY = getTerrainHeightXZ(x, z);
  const y = terrainY > -9000 ? terrainY : 0;
  
  return {
    id: ++ENEMY_ID_COUNTER,
    x, y, z,
    hp: ENEMY_HP_BASE + ENEMY_HP_SCALE * (waveNum - 1),
    maxHp: ENEMY_HP_BASE + ENEMY_HP_SCALE * (waveNum - 1),
    targetPieceId: null,
    targetPos: null,
    dead: false,
    deathTimer: 0,
    attackTimer: 0,
    rotY: angle + Math.PI, // face toward center initially
    state: 'walking', // 'walking' | 'attacking' | 'idle'
  };
}

/* ================================================================
   Find nearest building piece to an enemy
   ================================================================ */
function findNearestBuildingPiece(ex, ez) {
  let best = null;
  let bestDSq = Infinity;
  for (const p of CURRENT_BUILDING_PIECES) {
    if (!p) continue;
    const dx = ex - p.x;
    const dz = ez - p.z;
    const dsq = dx * dx + dz * dz;
    if (dsq < bestDSq) {
      bestDSq = dsq;
      best = p;
    }
  }
  return best;
}

/* ================================================================
   Cross-rig animation retargeting (Mixamo → any humanoid skeleton)
   
   The Walking.fbx / Running.fbx from the astronaut use Mixamo bone
   names like "mixamorigHips", "mixamorigLeftUpLeg", etc.
   The warrior model from Meshy uses different names.  We strip the
   "mixamorig" prefix and do fuzzy matching so e.g. animation track
   "mixamorigHips.quaternion" matches target bone "Hips" or "hips".
   ================================================================ */
function buildBoneMap(model) {
  const map = new Map();
  if (!model) return map;
  try {
    model.traverse(o => {
      if (o && (o.isBone || o.type === 'Bone')) {
        const n = String(o.name || '');
        // Normalise: lowercase, strip non-alnum
        const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
        map.set(key, n);
      }
    });
  } catch {}
  return map;
}

/** Strip common rig prefixes from a bone name before lookup */
function normaliseBoneName(name) {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Strip Mixamo prefix
  if (n.startsWith('mixamorig')) n = n.substring('mixamorig'.length);
  // Strip "bip01" or "bip001" prefixes (3ds Max)
  if (n.startsWith('bip01'))  n = n.substring(5);
  if (n.startsWith('bip001')) n = n.substring(6);
  return n;
}

function retargetClip(clip, boneMap, prefix) {
  if (!clip || !clip.tracks) return null;

  // Build the reverse lookup: normalised-without-prefix → actual target bone name
  // We normalise both sides the same way so "mixamorigHips" and "Hips" both become "hips"
  const strippedMap = new Map();
  for (const [key, actualName] of boneMap.entries()) {
    const stripped = normaliseBoneName(actualName);
    if (!strippedMap.has(stripped)) strippedMap.set(stripped, actualName);
  }

  const newTracks = [];
  for (const tr of clip.tracks) {
    const nm = String(tr.name || '');
    const dotIdx = nm.indexOf('.');
    if (dotIdx < 0) continue;
    const nodeName = nm.substring(0, dotIdx);
    const prop = nm.substring(dotIdx); // e.g. ".quaternion"

    // Skip position tracks — keeps animation in-place
    if (prop === '.position') continue;

    const stripped = normaliseBoneName(nodeName);
    const targetBone = strippedMap.get(stripped);
    if (targetBone) {
      // Remap track to target bone name
      newTracks.push(new tr.constructor(
        `${targetBone}${prop}`,
        tr.times.slice(),
        tr.values.slice(),
      ));
    }
    // If no match, still include the track (it might match by original name)
    else {
      newTracks.push(tr);
    }
  }
  if (newTracks.length === 0) return null;
  return new THREE.AnimationClip(`${prefix}:${clip.name || 'clip'}`, clip.duration, newTracks);
}

/* ================================================================
   Single Enemy mesh (3D) — with real walking animation
   ================================================================ */
function EnemyMesh({ enemy, clone, walkClips, runClips }) {
  const groupRef = useRef();
  const hpBarRef = useRef();
  const mixerRef = useRef(null);
  const actionsRef = useRef({});
  const currentAction = useRef(null);
  const prevState = useRef('');

  useLayoutEffect(() => {
    if (!clone) return;

    const mixer = new THREE.AnimationMixer(clone);
    mixerRef.current = mixer;
    const boneMap = buildBoneMap(clone);

    // Try retargeting the walk animation
    if (walkClips && walkClips.length > 0) {
      const retargeted = retargetClip(walkClips[0], boneMap, 'walk');
      if (retargeted && retargeted.tracks.length > 0) {
        const action = mixer.clipAction(retargeted);
        action.setLoop(THREE.LoopRepeat);
        actionsRef.current.walk = action;
      }
    }
    // Try retargeting the run animation
    if (runClips && runClips.length > 0) {
      const retargeted = retargetClip(runClips[0], boneMap, 'run');
      if (retargeted && retargeted.tracks.length > 0) {
        const action = mixer.clipAction(retargeted);
        action.setLoop(THREE.LoopRepeat);
        actionsRef.current.run = action;
      }
    }

    // Fallback: try model's own embedded animations
    if (!actionsRef.current.walk && !actionsRef.current.run) {
      const embeddedClips = clone.animations;
      if (embeddedClips && embeddedClips.length > 0) {
        const action = mixer.clipAction(embeddedClips[0]);
        action.setLoop(THREE.LoopRepeat);
        actionsRef.current.walk = action;
      }
    }

    // Start walking
    if (actionsRef.current.walk) {
      actionsRef.current.walk.play();
      currentAction.current = actionsRef.current.walk;
      prevState.current = 'walking';
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentAction.current = null;
    };
  }, [clone, walkClips, runClips]);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    groupRef.current.position.set(enemy.x, enemy.y, enemy.z);
    groupRef.current.rotation.y = enemy.rotY;

    // Death fade
    if (enemy.dead) {
      const scale = Math.max(0, 1 - enemy.deathTimer * 2);
      groupRef.current.scale.setScalar(scale * ENEMY_MODEL_SCALE);
      if (mixerRef.current && currentAction.current) {
        currentAction.current.fadeOut(0.3);
        currentAction.current = null;
      }
      return;
    }

    // Switch animation based on state
    const state = enemy.state || 'walking';
    if (state !== prevState.current) {
      prevState.current = state;
      const actions = actionsRef.current;
      const nextAction = state === 'attacking'
        ? (actions.run || actions.walk)
        : actions.walk;
      if (nextAction && nextAction !== currentAction.current) {
        if (currentAction.current) currentAction.current.fadeOut(0.25);
        nextAction.reset().fadeIn(0.25).play();
        nextAction.timeScale = state === 'attacking' ? 1.6 : 1.0;
        currentAction.current = nextAction;
      }
    }

    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(dt);
    }

    // HP bar
    if (hpBarRef.current) {
      const pct = Math.max(0, enemy.hp / enemy.maxHp);
      hpBarRef.current.scale.x = pct;
      if (pct > 0.6) hpBarRef.current.material.color.setHex(0x44ff44);
      else if (pct > 0.3) hpBarRef.current.material.color.setHex(0xffff44);
      else hpBarRef.current.material.color.setHex(0xff4444);
    }
  });

  return (
    <group ref={groupRef} scale={[ENEMY_MODEL_SCALE, ENEMY_MODEL_SCALE, ENEMY_MODEL_SCALE]}>
      {clone ? (
        <primitive object={clone} />
      ) : (
        <mesh>
          <capsuleGeometry args={[30, 80, 4, 8]} />
          <meshStandardMaterial color="#ff3333" emissive="#ff0000" emissiveIntensity={0.4} />
        </mesh>
      )}
      {/* HP bar (billboard) */}
      <group position={[0, ENEMY_HEIGHT / ENEMY_MODEL_SCALE + 20, 0]}>
        <mesh ref={hpBarRef} position={[0, 0, 0]}>
          <planeGeometry args={[100, 8]} />
          <meshBasicMaterial color="#44ff44" side={THREE.DoubleSide} transparent opacity={0.8} />
        </mesh>
        <mesh position={[0, 0, -0.1]}>
          <planeGeometry args={[104, 12]} />
          <meshBasicMaterial color="#000000" side={THREE.DoubleSide} transparent opacity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

/* ================================================================
   Turret Projectile visual
   ================================================================ */
function TurretBeam({ from, to, color = '#0088ff' }) {
  const meshRef = useRef();
  const glowRef = useRef();

  useFrame(() => {
    if (meshRef.current && meshRef.current.material) {
      meshRef.current.material.opacity = Math.max(0, meshRef.current.material.opacity - 0.03);
    }
    if (glowRef.current && glowRef.current.material) {
      glowRef.current.material.opacity = Math.max(0, glowRef.current.material.opacity - 0.04);
    }
  });

  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const quat = new THREE.Quaternion();
    // Cylinder is Y-aligned by default, orient it along the beam direction
    const up = new THREE.Vector3(0, 1, 0);
    quat.setFromUnitVectors(up, dir.normalize());
    return { position: mid, quaternion: quat, length: len };
  }, [from, to]);

  return (
    <group>
      {/* Core beam — thick bright cylinder */}
      <mesh ref={meshRef} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[0.6, 0.6, length, 8, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
      </mesh>
      {/* Outer glow */}
      <mesh ref={glowRef} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[1.4, 1.4, length, 8, 1]} />
        <meshBasicMaterial color={'#00ccff'} transparent opacity={0.3} toneMapped={false} />
      </mesh>
      {/* Muzzle flash */}
      <mesh position={from}>
        <sphereGeometry args={[1.5, 8, 6]} />
        <meshBasicMaterial color={'#00ddff'} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      {/* Impact flash */}
      <mesh position={to}>
        <sphereGeometry args={[1.2, 8, 6]} />
        <meshBasicMaterial color={'#ffffff'} transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ================================================================
   Main Wave Manager — 3D (inside Canvas)
   ================================================================ */
export default function EnemyWaveManager({ groundY, wsSend }) {
  const addResource = useInventoryStore(s => s.addResource);
  const addSC = useInventoryStore(s => s.addSC);
  
  // Wave state
  const waveRef = useRef({
    currentWave: 0,
    timer: FIRST_WAVE_DELAY,        // countdown to next wave
    phase: 'waiting',                // 'waiting' | 'warning' | 'active' | 'cleared'
    clearedTimer: 0,
  });
  
  // Enemies array (mutated in-place for performance)
  const enemiesRef = useRef([]);
  const [enemyRenderTick, setEnemyRenderTick] = useState(0); // force re-render on spawn/death
  
  // Turret beams (visual only, brief flash)
  const [turretBeams, setTurretBeams] = useState([]);
  const turretCooldowns = useRef({}); // { pieceId: lastFireTime }
  
  // Load enemy FBX model — attack robot NPC with walking animations
  const enemyFBX = useFBX('/models/avatars/NPCs/attackrobot/Meshy_AI_attack_npc_0227063610_texture.fbx');

  // Load walk animation from attack robot's own animation file
  const walkFBX = useFBX('/models/avatars/NPCs/attackrobot/animations/Walking.fbx');
  const runFBX  = useFBX('/models/avatars/astronaut/Running.fbx');
  const walkClips = useMemo(() => (walkFBX?.animations || []), [walkFBX]);
  const runClips  = useMemo(() => (runFBX?.animations  || []), [runFBX]);
  
  // Clone pool
  const clonePool = useRef({});
  
  const getClone = useCallback((enemyId) => {
    if (clonePool.current[enemyId]) return clonePool.current[enemyId];
    if (!enemyFBX) return null;
    try {
      const c = skeletonClone(enemyFBX);
      clonePool.current[enemyId] = c;
      return c;
    } catch {
      return null;
    }
  }, [enemyFBX]);

  // Spawn a wave
  const spawnWave = useCallback((waveNum) => {
    const count = Math.min(MAX_ENEMIES, BASE_ENEMY_COUNT + ENEMIES_PER_WAVE * (waveNum - 1));
    const newEnemies = [];
    for (let i = 0; i < count; i++) {
      newEnemies.push(createEnemy(waveNum));
    }
    enemiesRef.current = newEnemies;
    initBuildingHP(); // ensure all building pieces have HP
    setEnemyRenderTick(t => t + 1);
  }, []);

  // Main game loop
  useFrame((_, dt) => {
    const w = waveRef.current;
    const enemies = enemiesRef.current;
    const hasPieces = CURRENT_BUILDING_PIECES.length > 0;
    let needsRenderUpdate = false;

    // ── Wave timer logic ──
    if (w.phase === 'waiting') {
      w.timer -= dt;
      // Only start waves if player has built something
      if (w.timer <= WAVE_WARN_TIME && hasPieces && w.timer > 0) {
        w.phase = 'warning';
      }
      if (w.timer <= 0 && hasPieces) {
        w.currentWave++;
        w.phase = 'active';
        spawnWave(w.currentWave);
      }
      // If timer expires with no pieces, just reset
      if (w.timer <= 0 && !hasPieces) {
        w.timer = WAVE_INTERVAL;
      }
    } else if (w.phase === 'warning') {
      w.timer -= dt;
      if (w.timer <= 0) {
        w.currentWave++;
        w.phase = 'active';
        spawnWave(w.currentWave);
      }
    } else if (w.phase === 'active') {
      // Check if all enemies dead
      const allDead = enemies.length > 0 && enemies.every(e => e.dead);
      if (allDead) {
        // Clean up dead enemies after brief delay
        const allFaded = enemies.every(e => e.deathTimer > 1.0);
        if (allFaded) {
          // Wave cleared!
          w.phase = 'cleared';
          w.clearedTimer = 4; // show "Wave Cleared!" for 4 seconds
          enemiesRef.current = [];
          // Clean up clones
          for (const e of enemies) delete clonePool.current[e.id];
          
          // Reward
          const reward = REWARD_SC_BASE + REWARD_SC_SCALE * w.currentWave;
          if (addSC) {
            try { addSC(reward); } catch {}
          }
          
          needsRenderUpdate = true;
        }
      }
    } else if (w.phase === 'cleared') {
      w.clearedTimer -= dt;
      if (w.clearedTimer <= 0) {
        w.phase = 'waiting';
        w.timer = WAVE_INTERVAL;
      }
    }

    // ── Update enemies ──
    const now = performance.now() / 1000;
    const beamsThisFrame = [];

    for (const enemy of enemies) {
      if (enemy.dead) {
        enemy.deathTimer += dt;
        continue;
      }

      // Find target building piece
      if (!enemy.targetPieceId || !CURRENT_BUILDING_PIECES.find(p => p.id === enemy.targetPieceId)) {
        const nearest = findNearestBuildingPiece(enemy.x, enemy.z);
        if (nearest) {
          enemy.targetPieceId = nearest.id;
          enemy.targetPos = { x: nearest.x, z: nearest.z };
        } else {
          // No buildings — path toward center
          enemy.targetPos = { x: 0, z: 0 };
          enemy.targetPieceId = null;
        }
      }

      // Move toward target
      if (enemy.targetPos) {
        const dx = enemy.targetPos.x - enemy.x;
        const dz = enemy.targetPos.z - enemy.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > ENEMY_ATTACK_RANGE) {
          // Move
          enemy.state = 'walking';
          const moveSpeed = ENEMY_SPEED * dt;
          const nx = dx / dist;
          const nz = dz / dist;
          enemy.x += nx * moveSpeed;
          enemy.z += nz * moveSpeed;
          enemy.rotY = Math.atan2(nx, nz);
          
          // Snap to terrain
          const terrainY = getTerrainHeightXZ(enemy.x, enemy.z);
          if (terrainY > -9000) {
            enemy.y = terrainY;
          }
        } else {
          // Attack building piece — DISABLED for now (enemies gather but don't destroy)
          enemy.state = 'attacking';
          if (enemy.targetPieceId) {
            enemy.attackTimer += dt;
            // Building damage disabled — enemies still path + animate attack
            // if (enemy.attackTimer >= 0.5) {
            //   const dmg = ENEMY_ATTACK_DPS * enemy.attackTimer;
            //   const result = damageBuildingPiece(enemy.targetPieceId, dmg);
            //   enemy.attackTimer = 0;
            //   if (result === -1) {
            //     enemy.targetPieceId = null;
            //     enemy.targetPos = null;
            //     needsRenderUpdate = true;
            //   }
            // }
          }
        }
      }

      // ── Spike trap damage ──
      for (const p of CURRENT_BUILDING_PIECES) {
        if (!p || p.type !== 'spikeTrap') continue;
        const dx = enemy.x - p.x;
        const dz = enemy.z - p.z;
        const dsq = dx * dx + dz * dz;
        if (dsq < SPIKE_TRAP_RANGE * SPIKE_TRAP_RANGE) {
          // Check Y proximity (enemy must be near the trap surface)
          const trapTop = p.y + (p.dims?.[1] || 1.2);
          if (Math.abs(enemy.y - trapTop) < 5) {
            enemy.hp -= SPIKE_TRAP_DPS * dt;
          }
        }
      }

      // ── Check death ──
      if (enemy.hp <= 0 && !enemy.dead) {
        enemy.dead = true;
        enemy.deathTimer = 0;
        needsRenderUpdate = true;

        // Drop resource
        if (Math.random() < RESOURCE_DROP_CHANCE) {
          const types = ['moonRock', 'lunarCrystal', 'helium3', 'alienArtifact'];
          const weights = [50, 25, 10, 2];
          const total = weights.reduce((a, b) => a + b, 0);
          let roll = Math.random() * total;
          let dropType = types[0];
          for (let i = 0; i < types.length; i++) {
            roll -= weights[i];
            if (roll <= 0) { dropType = types[i]; break; }
          }
          addResource(dropType);
        }
      }
    }

    // ── Turret firing (old box turrets + new two-piece model turrets) ──
    // Initialize target tracking map for TurretTopTracker rendering
    const turretTargets = {};

    for (const p of CURRENT_BUILDING_PIECES) {
      if (!p || p.type !== 'turret') continue;
      const turretX = p.x;
      const turretZ = p.z;
      const turretY = (p.y || 0) + 4; // fire from top of turret
      const lastFire = turretCooldowns.current[p.id] || 0;
      
      if (now - lastFire < TURRET_FIRE_RATE) continue;

      // Find nearest alive enemy in range
      let bestEnemy = null;
      let bestDSq = TURRET_RANGE * TURRET_RANGE;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - turretX;
        const dz = enemy.z - turretZ;
        const dsq = dx * dx + dz * dz;
        if (dsq < bestDSq) {
          bestDSq = dsq;
          bestEnemy = enemy;
        }
      }

      if (bestEnemy) {
        // Fire!
        bestEnemy.hp -= TURRET_DAMAGE;
        turretCooldowns.current[p.id] = now;
        
        // Visual beam
        beamsThisFrame.push({
          id: `${p.id}-${now}`,
          from: [turretX, turretY, turretZ],
          to: [bestEnemy.x, bestEnemy.y + ENEMY_HEIGHT / 2, bestEnemy.z],
          time: now,
        });
      }
    }

    // ── Model turret assembly: turretTop + turretBase paired firing ──
    const PAIR_TOLERANCE = 15; // XZ distance tolerance for considering top+base as assembled
    const turretBases = [];
    const turretTops = [];
    for (const p of CURRENT_BUILDING_PIECES) {
      if (!p) continue;
      const def = PIECE_TYPES[p.type];
      if (def && def.isTurretBase) turretBases.push(p);
      if (def && def.isTurretTop) turretTops.push(p);
    }

    for (const top of turretTops) {
      const topDef = PIECE_TYPES[top.type];
      // Find a base underneath this top piece (within tolerance)
      let paired = false;
      for (const base of turretBases) {
        const dx = Math.abs(top.x - base.x);
        const dz = Math.abs(top.z - base.z);
        if (dx < PAIR_TOLERANCE && dz < PAIR_TOLERANCE) {
          paired = true;
          break;
        }
      }
      if (!paired) continue; // Not assembled — no firing

      const tRange = topDef.turretRange || TURRET_RANGE;
      const tDamage = topDef.turretDamage || TURRET_DAMAGE;
      const tFireRate = topDef.turretFireRate || TURRET_FIRE_RATE;
      const turretY = (top.y || 0) + (topDef.dims[1] / 2);
      const lastFire = turretCooldowns.current[top.id] || 0;

      // Find nearest alive enemy in range (even outside fire cooldown, for tracking)
      let bestEnemy = null;
      let bestDSq = tRange * tRange;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const ddx = enemy.x - top.x;
        const ddz = enemy.z - top.z;
        const dsq = ddx * ddx + ddz * ddz;
        if (dsq < bestDSq) {
          bestDSq = dsq;
          bestEnemy = enemy;
        }
      }

      // Publish target for visual tracking (TurretTopTracker reads this)
      if (bestEnemy) {
        turretTargets[top.id] = { x: bestEnemy.x, y: bestEnemy.y, z: bestEnemy.z };
      }

      // Fire if off cooldown and target acquired — dual beams side by side
      if (bestEnemy && (now - lastFire >= tFireRate)) {
        bestEnemy.hp -= tDamage;
        turretCooldowns.current[top.id] = now;
        // Calculate perpendicular offset for dual barrels
        const ddx = bestEnemy.x - top.x;
        const ddz = bestEnemy.z - top.z;
        const dist2D = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
        const perpX = -ddz / dist2D * 1.5; // 1.5 units apart
        const perpZ =  ddx / dist2D * 1.5;
        // Left barrel
        beamsThisFrame.push({
          id: `${top.id}-L-${now}`,
          from: [top.x + perpX, turretY, top.z + perpZ],
          to: [bestEnemy.x, bestEnemy.y + ENEMY_HEIGHT / 2, bestEnemy.z],
          time: now,
        });
        // Right barrel
        beamsThisFrame.push({
          id: `${top.id}-R-${now}`,
          from: [top.x - perpX, turretY, top.z - perpZ],
          to: [bestEnemy.x, bestEnemy.y + ENEMY_HEIGHT / 2, bestEnemy.z],
          time: now,
        });
      }
    }
    // Publish turret targets for TurretTopTracker rotation
    window.__CF_TURRET_TARGETS__ = turretTargets;

    // ── Player weapon damage to enemies ──
    // Check window global for bullet hits (set by WeaponSystem)
    const bulletHits = window.__CF_ENEMY_BULLET_HITS__;
    if (bulletHits && bulletHits.length > 0) {
      for (const hit of bulletHits) {
        const enemy = enemies.find(e => e.id === hit.enemyId && !e.dead);
        if (enemy) {
          enemy.hp -= hit.damage;
        }
      }
      window.__CF_ENEMY_BULLET_HITS__ = [];
    }

    // Update turret beams (remove old ones)
    if (beamsThisFrame.length > 0) {
      setTurretBeams(prev => {
        const fresh = prev.filter(b => now - b.time < 0.15);
        return [...fresh, ...beamsThisFrame];
      });
    } else {
      setTurretBeams(prev => {
        const fresh = prev.filter(b => now - b.time < 0.15);
        if (fresh.length !== prev.length) return fresh;
        return prev;
      });
    }

    // Publish wave state for HTML overlay
    window.__CF_WAVE_STATE__ = {
      currentWave: w.currentWave,
      phase: w.phase,
      timer: w.timer,
      clearedTimer: w.clearedTimer,
      enemyCount: enemies.filter(e => !e.dead).length,
      totalEnemies: enemies.length,
    };

    // Publish enemy positions for weapon system hit detection
    window.__CF_ENEMIES__ = enemies.filter(e => !e.dead).map(e => ({
      id: e.id, x: e.x, y: e.y, z: e.z,
      radius: 4, height: ENEMY_HEIGHT,
    }));

    if (needsRenderUpdate) setEnemyRenderTick(t => t + 1);
  });

  // Render enemies
  const aliveEnemies = enemiesRef.current.filter(e => e.deathTimer < 1.5);

  return (
    <>
      {aliveEnemies.map(enemy => (
        <EnemyMesh
          key={enemy.id}
          enemy={enemy}
          clone={getClone(enemy.id)}
          walkClips={walkClips}
          runClips={runClips}
        />
      ))}
      {/* Turret beam visuals */}
      {turretBeams.map(beam => (
        <TurretBeam key={beam.id} from={beam.from} to={beam.to} />
      ))}
    </>
  );
}

/* ================================================================
   Wave Overlays — HTML HUD (OUTSIDE Canvas)
   ================================================================ */
export function WaveOverlays() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(iv);
  }, []);

  const state = window.__CF_WAVE_STATE__ || {};
  const { currentWave = 0, phase = 'waiting', timer = 0, clearedTimer = 0, enemyCount = 0 } = state;

  return (
    <>
      {/* Wave warning countdown */}
      {phase === 'warning' && (
        <div style={{
          position: 'fixed', top: '12%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(120, 0, 0, 0.85)', border: '2px solid #ff4444',
          borderRadius: 12, padding: '12px 28px', color: '#fff',
          fontFamily: 'monospace', fontSize: 18, textAlign: 'center',
          zIndex: 9500, backdropFilter: 'blur(6px)',
          animation: 'pulse 1s infinite alternate',
        }}>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 4 }}>⚠️ WAVE {currentWave + 1} INCOMING</div>
          <div style={{ fontSize: 28, fontWeight: 'bold', color: '#ff6666' }}>
            {Math.ceil(timer)}s
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Defend your base!</div>
        </div>
      )}

      {/* Active wave — enemy counter */}
      {phase === 'active' && enemyCount > 0 && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(80, 0, 0, 0.8)', border: '1px solid #ff4444',
          borderRadius: 8, padding: '6px 20px', color: '#fff',
          fontFamily: 'monospace', fontSize: 14, textAlign: 'center',
          zIndex: 9000, backdropFilter: 'blur(4px)',
        }}>
          <span style={{ color: '#ff6666', fontWeight: 'bold' }}>WAVE {currentWave}</span>
          <span style={{ marginLeft: 12, opacity: 0.8 }}>
            👾 {enemyCount} {enemyCount === 1 ? 'enemy' : 'enemies'} remaining
          </span>
        </div>
      )}

      {/* Wave cleared celebration */}
      {phase === 'cleared' && clearedTimer > 0 && (
        <div style={{
          position: 'fixed', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 80, 0, 0.85)', border: '2px solid #44ff44',
          borderRadius: 16, padding: '20px 40px', color: '#fff',
          fontFamily: 'monospace', fontSize: 22, textAlign: 'center',
          zIndex: 10000, backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#66ff66' }}>
            🎉 WAVE {currentWave} CLEARED!
          </div>
          <div style={{ fontSize: 14, opacity: 0.7, marginTop: 8 }}>
            +{REWARD_SC_BASE + REWARD_SC_SCALE * currentWave} SC earned
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
            Next wave in {Math.floor(WAVE_INTERVAL / 60)} min
          </div>
        </div>
      )}

      {/* Waiting — next wave timer (subtle, bottom-left) */}
      {phase === 'waiting' && currentWave > 0 && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16,
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, padding: '4px 10px', color: '#aaa',
          fontFamily: 'monospace', fontSize: 11,
          zIndex: 8000, pointerEvents: 'none',
        }}>
          Next wave: {Math.floor(timer / 60)}:{String(Math.floor(timer % 60)).padStart(2, '0')}
        </div>
      )}

      {/* Pre-first-wave — subtle hint */}
      {phase === 'waiting' && currentWave === 0 && CURRENT_BUILDING_PIECES.length > 0 && timer < FIRST_WAVE_DELAY && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16,
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,100,100,0.2)',
          borderRadius: 6, padding: '4px 10px', color: '#ff8888',
          fontFamily: 'monospace', fontSize: 11,
          zIndex: 8000, pointerEvents: 'none',
        }}>
          ⚠️ First wave in {Math.ceil(timer)}s — place turrets & traps!
        </div>
      )}

      {/* Pulse animation for warning */}
      <style>{`
        @keyframes pulse {
          from { box-shadow: 0 0 10px rgba(255,0,0,0.3); }
          to   { box-shadow: 0 0 30px rgba(255,0,0,0.6); }
        }
      `}</style>
    </>
  );
}
