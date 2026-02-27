// BuildingSystem.jsx — Base building system for placing modular structure pieces
// 
// ARCHITECTURE (same pattern as ResourceNodes):
//   • BuildingSystem (default export)  → 3D meshes, ghost preview — inside <Canvas>
//   • BuildingOverlays (named export)  → HTML HUD / piece selector — OUTSIDE <Canvas>

import React, { useRef, useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { TextureLoader } from 'three';
import { TransformControls, useFBX } from '@react-three/drei';
import { getTerrainHeightXZ, updateBuildingPiecesCache } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG } from './useInventoryStore';
import {
  useBuildingStore,
  PIECE_TYPES,
  PIECE_ORDER,
  MODEL_PIECE_IDS,
  GRID_SIZE,
  WALL_THICKNESS,
  getSnapPoints,
} from './useBuildingStore';

/* ================================================================
   Geometry builders for each piece type
   ================================================================ */

/** Merge an array of {geo, matrix} into one BufferGeometry.
 *  Each geo is a simple BoxGeometry with a Matrix4 transform. */
function mergeBoxes(boxes) {
  const merged = new THREE.BufferGeometry();
  const positions = [], normals = [], uvs = [], indices = [];
  let vertexOffset = 0;
  for (const { geo, matrix } of boxes) {
    const pos = geo.getAttribute('position').clone();
    const nrm = geo.getAttribute('normal').clone();
    const uv = geo.getAttribute('uv').clone();
    const idx = geo.getIndex();
    // Apply transform to positions and normals
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
      pos.setXYZ(i, v.x, v.y, v.z);
      const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(normalMatrix).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    positions.push(pos);
    normals.push(nrm);
    uvs.push(uv);
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    }
    vertexOffset += pos.count;
  }
  // Flatten to typed arrays
  const pArr = new Float32Array(vertexOffset * 3);
  const nArr = new Float32Array(vertexOffset * 3);
  const uArr = new Float32Array(vertexOffset * 2);
  let pOff = 0, nOff = 0, uOff = 0;
  for (const p of positions) { pArr.set(p.array, pOff); pOff += p.array.length; }
  for (const n of normals) { nArr.set(n.array, nOff); nOff += n.array.length; }
  for (const u of uvs) { uArr.set(u.array, uOff); uOff += u.array.length; }
  merged.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uArr, 2));
  merged.setIndex(indices);
  return merged;
}

function makeBox(w, h, d, px, py, pz) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const matrix = new THREE.Matrix4().makeTranslation(px, py, pz);
  return { geo, matrix };
}

function createPieceGeometry(pieceType) {
  const def = PIECE_TYPES[pieceType];
  if (!def) return new THREE.BoxGeometry(1, 1, 1);

  switch (pieceType) {
    case 'foundation':
    case 'floor':
    case 'spikeTrap':
      return new THREE.BoxGeometry(def.dims[0], def.dims[1], def.dims[2]);

    case 'wall':
    case 'halfWall':
    case 'reinforcedWall':
      return new THREE.BoxGeometry(def.dims[0], def.dims[1], def.dims[2]);

    case 'wallDoor': {
      // Wall with doorway cutout built from BoxGeometry segments for proper UVs
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      const dw = def.doorWidth, dh = def.doorHeight;
      // Left segment
      const leftW = (w - dw) / 2;
      const left = makeBox(leftW, h, d, -(w / 2) + leftW / 2, h / 2, 0);
      // Right segment
      const right = makeBox(leftW, h, d, (w / 2) - leftW / 2, h / 2, 0);
      // Top (lintel above door)
      const topH = h - dh;
      const top = makeBox(dw, topH, d, 0, dh + topH / 2, 0);
      return mergeBoxes([left, right, top]);
    }

    case 'wallWindow': {
      // Wall with window cutout built from BoxGeometry segments for proper UVs
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      const ww = def.windowWidth, wh = def.windowHeight, wy = def.windowY;
      // Left segment (full height)
      const sideW = (w - ww) / 2;
      const left = makeBox(sideW, h, d, -(w / 2) + sideW / 2, h / 2, 0);
      // Right segment (full height)
      const right = makeBox(sideW, h, d, (w / 2) - sideW / 2, h / 2, 0);
      // Bottom (below window)
      const botH = wy - wh / 2;
      const bottom = makeBox(ww, botH, d, 0, botH / 2, 0);
      // Top (above window)
      const topH = h - (wy + wh / 2);
      const top = makeBox(ww, topH, d, 0, h - topH / 2, 0);
      return mergeBoxes([left, right, bottom, top]);
    }

    case 'fence': {
      // Metal railing: posts + top bar + mid bar (all boxes merged)
      const w = def.dims[0], h = def.dims[1];  // d (thickness) used by postD
      const postW = 0.4, postD = 0.4;
      const barH = 0.25, barD = 0.25;
      const postSpacing = 3.0;
      const postCount = Math.max(2, Math.ceil(w / postSpacing) + 1);
      const boxes = [];
      // Posts
      for (let i = 0; i < postCount; i++) {
        const t = i / (postCount - 1);
        const px = -w / 2 + t * w;
        boxes.push(makeBox(postW, h, postD, px, h / 2, 0));
      }
      // Top bar
      boxes.push(makeBox(w, barH, barD, 0, h, 0));
      // Mid bar
      boxes.push(makeBox(w, barH, barD, 0, h * 0.5, 0));
      return mergeBoxes(boxes);
    }

    case 'ramp': {
      // Triangle prism (ramp shape)
      const shape = new THREE.Shape();
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      shape.moveTo(0, 0);
      shape.lineTo(d, 0);
      shape.lineTo(d, h);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      geo.translate(-d / 2, 0, -w / 2);
      return geo;
    }

    case 'chest': {
      // Simple chest = box body + slightly wider lid
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      const bodyH = h * 0.65;
      const lidH = h * 0.35;
      const body = makeBox(w, bodyH, d, 0, bodyH / 2, 0);
      const lid = makeBox(w + 0.5, lidH, d + 0.5, 0, bodyH + lidH / 2, 0);
      return mergeBoxes([body, lid]);
    }

    case 'lightPost': {
      // Tall thin post with a small lantern box on top
      const _lw = def.dims[0]; void _lw; // dims[0] unused; using fixed pole width
      const h = def.dims[1];
      const poleW = 0.8;
      const lanternSize = 2.5;
      const pole = makeBox(poleW, h - lanternSize, poleW, 0, (h - lanternSize) / 2, 0);
      const lantern = makeBox(lanternSize, lanternSize, lanternSize, 0, h - lanternSize / 2, 0);
      return mergeBoxes([pole, lantern]);
    }

    case 'turret': {
      // Turret = base box + barrel cylinder approximated with boxes
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      const baseH = h * 0.6;
      const barrelH = h * 0.3;
      const barrelW = 1.2;
      const base = makeBox(w, baseH, d, 0, baseH / 2, 0);
      const barrel = makeBox(barrelW, barrelW, d * 0.8, 0, baseH + barrelH / 2, -d * 0.3);
      return mergeBoxes([base, barrel]);
    }

    default:
      return new THREE.BoxGeometry(def.dims[0], def.dims[1], def.dims[2]);
  }
}

// Cache geometries
const geoCache = {};
function getPieceGeometry(pieceType) {
  if (!geoCache[pieceType]) {
    geoCache[pieceType] = createPieceGeometry(pieceType);
  }
  return geoCache[pieceType];
}

/* ================================================================
   Snap logic — find the nearest valid snap point
   Uses a directional bias so looking left snaps to the left edge, etc.
   ================================================================ */
const SNAP_DISTANCE = 18.0; // max distance to snap to a point

