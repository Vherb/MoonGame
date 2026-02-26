// BuildingSystem.jsx — Base building system for placing modular structure pieces
// 
// ARCHITECTURE (same pattern as ResourceNodes):
//   • BuildingSystem (default export)  → 3D meshes, ghost preview — inside <Canvas>
//   • BuildingOverlays (named export)  → HTML HUD / piece selector — OUTSIDE <Canvas>

import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getTerrainHeightXZ, updateBuildingPiecesCache } from './terrainPhysics';
import { useInventoryStore, ITEM_CATALOG } from './useInventoryStore';
import {
  useBuildingStore,
  PIECE_TYPES,
  PIECE_ORDER,
  GRID_SIZE,
  WALL_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  RAMP_HEIGHT,
  getSnapPoints,
} from './useBuildingStore';

/* ================================================================
   Geometry builders for each piece type
   ================================================================ */
function createPieceGeometry(pieceType) {
  const def = PIECE_TYPES[pieceType];
  if (!def) return new THREE.BoxGeometry(1, 1, 1);

  switch (pieceType) {
    case 'foundation':
    case 'floor':
      return new THREE.BoxGeometry(def.dims[0], def.dims[1], def.dims[2]);

    case 'wall':
    case 'halfWall':
      return new THREE.BoxGeometry(def.dims[0], def.dims[1], def.dims[2]);

    case 'wallDoor': {
      // Wall with doorway cutout — use CSG-like approach via shape extrusion
      const shape = new THREE.Shape();
      const w = def.dims[0], h = def.dims[1];
      const dw = def.doorWidth / 2, dh = def.doorHeight;
      // Outer rectangle
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h);
      shape.lineTo(-w / 2, h);
      shape.lineTo(-w / 2, 0);
      // Door hole
      const hole = new THREE.Path();
      hole.moveTo(-dw, 0);
      hole.lineTo(dw, 0);
      hole.lineTo(dw, dh);
      hole.lineTo(-dw, dh);
      hole.lineTo(-dw, 0);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth: def.dims[2], bevelEnabled: false });
    }

    case 'wallWindow': {
      const shape = new THREE.Shape();
      const w = def.dims[0], h = def.dims[1];
      const ww = def.windowWidth / 2, wh = def.windowHeight / 2, wy = def.windowY;
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h);
      shape.lineTo(-w / 2, h);
      shape.lineTo(-w / 2, 0);
      const hole = new THREE.Path();
      hole.moveTo(-ww, wy - wh);
      hole.lineTo(ww, wy - wh);
      hole.lineTo(ww, wy + wh);
      hole.lineTo(-ww, wy + wh);
      hole.lineTo(-ww, wy - wh);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth: def.dims[2], bevelEnabled: false });
    }

    case 'ramp': {
      // Triangle prism (ramp shape)
      const shape = new THREE.Shape();
      const w = def.dims[0], h = def.dims[1], d = def.dims[2];
      // Side profile: right triangle
      shape.moveTo(0, 0);
      shape.lineTo(d, 0);
      shape.lineTo(d, h);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      // Center the geometry
      geo.translate(-d / 2, 0, -w / 2);
      return geo;
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
   ================================================================ */
const SNAP_DISTANCE = 3.0; // max distance to snap to a point

function findBestSnap(ghostPos, ghostRot, selectedPiece, placedPieces) {
  let bestSnap = null;
  let bestDist = SNAP_DISTANCE;

  for (const placed of placedPieces) {
    const snapPoints = getSnapPoints(placed.type, placed);
    for (const sp of snapPoints) {
      if (!sp.accepts.includes(selectedPiece)) continue;
      const dx = ghostPos[0] - sp.position[0];
      const dz = ghostPos[2] - sp.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
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
   PlacedPiece — single rendered building piece (3D mesh)
   ================================================================ */
function PlacedPiece({ piece }) {
  const def = PIECE_TYPES[piece.type];
  if (!def) return null;

  const geo = useMemo(() => getPieceGeometry(piece.type), [piece.type]);

  // For extruded geometries (door/window walls, ramps), offset Y to base
  const isExtruded = ['wallDoor', 'wallWindow'].includes(piece.type);
  const isRamp = piece.type === 'ramp';
  const yOffset = isExtruded ? 0 : def.dims[1] / 2;
  const zOffset = isExtruded ? -def.dims[2] / 2 : 0;

  // Health-based color tinting
  const healthRatio = (piece.health || 100) / 100;
  const color = new THREE.Color(def.color);
  if (healthRatio < 1) {
    color.lerp(new THREE.Color('#ff4444'), 1 - healthRatio);
  }

  return (
    <group position={[piece.x, piece.y, piece.z]} rotation={[0, piece.rotation || 0, 0]}>
      <mesh
        geometry={geo}
        position={[0, yOffset, zOffset]}
        castShadow
        receiveShadow
        userData={{ isBuildingPiece: true, pieceId: piece.id }}
      >
        <meshStandardMaterial
          color={color}
          roughness={0.85}
          metalness={0.15}
        />
      </mesh>
      {/* Wireframe edges for visual definition */}
      <mesh geometry={geo} position={[0, yOffset, zOffset]}>
        <meshBasicMaterial color="#444" wireframe opacity={0.15} transparent />
      </mesh>
    </group>
  );
}

/* ================================================================
   GhostPreview — semi-transparent preview of piece being placed
   ================================================================ */
function GhostPreview({ pieceType, position, rotation, valid }) {
  const def = PIECE_TYPES[pieceType];
  if (!def) return null;

  const geo = useMemo(() => getPieceGeometry(pieceType), [pieceType]);
  const isExtruded = ['wallDoor', 'wallWindow'].includes(pieceType);
  const yOffset = isExtruded ? 0 : def.dims[1] / 2;
  const zOffset = isExtruded ? -def.dims[2] / 2 : 0;

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
   BuildingSystem — default export (3D, inside Canvas)
   Manages ghost preview position, snap detection, piece rendering
   ================================================================ */
export default function BuildingSystem({ groundY, wsSend }) {
  const buildMode = useBuildingStore(s => s.buildMode);
  const selectedPiece = useBuildingStore(s => s.selectedPiece);
  const pieces = useBuildingStore(s => s.pieces);
  const ghostPosition = useBuildingStore(s => s.ghostPosition);
  const ghostRotation = useBuildingStore(s => s.ghostRotation);
  const ghostValid = useBuildingStore(s => s.ghostValid);
  const setGhost = useBuildingStore(s => s.setGhost);
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

  // Sync placed pieces to physics cache for walkable collision
  useEffect(() => {
    const physPieces = pieces.map(p => {
      const def = PIECE_TYPES[p.type];
      return {
        ...p,
        dims: def ? def.dims : [4, 0.3, 4],
        walkable: def ? !!def.walkable : false,
      };
    });
    updateBuildingPiecesCache(physPieces);
  }, [pieces]);

  // Update ghost preview position each frame based on player position + facing
  useFrame((_, dt) => {
    if (!buildMode) return;

    const avatar = window.__CF_LOCAL_AVATAR__;
    if (!avatar) return;

    const px = avatar.x || 0;
    const pz = avatar.z || 0;
    const yaw = avatar.yaw || 0;

    // Place ghost 8 units in front of player
    const dist = 8;
    const rawX = px + Math.sin(yaw) * dist;
    const rawZ = pz - Math.cos(yaw) * dist;

    // Get terrain height at ghost position
    const terrainY = getTerrainHeightXZ(rawX, rawZ);
    const baseY = (groundY || 0) + Math.max(0, terrainY);

    const currentRot = ghostRotRef.current;

    // Check for snap points on existing pieces
    const snap = findBestSnap([rawX, baseY, rawZ], currentRot, selectedPiece, pieces);

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
      const gridTerrainY = (groundY || 0) + Math.max(0, getTerrainHeightXZ(gridX, gridZ));

      finalPos = [gridX, gridTerrainY, gridZ];
      finalRot = currentRot;

      // Only foundations and ramps can be placed on terrain directly
      const canPlaceOnTerrain = selectedPiece === 'foundation' || selectedPiece === 'ramp';
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

      // Rotate ghost (Q/E or brackets)
      if (key === 'q' || key === '[') {
        ghostRotRef.current -= Math.PI / 2;
      }
      if (key === 'e' || key === ']') {
        // Only rotate if not also collecting resources — E in build mode = rotate
        ghostRotRef.current += Math.PI / 2;
      }

      // Cycle pieces with mouse wheel alternative: 1-7 number keys
      const num = parseInt(key);
      if (num >= 1 && num <= PIECE_ORDER.length) {
        useBuildingStore.getState().selectPiece(PIECE_ORDER[num - 1]);
      }

      // Place piece on Enter or left click handled separately
      if (key === 'enter' || key === 'return') {
        const placed = placePiece('local');
        if (placed && wsSend) {
          try { wsSend({ type: 'build_place', piece: placed }); } catch {}
        }
      }

      // Delete/destroy piece on X
      if (key === 'x') {
        // Find closest own piece within 10 units
        const avatar = window.__CF_LOCAL_AVATAR__;
        if (!avatar) return;
        const allPieces = useBuildingStore.getState().pieces;
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

      // Cycle with scroll alternative: comma/period
      if (key === ',' || key === '<') cyclePiece(-1);
      if (key === '.' || key === '>') cyclePiece(1);
    };

    // Place piece on mouse click
    const onClick = (e) => {
      if (e.button !== 0) return; // left click only
      const now = Date.now();
      if (now - placeDebounce.current < 200) return;
      placeDebounce.current = now;

      const placed = placePiece('local');
      if (placed && wsSend) {
        try { wsSend({ type: 'build_place', piece: placed }); } catch {}
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
  }, [buildMode, placePiece, removePiece, cyclePiece, wsSend]);

  // Listen for remote build events
  useEffect(() => {
    const handler = (e) => {
      try {
        const data = e.detail;
        if (data.type === 'build_place' && data.piece) {
          useBuildingStore.getState().addRemotePiece(data.piece);
        }
        if (data.type === 'build_destroy' && data.pieceId != null) {
          useBuildingStore.getState().removeRemotePiece(data.pieceId);
        }
      } catch {}
    };
    window.addEventListener('ws_building_msg', handler);
    return () => window.removeEventListener('ws_building_msg', handler);
  }, []);

  return (
    <>
      {/* Render all placed building pieces */}
      {pieces.map(piece => (
        <PlacedPiece key={piece.id} piece={piece} />
      ))}

      {/* Ghost preview (only in build mode) */}
      {buildMode && (
        <GhostPreview
          pieceType={selectedPiece}
          position={ghostPosition}
          rotation={ghostRotation}
          valid={ghostValid}
        />
      )}
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
  const toggleBuildMode = useBuildingStore(s => s.toggleBuildMode);
  const selectPiece = useBuildingStore(s => s.selectPiece);
  const resources = useInventoryStore(s => s.resources);
  const [tick, setTick] = useState(0);

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

  if (!buildMode) return null;

  const selectedDef = PIECE_TYPES[selectedPiece];

  // Check if player can afford each piece
  const canAfford = (pieceType) => {
    const def = PIECE_TYPES[pieceType];
    if (!def) return false;
    for (const [resId, needed] of Object.entries(def.cost)) {
      if ((resources[resId] || 0) < needed) return false;
    }
    return true;
  };

  return (
    <>
      {/* Build mode indicator */}
      <div style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.8)', border: '1px solid #00d4ff',
        borderRadius: 8, padding: '6px 20px', color: '#00d4ff',
        fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold',
        zIndex: 9500, pointerEvents: 'none', backdropFilter: 'blur(4px)',
        textTransform: 'uppercase', letterSpacing: 2,
      }}>
        🔨 BUILD MODE
      </div>

      {/* Piece selector bar (bottom center) */}
      <div style={{
        position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 4, background: 'rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
        padding: '8px 12px', zIndex: 9500, backdropFilter: 'blur(6px)',
      }}>
        {PIECE_ORDER.map((pieceId, idx) => {
          const def = PIECE_TYPES[pieceId];
          const isSelected = selectedPiece === pieceId;
          const affordable = canAfford(pieceId);
          return (
            <div
              key={pieceId}
              onClick={() => selectPiece(pieceId)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                background: isSelected ? 'rgba(0,212,255,0.2)' : 'transparent',
                border: isSelected ? '1px solid #00d4ff' : '1px solid transparent',
                opacity: affordable ? 1 : 0.4,
                transition: 'all 0.15s',
                minWidth: 50,
              }}
            >
              <span style={{ fontSize: 20 }}>{def.glyph}</span>
              <span style={{
                fontSize: 9, color: isSelected ? '#00d4ff' : '#aaa',
                fontFamily: 'monospace', marginTop: 2, whiteSpace: 'nowrap',
              }}>{def.label}</span>
              <span style={{
                fontSize: 8, color: '#666', fontFamily: 'monospace',
              }}>{idx + 1}</span>
            </div>
          );
        })}
      </div>

      {/* Selected piece info + cost (bottom-left) */}
      {selectedDef && (
        <div style={{
          position: 'fixed', bottom: 100, left: 16,
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

      {/* Controls hint (bottom-right) */}
      <div style={{
        position: 'fixed', bottom: 100, right: 16,
        background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8, padding: '8px 12px', color: '#999',
        fontFamily: 'monospace', fontSize: 10, zIndex: 9500,
        lineHeight: 1.6,
      }}>
        <div style={{ marginBottom: 4, color: '#aaa', fontSize: 9, opacity: 0.6 }}>KEYBOARD</div>
        <div><span style={{ color: '#fff' }}>Click</span> / <span style={{ color: '#fff' }}>Enter</span> — Place</div>
        <div><span style={{ color: '#fff' }}>Q/E</span> — Rotate</div>
        <div><span style={{ color: '#fff' }}>Scroll</span> / <span style={{ color: '#fff' }}>,.</span> — Cycle piece</div>
        <div><span style={{ color: '#fff' }}>1-7</span> — Select piece</div>
        <div><span style={{ color: '#fff' }}>X</span> — Destroy nearest</div>
        <div><span style={{ color: '#fff' }}>B</span> — Exit build mode</div>
        <div style={{ marginTop: 6, marginBottom: 4, color: '#aaa', fontSize: 9, opacity: 0.6 }}>CONTROLLER</div>
        <div><span style={{ color: '#00d4ff' }}>A</span> — Place</div>
        <div><span style={{ color: '#00d4ff' }}>LB/RB</span> — Rotate</div>
        <div><span style={{ color: '#00d4ff' }}>D-pad ←→</span> — Cycle piece</div>
        <div><span style={{ color: '#00d4ff' }}>X</span> — Destroy nearest</div>
        <div><span style={{ color: '#00d4ff' }}>R3</span> — Exit build mode</div>
      </div>

      {/* Placement validity indicator */}
      {!ghostState.ghostValid && (
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
