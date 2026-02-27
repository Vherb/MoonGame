// ConnectFour3D – avatar / opponent character components
// Extracted from ConnectFour3DView.jsx

import React, { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useFBX, useAnimations, Text, Billboard } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { LazerRifleModel } from './WeaponSystem';
import { JetpackBoneAttachment } from './JetpackModel';
import {
  COLS, ROWS, CELL, GAP, GROUND_CLEAR,
  AVATAR_BASE_HEIGHT, AVATAR_FINAL_HEIGHT, SHARK_SCALE_BOOST, CAPUCCINO_SCALE_BOOST,
  AVATAR_IDLE_AMP_Y, AVATAR_IDLE_SWAY_Z, AVATAR_IDLE_SPEED_Y, AVATAR_IDLE_SPEED_Z,
  AVATAR_X_FRONT, AVATAR_X_BACK, AVATAR_BAKED_POS, AVATAR_BAKED_SCALE_MUL,
  WALK_ANIM_TIMESCALE, RUN_ANIM_TIMESCALE,
  ASTRONAUT_WALK_DEFAULT, ASTRONAUT_RUN_DEFAULT, ASTRONAUT_Y_OFFSET,
  GUY1_WALK_DEFAULT, GUY1_RUN_DEFAULT, GUY1_Y_OFFSET,
  getAnimSpeed,
} from './constants';
import { getTerrainHeightXZ } from './terrainPhysics';
import { FootstepAudio, JetpackAudio } from './audioComponents';
export function OpponentAvatar({ flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match key dims used by other parts so placement stays consistent
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // frame height
  const groundY = -fh / 2 - GROUND_CLEAR;

  // WoodenTable dims (keep in sync with WoodenTable)
  // (Not directly used here; avatar anchors to groundY)

  // Place avatar across the table relative to current camera: same distance, opposite side
  const posX = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const posY = AVATAR_BAKED_POS[1];
  const posZ = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const faceDir = posZ >= 0 ? -1 : 1; // look toward board center (z=0)

  // Scale avatar (mobile adjustment currently unified to 1)
  const scale = 5 * (Number.isFinite(scaleOverride) ? scaleOverride : 1);

  // Anchor the avatar feet on the ground, level with table leg bottoms
  // Stand on the same floor plane used by NeonFloor and table legs
  const anchorY = groundY;

  // Simple stylized figure
  const bodyH = 1.8;
  const bodyR = 0.4;
  const headR = 0.36;
  const neckH = 0.18;
  const shoulderW = 1.0;
  const armR = 0.16;
  const armL = 0.9;

  const fabric = '#1f2937';
  const fabricEm = '#0b1220';
  const skin = '#d1a68a';

  const groupRotation = rotationOverride ?? [0, posZ > 0 ? Math.PI : 0, 0];
  const groupRef = useRef();
  const upperRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const baseY = anchorY + posY; // keep root anchored
  const startRotZ = groupRotation?.[2] || 0;
  useFrame(({ clock }) => {
    const g = groupRef.current;
    const u = upperRef.current;
    if (!g || !u) return;
    const t = clock.getElapsedTime();
  g.position.x = posX;
  g.position.y = baseY;
  g.position.z = posZ;
  g.scale.set(scale, scale, scale);
    // Move only the upper body: root stays fixed at ground
    const bob = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * AVATAR_IDLE_AMP_Y;
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const breath = Math.sin(t * 0.45) * 0.02;         // slower chest/torso pitch
    g.rotation.z = startRotZ;      // no whole-body tilt
    u.position.y = 0.15 + bob;     // upper body bob
    u.rotation.z = sway;           // upper body sway
    u.rotation.x = breath;         // gentle forward/back rock
    // arm micro motion (adds a little life)
    if (leftArmRef.current)  leftArmRef.current.rotation.x =  0.03 * Math.sin(t * 1.1);
    if (rightArmRef.current) rightArmRef.current.rotation.x = -0.03 * Math.sin(t * 1.1);
  });
  return (
  <group ref={groupRef} position={[posX, baseY, posZ]} rotation={groupRotation} scale={[scale, scale, scale]} raycast={null} frustumCulled={false}>
      {/* Upper body wrapper so feet/root remain planted */}
      <group ref={upperRef} position={[0, 0.15, 0]}>
        {/* Torso */}
        <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[bodyR, Math.max(0.2, bodyH - bodyR * 2), 8, 16]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>
        {/* Head + neck */}
        <mesh position={[0, bodyH + neckH + headR, 0]} castShadow>
        <sphereGeometry args={[headR, 24, 24]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>
        <mesh position={[0, bodyH + neckH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR * 0.45, headR * 0.5, neckH, 12]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>

        {/* Simple shoulders */}
        <mesh position={[0, bodyH - 0.3, 0]} castShadow>
        <boxGeometry args={[shoulderW, 0.28, 0.5]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>

        {/* Arms resting on table edge */}
        <group position={[0, 0.05, faceDir * 0.25]}>
        <mesh ref={leftArmRef} position={[ shoulderW / 2 - 0.2, 0, 0]} rotation={[0, 0, Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
          <mesh ref={rightArmRef} position={[-shoulderW / 2 + 0.2, 0, 0]} rotation={[0, 0, -Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
        </group>

        {/* Minimal face hint: two eyes (always toward center) */}
        <group position={[0, bodyH + neckH + headR, faceDir * 0.28]}>
        <mesh position={[-0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
          <mesh position={[ 0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
        </group>
      </group>
    </group>
  );
}


export function resolveAvatarUrl({ flip180 } = {}) {
  try {
    const envUrl = (process.env.REACT_APP_OPPONENT_MODEL_URL || process.env.REACT_APP_AVATAR_URL || '').trim();
    if (envUrl) return envUrl;
  } catch {}
  try {
    const winUrl = (window.OPPONENT_MODEL_URL ? String(window.OPPONENT_MODEL_URL).trim() : (window.AVATAR_URL ? String(window.AVATAR_URL).trim() : ''));
    if (winUrl) return winUrl;
  } catch {}
  // Always use the robot model (two separate instances)
  return '/models/avatars/robot/scene.gltf';
}

// Preload avatars (Player1 robot, Player2 tire)
try { useGLTF.preload('/models/avatars/robot/scene.gltf'); } catch {}
try { useGLTF.preload('/models/avatars/tire/scene.gltf'); } catch {} // may still be used later
try { useGLTF.preload('/models/avatars/capuccino/scene.gltf'); } catch {} // kept for future
try { useGLTF.preload('/models/avatars/shark/scene.gltf'); } catch {}

// Preload Alien 2 FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Walking_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Running_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx'); } catch {}
// Preload Astronaut FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Walking.fbx'); } catch {}
// Preload shooting animations
try { useFBX.preload('/models/avatars/astronaut/shooting/rifle aiming idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/firing rifle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/rifle run.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/walking.fbx'); } catch {}
// Preload new shooting animations
try { useFBX.preload('/models/avatars/astronaut/shooting/strafe.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/strafe (2).fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/walking backwards.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/run backwards.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/jump forward.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/jump backward.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/shooting/walking to dying.fbx'); } catch {}
// Preload Guy1 FBX clips
try { useFBX.preload('/models/avatars/guy1/Happy Idle (1).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Walking (5).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Walking Backwards.fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Running (3).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Left Turn (4).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Right Turn (2).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Jumping.fbx'); } catch {}

// Fixed scale multiplier to reach final absolute height after normalization (inlined where needed)


export function LoadedOpponent({ url, flip180, anchorY, z, faceDir, scaleMul, rotationOverride = null, positionOverride = null, xFront, xBack, zSign = -1 }) {
  const { scene, animations } = useGLTF(url);
  const isCapuccino = /capuccino/i.test(url);
  // Use SkeletonUtils.clone to preserve skinned mesh + skeleton hierarchy (fixes partial/missing geometry)
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const ref = useRef();
  const spineRef = useRef(null);
  const headRef = useRef(null);
  const shoulders = useRef({ left: null, right: null });
  // Attempt to keep decorative tube(s) anchored: collect all likely nodes by name
  const tubeRefs = useRef({ head: new Set(), body: new Set() });
  // Explicit bone map for the Neon Robot model (from provided GLTF node names)
  const boneMap = useRef({ spine0: null, spine1: null, spine2: null, lShoulder: null, rShoulder: null, lElbow: null, rElbow: null });
  // Base positions to allow gentle up/down bobbing without drifting
  const basePos = useRef({ spine: null, l: null, r: null, head: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store initial rotations so we animate relative to the bind pose
  const baseRot = useRef({ spine: null, head: null, l: null, r: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store the model root's normalized transform so animations can't drift it
  const baseRoot = useRef({ pos: new THREE.Vector3(0,0,0), rot: new THREE.Euler(0,0,0), scale: new THREE.Vector3(1,1,1) });
  // Built-in animation handling
  const groupRef = useRef();
  const { actions, names, clips } = useAnimations(animations || [], ref);
  const hasClips = !!(clips && clips.length);
  useLayoutEffect(() => {
  if (!ref.current || !cloned) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      // Center inner root around its visual center so group pivot acts as true center
      ref.current.position.x += -center.x;
      ref.current.position.z += -center.z;
      const isCap = /capuccino/i.test(url);
      const isShark = /shark/i.test(url);
      if (isCap) {
        // Heuristic: choose a child with a moderate vertical extent as the "body" (ignoring far separated props)
        let bodyNode = null;
        let bodyHeight = Infinity;
        let bodyMinY = 0;
        ref.current.children.forEach(ch => {
          if (!ch.isObject3D) return;
          const cb = new THREE.Box3().setFromObject(ch);
            if (cb.isEmpty()) return;
            const h = cb.max.y - cb.min.y;
            // Skip extremely tall groups (likely including floating weapons) and very tiny ones
            if (h <= 0) return;
            if (h > size.y * 0.95) return; // looks like full range including props
            if (h < size.y * 0.02) return; // too small (single part)
            // Prefer a height closest to 30% of global size or just the first reasonable one
            const targetFrac = 0.30 * size.y;
            const score = Math.abs(h - targetFrac);
            // Track best candidate by minimal score; fallback to smallest reasonable height if not set
            if (!bodyNode || score < bodyHeight) {
              bodyNode = ch;
              bodyHeight = score;
              bodyMinY = cb.min.y;
            }
        });
        // Fallback: if no candidate, use global but clamp to avoid huge compression
        let effectiveHeight;
        let effectiveMinY;
        if (bodyNode) {
          const bb = new THREE.Box3().setFromObject(bodyNode);
          effectiveHeight = Math.max(0.0001, bb.max.y - bb.min.y);
          effectiveMinY = bb.min.y;
        } else {
          effectiveHeight = Math.max(0.0001, size.y * 0.45); // assume body is ~45% of total span
          effectiveMinY = box.min.y + size.y * 0.25; // ignore bottom quarter (possible outliers)
        }
        // Ground by shifting so chosen minY lands at y=0
        ref.current.position.y += -effectiveMinY;
        const desired = AVATAR_BASE_HEIGHT;
        const s = desired / effectiveHeight;
        ref.current.scale.multiplyScalar(s);
      } else if (isShark) {
        // Shark path: treat like robot (full recenter) PLUS glue obvious accessories to closest large parent before scaling
        const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
        const meshes = [];
        ref.current.traverse(o => { if (o.isMesh) meshes.push(o); });
        // Determine primary body as largest volume mesh
        let bodyMesh = null; let maxVol = 0;
        meshes.forEach(m => { const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return; const s2 = new THREE.Vector3(); b.getSize(s2); const vol = s2.x*s2.y*s2.z; if (vol > maxVol) { maxVol = vol; bodyMesh = m; } });
        if (bodyMesh) {
          meshes.forEach(m => {
            if (m === bodyMesh) return;
            if (accessoryRegex.test(m.name || '')) {
              try { bodyMesh.attach(m); } catch {}
            }
          });
        }
        // Recompute box after attaching
        const box2 = new THREE.Box3().setFromObject(ref.current);
        const size2 = new THREE.Vector3(); const center2 = new THREE.Vector3();
        box2.getSize(size2); box2.getCenter(center2);
        ref.current.position.x += -center2.x;
        ref.current.position.z += -center2.z;
        ref.current.position.y += -box2.min.y;
        if (size2.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size2.y;
          ref.current.scale.setScalar(s);
        }
      } else {
        // Robot (default) path: full recenter
        ref.current.position.x += -center.x;
        ref.current.position.z += -center.z;
        ref.current.position.y += -box.min.y;
        if (size.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size.y;
          ref.current.scale.setScalar(s);
        }
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const dbgBox = new THREE.Box3().setFromObject(ref.current);
        const dbgSize = new THREE.Vector3(); dbgBox.getSize(dbgSize);
        // eslint-disable-next-line no-console
        console.log('[Capuccino Avatar] normalized root', {
          pos: ref.current.position.clone(),
          scale: ref.current.scale.clone(),
          size: dbgSize
        });
      } catch {}
    }
    // Record the normalized root transform as our baseline
    baseRoot.current.pos.copy(ref.current.position);
    baseRoot.current.rot.copy(ref.current.rotation);
    baseRoot.current.scale.copy(ref.current.scale);
    // Skip robot-specific bone/tube mapping for capuccino model to prevent scattering
  if (!/capuccino/i.test(url) && !/shark/i.test(url)) {
      ref.current.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
        if (o.isBone) {
          const name = (o.name || '').toLowerCase();
          if (!spineRef.current && (name.includes('spine') || name.includes('chest'))) spineRef.current = o;
          if (!headRef.current && name.includes('head')) headRef.current = o;
          if (!spineRef.current && name.includes('hips')) spineRef.current = o;
          if (!shoulders.current.left && (name.includes('shoulder') && (name.includes('l') || name.includes('left') || name.endsWith('.l')))) shoulders.current.left = o;
          if (!shoulders.current.right && (name.includes('shoulder') && (name.includes('r') || name.includes('right') || name.endsWith('.r')))) shoulders.current.right = o;
          switch (o.name) {
            case 'Bone_00': boneMap.current.spine0 = o; break;
            case 'Bone.001_01': boneMap.current.spine1 = o; break;
            case 'Bone.002_02': boneMap.current.spine2 = o; break;
            case 'Bone.003_03': boneMap.current.lShoulder = o; break;
            case 'Bone.004_04': boneMap.current.lElbow = o; break;
            case 'Bone.005_05': boneMap.current.rShoulder = o; break;
            case 'Bone.006_06': boneMap.current.rElbow = o; break;
            default: break;
          }
        }
      });
    } else {
      // Still enable shadows for meshes in capuccino hierarchy
      ref.current.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    }

    // If we detected tube nodes, attach them to the appropriate bones/groups so they follow animation
    const headBone = headRef.current || boneMap.current.spine2 || null;
    const bodyBone = boneMap.current.spine1 || boneMap.current.spine0 || spineRef.current || null;
    try {
      if (headBone && tubeRefs.current.head.size) {
        tubeRefs.current.head.forEach((node) => {
          if (node && node.parent !== headBone) headBone.attach(node);
        });
      }
    } catch {}
    try {
      if (bodyBone && tubeRefs.current.body.size) {
        tubeRefs.current.body.forEach((node) => {
          if (node && node.parent !== bodyBone) bodyBone.attach(node);
        });
      }
    } catch {}
    // Record base rotations once
    baseRot.current.spine  = spineRef.current?.rotation ? spineRef.current.rotation.clone() : null;
    baseRot.current.head   = headRef.current?.rotation ? headRef.current.rotation.clone() : null;
    baseRot.current.l      = shoulders.current.left?.rotation ? shoulders.current.left.rotation.clone() : null;
    baseRot.current.r      = shoulders.current.right?.rotation ? shoulders.current.right.rotation.clone() : null;
    baseRot.current.spine0 = boneMap.current.spine0?.rotation ? boneMap.current.spine0.rotation.clone() : null;
    baseRot.current.spine1 = boneMap.current.spine1?.rotation ? boneMap.current.spine1.rotation.clone() : null;
    baseRot.current.spine2 = boneMap.current.spine2?.rotation ? boneMap.current.spine2.rotation.clone() : null;
    baseRot.current.lSh    = boneMap.current.lShoulder?.rotation ? boneMap.current.lShoulder.rotation.clone() : null;
    baseRot.current.rSh    = boneMap.current.rShoulder?.rotation ? boneMap.current.rShoulder.rotation.clone() : null;
    baseRot.current.lEl    = boneMap.current.lElbow?.rotation ? boneMap.current.lElbow.rotation.clone() : null;
    baseRot.current.rEl    = boneMap.current.rElbow?.rotation ? boneMap.current.rElbow.rotation.clone() : null;
  // Record base positions once (for subtle vertical bobbing of upper body)
  basePos.current.spine  = spineRef.current?.position ? spineRef.current.position.clone() : null;
  basePos.current.l      = shoulders.current.left?.position ? shoulders.current.left.position.clone() : null;
  basePos.current.r      = shoulders.current.right?.position ? shoulders.current.right.position.clone() : null;
  basePos.current.head   = headRef.current?.position ? headRef.current.position.clone() : null;
  basePos.current.spine0 = boneMap.current.spine0?.position ? boneMap.current.spine0.position.clone() : null;
  basePos.current.spine1 = boneMap.current.spine1?.position ? boneMap.current.spine1.position.clone() : null;
  basePos.current.spine2 = boneMap.current.spine2?.position ? boneMap.current.spine2.position.clone() : null;
  basePos.current.lSh    = boneMap.current.lShoulder?.position ? boneMap.current.lShoulder.position.clone() : null;
  basePos.current.rSh    = boneMap.current.rShoulder?.position ? boneMap.current.rShoulder.position.clone() : null;
  basePos.current.lEl    = boneMap.current.lElbow?.position ? boneMap.current.lElbow.position.clone() : null;
  basePos.current.rEl    = boneMap.current.rElbow?.position ? boneMap.current.rElbow.position.clone() : null;
  }, [cloned, scaleMul]);
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const py = AVATAR_BAKED_POS[1];
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const groupRotation = rotationOverride ?? [0, pz > 0 ? Math.PI : 0, 0];
  const baseY = anchorY + py; // support Y anchor
  useFrame(({ clock }) => {
    const g = groupRef.current; if (!g) return;
    // Root stays put so feet contact remains constant (unless overridden)
    const useOverride = Array.isArray(positionOverride);
    const outX = useOverride ? (positionOverride[0] || 0) : px;
    const outZ = useOverride ? (positionOverride[2] || 0) : pz;
    g.position.x = outX;
    g.position.y = baseY;
    g.position.z = outZ;
    g.scale.set(scaleMul, scaleMul, scaleMul);
    // Apply full rotation override if provided, else preserve existing y (camera-facing) and set z from groupRotation
    if (Array.isArray(rotationOverride)) {
      g.rotation.set(rotationOverride[0] || 0, rotationOverride[1] || 0, rotationOverride[2] || 0);
    } else {
      g.rotation.z = groupRotation?.[2] || 0;
    }
    // If model has native animation clips, lock the model root to baseline so placement matches robot
    if (ref.current && baseRoot.current) {
      ref.current.position.copy(baseRoot.current.pos);
      ref.current.rotation.copy(baseRoot.current.rot);
      ref.current.scale.copy(baseRoot.current.scale);
    }
    // Skip custom robot bone sway logic for capuccino model (prevents malformed pose / missing parts)
    if (isCapuccino) return;
    // Apply tiny rotations to upper bones if we found them
  const t = clock.getElapsedTime();
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const nodFast  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.10);
    const nodSlow  = Math.sin(t * (AVATAR_IDLE_SPEED_Y * 0.65) * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.06);
    // Gentle vertical bob for breathing â€“ apply as translation to upper body anchors
  const bob  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.30);
  // Occasional slow weight shift (very low frequency lean)
  // Much subtler occasional weight shift: slower and smaller
  const shift = Math.sin(t * 0.05 * 2 * Math.PI) * 0.02; // ~20s period, ~1.1Â°

    // Prefer explicit robot bones for more natural distribution
    const b = boneMap.current;
    if (b.spine0 && baseRot.current.spine0) {
      // hips/base: keep feet planted; very subtle slow lean
      b.spine0.rotation.z = baseRot.current.spine0.z + (-sway * 0.25) + (shift * 0.3);
      b.spine0.rotation.x = baseRot.current.spine0.x + (nodSlow * 0.3);
    }
    if (b.spine1 && baseRot.current.spine1) {
      b.spine1.rotation.z = baseRot.current.spine1.z + (sway * 0.6) + (shift * 0.25);
      b.spine1.rotation.x = baseRot.current.spine1.x + (nodSlow * 0.6);
    }
    if (b.spine2 && baseRot.current.spine2) {
      b.spine2.rotation.z = baseRot.current.spine2.z + (sway * 0.85) + (shift * 0.12);
      b.spine2.rotation.x = baseRot.current.spine2.x + (nodFast * 1.0);
      if (b.spine2.position && basePos.current.spine) b.spine2.position.y = basePos.current.spine.y + bob * 0.6;
    }
    if (b.lShoulder && baseRot.current.lSh) b.lShoulder.rotation.z = baseRot.current.lSh.z + (-sway * 0.9) + (-shift * 0.18);
    if (b.rShoulder && baseRot.current.rSh) b.rShoulder.rotation.z = baseRot.current.rSh.z + (sway * 0.9) + (shift * 0.18);
    if (b.lElbow && baseRot.current.lEl) b.lElbow.rotation.z = baseRot.current.lEl.z + (sway * 0.15);
    if (b.rElbow && baseRot.current.rEl) b.rElbow.rotation.z = baseRot.current.rEl.z + (-sway * 0.15);

    // Fallback to generic captures if explicit ones are missing
    if (!b.spine0 && spineRef.current && baseRot.current.spine) {
      spineRef.current.rotation.z = baseRot.current.spine.z + sway * 1.0;
      spineRef.current.rotation.x = baseRot.current.spine.x + nodFast * 0.28;
      if (basePos.current.spine) spineRef.current.position.y = basePos.current.spine.y + bob;
    }
    if (!b.lShoulder && shoulders.current.left && baseRot.current.l) {
      shoulders.current.left.rotation.z = baseRot.current.l.z + (-sway * 0.9);
      if (basePos.current.l) shoulders.current.left.position.y = basePos.current.l.y + bob;
    }
    if (!b.rShoulder && shoulders.current.right && baseRot.current.r) {
      shoulders.current.right.rotation.z = baseRot.current.r.z + (sway * 0.9);
      if (basePos.current.r) shoulders.current.right.position.y = basePos.current.r.y + bob;
    }
    // No camera-aware motion per request
  });
  // Play built-in idle (or first clip) if present
  useLayoutEffect(() => {
    if (!hasClips || !actions) return;
    const idleName = (names && names.find(n => /idle/i.test(n))) || Object.keys(actions)[0];
    const a = idleName ? actions[idleName] : null;
    if (a) {
      a.reset().fadeIn(0.25).play();
    }
    return () => { if (a) a.fadeOut(0.2); };
  }, [hasClips, actions, names]);
  return (
  <group ref={groupRef} position={[px, baseY, pz]} rotation={groupRotation} scale={[scaleMul, scaleMul, scaleMul]} raycast={null} frustumCulled={false}>
      <primitive ref={ref} object={cloned} dispose={null} />
      <group position={[0, 0, faceDir * 0.12]} />
    </group>
  );
}

// Minimal loader for inspection (no bone logic) â€“ used for capuccino test
// Specialized component to properly normalize and display the capuccino model.
// Strategy:
// 1. Clone with SkeletonUtils to preserve any skinning.
// 2. Identify "core" meshes (body/limbs/head/shoes) by name patterns, ignoring accessories (katana, bandana, facial detail) for scaling.
// 3. Compute bounding box of core set; fallback to global if none.
// 4. Recentre X/Z on core center, ground on core minY, scale core height to AVATAR_BASE_HEIGHT.
// 5. Do not manipulate bones or apply robot idle sway; remain static for integrity.

export function CapuccinoOpponent({ rotation=[0,Math.PI,0], xOffset=0, zSign=-1, xFront=AVATAR_X_FRONT, xBack=AVATAR_X_BACK }) {
  const url = '/models/avatars/capuccino/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const wrapRef = useRef(); // group we move/scale
  const modelRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !modelRef.current || !wrapRef.current) return;
    // Collect candidate core meshes
    const coreRegex = /(body_|legs_|arms_|hands_|shoes_|capuccinoassasino|spine_|root_01|head_)/i;
  const accessoryRegex = /(katana|bandana|cup|eyebrow|eyelid|eyes?)/i;
  const accessories = [];
    const coreMeshes = [];
    modelRef.current.traverse(o => {
      if (o.isMesh) {
        const n = (o.name||'');
        if (coreRegex.test(n) && !accessoryRegex.test(n)) coreMeshes.push(o); else if (accessoryRegex.test(n)) accessories.push(o);
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      }
    });
    let coreBox = new THREE.Box3();
    if (coreMeshes.length) {
      coreMeshes.forEach(m => coreBox.expandByObject(m));
    } else {
      coreBox.setFromObject(modelRef.current);
    }
    if (coreBox.isEmpty()) return;
    const coreSize = new THREE.Vector3(); coreBox.getSize(coreSize);
    const coreCenter = new THREE.Vector3(); coreBox.getCenter(coreCenter);
    const coreHeight = coreSize.y > 0 ? coreSize.y : 1;
    const scale = AVATAR_BASE_HEIGHT / coreHeight;
    // Apply transforms to modelRef (child of wrapRef) so we can still position wrapRef in world
    modelRef.current.position.x += -coreCenter.x;
    modelRef.current.position.z += -coreCenter.z;
    modelRef.current.position.y += -coreBox.min.y; // ground feet/base
    modelRef.current.scale.multiplyScalar(scale);

    // Process accessories: either hide distant ones or pull them toward the body root.
    const MAX_DIST = coreSize.length() * 1.2; // heuristic threshold
    accessories.forEach(a => {
      const apos = new THREE.Vector3(); a.getWorldPosition(apos);
      const rel = apos.clone().sub(coreCenter);
      if (rel.length() > MAX_DIST) {
        // Hide extreme outliers (likely duplicate props far away)
        a.visible = false;
      } else {
        // Recentre moderate-distance accessories so they cling to body (preserve vertical offset a bit)
        a.position.x += -coreCenter.x * 0.9;
        a.position.z += -coreCenter.z * 0.9;
      }
    });
  }, [cloned]);

  if (!cloned) return null;
  // Compute anchored world placement similar to other avatars
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? xFront : xBack) + xOffset;
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - 0.02; const py = AVATAR_BAKED_POS[1];
  const baseScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT * CAPUCCINO_SCALE_BOOST;
  return (
    <group ref={wrapRef} position={[px, groundY + py, pz]} rotation={rotation} scale={[baseScale, baseScale, baseScale]} frustumCulled={false}>
      <group ref={modelRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// (Removed custom SharkOpponent; shark now uses the same GLTFOpponent pipeline as robot.)


export function GLTFOpponent({ url, flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match ground/table reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - 0.02;
  const scaleMul = (AVATAR_FINAL_HEIGHT / AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleOverride) ? scaleOverride : 1);
  // LoadedOpponent normalizes then applies scaleMul and idle animation
  return (
    <LoadedOpponent
      url={url}
      flip180={flip180}
      anchorY={groundY}
      z={0}
      faceDir={0}
      scaleMul={scaleMul}
      rotationOverride={rotationOverride}
      positionOverride={positionOverride}
      xFront={xFront}
      xBack={xBack}
      zSign={zSign}
    />
  );
}

// RawSharkOpponent: load shark exactly as authored (no recenter per child, no accessory re-parent),
// only ground and uniformly scale via inner pivot, then place via outer group.

export function RawSharkOpponent({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef(); // we shift & scale this
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add cloned scene once under pivot
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute full scene bounds WITHOUT altering child transforms (preserve layout)
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Do NOT move or re-parent any skinned child; adjust only the pivot to keep authored hierarchy intact
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first animation clip (if any) similar to robot approach
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * SHARK_SCALE_BOOST; // boosted final presence
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? 0 : Math.PI), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// SharkFixed: "glue" scattered shark parts (teeth/eyes/fins) to the main body and apply only wrapper scaling.
// Strategy:
// 1. Clone scene untouched.
// 2. Identify main body mesh (largest volume or name match).
// 3. Categorize accessory meshes (teeth/eyes/mouth/jaw) and re-parent them to body root (preserves world transforms but keeps them together).
// 4. Compute body bounding box (body root only) to determine scale + ground offset.
// 5. Apply translation (ground) and uniform scale ONLY at an inner pivot group; outer group handles world placement & final size.
// 6. Optionally down-scale oversized accessories ( > 20% of body height ).

export function SharkFixed({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    const bodyRegex = /(body|torso|main|mesh)/i;
    const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
    let bodyMesh = null;
    const accessories = [];
    const meshes = [];
    cloned.traverse(o => {
      if (o.isMesh) {
        meshes.push(o);
        // choose body by name first, else largest volume
        if (bodyRegex.test(o.name || '')) {
          if (!bodyMesh) bodyMesh = o;
        }
      }
    });
    if (!bodyMesh) {
      // fallback: largest volume
      let maxVol = 0;
      meshes.forEach(m => {
        const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return;
        const s = new THREE.Vector3(); b.getSize(s); const vol = s.x*s.y*s.z;
        if (vol > maxVol) { maxVol = vol; bodyMesh = m; }
      });
    }
    // collect accessories (exclude body)
    meshes.forEach(m => { if (m !== bodyMesh && accessoryRegex.test(m.name || '')) accessories.push(m); });
    // Re-parent accessories to body so scaling/placement remains cohesive
    if (bodyMesh) {
      accessories.forEach(a => { if (a.parent !== bodyMesh) try { bodyMesh.attach(a); } catch {} });
    }
    // Compute body bounding box AFTER re-parent
    const bodyBox = bodyMesh ? new THREE.Box3().setFromObject(bodyMesh) : new THREE.Box3().setFromObject(cloned);
    if (bodyBox.isEmpty()) return;
    const bodySize = new THREE.Vector3(); bodyBox.getSize(bodySize);
    const bodyHeight = bodySize.y || 1;
    const minY = bodyBox.min.y;
    // Ground offset: shift pivot so body minY -> 0
    pivotRef.current.position.y += -minY;
    // Normalize body to base height at pivot level
    const normScale = AVATAR_BASE_HEIGHT / bodyHeight;
    pivotRef.current.scale.set(normScale, normScale, normScale);
    // Clamp huge accessories relative to body height
    accessories.forEach(a => {
      try {
        const ab = new THREE.Box3().setFromObject(a); if (ab.isEmpty()) return;
        const as = new THREE.Vector3(); ab.getSize(as);
        const maxDim = Math.max(as.x, as.y, as.z);
        const desired = bodyHeight * 0.20;
        if (maxDim > desired && maxDim > 0) {
          const s = desired / maxDim;
            a.scale.multiplyScalar(s);
        }
      } catch {}
    });
    // Shadows & culling flags
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const finalScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT; // amplify normalized body
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[finalScale, finalScale, finalScale]} frustumCulled={false}>
      <group ref={pivotRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// Generic skinned GLTF opponent that preserves authored skeleton and node parenting.
// It centers on X/Z, grounds at minY, and normalizes height by moving/scaling a pivot above the cloned scene.
// No re-parenting or per-mesh transforms are applied to avoid breaking skinning.

export function SkinnedGLTFOpponent({ url, xFront, xBack, zSign = -1, scaleBoost = 1 }) {
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add once
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute bounds of the authored hierarchy
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Shift only the pivot so minY -> 0 and model is centered in X/Z
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    // Enable shadows on meshes
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first clip if present
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleBoost) ? scaleBoost : 1);
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// Sandbox-style alien loader: no normalization of inner hierarchy; enforce skinning; filter tracks; lock root motion; clamp bone scale; zero non-bone transforms.

export function AlienSandboxOpponent({ url = '/models/avatars/alien/scene.gltf', xFront, xBack, zSign = -1, centerInParent = false, positionOverride = null, isWalking = false }) {
  const { scene, animations } = useGLTF(url);
  const innerRef = useRef();
  const pivotRef = useRef();
  const outerRef = useRef();
  const anchorBoneRef = useRef(null);
  const anchorInitPos = useRef(new THREE.Vector3());
  const pivotBasePos = useRef(new THREE.Vector3());
  // Enforce skinning and basic render flags; optionally zero out non-bone transforms
  useLayoutEffect(() => {
  if (!scene) return;
  scene.traverse((o) => {
      if (o.isSkinnedMesh && o.material) {
        if (!o.material.skinning) { o.material.skinning = true; o.material.needsUpdate = true; }
      }
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      const isBone = o.isBone || o.type === 'Bone';
      if (!isBone) {
        if (o.position && (o.position.x !== 0 || o.position.y !== 0 || o.position.z !== 0)) o.position.set(0,0,0);
        if (o.scale && (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1)) o.scale.set(1,1,1);
        if (o.updateMatrix) o.updateMatrix();
      }
    });
    // Removed auto-grounding (minY -> 0) for Alien
  }, [scene]);
  // Optionally center the model in its parent so the pivot is at the visual center
  useLayoutEffect(() => {
  if (!centerInParent || !scene || !pivotRef.current) return;
    if (pivotRef.current.__centeredOnce) return;
    try {
      const box = new THREE.Box3();
  scene.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) { bb.applyMatrix4(o.matrixWorld); box.union(bb); }
        }
      });
      if (!box.isEmpty()) {
        const center = new THREE.Vector3(); box.getCenter(center);
        // move inner model so its center aligns with parent's origin (idempotent)
        const px = pivotRef.current.position.x;
        const pz = pivotRef.current.position.z;
        pivotRef.current.position.set(-center.x, pivotRef.current.position.y, -center.z);
        // Update base after first centering
        pivotBasePos.current.copy(pivotRef.current.position);
        pivotRef.current.__centeredOnce = true;
      }
    } catch {}
  }, [centerInParent, scene]);
  // Filter animations like sandbox: drop non-bone tracks, lock root bone position/scale, clamp bone scales
  const filteredClips = useMemo(() => {
  if (!animations || !scene) return animations || [];
    const nameToObj = new Map();
  scene.traverse((o) => { if (o.name) nameToObj.set(o.name, o); });
    const rootBoneNames = new Set();
  scene.traverse((o) => {
      if ((o.isBone || o.type === 'Bone') && (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone'))) {
        if (o.name) rootBoneNames.add(o.name);
      }
    });
  const filterNonBoneTransforms = true;
  const lockRootMotion = false; // allow authored root motion
  const clampBoneScale = true;
  const stripBoneXZTranslation = false; // keep authored bone translations
    return animations.map((clip) => {
      const dropped = [];
      const newTracks = [];
      for (const track of clip.tracks) {
        const firstDot = track.name.indexOf('.');
        const nodeName = firstDot === -1 ? track.name : track.name.slice(0, firstDot);
        const property = firstDot === -1 ? '' : track.name.slice(firstDot + 1);
        const obj = nameToObj.get(nodeName);
  // If the target node doesn't exist in the loaded scene, drop the track to avoid unexpected transforms.
  if (!obj) { dropped.push(track.name); continue; }
        const isBone = obj.isBone || obj.type === 'Bone';
  // Keep animation only on bones; drop transforms on meshes or groups
  if (filterNonBoneTransforms && !isBone) { dropped.push(track.name); continue; }
        if (lockRootMotion && isBone && (property.startsWith('position') || property.startsWith('scale')) && rootBoneNames.has(nodeName)) {
          dropped.push(track.name); continue;
        }
        // Remove forward locomotion baked into bone position tracks: keep vertical bob (Y), zero X/Z.
        if (
          stripBoneXZTranslation &&
          isBone &&
          property.startsWith('position')
        ) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              // Check if X/Z have meaningful movement to avoid touching non-moving tracks
              let sumXZ = 0;
              for (let i = 0; i < values.length; i += 3) {
                sumXZ += Math.abs(values[i]) + Math.abs(values[i+2]);
              }
              if (sumXZ > 1e-5) {
                for (let i = 0; i < values.length; i += 3) {
                  // x, y, z â€” keep y (vertical), zero x/z to eliminate drift
                  values[i] = 0;
                  // values[i+1] stays as is (breathe/bounce)
                  values[i+2] = 0;
                }
                newTracks.push(new ctor(track.name, times, values, track.interpolation));
                continue;
              }
            }
          } catch {}
        }
        if (clampBoneScale && isBone && property.startsWith('scale')) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              const minS = 0.01, maxS = 100;
              for (let i = 0; i < values.length; i += 3) {
                values[i]   = Math.min(maxS, Math.max(minS, values[i]));
                values[i+1] = Math.min(maxS, Math.max(minS, values[i+1]));
                values[i+2] = Math.min(maxS, Math.max(minS, values[i+2]));
              }
              newTracks.push(new ctor(track.name, times, values, track.interpolation));
              continue;
            }
          } catch {}
        }
        newTracks.push(track);
      }
      if (newTracks.length === clip.tracks.length) return clip;
      const clonedClip = clip.clone();
      clonedClip.tracks = newTracks;
      if (dropped.length) {
        try { console.info('[C4 Alien] Dropped tracks:', dropped); } catch {}
      }
      return clonedClip;
    });
  }, [animations, scene]);
  // Use one mixer for all clips and cross-fade between idle and walk
  const { actions: allActions, names: clipNames } = useAnimations(filteredClips || [], innerRef);
  const currentActionRef = useRef(null); // 'idle' | 'walk' | null
  const pickIdleName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    let idle = byName(/idle|stand|breath|breathe/i);
    if (!idle) idle = clips.reduce((a,b)=> (a && a.duration>=b.duration?a:b), null) || clips[0];
    return idle ? (idle.name || null) : null;
  }, [filteredClips]);
  const pickWalkName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    // Prefer explicit alien clip names if present
    let w = clips.find(c => (c.name||'').toLowerCase() === 'zbs_phobos.qc_skeleton|zbs_walk'.toLowerCase());
    if (!w) w = byName(/walk|run|move|stride|jog|locomotion|forward|pace|step/i);
    if (!w) {
      const idleLike = /idle|stand|breath|breathe|pose|look/i;
      w = clips.find(c => !idleLike.test(c.name||'') && (c.duration||0) > 0.5) || null;
    }
    return w ? (w.name || null) : null;
  }, [filteredClips]);
  useLayoutEffect(() => {
    if (!allActions) return;
    const idle = pickIdleName ? allActions[pickIdleName] : null;
    const walk = pickWalkName ? allActions[pickWalkName] : null;
    const want = isWalking ? 'walk' : 'idle';
    if (currentActionRef.current === want) return;
    // stop previous
    try {
      if (currentActionRef.current === 'walk' && walk) walk.stop();
      if (currentActionRef.current === 'idle' && idle) idle.stop();
    } catch {}
    // start next
    if (isWalking && walk) {
      try { walk.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
    } else if (!isWalking && idle) {
      try { idle.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
      // when going to idle, snap pivot back to base to clear any in-place offsets
      if (pivotRef.current && pivotBasePos.current) {
        pivotRef.current.position.x = pivotBasePos.current.x;
        pivotRef.current.position.z = pivotBasePos.current.z;
      }
    }
    currentActionRef.current = want;
    return () => { /* keep actions managed by drei mixer lifecycle */ };
  }, [allActions, isWalking, pickIdleName, pickWalkName]);

  // Find an anchor bone (prefer hips/pelvis, fallback to any root bone) and capture its initial parent-local XZ baseline
  useEffect(() => {
  if (!scene || !pivotRef.current) return;
    let hips = null;
    const roots = [];
  scene.traverse((o) => {
      if (o && (o.isBone || o.type === 'Bone')) {
        const nm = (o.name || '').toLowerCase();
        if (/hip|pelvis/.test(nm)) hips = o;
        if (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone')) roots.push(o);
      }
    });
    const anchor = hips || roots[0] || null;
    anchorBoneRef.current = anchor;
    if (anchor) {
      try {
        anchor.updateWorldMatrix && anchor.updateWorldMatrix(true, false);
        const world = new THREE.Vector3();
        anchor.getWorldPosition(world);
        const parent = outerRef.current;
        if (parent && parent.worldToLocal) {
          const local = world.clone();
          parent.worldToLocal(local);
          anchorInitPos.current.copy(local);
        } else {
          anchorInitPos.current.copy(world);
        }
      } catch {}
    }
    // record current pivot offset as base
    if (pivotRef.current) pivotBasePos.current.copy(pivotRef.current.position || new THREE.Vector3());
  }, [scene]);

  // (Removed re-baseline on state change to avoid any visual separation or snapping)

  // Runtime inverse-offset to keep animation in-place on X/Z (preserve vertical bob).
  // Compute anchor drift in the parent's local space so we don't fight parent rotation/translation.
  useFrame(() => { /* no in-place enforcement; play clips as-authored */ });
  // World placement using only parent-level transforms (no inner normalization)
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const baseY = groundY + py;
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;
  const outerScale = 0.09; // slightly reduced alien presence
  // Do not auto-flip by side; facing is controlled by parent mover/overrides
  const rotY = 0;
  // Note: removed auto floor calibration and per-frame height adjustments for Alien

  return (
  <group ref={outerRef} position={[outX, baseY, outZ]} rotation={[0, rotY, 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef}>
  {scene ? <primitive ref={innerRef} object={scene} dispose={null} /> : null}
      </group>
    </group>
  );
}

// FBX-based Alien 2 opponent: Idle when stopped, Walk when moving

export function Alien2FBXOpponent({
  baseUrl = '/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx',
  walkUrl = '/models/avatars/alien 2/Animation_Walking_withSkin.fbx',
  runUrl = '/models/avatars/alien 2/Animation_Running_withSkin.fbx',
  turnLeftUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx',
  turnRightUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx',
  jumpUrl = '/models/avatars/alien 2/Animation_Regular_Jump_withSkin.fbx',
  flyUrl = '/models/avatars/astronaut/Flying.fbx',
  xFront,
  xBack,
  zSign = -1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  yawOffset = 0,
  scaleMul = 0.09, // slightly reduced default size
  isJumping = false,
  isJetpacking = false,
  isFalling = false,
  jetpackTiltX = 0,
  jetpackTiltZ = 0,
  extraLiftY = 0
}){
  // Load both FBXs unconditionally for stable hook order
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const fly   = useFBX(flyUrl);
  // Clone the loaded FBX so multiple instances don't share the same skinned meshes
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();
  

  // Merge animations and namespace to pick deterministically
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  const flyAnimsRaw  = useMemo(() => ((fly  && fly.animations)  ? fly.animations  : []), [fly]);
  // Build bone map for retargeting cross-character animations (e.g. astronaut fly → alien rig)
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);
  // Lock root Y position but allow natural tail/spine movement during idle animation
  const lockYPositionClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      const tracks = clip.tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Only remove position tracks for root/hips/mixamorig (character root movement)
        // This preserves tail and other body part animations
        if (n.endsWith('.position')) {
          const isRootBone = n.includes('mixamorig') || n.includes('hips') || n.includes('pelvis') || n.split('.')[0].length < 5;
          return !isRootBone; // Keep non-root position tracks (tail, spine, etc.)
        }
        return true;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);
  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockYPositionClip(c)), [baseAnimsRaw, lockYPositionClip]);
  // Preserve original locomotion tracks (allow root motion)
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(
    `walk:${c.name || 'clip'}`, c.duration, c.tracks
  )), [walkAnimsRaw]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(
    `run:${c.name || 'clip'}`, c.duration, c.tracks
  )), [runAnimsRaw]);
  // For turn clips, make them fully in-place: drop root translation AND hips/pelvis rotations.
  // The PlayerMover rotates the character yaw; the clip supplies upper-body turn motion only.
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // remove all position tracks (prevent any X/Z shift)
        if (n.endsWith('.position')) return false;
        // also remove hips/pelvis rotations to avoid root twist-induced drift
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove Y position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove Y position tracks to prevent animation from fighting physics
        if (n.endsWith('.position')) {
          // Check if this is specifically the Y component or a full position vector
          return false; // Remove all position tracks to be safe
        }
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(c.tracks)
  )), [jumpAnimsRaw, filterJumpTracks]);
  // Filter fly tracks: strip hips/pelvis rotation + position so procedural tilt controls orientation
  const filterFlyTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const flyAnims = useMemo(() => flyAnimsRaw.map(c => new THREE.AnimationClip(
    `fly:${c.name || 'clip'}`, c.duration, filterFlyTracks(retargetTracks(c.tracks))
  )), [flyAnimsRaw, retargetTracks, filterFlyTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims, ...flyAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims, flyAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);
  const modelHeightRef = useRef(0);

  // Ground model to align feet with floor and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) modelHeightRef.current = box.max.y - box.min.y;
      // Enable shadows, prevent frustum culling, tag for bullet hit detection
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.isPlayer = true; } });
      
      // Adjust idle stance: bring feet closer together by slightly adducting upper legs
      try {
        const normName = (s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
        const bones = [];
        model.traverse(o => { if (o && (o.isBone || o.type==='Bone')) bones.push(o); });
        const findUpper = (side)=>{
          const targetA = side==='L' ? ['leftupleg','leftthigh'] : ['rightupleg','rightthigh'];
          return bones.find(b=>{ const n=normName(b.name); return targetA.some(t=>n.includes(t)); });
        };
        const L = findUpper('L');
        const R = findUpper('R');
        const angle = 0.10; // ~5.7 degrees inward
        if (L) { L.rotation.z = (L.rotation?.z || 0) - angle; }
        if (R) { R.rotation.z = (R.rotation?.z || 0) + angle; }
      } catch {}
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    // Already playing this animation — don't reset it (avoids T-pose flicker)
    if (prev === next && next.isRunning()) return;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE);
      else if (name.startsWith('run:')) v = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE);
  else if (name.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
  else if (name.startsWith('fly:')) v = 1.0;
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(happy|idle)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);
  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);
  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);
  const pickFlyName = useMemo(() => {
    if (!flyAnimsRaw || flyAnimsRaw.length === 0) return null;
    const byName = flyAnimsRaw.find(c => /fly|float|hover/i.test(c.name));
    const chosen = byName || flyAnimsRaw[0];
    return chosen ? `fly:${chosen.name || 'clip'}` : null;
  }, [flyAnimsRaw]);

  // Start idle immediately to avoid bind-pose flash; then cross-fade based on state (including jump)
  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJetpacking && pickFlyName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickFlyName);
      try { actions[pickFlyName].timeScale = 1.0; } catch {}
    } else if (!isJetpacking && (isFalling || isJumping) && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('alien.jump', 0.4); } catch {}
      } else {
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      // Running has priority over walking
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE); } catch {}
    } else if (isWalking && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      // Walk faster than before
  try { actions[pickWalkName].timeScale = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30); } catch {}
    } else if (isWalking && pickRunName) { // fallback: no walk clip available
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, pickFlyName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
  if (nm.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30);
  else if (nm.startsWith('run:')) v = getAnimSpeed('alien.run', 0.42);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
  else if (nm.startsWith('fly:')) v = 1.0;
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
    // Procedural body tilt while jetpacking
    if (innerRef.current) {
      const lerpRate = 12;
      if (isJetpacking || isFalling) {
        const totalTiltX = jetpackTiltX;
        innerRef.current.rotation.x = totalTiltX;
        innerRef.current.rotation.z = -jetpackTiltZ;
        const halfH = modelHeightRef.current * 0.5;
        innerRef.current.position.y = halfH * Math.sin(Math.abs(totalTiltX));
      } else {
        const k = Math.min(1, lerpRate * dt);
        innerRef.current.rotation.x += (0 - innerRef.current.rotation.x) * k;
        innerRef.current.rotation.z += (0 - innerRef.current.rotation.z) * k;
        innerRef.current.position.y += (0 - innerRef.current.position.y) * k;
        if (Math.abs(innerRef.current.rotation.x) < 0.001) innerRef.current.rotation.x = 0;
        if (Math.abs(innerRef.current.rotation.z) < 0.001) innerRef.current.rotation.z = 0;
        if (Math.abs(innerRef.current.position.y) < 0.001) innerRef.current.position.y = 0;
      }
    }
  });

  // World placement: keep consistent with GLTF avatars using baked constants
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  // Use the provided instance yawOffset
  const effYawOffset = yawOffset;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  // World-space lift coming from stairs/table/jump so it matches the green feet marker exactly
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; if PlayerMover publishes its offset on window, read it, else fallback
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking && !isJetpacking} isWalkingBackward={isWalkingBackward && !isJetpacking} isRunning={isRunning && !isJetpacking} characterId="alien" />
          <JetpackAudio isJetpacking={isJetpacking} isRunning={isRunning} />
        </group>
      </group>
      <Suspense fallback={null}><JetpackBoneAttachment modelRef={model} isJetpacking={isJetpacking} isRunning={isRunning} /></Suspense>
    </group>
  );
}