function findBestSnap(ghostPos, ghostRot, selectedPiece, placedPieces, playerPos, lookYaw, playerY) {
  let bestSnap = null;
  let bestScore = Infinity;

  // Look direction unit vector — matches THREE.js forward: (-sin(yaw), -cos(yaw))
  const lookDirX = -Math.sin(lookYaw);
  const lookDirZ = -Math.cos(lookYaw);

  for (const placed of placedPieces) {
    const snapPoints = getSnapPoints(placed.type, placed);
    for (const sp of snapPoints) {
      if (!sp.accepts.includes(selectedPiece)) continue;
      const dx = ghostPos[0] - sp.position[0];
      const dz = ghostPos[2] - sp.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > SNAP_DISTANCE) continue;

      // Vertical distance penalty — strongly prefer snap points near the player's Y level
      // This ensures when on the 2nd floor we snap to 2nd floor points, not ground floor
      const dy = Math.abs((playerY || ghostPos[1]) - sp.position[1]);
      const yPenalty = dy * 0.8; // strong vertical bias

      // Directional score: prefer snap points that are in front of the player
      const toSnapX = sp.position[0] - playerPos[0];
      const toSnapZ = sp.position[2] - playerPos[1]; // playerPos is [x, z]
      const toSnapLen = Math.sqrt(toSnapX * toSnapX + toSnapZ * toSnapZ) || 1;
      const dot = (toSnapX * lookDirX + toSnapZ * lookDirZ) / toSnapLen; // [-1, 1]
      const dirPenalty = (1 - dot) * 0.5 * SNAP_DISTANCE;
      const score = dist + dirPenalty + yPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestSnap = sp;
      }
    }
  }

  return bestSnap;
}

/* ================================================================
   Check if placement overlaps existing pieces
   ================================================================ */
function checkOverlap(x, y, z, rotation, pieceType, existingPieces) {
  const def = PIECE_TYPES[pieceType];
  if (!def) return true;
  const margin = 0.3;

  for (const p of existingPieces) {
    const pDef = PIECE_TYPES[p.type];
    if (!pDef) continue;

    const dx = Math.abs(x - p.x);
    const dy = Math.abs(y - p.y);
    const dz = Math.abs(z - p.z);

    // Simple AABB overlap (approximate — ignores rotation for speed)
    const overlapX = (def.dims[0] + pDef.dims[0]) / 2 - margin;
    const overlapY = (def.dims[1] + pDef.dims[1]) / 2 - margin;
    const overlapZ = (def.dims[2] + pDef.dims[2]) / 2 - margin;

    // For walls, use the max of width/depth since they can be rotated
    const maxDimH = Math.max(overlapX, overlapZ);
    if (dx < maxDimH && dy < overlapY && dz < maxDimH) {
      // Additional check: if same position within 0.5, definitely overlapping
      if (dx < 0.5 && dy < 0.5 && dz < 0.5) return true;
    }
  }
  return false;
}

/* ================================================================
   Building texture map — maps piece type → texture path
   ================================================================ */
const PIECE_TEXTURE_MAP = {
  foundation: '/textures/building/foundation.jpg',
  wall:       '/textures/building/wall.jpg',
  wallDoor:   '/textures/building/wall.jpg',
  wallWindow: '/textures/building/wall.jpg',
  halfWall:   '/textures/building/wall.jpg',
  floor:      '/textures/building/floor.jpg',
  ramp:       '/textures/building/floor.jpg',
  fence:      '/textures/building/wall.jpg',
  reinforcedWall: '/textures/building/wall.jpg',
  spikeTrap:  '/textures/building/foundation.jpg',
  chest:      '/textures/building/wall.jpg',
  lightPost:  '/textures/building/wall.jpg',
  turret:     '/textures/building/wall.jpg',
};

// Texture repeat scale per type (how many times to tile)
const PIECE_TEXTURE_REPEAT = {
  foundation: [1, 1],
  wall:       [1, 1],
  wallDoor:   [1, 1],
  wallWindow: [1, 1],
  halfWall:   [1, 1],
  floor:      [1, 1],
  ramp:       [1, 1],
  fence:      [1, 1],
  reinforcedWall: [1, 1],
  spikeTrap:  [1, 1],
  chest:      [1, 1],
  lightPost:  [1, 1],
  turret:     [1, 1],
};

/* ================================================================
   DoorPanel — animated door that swings open/closed on click
   ================================================================ */
function DoorPanel({ piece, wsSend }) {
  const def = PIECE_TYPES[piece.type];
  const doorWidth = def.doorWidth || 10;
  const doorHeight = def.doorHeight || 22;
  const isOpen = useBuildingStore(s => s.doorStates[piece.id] || false);
  const toggleDoor = useBuildingStore(s => s.toggleDoor);
  const meshRef = useRef();

  // Animate door rotation (hinge at left edge)
  const currentAngle = useRef(0);
  useFrame((_, dt) => {
    const target = isOpen ? -Math.PI / 2 : 0;
    currentAngle.current += (target - currentAngle.current) * Math.min(1, dt * 5);
    if (meshRef.current) {
      meshRef.current.rotation.y = currentAngle.current;
    }
  });

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    toggleDoor(piece.id);
    // Sync via WS
    if (wsSend) {
      try {
        wsSend({ type: 'door_toggle', pieceId: piece.id, isOpen: !isOpen });
      } catch {}
    }
  }, [piece.id, isOpen, toggleDoor, wsSend]);

  return (
    <group position={[0, 0, 0]}>
      {/* Hinge pivot at left edge of door opening — rotation on this group */}
      <group position={[-doorWidth / 2, 0, 0]} ref={meshRef}>
        {/* Door mesh offset so its left edge is at the pivot */}
        <mesh
          position={[(doorWidth - 0.5) / 2, doorHeight / 2, 0]}
          onClick={handleClick}
          castShadow
          receiveShadow
          userData={{ isDoor: true, pieceId: piece.id }}
        >
          <boxGeometry args={[doorWidth - 0.5, doorHeight - 0.5, WALL_THICKNESS * 0.6]} />
          <meshStandardMaterial
            color="#6B4226"
            roughness={0.7}
            metalness={0.1}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ================================================================
   ModelPieceInner — loads and renders FBX model for model-based props
   Must be inside <Suspense> because useFBX suspends.
   ================================================================ */
function ModelPieceInner({ piece, isDeleteTarget }) {
  const def = PIECE_TYPES[piece.type];
  const modelPath = piece.modelPath || (def && def.modelPath);
  const fbx = useFBX(modelPath);

  const clone = useMemo(() => {
    if (!fbx) return null;
    const group = new THREE.Group();
    fbx.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mesh = new THREE.Mesh(o.geometry, o.material.clone ? o.material.clone() : o.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.copy(o.position);
        mesh.rotation.copy(o.rotation);
        mesh.scale.copy(o.scale);
        mesh.userData = { isBuildingPiece: true, pieceId: piece.id };
        group.add(mesh);
      }
    });
    return group;
  }, [fbx, piece.id]);

  // Apply delete-target tint via emissive
  useEffect(() => {
    if (!clone) return;
    clone.traverse(o => {
      if (o.isMesh && o.material) {
        const mat = o.material;
        if (isDeleteTarget) {
          mat.emissive = new THREE.Color('#ff0000');
          mat.emissiveIntensity = 0.4;
        } else {
          mat.emissive = new THREE.Color('#000000');
          mat.emissiveIntensity = 0;
        }
      }
    });
  }, [clone, isDeleteTarget]);

  if (!clone) return null;

  const sc = piece.modelScale || (def && def.defaultScale) || [0.1, 0.1, 0.1];
  return <primitive object={clone} scale={sc} />;
}

/* ================================================================
   ModelPiece — Suspense wrapper for model loading
   Shows a placeholder box while the FBX loads.
   ================================================================ */
const ModelPiece = React.memo(function ModelPiece({ piece, isDeleteTarget }) {
  const def = PIECE_TYPES[piece.type];
  const modelPath = piece.modelPath || (def && def.modelPath);
  if (!modelPath) {
    // No model path (e.g. modelCustom with no selection) — render a colored box
    return (
      <mesh castShadow receiveShadow userData={{ isBuildingPiece: true, pieceId: piece.id }}>
        <boxGeometry args={def ? def.dims : [8, 8, 8]} />
        <meshStandardMaterial color={isDeleteTarget ? '#ff2222' : (def?.color || '#9933CC')} />
      </mesh>
    );
  }
  return (
    <Suspense fallback={
      <mesh castShadow receiveShadow>
        <boxGeometry args={def ? [def.dims[0] * 0.5, def.dims[1] * 0.5, def.dims[2] * 0.5] : [4, 4, 4]} />
        <meshStandardMaterial color={def?.color || '#888'} wireframe transparent opacity={0.4} />
      </mesh>
    }>
      <ModelPieceInner piece={piece} isDeleteTarget={isDeleteTarget} />
    </Suspense>
  );
});

/* ================================================================
   PlacedPiece — single rendered building piece (3D mesh)
   Wrapped in React.memo to avoid re-rendering ALL pieces when one is added/removed.
   ================================================================ */