// FBX-based Astronaut (Player 1 replacement for robot): Idle/Walk/Run with cross-fades

export function AstronautFBXOpponent({
  baseUrl = '/models/avatars/astronaut/Breathing Idle.fbx',
  walkUrl = '/models/avatars/astronaut/Walking.fbx',
  runUrl = '/models/avatars/astronaut/Running.fbx',
  turnLeftUrl = '/models/avatars/astronaut/Left Turn.fbx',
  turnRightUrl = '/models/avatars/astronaut/Right Turn.fbx',
  jumpUrl = '/models/avatars/astronaut/Jump.fbx',
  flyUrl = '/models/avatars/astronaut/Flying.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  isJetpacking = false,
  isFalling = false,
  isShooting = false,
  isAiming = false,
  isStrafeLeft = false,
  isStrafeRight = false,
  isDead = false,
  jetpackTiltX = 0,
  jetpackTiltZ = 0,
  pitch = 0,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0,
  isLocalPlayer = false
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  // Include run animation now that it's available
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const fly   = useFBX(flyUrl);
  // Shooting animation FBXs
  const rifleIdleFbx = useFBX('/models/avatars/astronaut/shooting/rifle aiming idle.fbx');
  const fireFbx      = useFBX('/models/avatars/astronaut/shooting/firing rifle.fbx');
  const rifleRunFbx  = useFBX('/models/avatars/astronaut/shooting/rifle run.fbx');
  const rifleWalkFbx = useFBX('/models/avatars/astronaut/shooting/walking.fbx');
  // New shooting animation FBXs
  const strafeLeftFbx  = useFBX('/models/avatars/astronaut/shooting/strafe (2).fbx');
  const strafeRightFbx = useFBX('/models/avatars/astronaut/shooting/strafe.fbx');
  const walkBackFbx    = useFBX('/models/avatars/astronaut/shooting/walking backwards.fbx');
  const runBackFbx     = useFBX('/models/avatars/astronaut/shooting/run backwards.fbx');
  const jumpFwdFbx     = useFBX('/models/avatars/astronaut/shooting/jump forward.fbx');
  const jumpBackFbx    = useFBX('/models/avatars/astronaut/shooting/jump backward.fbx');
  const dyingFbx       = useFBX('/models/avatars/astronaut/shooting/walking to dying.fbx');
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Cache upper-body bone refs for procedural pitch aiming + rifle attachment
  const spineBones = useMemo(() => {
    const bones = { spine1: null, spine2: null, head: null, rightHand: null };
    try {
      if (model) {
        model.traverse(o => {
          if (!o || !o.isBone) return;
          const n = String(o.name || '').toLowerCase();
          if (n.includes('spine1') && !bones.spine1) bones.spine1 = o;
          else if (n.includes('spine2') && !bones.spine2) bones.spine2 = o;
          else if (n.includes('head') && !n.includes('headtop') && !n.includes('head_end') && !bones.head) bones.head = o;
          else if (n.includes('righthand') && !n.includes('thumb') && !n.includes('index') && !n.includes('middle') && !n.includes('ring') && !n.includes('pinky') && !bones.rightHand) bones.rightHand = o;
        });
      }
    } catch {}
    return bones;
  }, [model]);
  const pitchRef = useRef(0);
  const rifleGroupRef = useRef();

  // Merge animations with namespaced clips for deterministic selection
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run && run.animations) ? run.animations : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations) ? tright.animations : []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  const flyAnimsRaw  = useMemo(() => ((fly  && fly.animations)  ? fly.animations  : []), [fly]);
  // Shooting animation raw clips
  const rifleIdleAnimsRaw = useMemo(() => ((rifleIdleFbx && rifleIdleFbx.animations) ? rifleIdleFbx.animations : []), [rifleIdleFbx]);
  const fireAnimsRaw      = useMemo(() => ((fireFbx && fireFbx.animations) ? fireFbx.animations : []), [fireFbx]);
  const rifleRunAnimsRaw  = useMemo(() => ((rifleRunFbx && rifleRunFbx.animations) ? rifleRunFbx.animations : []), [rifleRunFbx]);
  const rifleWalkAnimsRaw = useMemo(() => ((rifleWalkFbx && rifleWalkFbx.animations) ? rifleWalkFbx.animations : []), [rifleWalkFbx]);
  // New shooting raw clips
  const strafeLeftAnimsRaw  = useMemo(() => ((strafeLeftFbx && strafeLeftFbx.animations) ? strafeLeftFbx.animations : []), [strafeLeftFbx]);
  const strafeRightAnimsRaw = useMemo(() => ((strafeRightFbx && strafeRightFbx.animations) ? strafeRightFbx.animations : []), [strafeRightFbx]);
  const walkBackAnimsRaw    = useMemo(() => ((walkBackFbx && walkBackFbx.animations) ? walkBackFbx.animations : []), [walkBackFbx]);
  const runBackAnimsRaw     = useMemo(() => ((runBackFbx && runBackFbx.animations) ? runBackFbx.animations : []), [runBackFbx]);
  const jumpFwdAnimsRaw     = useMemo(() => ((jumpFwdFbx && jumpFwdFbx.animations) ? jumpFwdFbx.animations : []), [jumpFwdFbx]);
  const jumpBackAnimsRaw    = useMemo(() => ((jumpBackFbx && jumpBackFbx.animations) ? jumpBackFbx.animations : []), [jumpBackFbx]);
  const dyingAnimsRaw       = useMemo(() => ((dyingFbx && dyingFbx.animations) ? dyingFbx.animations : []), [dyingFbx]);
  // Build a simple bone-name map for retargeting breathing tracks to the rig
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  // Lock Y position but allow XZ root motion during idle animation
  const sanitizeBreathingClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Zero out Y component of position tracks to lock vertical position
      const tracks = clip.tracks.map(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position') && tr.values && tr.values.length > 0) {
          const newValues = [...tr.values];
          // Position tracks are XYZ triplets: [x0, y0, z0, x1, y1, z1, ...]
          // Zero out every Y component (indices 1, 4, 7, 10, ...)
          for (let i = 1; i < newValues.length; i += 3) {
            newValues[i] = 0;
          }
          const NewTrackClass = tr.constructor;
          return new NewTrackClass(tr.name, tr.times.slice(), newValues instanceof Float32Array ? new Float32Array(newValues) : newValues);
        }
        return tr;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position'); // drop root translation
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  // Variant of retargetTracks that KEEPS position tracks (needed for dying animation to collapse to ground)
  const retargetTracksKeepPosition = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);
  const baseAnims = useMemo(() => baseAnimsRaw.map(c => sanitizeBreathingClip(c)), [baseAnimsRaw, sanitizeBreathingClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  // Fly tracks: strip position AND hips/pelvis rotation (procedural flyCorrection handles body tilt,
  // keeping hips rotation causes the character to shift backward during crossfade from walk/run)
  const filterFlyTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const flyAnims = useMemo(() => flyAnimsRaw.map(c => new THREE.AnimationClip(
    `fly:${c.name || 'clip'}`, c.duration, filterFlyTracks(retargetTracks(c.tracks))
  )), [flyAnimsRaw, retargetTracks, filterFlyTracks]);
  // Retarget shooting clips: strip root position, remap bone names, namespace
  const rifleIdleAnims = useMemo(() => rifleIdleAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleIdle:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [rifleIdleAnimsRaw, retargetTracks]);
  const fireAnims = useMemo(() => fireAnimsRaw.map(c => new THREE.AnimationClip(
    `fire:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [fireAnimsRaw, retargetTracks]);
  const rifleRunAnims = useMemo(() => rifleRunAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleRun:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [rifleRunAnimsRaw, retargetTracks]);
  const rifleWalkAnims = useMemo(() => rifleWalkAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleWalk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [rifleWalkAnimsRaw, retargetTracks]);
  // Retarget new shooting clips
  // Retarget new shooting clips
  const strafeLeftAnims = useMemo(() => strafeLeftAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleStrafe:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [strafeLeftAnimsRaw, retargetTracks]);
  const strafeRightAnims = useMemo(() => strafeRightAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleStrafe2:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [strafeRightAnimsRaw, retargetTracks]);
  const walkBackAnims = useMemo(() => walkBackAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleWalkBack:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [walkBackAnimsRaw, retargetTracks]);
  const runBackAnims = useMemo(() => runBackAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleRunBack:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [runBackAnimsRaw, retargetTracks]);
  const jumpFwdAnims = useMemo(() => jumpFwdAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleJumpFwd:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [jumpFwdAnimsRaw, retargetTracks]);
  const jumpBackAnims = useMemo(() => jumpBackAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleJumpBack:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [jumpBackAnimsRaw, retargetTracks]);
  const dyingAnims = useMemo(() => dyingAnimsRaw.map(c => new THREE.AnimationClip(
    `rifleDying:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [dyingAnimsRaw, retargetTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims, ...flyAnims, ...rifleIdleAnims, ...fireAnims, ...rifleRunAnims, ...rifleWalkAnims, ...strafeLeftAnims, ...strafeRightAnims, ...walkBackAnims, ...runBackAnims, ...jumpFwdAnims, ...jumpBackAnims, ...dyingAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims, flyAnims, rifleIdleAnims, fireAnims, rifleRunAnims, rifleWalkAnims, strafeLeftAnims, strafeRightAnims, walkBackAnims, runBackAnims, jumpFwdAnims, jumpBackAnims, dyingAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);
  const modelHeightRef = useRef(0); // bounding-box height (local, unscaled) for fly pivot offset

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) {
        model.position.y += -box.min.y;
        modelHeightRef.current = box.max.y - box.min.y;
      }
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.isPlayer = true; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    // Already playing this animation — don't reset it (avoids T-pose flicker)
    if (prev === next && next.isRunning()) return;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    const playOnce = isJump;
    next.reset().setLoop(playOnce ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (playOnce) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
  if (name.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (name.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
  else if (name.startsWith('fly:')) v = 1.0;
  else if (name.startsWith('rifleStrafe:') || name.startsWith('rifleStrafe2:')) v = 0.45;
  else if (name.startsWith('rifleRun:')) v = 0.6;
  else if (name.startsWith('rifleRunBack:')) v = 0.45;
  else if (name.startsWith('fire:') || name.startsWith('rifleIdle:') || name.startsWith('rifleWalk:')) v = 1.0;
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);
  const pickFlyName = useMemo(() => {
    if (!flyAnimsRaw || flyAnimsRaw.length === 0) return null;
    const byName = flyAnimsRaw.find(c => /fly|float|hover/i.test(c.name));
    const chosen = byName || flyAnimsRaw[0];
    return chosen ? `fly:${chosen.name || 'clip'}` : null;
  }, [flyAnimsRaw]);
  // Shooting animation name resolvers
  const pickRifleIdleName = useMemo(() => {
    if (!rifleIdleAnimsRaw || rifleIdleAnimsRaw.length === 0) return null;
    return `rifleIdle:${rifleIdleAnimsRaw[0].name || 'clip'}`;
  }, [rifleIdleAnimsRaw]);
  const pickFireName = useMemo(() => {
    if (!fireAnimsRaw || fireAnimsRaw.length === 0) return null;
    return `fire:${fireAnimsRaw[0].name || 'clip'}`;
  }, [fireAnimsRaw]);
  const pickRifleRunName = useMemo(() => {
    if (!rifleRunAnimsRaw || rifleRunAnimsRaw.length === 0) return null;
    return `rifleRun:${rifleRunAnimsRaw[0].name || 'clip'}`;
  }, [rifleRunAnimsRaw]);
  const pickRifleWalkName = useMemo(() => {
    if (!rifleWalkAnimsRaw || rifleWalkAnimsRaw.length === 0) return null;
    return `rifleWalk:${rifleWalkAnimsRaw[0].name || 'clip'}`;
  }, [rifleWalkAnimsRaw]);
  // New shooting animation name resolvers
  const pickRifleStrafeLeftName = useMemo(() => {
    if (!strafeLeftAnimsRaw || strafeLeftAnimsRaw.length === 0) return null;
    return `rifleStrafe:${strafeLeftAnimsRaw[0].name || 'clip'}`;
  }, [strafeLeftAnimsRaw]);
  const pickRifleStrafeRightName = useMemo(() => {
    if (!strafeRightAnimsRaw || strafeRightAnimsRaw.length === 0) return null;
    return `rifleStrafe2:${strafeRightAnimsRaw[0].name || 'clip'}`;
  }, [strafeRightAnimsRaw]);
  const pickRifleWalkBackName = useMemo(() => {
    if (!walkBackAnimsRaw || walkBackAnimsRaw.length === 0) return null;
    return `rifleWalkBack:${walkBackAnimsRaw[0].name || 'clip'}`;
  }, [walkBackAnimsRaw]);
  const pickRifleRunBackName = useMemo(() => {
    if (!runBackAnimsRaw || runBackAnimsRaw.length === 0) return null;
    return `rifleRunBack:${runBackAnimsRaw[0].name || 'clip'}`;
  }, [runBackAnimsRaw]);
  const pickRifleJumpFwdName = useMemo(() => {
    if (!jumpFwdAnimsRaw || jumpFwdAnimsRaw.length === 0) return null;
    return `rifleJumpFwd:${jumpFwdAnimsRaw[0].name || 'clip'}`;
  }, [jumpFwdAnimsRaw]);
  const pickRifleJumpBackName = useMemo(() => {
    if (!jumpBackAnimsRaw || jumpBackAnimsRaw.length === 0) return null;
    return `rifleJumpBack:${jumpBackAnimsRaw[0].name || 'clip'}`;
  }, [jumpBackAnimsRaw]);
  const pickDyingName = useMemo(() => {
    if (!dyingAnimsRaw || dyingAnimsRaw.length === 0) return null;
    return `rifleDying:${dyingAnimsRaw[0].name || 'clip'}`;
  }, [dyingAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    // --- DYING (highest priority except jetpack — dead player stays on ground) ---
    if (isDead && pickDyingName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickDyingName);
      try {
        const a = actions[pickDyingName];
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.timeScale = 1.0;
      } catch {}
    } else if (isJetpacking && pickFlyName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickFlyName);
      try { actions[pickFlyName].timeScale = 1.0; } catch {}
    } else if (!isJetpacking && (isFalling || isJumping) && pickJumpName) {
      // Rifle jump variants when aiming
      if (isAiming && isWalkingBackward && pickRifleJumpBackName) {
        wasJumpingRef.current = true;
        crossFadeTo(pickRifleJumpBackName);
        try { actions[pickRifleJumpBackName].timeScale = 1.0; } catch {}
      } else if (isAiming && (isWalking || isRunning) && pickRifleJumpFwdName) {
        wasJumpingRef.current = true;
        crossFadeTo(pickRifleJumpFwdName);
        try { actions[pickRifleJumpFwdName].timeScale = 1.0; } catch {}
      } else if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('astronaut.jump', 0.65); } catch {}
        wasJumpingRef.current = true;
      } else {
        // Already in jump anim — keep it active
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
        wasJumpingRef.current = true;
      }
    } else if (isShooting && pickFireName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickFireName);
      try { actions[pickFireName].timeScale = 1.0; } catch {}
    } else if (isAiming && isStrafeLeft && pickRifleStrafeLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleStrafeLeftName);
      try { actions[pickRifleStrafeLeftName].timeScale = 0.45; } catch {}
    } else if (isAiming && isStrafeRight && pickRifleStrafeRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleStrafeRightName);
      try { actions[pickRifleStrafeRightName].timeScale = 0.45; } catch {}
    } else if (isAiming && isRunning && isWalkingBackward && pickRifleRunBackName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleRunBackName);
      try { actions[pickRifleRunBackName].timeScale = 0.45; } catch {}
    } else if (isAiming && isRunning && pickRifleRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleRunName);
      try { actions[pickRifleRunName].timeScale = 0.6; } catch {}
    } else if (isAiming && isWalkingBackward && pickRifleWalkBackName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleWalkBackName);
      try { actions[pickRifleWalkBackName].timeScale = 1.0; } catch {}
    } else if (isAiming && isWalking && pickRifleWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleWalkName);
      try { actions[pickRifleWalkName].timeScale = 1.0; } catch {}
    } else if (isAiming && pickRifleIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRifleIdleName);
      try { actions[pickRifleIdleName].timeScale = 1.0; } catch {}
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, isShooting, isAiming, isStrafeLeft, isStrafeRight, isDead, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, pickFlyName, pickFireName, pickRifleIdleName, pickRifleRunName, pickRifleWalkName, pickRifleStrafeLeftName, pickRifleStrafeRightName, pickRifleWalkBackName, pickRifleRunBackName, pickRifleJumpFwdName, pickRifleJumpBackName, pickDyingName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
  else if (nm.startsWith('fly:')) v = 1.0;
  else if (nm.startsWith('rifleStrafe:') || nm.startsWith('rifleStrafe2:')) v = 0.45;
  else if (nm.startsWith('rifleRun:')) v = 0.6;
  else if (nm.startsWith('rifleRunBack:')) v = 0.45;
  else if (nm.startsWith('fire:') || nm.startsWith('rifleIdle:') || nm.startsWith('rifleWalk:') || nm.startsWith('rifleWalkBack:') || nm.startsWith('rifleJumpFwd:') || nm.startsWith('rifleJumpBack:') || nm.startsWith('rifleDying:')) v = 1.0;
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
    // Procedural body tilt while jetpacking
    // Only apply tilt when actually airborne. On landing, smoothly lerp back to neutral.
    if (innerRef.current) {
      const lerpRate = 12; // fast but smooth transition
      if (isJetpacking || isFalling) {
        const totalTiltX = jetpackTiltX;
        innerRef.current.rotation.x = totalTiltX;
        innerRef.current.rotation.z = -jetpackTiltZ;
        // Compensate Y so the character doesn't sink below terrain when tilted
        const halfH = modelHeightRef.current * 0.5;
        innerRef.current.position.y = halfH * Math.sin(Math.abs(totalTiltX));
      } else {
        // Grounded — smoothly lerp tilt and Y offset back to 0
        const k = Math.min(1, lerpRate * dt);
        innerRef.current.rotation.x += (0 - innerRef.current.rotation.x) * k;
        innerRef.current.rotation.z += (0 - innerRef.current.rotation.z) * k;
        innerRef.current.position.y += (0 - innerRef.current.position.y) * k;
        // Snap to exactly 0 when close to avoid floating-point drift
        if (Math.abs(innerRef.current.rotation.x) < 0.001) innerRef.current.rotation.x = 0;
        if (Math.abs(innerRef.current.rotation.z) < 0.001) innerRef.current.rotation.z = 0;
        if (Math.abs(innerRef.current.position.y) < 0.001) innerRef.current.position.y = 0;
      }
    }
    // Procedural upper-body pitch aiming
    // Distribute camera pitch across spine bones when aiming (not while jetpacking/falling).
    // When also walking/running/strafing, the Mixamo rifle-walk animations already tilt the
    // spine & head into a rifle pose — adding full pitch on top makes the head spin forward.
    // So: reduce spine contribution and skip the head bone when a movement anim is playing.
    try {
      // For the local player, read pitch directly from the window global every frame
      // to avoid stale values from PlayerMover's memoized cloneElement (pitch isn't in its deps).
      const livePitch = isLocalPlayer ? (window.__CF_CAM_V_ANGLE__ || 0) : (pitch || 0);
      const wantPitch = (isAiming && !isJetpacking && !isFalling) ? (-livePitch) : 0;
      const lerpK = Math.min(1, 14 * dt);
      pitchRef.current += (wantPitch - pitchRef.current) * lerpK;
      if (Math.abs(pitchRef.current) < 0.001) pitchRef.current = 0;
      const p = pitchRef.current;
      const isMoving = isWalking || isRunning || isStrafeLeft || isStrafeRight || isWalkingBackward;
      if (isAiming && isMoving) {
        // Movement rifle anims already rotate upper body — only add a small pitch nudge to spines
        if (spineBones.spine1) spineBones.spine1.rotation.x += p * 0.2;
        if (spineBones.spine2) spineBones.spine2.rotation.x += p * 0.2;
        // Skip head — the walk anim handles it, adding more causes forward spin
      } else {
        // Standing still while aiming — full procedural pitch
        if (spineBones.spine1) spineBones.spine1.rotation.x += p * 0.4;
        if (spineBones.spine2) spineBones.spine2.rotation.x += p * 0.4;
        if (spineBones.head)   spineBones.head.rotation.x   += p * 0.2;
      }
    } catch {}
    // Toggle rifle visibility + apply live tuner transform from editor
    try {
      if (rifleGroupRef.current) {
        // Expose ref — local player uses __CF_MY_RIFLE_REF__ for gizmo, remote uses separate key
        if (isLocalPlayer) {
          window.__CF_MY_RIFLE_REF__ = rifleGroupRef.current;
        }
        rifleGroupRef.current.matrixAutoUpdate = true;
        const tuner = window.__CF_RIFLE_TUNER__;
        // Skip position/rotation/scale writes while the gizmo is being dragged (only for local)
        const isDragging = isLocalPlayer && !!window.__CF_RIFLE_DRAGGING__;
        if (tuner) {
          rifleGroupRef.current.visible = tuner.forceVisible || !!(isAiming || isShooting);
          if (!isDragging) {
            rifleGroupRef.current.position.x = tuner.pos[0];
            rifleGroupRef.current.position.y = tuner.pos[1];
            rifleGroupRef.current.position.z = tuner.pos[2];
            rifleGroupRef.current.rotation.set(tuner.rot[0], tuner.rot[1], tuner.rot[2]);
            const sc = tuner.scale || 3.5;
            rifleGroupRef.current.scale.set(sc, sc, sc);
            rifleGroupRef.current.updateMatrix();
          }
        } else {
          rifleGroupRef.current.visible = !!(isAiming || isShooting);
        }
      }
    } catch {}
  });

  // Attach rifle group to the right hand bone
  useEffect(() => {
    if (!spineBones.rightHand || !rifleGroupRef.current) return;
    try {
      spineBones.rightHand.add(rifleGroupRef.current);
    } catch {}
    return () => {
      try {
        if (rifleGroupRef.current && rifleGroupRef.current.parent) {
          rifleGroupRef.current.parent.remove(rifleGroupRef.current);
        }
      } catch {}
    };
  }, [spineBones.rightHand]);

  // Placement consistent with GLTF avatars
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Alien)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking && !isJetpacking} isWalkingBackward={isWalkingBackward && !isJetpacking} isRunning={isRunning && !isJetpacking} />
          <JetpackAudio isJetpacking={isJetpacking} isRunning={isRunning} />
        </group>
      </group>
      {/* Rifle attached to right hand bone (re-parented in useEffect above, transform driven by tuner) */}}
      <group ref={rifleGroupRef} visible={false}>
        <Suspense fallback={null}>
          <LazerRifleModel scale={1} />
        </Suspense>
      </group>
      <Suspense fallback={null}><JetpackBoneAttachment modelRef={model} isJetpacking={isJetpacking} isRunning={isRunning} /></Suspense>
    </group>
  );
}