const PlacedPiece = React.memo(function PlacedPiece({ piece, isDeleteTarget, textures, wsSend }) {
  const def = PIECE_TYPES[piece.type];
  const geo = useMemo(() => def && !def.isModel ? getPieceGeometry(piece.type) : null, [piece.type, def]);
  if (!def) return null;

  // Model-based props delegate to ModelPiece
  if (def.isModel) {
    return (
      <group
        position={[piece.x, piece.y, piece.z]}
        rotation={[0, piece.rotation || 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          const state = useBuildingStore.getState();
          if (state.buildMode) {
            // Toggle selection: click to select, click again to deselect
            state.setSelectedProp(state.selectedPropId === piece.id ? null : piece.id);
          }
        }}
      >
        <ModelPiece piece={piece} isDeleteTarget={isDeleteTarget} />
      </group>
    );
  }

  const isMerged = ['wallDoor', 'wallWindow'].includes(piece.type);
  const isFence = piece.type === 'fence';
  const isProp = ['chest', 'lightPost', 'turret'].includes(piece.type);
  const yOffset = (isMerged || isFence || isProp) ? 0 : def.dims[1] / 2;
  const zOffset = 0;

  // Health-based color tinting
  const maxHealth = 100 * (def.healthMultiplier || 1);
  const healthRatio = (piece.health || maxHealth) / maxHealth;
  const baseColor = isDeleteTarget ? '#ff2222' : '#ffffff';
  const color = new THREE.Color(baseColor);
  if (!isDeleteTarget && healthRatio < 1) {
    color.lerp(new THREE.Color('#ff4444'), 1 - healthRatio);
  }

  // Get the texture for this piece type
  const texture = textures ? textures[piece.type] : null;

  // Special material for fence (metallic)
  const isFenceMat = piece.type === 'fence';
  // Special material for spike trap (reddish tint)
  const isSpikeTrap = piece.type === 'spikeTrap';

  return (
    <group position={[piece.x, piece.y, piece.z]} rotation={[0, piece.rotation || 0, 0]}>
      <mesh
        geometry={geo}
        position={[0, yOffset, zOffset]}
        castShadow
        receiveShadow
        userData={{ isBuildingPiece: true, pieceId: piece.id }}
      >
        {isFenceMat ? (
          <meshStandardMaterial
            color={isDeleteTarget ? '#ff2222' : '#888899'}
            roughness={0.35}
            metalness={0.7}
            emissive={isDeleteTarget ? '#ff0000' : '#000000'}
            emissiveIntensity={isDeleteTarget ? 0.3 : 0}
          />
        ) : (
          <meshStandardMaterial
            color={isSpikeTrap ? (isDeleteTarget ? '#ff2222' : '#cc4444') : color}
            map={texture || null}
            roughness={isDeleteTarget ? 0.4 : 0.85}
            metalness={isDeleteTarget ? 0.6 : 0.15}
            emissive={isDeleteTarget ? '#ff0000' : (isSpikeTrap ? '#440000' : '#000000')}
            emissiveIntensity={isDeleteTarget ? 0.3 : (isSpikeTrap ? 0.15 : 0)}
          />
        )}
      </mesh>

      {/* Door panel inside wallDoor */}
      {piece.type === 'wallDoor' && (
        <DoorPanel piece={piece} wsSend={wsSend} />
      )}

      {/* Light post point light */}
      {piece.type === 'lightPost' && def.lightRadius && (
        <pointLight
          position={[0, def.dims[1], 0]}
          color={def.lightColor || '#ffe4b5'}
          intensity={def.lightIntensity || 2}
          distance={def.lightRadius || 60}
          castShadow={false}
        />
      )}

      {/* Spike trap visual spikes */}
      {isSpikeTrap && (
        <group position={[0, def.dims[1], 0]}>
          {[[-6,0,-6],[6,0,-6],[-6,0,6],[6,0,6],[0,0,0],[-6,0,0],[6,0,0],[0,0,-6],[0,0,6]].map(([sx,sy,sz], i) => (
            <mesh key={i} position={[sx, 1.5, sz]} castShadow>
              <coneGeometry args={[0.8, 3, 4]} />
              <meshStandardMaterial color="#aa3333" metalness={0.6} roughness={0.3} />
            </mesh>
          ))}
        </group>
      )}

      {/* Turret barrel emissive glow (no pointLight — avoids shader recompilation lag) */}
      {piece.type === 'turret' && (
        <mesh position={[0, def.dims[1] * 0.7, -def.dims[2] * 0.5]}>
          <sphereGeometry args={[0.8, 8, 6]} />
          <meshStandardMaterial color="#ff4400" emissive="#ff4400" emissiveIntensity={2} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
});

/* ================================================================
   GhostPreview — semi-transparent preview of piece being placed
   ================================================================ */
function GhostPreview({ pieceType, position, rotation, valid }) {
  const def = PIECE_TYPES[pieceType];
  const geo = useMemo(() => def && !def.isModel ? getPieceGeometry(pieceType) : null, [pieceType, def]);
  if (!def) return null;

  // Model-based props: show a bounding-box ghost instead of piece geometry
  if (def.isModel) {
    const [w, h, d] = def.dims;
    return (
      <group position={position} rotation={[0, rotation, 0]}>
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial
            color={valid ? '#00ff88' : '#ff4444'}
            transparent opacity={0.3} side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial
            color={valid ? '#00ff88' : '#ff4444'}
            wireframe transparent opacity={0.6}
          />
        </mesh>
      </group>
    );
  }
  const isMerged = ['wallDoor', 'wallWindow'].includes(pieceType);
  const isFence = pieceType === 'fence';
  const isProp = ['chest', 'lightPost', 'turret'].includes(pieceType);
  const yOffset = (isMerged || isFence || isProp) ? 0 : def.dims[1] / 2;
  const zOffset = 0;

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh geometry={geo} position={[0, yOffset, zOffset]}>
        <meshStandardMaterial
          color={valid ? '#00ff88' : '#ff4444'}
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={geo} position={[0, yOffset, zOffset]}>
        <meshBasicMaterial
          color={valid ? '#00ff88' : '#ff4444'}
          wireframe
          opacity={0.6}
          transparent
        />
      </mesh>
    </group>
  );
}

/* ================================================================
   CornerPosts — auto-fill corner gaps where walls meet at 90°
   Detects wall endpoints that share the same position and renders
   a small WALL_THICKNESS × height × WALL_THICKNESS box to seal the gap.
   ================================================================ */
const _cornerGeo = {};
function getCornerGeo(h) {
  const key = `${h}`;
  if (!_cornerGeo[key]) _cornerGeo[key] = new THREE.BoxGeometry(WALL_THICKNESS, h, WALL_THICKNESS);
  return _cornerGeo[key];
}

function CornerPosts({ pieces, textures }) {
  const corners = useMemo(() => {
    // Collect wall pieces
    const wallTypes = new Set(['wall', 'wallDoor', 'wallWindow', 'halfWall', 'fence', 'reinforcedWall']);
    const walls = pieces.filter(p => wallTypes.has(p.type));
    if (walls.length < 2) return [];

    // For each wall, compute its two endpoints (left/right ends in world space)
    const eps = []; // { x, y, z, height, wallId }
    for (const w of walls) {
      const def = PIECE_TYPES[w.type];
      if (!def) continue;
      const halfW = def.dims[0] / 2;
      const rot = w.rotation || 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      // Local endpoints at (-halfW, 0) and (+halfW, 0) in wall's local X
      eps.push({ x: w.x - halfW * cosR, z: w.z - halfW * (-sinR), y: w.y, height: def.dims[1], wallId: w.id, rot });
      eps.push({ x: w.x + halfW * cosR, z: w.z + halfW * (-sinR), y: w.y, height: def.dims[1], wallId: w.id, rot });
    }

    // Find pairs of endpoints from DIFFERENT walls that are very close (within WALL_THICKNESS)
    // and at different rotations (meaning they form a corner)
    const posts = [];
    const used = new Set();
    const thresh = WALL_THICKNESS * 1.5;
    for (let i = 0; i < eps.length; i++) {
      for (let j = i + 1; j < eps.length; j++) {
        if (eps[i].wallId === eps[j].wallId) continue;
        const dx = eps[i].x - eps[j].x;
        const dz = eps[i].z - eps[j].z;
        const dy = eps[i].y - eps[j].y;
        if (Math.abs(dx) > thresh || Math.abs(dz) > thresh || Math.abs(dy) > 1) continue;
        // Check that rotations differ (i.e. not parallel walls)
        const angleDiff = Math.abs(eps[i].rot - eps[j].rot) % Math.PI;
        if (angleDiff < 0.3 || angleDiff > Math.PI - 0.3) continue; // parallel or anti-parallel, skip
        const key = `${Math.round((eps[i].x + eps[j].x) * 10)}_${Math.round((eps[i].z + eps[j].z) * 10)}_${Math.round(eps[i].y)}`;
        if (used.has(key)) continue;
        used.add(key);
        const h = Math.min(eps[i].height, eps[j].height);
        posts.push({
          x: (eps[i].x + eps[j].x) / 2,
          y: eps[i].y,
          z: (eps[i].z + eps[j].z) / 2,
          height: h,
        });
      }
    }
    return posts;
  }, [pieces]);

  if (corners.length === 0) return null;

  const wallTex = textures ? textures['wall'] : null;

  return (
    <>
      {corners.map((c, i) => (
        <mesh
          key={`corner-${i}`}
          geometry={getCornerGeo(c.height)}
          position={[c.x, c.y + c.height / 2, c.z]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#ffffff"
            map={wallTex || null}
            roughness={0.85}
            metalness={0.15}
          />
        </mesh>
      ))}
    </>
  );
}

/* ================================================================
   SelectedPropGizmo — TransformControls for a selected model prop
   Shows scale/rotate/translate gizmo on a placed model prop.
   Activated when player clicks a model prop in build mode.
   ================================================================ */
function SelectedPropGizmo({ pieces, wsSend }) {
  const selectedPropId = useBuildingStore(s => s.selectedPropId);
  const updatePieceTransform = useBuildingStore(s => s.updatePieceTransform);
  const groupRef = useRef();
  const tcRef = useRef();
  const [transformMode, setTransformMode] = useState('translate');

  const piece = useMemo(() => {
    if (!selectedPropId) return null;
    return pieces.find(p => p.id === selectedPropId) || null;
  }, [selectedPropId, pieces]);

  // Set initial position when piece changes
  useEffect(() => {
    if (piece && groupRef.current) {
      groupRef.current.position.set(piece.x, piece.y, piece.z);
      groupRef.current.rotation.set(0, piece.rotation || 0, 0);
      const sc = piece.modelScale || PIECE_TYPES[piece.type]?.defaultScale || [0.1, 0.1, 0.1];
      groupRef.current.scale.set(sc[0], sc[1], sc[2]);
    }
  }, [piece]);

  // Keyboard shortcut to switch transform mode (T/R/S) while prop is selected
  useEffect(() => {
    if (!selectedPropId) return;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 't' || e.key === 'T') setTransformMode('translate');
      else if (e.key === 'r' || e.key === 'R') setTransformMode('rotate');
      else if (e.key === 'g' || e.key === 'G') setTransformMode('scale');
      else if (e.key === 'Escape') useBuildingStore.getState().setSelectedProp(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPropId]);

  // Save helper — persist locally + WS sync
  const saveAndSync = useCallback(() => {
    if (!groupRef.current || !piece) return;
    const pos = groupRef.current.position;
    const rot = groupRef.current.rotation;
    const scl = groupRef.current.scale;
    updatePieceTransform(piece.id, {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: rot.y,
      modelScale: [scl.x, scl.y, scl.z],
    });
    if (wsSend) {
      try {
        wsSend({
          type: 'build_transform',
          pieceId: piece.id,
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: rot.y,
          modelScale: [scl.x, scl.y, scl.z],
        });
      } catch {}
    }
  }, [piece, updatePieceTransform, wsSend]);

  // Handle transform end (mouse gizmo drag)
  useEffect(() => {
    if (!tcRef.current) return;
    const controls = tcRef.current;
    const onChanged = (event) => {
      if (event.value) return; // dragging started, wait for end
      saveAndSync();
    };
    controls.addEventListener('dragging-changed', onChanged);
    return () => {
      if (controls.removeEventListener) controls.removeEventListener('dragging-changed', onChanged);
    };
  }, [saveAndSync]);

  // Gamepad prop controls — D-pad move/rotate, LB/RB scale, Y deselect
  const lastSaveRef = useRef(0);
  useFrame((_, delta) => {
    if (!selectedPropId || !groupRef.current || !piece) return;
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!gp) return;

    const MOVE_SPEED = 40; // units/sec
    const ROT_SPEED = 2;   // rad/sec
    const SCALE_SPEED = 0.5; // scale units/sec
    const MIN_SCALE = 0.01;
    const MAX_SCALE = 5;
    let changed = false;

    // D-pad Up (12) / Down (13) — move Y
    if (gp.buttons[12]?.pressed) { groupRef.current.position.y += MOVE_SPEED * delta; changed = true; }
    if (gp.buttons[13]?.pressed) { groupRef.current.position.y -= MOVE_SPEED * delta; changed = true; }
    // D-pad Left (14) / Right (15) — rotate Y
    if (gp.buttons[14]?.pressed) { groupRef.current.rotation.y += ROT_SPEED * delta; changed = true; }
    if (gp.buttons[15]?.pressed) { groupRef.current.rotation.y -= ROT_SPEED * delta; changed = true; }
    // LB (4) — scale down, RB (5) — scale up
    if (gp.buttons[4]?.pressed) {
      const s = Math.max(MIN_SCALE, groupRef.current.scale.x - SCALE_SPEED * delta);
      groupRef.current.scale.set(s, s, s);
      changed = true;
    }
    if (gp.buttons[5]?.pressed) {
      const s = Math.min(MAX_SCALE, groupRef.current.scale.x + SCALE_SPEED * delta);
      groupRef.current.scale.set(s, s, s);
      changed = true;
    }
    // Y button (3) — deselect prop
    if (gp.buttons[3]?.pressed) {
      useBuildingStore.getState().setSelectedProp(null);
      return;
    }

    // Throttled save — 200ms
    if (changed) {
      const now = performance.now();
      if (now - lastSaveRef.current > 200) {
        lastSaveRef.current = now;
        saveAndSync();
      }
    }
  });

  if (!piece || !PIECE_TYPES[piece.type]?.isModel) return null;

  return (
    <>
      <group ref={groupRef}>
        {/* invisible mesh just so TransformControls has something to attach to */}
        <mesh visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {groupRef.current && (
        <TransformControls
          ref={tcRef}
          object={groupRef.current}
          mode={transformMode}
          size={0.6}
        />
      )}
    </>
  );
}

/* ================================================================
   BuildingSystem — default export (3D, inside Canvas)
   Manages ghost preview position, snap detection, piece rendering
   ================================================================ */
export default function BuildingSystem({ groundY, wsSend }) {
  const buildMode = useBuildingStore(s => s.buildMode);
  const selectedPiece = useBuildingStore(s => s.selectedPiece);
  const deleteMode = useBuildingStore(s => s.deleteMode);
  const deleteTargetId = useBuildingStore(s => s.deleteTargetId);
  const setDeleteTarget = useBuildingStore(s => s.setDeleteTarget);
  const pieces = useBuildingStore(s => s.pieces);
  const ghostPosition = useBuildingStore(s => s.ghostPosition);
  const ghostRotation = useBuildingStore(s => s.ghostRotation);
  const ghostValid = useBuildingStore(s => s.ghostValid);
  const setGhost = useBuildingStore(s => s.setGhost);

  // Load building textures
  const texturePaths = useMemo(() => [...new Set(Object.values(PIECE_TEXTURE_MAP))], []);
  const rawTextures = useLoader(TextureLoader, texturePaths);
  const buildingTextures = useMemo(() => {
    const map = {};
    texturePaths.forEach((path, i) => {
      const tex = rawTextures[i];
      if (tex) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2); // default repeat
        tex.colorSpace = THREE.SRGBColorSpace;
        map[path] = tex;
      }
    });
    // Create per-piece-type cloned textures with correct repeat
    const perType = {};
    for (const [pieceType, texPath] of Object.entries(PIECE_TEXTURE_MAP)) {
      const src = map[texPath];
      if (!src) continue;
      const cloned = src.clone();
      const rep = PIECE_TEXTURE_REPEAT[pieceType] || [2, 2];
      cloned.wrapS = THREE.RepeatWrapping;
      cloned.wrapT = THREE.RepeatWrapping;
      cloned.repeat.set(rep[0], rep[1]);
      cloned.needsUpdate = true;
      perType[pieceType] = cloned;
    }
    return perType;
  }, [rawTextures, texturePaths]);
  const placePiece = useBuildingStore(s => s.placePiece);
  const removePiece = useBuildingStore(s => s.removePiece);
  const cyclePiece = useBuildingStore(s => s.cyclePiece);

  const ghostRotRef = useRef(0);
  const placeDebounce = useRef(0);

  // Gamepad previous-frame button states for edge detection
  const gpPrev = useRef({
    a: false, x: false, lb: false, rb: false,
    dpadLeft: false, dpadRight: false, r3: false,
  });

  // Sync placed pieces to physics cache for walkable collision + wall blocking
  useEffect(() => {
    const physPieces = pieces.map(p => {
      const def = PIECE_TYPES[p.type];
      return {
        ...p,
        dims: def ? def.dims : [4, 0.3, 4],
        walkable: def ? !!def.walkable : false,
        snapType: def?.snapType,
        doorWidth: def?.doorWidth,
        doorHeight: def?.doorHeight,
      };
    });
    updateBuildingPiecesCache(physPieces);
  }, [pieces]);

  // Helper: find the piece the player is looking at (nearest in look direction)
  const findDeleteTarget = (px, pz, yaw) => {
    const lookX = -Math.sin(yaw);
    const lookZ = -Math.cos(yaw);
    let best = null, bestScore = Infinity;
    const maxDist = 50; // max range for delete targeting
    for (const p of pieces) {
      const dx = p.x - px, dz = p.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxDist) continue;
      // Dot product: how much is this piece in the look direction?
      const dot = (dx * lookX + dz * lookZ) / (dist || 1);
      if (dot < 0.3) continue; // must be roughly in front
      // Score: prefer closer + more aligned
      const score = dist * (1 - dot * 0.5);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  };

  // Helper: delete targeted piece
  const deleteTargetedPiece = useCallback(() => {
    const targetId = useBuildingStore.getState().deleteTargetId;
    if (!targetId) return;
    const piece = useBuildingStore.getState().pieces.find(p => p.id === targetId);
    if (!piece) return;
    removePiece(targetId);
    if (wsSend) {
      try { wsSend({ type: 'build_destroy', pieceId: targetId }); } catch {}
    }
  }, [removePiece, wsSend]);

  // Update ghost preview position each frame based on player position + facing
  useFrame((_, dt) => {
    if (!buildMode) return;

    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;

    const px = avatar.x || 0;
    const pz = avatar.z || 0;
    // In FPV, use camera yaw so ghost faces where you're looking; otherwise use camera orbit yaw for 3rd person
    const isFPV = !!avatar.firstPersonMode;
    const yaw = isFPV
      ? (typeof window.__CF_FPS_CAMERA_YAW__ === 'number' ? window.__CF_FPS_CAMERA_YAW__ : (avatar.yaw || 0))
      : (typeof window.__CF_3RD_CAMERA_YAW__ === 'number' ? window.__CF_3RD_CAMERA_YAW__ : (avatar.yaw || 0));

    // --- DELETE MODE: find nearest piece in look direction ---
    if (deleteMode) {
      const target = findDeleteTarget(px, pz, yaw);
      setDeleteTarget(target ? target.id : null);
      // Publish state for HTML overlay
      window.__CF_BUILDING_STATE__ = {
        buildMode: true,
        deleteMode: true,
        selectedPiece: 'demolish',
        ghostValid: !!target,
        deleteTargetId: target ? target.id : null,
      };

      // Gamepad controls in delete mode
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
      if (gp) {
        const prev = gpPrev.current;
        const aBtn  = gp.buttons[0]?.pressed || false;
        const xBtn  = gp.buttons[2]?.pressed || false;
        const dlBtn = gp.buttons[14]?.pressed || false;
        const drBtn = gp.buttons[15]?.pressed || false;
        // A or X — delete targeted piece
        if ((aBtn && !prev.a) || (xBtn && !prev.x)) {
          deleteTargetedPiece();
        }
        // D-pad Left/Right — cycle piece type (can leave delete mode)
        if (dlBtn && !prev.dpadLeft)  cyclePiece(-1);
        if (drBtn && !prev.dpadRight) cyclePiece(1);
        prev.a = aBtn; prev.x = xBtn;
        prev.dpadLeft = dlBtn; prev.dpadRight = drBtn;
      }
      return; // skip normal ghost logic
    }
    // Clear delete target when not in delete mode
    setDeleteTarget(null);

    // Place ghost 38 units in front of player (pieces are large)
    // Forward direction matches THREE.js: (-sin(yaw), -cos(yaw))
    const dist = 38;
    const rawX = px - Math.sin(yaw) * dist;
    const rawZ = pz - Math.cos(yaw) * dist;

    // Get terrain height at ghost position
    const terrainY = getTerrainHeightXZ(rawX, rawZ);
    const baseY = (groundY || 0) + Math.max(0, terrainY);

    // Player's actual world Y position (includes platform lift from standing on buildings)
    const playerLift = avatar.lift || 0;
    const playerWorldY = (groundY || 0) + playerLift;

    const currentRot = ghostRotRef.current;

    // Check for snap points on existing pieces (with directional bias + vertical level preference)
    const snap = findBestSnap([rawX, baseY, rawZ], currentRot, selectedPiece, pieces, [px, pz], yaw, playerWorldY);

    let finalPos, finalRot, isValid;

    if (snap) {
      // Snap to existing piece
      finalPos = snap.position;
      finalRot = snap.rotation;
      isValid = !checkOverlap(finalPos[0], finalPos[1], finalPos[2], finalRot, selectedPiece, pieces);
    } else {
      // Free placement on terrain (foundations only)
      // Snap to grid
      const gridX = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
      const gridZ = Math.round(rawZ / GRID_SIZE) * GRID_SIZE;

      // Sample terrain height at all 4 corners + center of the foundation footprint
      // to ensure the slab sits above terrain everywhere
      const halfG = GRID_SIZE / 2;
      const hCenter = getTerrainHeightXZ(gridX, gridZ);
      const hNE = getTerrainHeightXZ(gridX + halfG, gridZ - halfG);
      const hNW = getTerrainHeightXZ(gridX - halfG, gridZ - halfG);
      const hSE = getTerrainHeightXZ(gridX + halfG, gridZ + halfG);
      const hSW = getTerrainHeightXZ(gridX - halfG, gridZ + halfG);
      const maxTerrainH = Math.max(hCenter, hNE, hNW, hSE, hSW);
      const gridTerrainY = (groundY || 0) + Math.max(0, maxTerrainH);

      finalPos = [gridX, gridTerrainY, gridZ];
      finalRot = currentRot;

      // Pieces that can be placed directly on terrain (no foundation required)
      const pDef = PIECE_TYPES[selectedPiece];
      const canPlaceOnTerrain = selectedPiece === 'foundation' || selectedPiece === 'ramp'
        || selectedPiece === 'turret' || selectedPiece === 'spikeTrap'
        || (pDef && pDef.isModel);
      isValid = canPlaceOnTerrain && !checkOverlap(gridX, gridTerrainY, gridZ, currentRot, selectedPiece, pieces);
    }

    // Check resources
    if (isValid) {
      const pieceDef = PIECE_TYPES[selectedPiece];
      const inv = useInventoryStore.getState();
      for (const [resId, needed] of Object.entries(pieceDef.cost)) {
        if ((inv.resources[resId] || 0) < needed) {
          isValid = false;
          break;
        }
      }
    }

    // Block modelCustom placement if no model path selected
    if (isValid && selectedPiece === 'modelCustom') {
      const cmPath = useBuildingStore.getState().customModelPath;
      if (!cmPath) isValid = false;
    }

    setGhost(finalPos, finalRot, isValid);

    // Publish state for HTML overlay
    window.__CF_BUILDING_STATE__ = {
      buildMode: true,
      selectedPiece,
      ghostValid: isValid,
      ghostPosition: finalPos,
    };

    // --- Gamepad controls (polled each frame while in build mode) ---
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
    if (gp) {
      const prev = gpPrev.current;
      const aBtn  = gp.buttons[0]?.pressed || false;
      const xBtn  = gp.buttons[2]?.pressed || false;
      const lbBtn = gp.buttons[4]?.pressed || false;
      const rbBtn = gp.buttons[5]?.pressed || false;
      const dlBtn = gp.buttons[14]?.pressed || false;
      const drBtn = gp.buttons[15]?.pressed || false;

      // A button — place piece
      if (aBtn && !prev.a) {
        const placed = placePiece('local');
        if (placed && wsSend) {
          try { wsSend({ type: 'build_place', piece: placed }); } catch {}
        }
      }

      // X button — destroy nearest own piece
      if (xBtn && !prev.x) {
        const av = window.__CF_LOCAL_AVATAR__;
        if (av) {
          const all = useBuildingStore.getState().pieces;
          let closest = null, closestDist = 10;
          for (const p of all) {
            if (p.ownerId !== 'local') continue;
            const ddx = av.x - p.x, ddz = av.z - p.z;
            const dd = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dd < closestDist) { closestDist = dd; closest = p; }
          }
          if (closest) {
            removePiece(closest.id);
            if (wsSend) {
              try { wsSend({ type: 'build_destroy', pieceId: closest.id }); } catch {}
            }
          }
        }
      }

      // LB — rotate left
      if (lbBtn && !prev.lb) ghostRotRef.current -= Math.PI / 2;
      // RB — rotate right
      if (rbBtn && !prev.rb) ghostRotRef.current += Math.PI / 2;

      // D-pad Left/Right — cycle piece type
      if (dlBtn && !prev.dpadLeft)  cyclePiece(-1);
      if (drBtn && !prev.dpadRight) cyclePiece(1);

      // Update prev state
      prev.a = aBtn; prev.x = xBtn;
      prev.lb = lbBtn; prev.rb = rbBtn;
      prev.dpadLeft = dlBtn; prev.dpadRight = drBtn;
    }
  });

  // Clean up window state when build mode exits
  useEffect(() => {
    if (!buildMode) {
      window.__CF_BUILDING_STATE__ = { buildMode: false };
    }
  }, [buildMode]);

  // Keyboard controls for building
  useEffect(() => {
    if (!buildMode) return;

    const onKey = (e) => {
      const key = e.key.toLowerCase();
      const store = useBuildingStore.getState();
      const isDeleteMode = store.deleteMode;

      // Rotate ghost (Q/E or brackets) — only in placement mode
      if (!isDeleteMode) {
        if (key === 'q' || key === '[') {
          ghostRotRef.current -= Math.PI / 2;
        }
        if (key === 'e' || key === ']') {
          ghostRotRef.current += Math.PI / 2;
        }
      }

      // Cycle pieces with number keys 1-8
      const num = parseInt(key);
      if (num >= 1 && num <= PIECE_ORDER.length) {
        store.selectPiece(PIECE_ORDER[num - 1]);
      }

      // Place piece OR delete targeted piece on Enter
      if (key === 'enter' || key === 'return') {
        if (isDeleteMode) {
          deleteTargetedPiece();
        } else {
          const placed = placePiece('local');
          if (placed && wsSend) {
            try { wsSend({ type: 'build_place', piece: placed }); } catch {}
          }
        }
      }

      // Delete/destroy piece on X — works in both modes
      if (key === 'x') {
        if (isDeleteMode) {
          // Delete the currently targeted piece
          deleteTargetedPiece();
        } else {
          // Find closest own piece within 10 units
          const avatar = window.__CF_LOCAL_AVATAR__;
          if (!avatar) return;
          const allPieces = store.pieces;
          let closest = null, closestDist = 10;
          for (const p of allPieces) {
            if (p.ownerId !== 'local') continue;
            const dx = avatar.x - p.x;
            const dz = avatar.z - p.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < closestDist) {
              closestDist = d;
              closest = p;
            }
          }
          if (closest) {
            removePiece(closest.id);
            if (wsSend) {
              try { wsSend({ type: 'build_destroy', pieceId: closest.id }); } catch {}
            }
          }
        }
      }

      // Cycle with scroll alternative: comma/period
      if (key === ',' || key === '<') cyclePiece(-1);
      if (key === '.' || key === '>') cyclePiece(1);
    };

    // Place piece or delete on mouse click
    const onClick = (e) => {
      if (e.button !== 0) return; // left click only
      const now = Date.now();
      if (now - placeDebounce.current < 200) return;
      placeDebounce.current = now;

      const store = useBuildingStore.getState();
      if (store.deleteMode) {
        deleteTargetedPiece();
      } else {
        const placed = placePiece('local');
        if (placed && wsSend) {
          try { wsSend({ type: 'build_place', piece: placed }); } catch {}
        }
      }
    };

    // Scroll wheel to cycle pieces
    const onWheel = (e) => {
      if (!buildMode) return;
      e.preventDefault();
      cyclePiece(e.deltaY > 0 ? 1 : -1);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      window.removeEventListener('wheel', onWheel);
    };
  }, [buildMode, placePiece, removePiece, cyclePiece, wsSend, deleteTargetedPiece]);

  // ── Door interaction: press X near a wallDoor to toggle it (works outside build mode) ──
  // Also polls gamepad X button for controller support
  const gpDoorPrev = useRef(false);
  const toggleNearestDoor = useCallback(() => {
    const DOOR_INTERACT_RANGE = 50;
    const state = useBuildingStore.getState();
    if (state.buildMode) return; // build mode X has its own handler

    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;

    const doors = state.pieces.filter(p => p.type === 'wallDoor');
    let closestDoor = null, closestDist = DOOR_INTERACT_RANGE;
    for (const p of doors) {
      const dx = (avatar.x || 0) - p.x;
      const dz = (avatar.z || 0) - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < closestDist) {
        closestDist = dist;
        closestDoor = p;
      }
    }
    if (!closestDoor) return;

    const wasOpen = !!state.doorStates[closestDoor.id];
    state.toggleDoor(closestDoor.id);
    if (wsSend) {
      try { wsSend({ type: 'door_toggle', pieceId: closestDoor.id, isOpen: !wasOpen }); } catch {}
    }
  }, [wsSend]);

  // Keyboard X for doors
  useEffect(() => {
    const onDoorKey = (e) => {
      if (e.key.toLowerCase() !== 'x') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      toggleNearestDoor();
    };
    window.addEventListener('keydown', onDoorKey);
    return () => window.removeEventListener('keydown', onDoorKey);
  }, [toggleNearestDoor]);

  // Gamepad X button for doors (polled via useFrame, outside build mode)
  useFrame(() => {
    const state = useBuildingStore.getState();
    if (state.buildMode) { gpDoorPrev.current = false; return; }

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
    if (!gp) return;

    const xBtn = gp.buttons[2]?.pressed || false;
    if (xBtn && !gpDoorPrev.current) {
      toggleNearestDoor();
    }
    gpDoorPrev.current = xBtn;
  });

  // Remote build events are handled directly in RoomView → useBuildingStore
  // (avoids Suspense race condition with texture loading)

  // Load building pieces from server on room join
  // (sync listener is in RoomView to avoid Suspense race condition)

  return (
    <>
      {/* Render all placed building pieces */}
      {pieces.map(piece => (
        <PlacedPiece
          key={piece.id}
          piece={piece}
          isDeleteTarget={deleteMode && deleteTargetId === piece.id}
          textures={buildingTextures}
          wsSend={wsSend}
        />
      ))}

      {/* Ghost preview (only in build mode, not in delete mode) */}
      {buildMode && !deleteMode && (
        <GhostPreview
          pieceType={selectedPiece}
          position={ghostPosition}
          rotation={ghostRotation}
          valid={ghostValid}
        />
      )}

      {/* Auto-generated corner posts where walls meet at 90° */}
      <CornerPosts pieces={pieces} textures={buildingTextures} />

      {/* TransformControls gizmo for selected model prop */}
      <SelectedPropGizmo pieces={pieces} wsSend={wsSend} />
    </>
  );
}