// Footstep audio component - plays spatial audio when character is walking

export function Guy1FBXOpponent({
  baseUrl = '/models/avatars/guy1/Happy Idle (1).fbx',
  walkUrl = '/models/avatars/guy1/Walking (5).fbx',
  walkBackUrl = '/models/avatars/guy1/Walking Backwards.fbx',
  runUrl = '/models/avatars/guy1/Running (3).fbx',
  turnLeftUrl = '/models/avatars/guy1/Left Turn (4).fbx',
  turnRightUrl = '/models/avatars/guy1/Right Turn (2).fbx',
  jumpUrl = '/models/avatars/guy1/Jumping.fbx',
  flyUrl = '/models/avatars/astronaut/Flying.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  isJetpacking = false,
  isFalling = false,
  jetpackTiltX = 0,
  jetpackTiltZ = 0,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const walkBack = useFBX(walkBackUrl);
  // Include run animation now that it's available
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const fly   = useFBX(flyUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Merge animations with namespaced clips for deterministic selection
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const walkBackAnimsRaw = useMemo(() => ((walkBack && walkBack.animations) ? walkBack.animations : []), [walkBack]);
  const runAnimsRaw  = useMemo(() => ((run && run.animations) ? run.animations : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations) ? tright.animations : []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  // Build a simple bone-name map for retargeting breathing tracks to the rig
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  // Lock Y position but allow XZ root motion during idle animation
  const lockFeetIdleClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Zero out Y component of position tracks to lock vertical position
      const tracks = clip.tracks.map(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position') && tr.values && tr.values.length > 0) {
          const newValues = [...tr.values];
          // Position tracks are XYZ triplets: [x0, y0, z0, x1, y1, z1, ...]
          // Zero out every Y component (indices 1, 4, 7, 10, ...)
          for (let i = 1; i < newValues.length; i += 3) {
            newValues[i] = 0;
          }
          const NewTrackClass = tr.constructor;
          return new NewTrackClass(tr.name, tr.times.slice(), newValues instanceof Float32Array ? new Float32Array(newValues) : newValues);
        }
        return tr;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position'); // drop root translation
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockFeetIdleClip(c)), [baseAnimsRaw, lockFeetIdleClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  const walkBackAnims = useMemo(() => walkBackAnimsRaw.map(c => new THREE.AnimationClip(`walkback:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkBackAnimsRaw, retargetTracks]);
  // Fly animation: filter hips rotation/position for procedural tilt control
  const flyAnimsRaw  = useMemo(() => ((fly  && fly.animations)  ? fly.animations  : []), [fly]);
  const filterFlyTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const flyAnims = useMemo(() => flyAnimsRaw.map(c => new THREE.AnimationClip(
    `fly:${c.name || 'clip'}`, c.duration, filterFlyTracks(retargetTracks(c.tracks))
  )), [flyAnimsRaw, retargetTracks, filterFlyTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...walkBackAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims, ...flyAnims]), [baseAnims, walkAnims, walkBackAnims, runAnims, leftAnims, rightAnims, jumpAnims, flyAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);
  const modelHeightRef = useRef(0);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) {
        model.position.y += -box.min.y;
        modelHeightRef.current = box.max.y - box.min.y;
      }
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.isPlayer = true; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    // Already playing this animation — don't reset it (avoids T-pose flicker)
    if (prev === next && next.isRunning()) return;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT);
      else if (name.startsWith('walkback:')) v = 0.4; // Slower backwards walk animation
      else if (name.startsWith('run:')) v = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT);
      else if (name.startsWith('jump:')) v = getAnimSpeed('guy1.jump', 0.65);
      else if (name.startsWith('fly:')) v = 1.0;
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickWalkBackName = useMemo(() => {
    if (!walkBackAnimsRaw || walkBackAnimsRaw.length === 0) return null;
    const byName = walkBackAnimsRaw.find(c => /walk|walking|back/i.test(c.name));
    const chosen = byName || walkBackAnimsRaw[0];
    return chosen ? `walkback:${chosen.name || 'clip'}` : null;
  }, [walkBackAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);
  const pickFlyName = useMemo(() => {
    if (!flyAnimsRaw || flyAnimsRaw.length === 0) return null;
    const byName = flyAnimsRaw.find(c => /fly|float|hover/i.test(c.name));
    const chosen = byName || flyAnimsRaw[0];
    return chosen ? `fly:${chosen.name || 'clip'}` : null;
  }, [flyAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJetpacking && pickFlyName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickFlyName);
      try { actions[pickFlyName].timeScale = 1.0; } catch {}
    } else if (!isJetpacking && (isFalling || isJumping) && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('guy1.jump', 0.65); } catch {}
      } else {
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT); } catch {}
    } else if (isWalkingBackward && pickWalkBackName) {
      const shouldSwap = Math.abs(yawOffset) < 0.1;
      const animName = shouldSwap ? pickWalkName : pickWalkBackName;
      wasJumpingRef.current = false;
      crossFadeTo(animName);
      try { actions[animName].timeScale = 0.4; } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { 
        actions[pickWalkName].timeScale = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT); 
      } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, pickIdleName, pickWalkName, pickWalkBackName, pickRunName, pickLeftName, pickRightName, pickJumpName, pickFlyName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT);
        else if (nm.startsWith('walkback:')) v = 0.4; // Slower backwards walk animation
        else if (nm.startsWith('run:')) v = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT);
        else if (nm.startsWith('jump:')) v = getAnimSpeed('guy1.jump', 0.65);
        else if (nm.startsWith('fly:')) v = 1.0;
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
    // Procedural body tilt while jetpacking
    if (innerRef.current) {
      const lerpRate = 12;
      if (isJetpacking || isFalling) {
        const totalTiltX = jetpackTiltX;
        innerRef.current.rotation.x = totalTiltX;
        innerRef.current.rotation.z = -jetpackTiltZ;
        const halfH = modelHeightRef.current * 0.5;
        innerRef.current.position.y = halfH * Math.sin(Math.abs(totalTiltX));
      } else {
        const k = Math.min(1, lerpRate * dt);
        innerRef.current.rotation.x += (0 - innerRef.current.rotation.x) * k;
        innerRef.current.rotation.z += (0 - innerRef.current.rotation.z) * k;
        innerRef.current.position.y += (0 - innerRef.current.position.y) * k;
        if (Math.abs(innerRef.current.rotation.x) < 0.001) innerRef.current.rotation.x = 0;
        if (Math.abs(innerRef.current.rotation.z) < 0.001) innerRef.current.rotation.z = 0;
        if (Math.abs(innerRef.current.position.y) < 0.001) innerRef.current.position.y = 0;
      }
    }
  });

  // Placement consistent with GLTF avatars
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Astronaut)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking && !isJetpacking} isWalkingBackward={isWalkingBackward && !isJetpacking} isRunning={isRunning && !isJetpacking} />
          <JetpackAudio isJetpacking={isJetpacking} isRunning={isRunning} />
        </group>
      </group>
      <Suspense fallback={null}><JetpackBoneAttachment modelRef={model} isJetpacking={isJetpacking} isRunning={isRunning} /></Suspense>
    </group>
  );
}

// FBX-based Robot 4 (animated like Astronaut): Idle/Walk/Run/Turn/Jump with cross-fades

export function Robot4FBXOpponent({
  baseUrl = '/models/avatars/robot 4/Breathing Idle (2).fbx',
  walkUrl = '/models/avatars/robot 4/Walking (2).fbx',
  runUrl = '/models/avatars/robot 4/Running (2).fbx',
  turnLeftUrl = '/models/avatars/robot 4/Left Turn (1).fbx',
  turnRightUrl = '/models/avatars/robot 4/Right Turn (1).fbx',
  jumpUrl = '/models/avatars/robot 4/Jump (1).fbx',
  flyUrl = '/models/avatars/astronaut/Flying.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  isJetpacking = false,
  isFalling = false,
  jetpackTiltX = 0,
  jetpackTiltZ = 0,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const fly   = useFBX(flyUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Build bone map for retargeting
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);

  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);

  // Remove position tracks from idle animation to make it in-place like walk/run
  const lockFeetIdleClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Remove all position tracks so idle stays in place
      const tracks = clip.tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockFeetIdleClip(c)), [baseAnimsRaw, lockFeetIdleClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  // Fly animation: filter hips rotation/position for procedural tilt control
  const flyAnimsRaw  = useMemo(() => ((fly  && fly.animations)  ? fly.animations  : []), [fly]);
  const filterFlyTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const flyAnims = useMemo(() => flyAnimsRaw.map(c => new THREE.AnimationClip(
    `fly:${c.name || 'clip'}`, c.duration, filterFlyTracks(retargetTracks(c.tracks))
  )), [flyAnimsRaw, retargetTracks, filterFlyTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims, ...flyAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims, flyAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);
  const modelHeightRef = useRef(0);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) {
        model.position.y += -box.min.y;
        modelHeightRef.current = box.max.y - box.min.y;
      }
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.isPlayer = true; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    // Already playing this animation — don't reset it (avoids T-pose flicker)
    if (prev === next && next.isRunning()) return;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
      else if (name.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
      else if (name.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
      else if (name.startsWith('fly:')) v = 1.0;
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);
  const pickFlyName = useMemo(() => {
    if (!flyAnimsRaw || flyAnimsRaw.length === 0) return null;
    const byName = flyAnimsRaw.find(c => /fly|float|hover/i.test(c.name));
    const chosen = byName || flyAnimsRaw[0];
    return chosen ? `fly:${chosen.name || 'clip'}` : null;
  }, [flyAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = getAnimSpeed('robot.idle', 0.25);
        if (typeof idle.setEffectiveTimeScale === 'function') idle.setEffectiveTimeScale(getAnimSpeed('robot.idle', 0.25));
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJetpacking && pickFlyName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickFlyName);
      try { actions[pickFlyName].timeScale = 1.0; } catch {}
    } else if (!isJetpacking && (isFalling || isJumping) && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('robot.jump', 0.65); } catch {}
      } else {
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, pickFlyName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
        else if (nm.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
        else if (nm.startsWith('fly:')) v = 1.0;
        else if (nm.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}

    // --- Tilt while jetpacking (same as Astronaut) ---
    if (innerRef.current) {
      if (isJetpacking) {
        const tx = typeof jetpackTiltX === 'number' ? jetpackTiltX : 0;
        const tz = typeof jetpackTiltZ === 'number' ? jetpackTiltZ : 0;
        innerRef.current.rotation.x = THREE.MathUtils.lerp(innerRef.current.rotation.x, tx, 0.15);
        innerRef.current.rotation.z = THREE.MathUtils.lerp(innerRef.current.rotation.z, tz, 0.15);
      } else {
        innerRef.current.rotation.x = THREE.MathUtils.lerp(innerRef.current.rotation.x, 0, 0.15);
        innerRef.current.rotation.z = THREE.MathUtils.lerp(innerRef.current.rotation.z, 0, 0.15);
      }
    }
  });

  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Astronaut)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking && !isJetpacking} isWalkingBackward={isWalkingBackward && !isJetpacking} isRunning={isRunning && !isJetpacking} />
          <JetpackAudio isJetpacking={isJetpacking} isRunning={isRunning} />
        </group>
      </group>
      <Suspense fallback={null}><JetpackBoneAttachment modelRef={model} isJetpacking={isJetpacking} isRunning={isRunning} /></Suspense>
    </group>
  );
}


/**
 * Billboard that always faces the camera, even when inside a rotated parent group.
 * drei's Billboard uses camera.quaternion as LOCAL quaternion, which breaks when
 * the parent group is rotated (e.g. character yaw). This component compensates
 * by computing: local_q = inverse(parent_world_q) * camera_q
 */
export function CameraFacingBillboard({ children, position = [0, 0, 0] }) {
  const ref = useRef();
  const _pq = useMemo(() => new THREE.Quaternion(), []);

  useFrame(({ camera }) => {
    if (!ref.current || !ref.current.parent) return;
    ref.current.parent.getWorldQuaternion(_pq);
    _pq.invert();
    ref.current.quaternion.copy(_pq).multiply(camera.quaternion);
  });

  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

export function RemoteAvatarGroup({ side, base, children, avatarKey }){
  const gref = useRef();
  const pos = useRef({ x: base.x, z: base.z });
  const target = useRef({ x: base.x, z: base.z, has: false });
  const yawRef = useRef(0);
  const yawTargetRef = useRef(null);
  const lastTargetPos = useRef({ x: base.x, z: base.z });
  const lastMoveAtRef = useRef(0);
  const lastMsgAtRef = useRef(0);
  const lastRunRef = useRef(false);
  const lastJumpRef = useRef(false);
  const lastJetRef = useRef(false);
  const lastLiftRef = useRef(0);
  const lastTiltXRef = useRef(0);
  const lastTiltZRef = useRef(0);
  const liftPrevRef = useRef(0);
  const lastShootRef = useRef(false);
  const lastAimRef = useRef(false);
  const lastWalkBackRef = useRef(false);
  const lastStrafeLeftRef = useRef(false);
  const lastStrafeRightRef = useRef(false);
  const lastDeadRef = useRef(false);
  const lastPitchRef = useRef(0);
  const [isWalking, setIsWalking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  const [isJumpingRemote, setIsJumpingRemote] = useState(false);
  const [isJetpackingRemote, setIsJetpackingRemote] = useState(false);
  const [isFallingRemote, setIsFallingRemote] = useState(false);
  const [isShootingRemote, setIsShootingRemote] = useState(false);
  const [isAimingRemote, setIsAimingRemote] = useState(false);
  const [isWalkingBackwardRemote, setIsWalkingBackwardRemote] = useState(false);
  const [isStrafeLeftRemote, setIsStrafeLeftRemote] = useState(false);
  const [isStrafeRightRemote, setIsStrafeRightRemote] = useState(false);
  const [isDeadRemote, setIsDeadRemote] = useState(false);
  const [liftRemote, setLiftRemote] = useState(0);
  const prevYawRef = useRef(0);
  const prevYawTsRef = useRef(0);
  const norm = (a)=>{ let v=(a+Math.PI)%(2*Math.PI); if(v<0) v+=2*Math.PI; return v-Math.PI; };
  const unwrapToNear = (wrapped, near)=>{ const w = norm(wrapped); const k = Math.round((near - w)/(2*Math.PI)); return w + k*2*Math.PI; };
  
  useLayoutEffect(() => {
    try {
      const msg = avatarKey ? (window.__CF_REMOTE_AVATARS__ && window.__CF_REMOTE_AVATARS__[avatarKey]) : window.__CF_REMOTE_AVATAR__;
      if (msg && (avatarKey || msg.side === side) && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        pos.current = { x: Number(msg.x), z: Number(msg.z) };
        if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
          const yw = norm(Number(msg.yaw));
          yawRef.current = yw; yawTargetRef.current = yw;
          prevYawRef.current = yw; prevYawTsRef.current = performance.now();
        }
        if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) {
          lastLiftRef.current = Number(msg.lift);
          setLiftRemote(Number(msg.lift));
        }
      }
    } catch {}
  }, [side, base.x, base.z, avatarKey]);
  
  useFrame((_, delta) => {
    try {
      const msg = avatarKey ? (window.__CF_REMOTE_AVATARS__ && window.__CF_REMOTE_AVATARS__[avatarKey]) : window.__CF_REMOTE_AVATAR__;
      if (msg && (avatarKey || msg.side === side)) {
        const tx = Number(msg.x); const tz = Number(msg.z);
        if (Number.isFinite(tx) && Number.isFinite(tz)) {
          target.current = { x: tx, z: tz, has: true };
          const dxT = tx - lastTargetPos.current.x;
          const dzT = tz - lastTargetPos.current.z;
          const moved2 = dxT*dxT + dzT*dzT;
          if (moved2 > 1e-6) {
            lastMoveAtRef.current = performance.now();
            lastTargetPos.current.x = tx; lastTargetPos.current.z = tz;
          }
          lastMsgAtRef.current = performance.now();
        }
        if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
          const prev = (typeof yawTargetRef.current === 'number') ? yawTargetRef.current : yawRef.current || 0;
          yawTargetRef.current = unwrapToNear(Number(msg.yaw), prev);
        }
        if (typeof msg.run === 'boolean') lastRunRef.current = !!msg.run;
        if (typeof msg.isJumping === 'boolean') lastJumpRef.current = !!msg.isJumping;
        if (typeof msg.isJetpacking === 'boolean') lastJetRef.current = !!msg.isJetpacking;
        if (typeof msg.tiltX === 'number') lastTiltXRef.current = msg.tiltX;
        if (typeof msg.tiltZ === 'number') lastTiltZRef.current = msg.tiltZ;
        if (typeof msg.isShooting === 'boolean') lastShootRef.current = !!msg.isShooting;
        if (typeof msg.isAiming === 'boolean') lastAimRef.current = !!msg.isAiming;
        if (typeof msg.isWalkingBackward === 'boolean') lastWalkBackRef.current = !!msg.isWalkingBackward;
        if (typeof msg.isStrafeLeft === 'boolean') lastStrafeLeftRef.current = !!msg.isStrafeLeft;
        if (typeof msg.isStrafeRight === 'boolean') lastStrafeRightRef.current = !!msg.isStrafeRight;
        if (typeof msg.isDead === 'boolean') lastDeadRef.current = !!msg.isDead;
        if (typeof msg.pitch === 'number') lastPitchRef.current = msg.pitch;
        if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) lastLiftRef.current = Number(msg.lift);
      }
      // Use faster lerp when jetpacking for smoother high-speed movement
      const isJet = !!lastJetRef.current;
      const alpha = Math.min(1, delta * (isJet ? 18.0 : 10.0));
      const tx = target.current.has ? target.current.x : pos.current.x;
      const tz = target.current.has ? target.current.z : pos.current.z;
      pos.current.x += (tx - pos.current.x) * alpha;
      pos.current.z += (tz - pos.current.z) * alpha;
      if (typeof yawTargetRef.current === 'number') {
        const cur = yawRef.current;
        const tgt = yawTargetRef.current;
        const rotAlpha = Math.min(1, delta * (isJet ? 18.0 : 10.0));
        yawRef.current = cur + (tgt - cur) * rotAlpha;
      }
      if (gref.current) {
        gref.current.position.set(pos.current.x, 0, pos.current.z);
        gref.current.rotation.y = norm(yawRef.current || 0);
      }
      // Also track lift on the group Y so Billboard stays at correct world height
      // (the avatar model handles its own lift via extraLiftY prop)
      const now = performance.now();
      const running = !!lastRunRef.current;
      const WALK_GRACE_MS = 85;
      const walking = running || ((now - lastMoveAtRef.current) < WALK_GRACE_MS);
      if (walking !== isWalking) setIsWalking(walking);
      if (running !== isRunning) setIsRunning(running);
      const newJump = !!lastJumpRef.current;
      const newJet = !!lastJetRef.current;
      const newLift = Number(lastLiftRef.current) || 0;
      if (newJump !== isJumpingRemote) setIsJumpingRemote(newJump);
      if (newJet !== isJetpackingRemote) setIsJetpackingRemote(newJet);
      // Derive isFalling: jetpacking + descending (lift decreasing) + not walking
      const liftDelta = newLift - liftPrevRef.current;
      liftPrevRef.current = newLift;
      const falling = newJet && liftDelta < -0.1 && !walking;
      if (falling !== isFallingRemote) setIsFallingRemote(falling);
      if (Math.abs(newLift - liftRemote) > 0.01) setLiftRemote(newLift);
      // Derive shooting/aiming state from remote message
      const newShoot = !!lastShootRef.current;
      const newAim = !!lastAimRef.current;
      if (newShoot !== isShootingRemote) setIsShootingRemote(newShoot);
      if (newAim !== isAimingRemote) setIsAimingRemote(newAim);
      const newWalkBack = !!lastWalkBackRef.current;
      const newStrafeL = !!lastStrafeLeftRef.current;
      const newStrafeR = !!lastStrafeRightRef.current;
      const newDead = !!lastDeadRef.current;
      if (newWalkBack !== isWalkingBackwardRemote) setIsWalkingBackwardRemote(newWalkBack);
      if (newStrafeL !== isStrafeLeftRemote) setIsStrafeLeftRemote(newStrafeL);
      if (newStrafeR !== isStrafeRightRemote) setIsStrafeRightRemote(newStrafeR);
      if (newDead !== isDeadRemote) setIsDeadRemote(newDead);
      const prevTs = prevYawTsRef.current || now - Math.max(1, delta*1000);
      const dtMs = Math.max(1, now - prevTs);
      const dtSec = dtMs / 1000;
      const yawVel = (yawRef.current - prevYawRef.current) / dtSec;
      const TURN_THRESH = 0.5;
      const turningL = !walking && (yawVel > TURN_THRESH);
      const turningR = !walking && (yawVel < -TURN_THRESH);
      if (turningL !== isTurningLeft) setIsTurningLeft(turningL);
      if (turningR !== isTurningRight) setIsTurningRight(turningR);
      prevYawRef.current = yawRef.current;
      prevYawTsRef.current = now;
    } catch {}
  });
  
  const prevPropsRef = useRef({});
  const clonedChildrenRef = useRef(null);
  const currentProps = { isWalking, isRunning, isTurningLeft, isTurningRight, isJumpingRemote, isJetpackingRemote, isFallingRemote, isShootingRemote, isAimingRemote, isWalkingBackwardRemote, isStrafeLeftRemote, isStrafeRightRemote, isDeadRemote, liftRemote, tiltX: lastTiltXRef.current, tiltZ: lastTiltZRef.current, pitch: lastPitchRef.current };
  const propsChanged = Object.keys(currentProps).some(key => prevPropsRef.current[key] !== currentProps[key]);
  
  if (propsChanged || !clonedChildrenRef.current) {
    prevPropsRef.current = currentProps;
    clonedChildrenRef.current = React.Children.map(children, (child, idx) => {
      if (idx === 0 && React.isValidElement(child)) {
        return React.cloneElement(child, { 
          isWalking, isRunning, isTurningLeft, isTurningRight, 
          isWalkingBackward: isWalkingBackwardRemote,
          isJumping: isJumpingRemote, isJetpacking: isJetpackingRemote, isFalling: isFallingRemote,
          isShooting: isShootingRemote, isAiming: isAimingRemote,
          isStrafeLeft: isStrafeLeftRemote, isStrafeRight: isStrafeRightRemote,
          isDead: isDeadRemote,
          jetpackTiltX: lastTiltXRef.current, jetpackTiltZ: lastTiltZRef.current,
          pitch: lastPitchRef.current,
          extraLiftY: liftRemote
        });
      } else if (idx === 1 && React.isValidElement(child)) {
        if (child.props && child.props.position) {
          const [x, y, z] = child.props.position;
          return React.cloneElement(child, {
            ...child.props,
            position: [x, y + liftRemote, z]
          });
        }
      }
      return child;
    });
  }

  // Tag all descendant meshes with the avatarKey (socketId) so bullet hits know which player was hit
  useEffect(() => {
    if (!gref.current || !avatarKey) return;
    const tag = () => {
      gref.current.traverse(o => {
        if (o.isMesh) {
          o.userData.playerId = avatarKey;
        }
      });
    };
    // Initial tag + delayed re-tag in case FBX models load after mount
    tag();
    const t = setTimeout(tag, 1500);
    return () => clearTimeout(t);
  }, [avatarKey]);
  
  return <group ref={gref}>{clonedChildrenRef.current}</group>;}