/* ================================================================
   BuildingOverlays — named export (HTML, OUTSIDE Canvas)
   Shows piece selector, resource costs, build mode indicator
   ================================================================ */
export function BuildingOverlays() {
  const buildMode = useBuildingStore(s => s.buildMode);
  const selectedPiece = useBuildingStore(s => s.selectedPiece);
  const deleteMode = useBuildingStore(s => s.deleteMode);
  const toggleBuildMode = useBuildingStore(s => s.toggleBuildMode);
  const selectPiece = useBuildingStore(s => s.selectPiece);
  const customModelPath = useBuildingStore(s => s.customModelPath);
  const setCustomModelPath = useBuildingStore(s => s.setCustomModelPath);
  const selectedPropId = useBuildingStore(s => s.selectedPropId);
  const resources = useInventoryStore(s => s.resources);
  const [, setTick] = useState(0);
  const [nearbyDoor, setNearbyDoor] = useState(null); // { id, isOpen, dist }
  const [availableModels, setAvailableModels] = useState([]);

  // Fetch available models from server for custom model picker
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(data => { if (data.models) setAvailableModels(data.models.filter(m => m.path)); })
      .catch(() => {});
  }, []);

  // Poll for nearby door (always active, not just in build mode)
  useEffect(() => {
    const DOOR_PROMPT_RANGE = 50;
    const iv = setInterval(() => {
      const avatar = window.__CF_LOCAL_AVATAR__;
      if (!avatar) { setNearbyDoor(null); return; }
      const state = useBuildingStore.getState();
      // Don't show prompt in build mode (build UI is showing)
      if (state.buildMode) { setNearbyDoor(null); return; }
      const doors = state.pieces.filter(p => p.type === 'wallDoor');
      let closest = null, closestDist = DOOR_PROMPT_RANGE;
      for (const p of doors) {
        const dx = (avatar.x || 0) - p.x;
        const dz = (avatar.z || 0) - p.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < closestDist) {
          closestDist = dist;
          closest = p;
        }
      }
      if (closest) {
        const isOpen = !!state.doorStates[closest.id];
        setNearbyDoor({ id: closest.id, isOpen, dist: closestDist });
      } else {
        setNearbyDoor(null);
      }
    }, 200);
    return () => clearInterval(iv);
  }, []);

  // Poll for ghost state updates
  useEffect(() => {
    if (!buildMode) return;
    const iv = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(iv);
  }, [buildMode]);

  // Toggle build mode on B key or R3 (Right Stick Click, gamepad button 11)
  const gpTogglePrev = useRef(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'b' || e.key === 'B') {
        // Don't toggle if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        toggleBuildMode();
      }
    };
    window.addEventListener('keydown', onKey);

    // Poll gamepad for R3 toggle (runs whether or not build mode is active)
    let rafId;
    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
      if (gp) {
        const r3Now = gp.buttons[11]?.pressed || false;
        if (r3Now && !gpTogglePrev.current) {
          toggleBuildMode();
        }
        gpTogglePrev.current = r3Now;
      }
      rafId = requestAnimationFrame(pollGamepad);
    };
    rafId = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(rafId);
    };
  }, [toggleBuildMode]);

  const ghostState = window.__CF_BUILDING_STATE__ || {};

  // Show door prompt even outside build mode
  if (!buildMode) {
    if (!nearbyDoor) return null;
    return (
      <div style={{
        position: 'fixed', bottom: '20%', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,200,50,0.6)',
        borderRadius: 8, padding: '10px 24px',
        color: '#ffd700', fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold',
        zIndex: 9500, pointerEvents: 'none', backdropFilter: 'blur(4px)',
        textAlign: 'center', textShadow: '0 0 10px rgba(255,215,0,0.4)',
        animation: 'pulse 2s ease-in-out infinite',
      }}>
        <div>Press <span style={{ color: '#fff', fontSize: 20, border: '1px solid #888', borderRadius: 4, padding: '0 6px', background: 'rgba(255,255,255,0.1)' }}>X</span> to {nearbyDoor.isOpen ? 'Close' : 'Open'} Door</div>
      </div>
    );
  }

  const selectedDef = PIECE_TYPES[selectedPiece];
  const isDemolish = deleteMode || selectedPiece === 'demolish';

  // Check if player can afford each piece
  const canAfford = (pieceType) => {
    if (pieceType === 'demolish') return true; // demolish is always available
    const def = PIECE_TYPES[pieceType];
    if (!def) return false;
    for (const [resId, needed] of Object.entries(def.cost)) {
      if ((resources[resId] || 0) < needed) return false;
    }
    return true;
  };

  // Piece selector items — includes demolish at end
  const DEMOLISH_DEF = { glyph: '🗑️', label: 'Demolish', description: 'Look at a piece and click to delete it.' };

  return (
    <>
      {/* Build mode indicator */}
      <div style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: isDemolish ? 'rgba(60,0,0,0.85)' : 'rgba(0,0,0,0.8)',
        border: `1px solid ${isDemolish ? '#ff4444' : '#00d4ff'}`,
        borderRadius: 8, padding: '6px 20px',
        color: isDemolish ? '#ff4444' : '#00d4ff',
        fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold',
        zIndex: 9500, pointerEvents: 'none', backdropFilter: 'blur(4px)',
        textTransform: 'uppercase', letterSpacing: 2,
      }}>
        {isDemolish ? '🗑️ DEMOLISH MODE' : '🔨 BUILD MODE'}
      </div>

      {/* Piece selector bar (bottom center — raised above HP/ammo bar area) */}
      <div style={{
        position: 'fixed', bottom: 170, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 2, background: 'rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
        padding: '6px 8px', zIndex: 9500, backdropFilter: 'blur(6px)',
        maxWidth: '95vw', flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {PIECE_ORDER.map((pieceId, idx) => {
          const def = pieceId === 'demolish' ? DEMOLISH_DEF : PIECE_TYPES[pieceId];
          const isSelected = selectedPiece === pieceId;
          const affordable = canAfford(pieceId);
          const isDemolishItem = pieceId === 'demolish';
          return (
            <div
              key={pieceId}
              onClick={() => selectPiece(pieceId)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
                background: isSelected
                  ? (isDemolishItem ? 'rgba(255,68,68,0.25)' : 'rgba(0,212,255,0.2)')
                  : 'transparent',
                border: isSelected
                  ? `1px solid ${isDemolishItem ? '#ff4444' : '#00d4ff'}`
                  : '1px solid transparent',
                opacity: affordable ? 1 : 0.4,
                transition: 'all 0.15s',
                minWidth: 38,
              }}
            >
              <span style={{ fontSize: 16 }}>{def.glyph}</span>
              <span style={{
                fontSize: 8,
                color: isSelected ? (isDemolishItem ? '#ff4444' : '#00d4ff') : '#aaa',
                fontFamily: 'monospace', marginTop: 1, whiteSpace: 'nowrap',
              }}>{def.label}</span>
              <span style={{
                fontSize: 7, color: '#666', fontFamily: 'monospace',
              }}>{idx < 9 ? idx + 1 : ''}</span>
            </div>
          );
        })}
      </div>

      {/* Selected piece info + cost (bottom-left — raised above HP bar) */}
      {isDemolish ? (
        <div style={{
          position: 'fixed', bottom: 240, left: 16,
          background: 'rgba(60,0,0,0.85)', border: '1px solid rgba(255,68,68,0.3)',
          borderRadius: 8, padding: '10px 14px', color: '#fff',
          fontFamily: 'monospace', fontSize: 12, zIndex: 9500,
          backdropFilter: 'blur(4px)', minWidth: 160,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 4, color: '#ff4444' }}>
            🗑️ Demolish
          </div>
          <div style={{ opacity: 0.7, fontSize: 11 }}>
            Look at a piece and click to delete it.
          </div>
          <div style={{ opacity: 0.5, fontSize: 10, marginTop: 6 }}>
            Refunds half materials.
          </div>
        </div>
      ) : selectedDef && (
        <div style={{
          position: 'fixed', bottom: 240, left: 16,
          background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8, padding: '10px 14px', color: '#fff',
          fontFamily: 'monospace', fontSize: 12, zIndex: 9500,
          backdropFilter: 'blur(4px)', minWidth: 160,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 4 }}>
            {selectedDef.glyph} {selectedDef.label}
          </div>
          <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 8 }}>
            {selectedDef.description}
          </div>
          {/* Custom model picker for modelCustom */}
          {selectedPiece === 'modelCustom' && (
            <div style={{ marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
              <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>SELECT MODEL:</div>
              <select
                value={customModelPath || ''}
                onChange={(e) => setCustomModelPath(e.target.value || null)}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4,
                  color: '#fff', fontFamily: 'monospace', fontSize: 11,
                  padding: '4px 6px', cursor: 'pointer',
                }}
              >
                <option value="" style={{ background: '#222' }}>-- pick a model --</option>
                {availableModels.map(m => (
                  <option key={m.path} value={m.path} style={{ background: '#222' }}>
                    {m.name}
                  </option>
                ))}
              </select>
              {!customModelPath && (
                <div style={{ color: '#ff8800', fontSize: 10, marginTop: 4, opacity: 0.8 }}>
                  ⚠ Pick a model before placing
                </div>
              )}
            </div>
          )}
          {/* Model prop post-place hint */}
          {selectedDef.isModel && (
            <div style={{ marginBottom: 6, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 10, color: '#00d4ff', opacity: 0.8 }}>
                💡 After placing, click prop in build mode to adjust with T/R/G gizmo
              </div>
            </div>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>COST:</div>
            {Object.entries(selectedDef.cost).map(([resId, needed]) => {
              const cat = ITEM_CATALOG[resId];
              const have = resources[resId] || 0;
              const enough = have >= needed;
              return (
                <div key={resId} style={{
                  display: 'flex', justifyContent: 'space-between',
                  color: enough ? '#22c55e' : '#ef4444',
                  marginBottom: 2,
                }}>
                  <span>{cat?.glyph} {cat?.label}</span>
                  <span>{have}/{needed}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls hint (bottom-right — raised above ammo display) */}
      <div style={{
        position: 'fixed', bottom: 240, right: 16,
        background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8, padding: '8px 12px', color: '#999',
        fontFamily: 'monospace', fontSize: 10, zIndex: 9500,
        lineHeight: 1.6,
      }}>
        <div style={{ marginBottom: 4, color: '#aaa', fontSize: 9, opacity: 0.6 }}>KEYBOARD</div>
        <div><span style={{ color: '#fff' }}>Click</span> / <span style={{ color: '#fff' }}>Enter</span> — {isDemolish ? 'Delete' : 'Place'}</div>
        {!isDemolish && <div><span style={{ color: '#fff' }}>Q/E</span> — Rotate</div>}
        <div><span style={{ color: '#fff' }}>Scroll</span> / <span style={{ color: '#fff' }}>,.</span> — Cycle piece</div>
        <div><span style={{ color: '#fff' }}>1-9</span> — Select piece</div>
        {!isDemolish && <div><span style={{ color: '#fff' }}>X</span> — Destroy nearest</div>}
        <div><span style={{ color: '#fff' }}>B</span> — Exit build mode</div>
        {selectedPropId && (
          <>
            <div style={{ marginTop: 6, marginBottom: 4, color: '#ffd700', fontSize: 9, opacity: 0.8 }}>PROP GIZMO</div>
            <div><span style={{ color: '#ffd700' }}>T</span> — Translate</div>
            <div><span style={{ color: '#ffd700' }}>R</span> — Rotate</div>
            <div><span style={{ color: '#ffd700' }}>G</span> — Scale</div>
            <div><span style={{ color: '#ffd700' }}>Esc</span> — Deselect</div>
          </>
        )}
        <div style={{ marginTop: 6, marginBottom: 4, color: '#aaa', fontSize: 9, opacity: 0.6 }}>CONTROLLER</div>
        <div><span style={{ color: '#00d4ff' }}>A</span> — {isDemolish ? 'Delete' : 'Place'}</div>
        {!isDemolish && <div><span style={{ color: '#00d4ff' }}>LB/RB</span> — Rotate</div>}
        <div><span style={{ color: '#00d4ff' }}>D-pad ←→</span> — Cycle piece</div>
        <div><span style={{ color: '#00d4ff' }}>R3</span> — Exit build mode</div>
        {selectedPropId && (
          <>
            <div style={{ marginTop: 6, marginBottom: 4, color: '#ffd700', fontSize: 9, opacity: 0.8 }}>CONTROLLER PROP</div>
            <div><span style={{ color: '#ffd700' }}>D-pad ↑↓</span> — Move up/down</div>
            <div><span style={{ color: '#ffd700' }}>D-pad ←→</span> — Rotate</div>
            <div><span style={{ color: '#ffd700' }}>LB/RB</span> — Scale</div>
            <div><span style={{ color: '#ffd700' }}>Y</span> — Deselect</div>
          </>
        )}
      </div>

      {/* Placement / delete validity indicator */}
      {isDemolish ? (
        ghostState.deleteTargetId ? (
          <div style={{
            position: 'fixed', bottom: '15%', left: '50%', transform: 'translateX(-50%)',
            color: '#ff4444', fontFamily: 'monospace', fontSize: 13,
            pointerEvents: 'none', zIndex: 9500, opacity: 0.9,
            textShadow: '0 0 8px rgba(255,68,68,0.5)',
          }}>
            🗑️ Click to demolish
          </div>
        ) : (
          <div style={{
            position: 'fixed', bottom: '15%', left: '50%', transform: 'translateX(-50%)',
            color: '#888', fontFamily: 'monospace', fontSize: 12,
            pointerEvents: 'none', zIndex: 9500, opacity: 0.6,
          }}>
            Look at a piece to target it
          </div>
        )
      ) : !ghostState.ghostValid && (
        <div style={{
          position: 'fixed', bottom: '15%', left: '50%', transform: 'translateX(-50%)',
          color: '#ef4444', fontFamily: 'monospace', fontSize: 12,
          pointerEvents: 'none', zIndex: 9500, opacity: 0.8,
        }}>
          ✕ Cannot place here
        </div>
      )}
    </>
  );
}
