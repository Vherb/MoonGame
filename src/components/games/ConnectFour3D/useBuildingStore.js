// useBuildingStore.js — Zustand store for base-building system
// Manages piece types, placed pieces, build mode state, resource costs, and persistence.

import { create } from 'zustand';

/* ================================================================
   Building Piece Definitions
   ================================================================ */
export const GRID_SIZE = 4;       // each piece occupies a 4×4 grid cell
export const WALL_HEIGHT = 4;     // wall height
export const WALL_THICKNESS = 0.25;
export const FLOOR_THICKNESS = 0.3;
export const RAMP_HEIGHT = WALL_HEIGHT;

export const PIECE_TYPES = {
  foundation: {
    id: 'foundation',
    label: 'Foundation',
    glyph: '⬜',
    description: 'Flat platform base. Snaps to terrain.',
    dims: [GRID_SIZE, FLOOR_THICKNESS, GRID_SIZE], // width, height, depth
    cost: { moonRock: 5 },
    color: '#8B8682',
    snapType: 'floor',       // sits on ground or on top of walls
    walkable: true,
  },
  wall: {
    id: 'wall',
    label: 'Wall',
    glyph: '🧱',
    description: 'Vertical wall. Snaps to foundation edges.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS],
    cost: { moonRock: 3 },
    color: '#9E9E9E',
    snapType: 'wall',
    walkable: false,
  },
  wallDoor: {
    id: 'wallDoor',
    label: 'Door Wall',
    glyph: '🚪',
    description: 'Wall with a door opening.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS],
    cost: { moonRock: 3, lunarCrystal: 1 },
    color: '#8E8E8E',
    snapType: 'wall',
    walkable: false,
    hasDoor: true,
    doorWidth: 1.4,
    doorHeight: 2.8,
  },
  wallWindow: {
    id: 'wallWindow',
    label: 'Window Wall',
    glyph: '🪟',
    description: 'Wall with a window opening.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS],
    cost: { moonRock: 3, lunarCrystal: 1 },
    color: '#8E8E8E',
    snapType: 'wall',
    walkable: false,
    hasWindow: true,
    windowWidth: 1.8,
    windowHeight: 1.2,
    windowY: 1.8,  // center Y of window relative to wall base
  },
  floor: {
    id: 'floor',
    label: 'Floor/Ceiling',
    glyph: '⬛',
    description: 'Horizontal slab for upper stories.',
    dims: [GRID_SIZE, FLOOR_THICKNESS, GRID_SIZE],
    cost: { moonRock: 4 },
    color: '#7A7A7A',
    snapType: 'floor',
    walkable: true,
  },
  ramp: {
    id: 'ramp',
    label: 'Ramp',
    glyph: '📐',
    description: 'Angled slope between levels.',
    dims: [GRID_SIZE, RAMP_HEIGHT, GRID_SIZE],
    cost: { moonRock: 4 },
    color: '#6E6E6E',
    snapType: 'ramp',
    walkable: true,
  },
  halfWall: {
    id: 'halfWall',
    label: 'Half Wall',
    glyph: '▬',
    description: 'Half-height wall for cover.',
    dims: [GRID_SIZE, WALL_HEIGHT / 2, WALL_THICKNESS],
    cost: { moonRock: 2 },
    color: '#9E9E9E',
    snapType: 'wall',
    walkable: false,
  },
};

// Ordered list for cycling through pieces
export const PIECE_ORDER = ['foundation', 'wall', 'wallDoor', 'wallWindow', 'floor', 'ramp', 'halfWall'];

/* ================================================================
   Snap Point Definitions
   Each placed piece exposes snap points where other pieces can attach.
   ================================================================ */
const H = GRID_SIZE / 2;

// Foundation snap points: walls on 4 edges, floors on top
export function getSnapPoints(piece, placedPiece) {
  const { x, y, z, rotation } = placedPiece;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotate = (lx, lz) => [x + lx * cos - lz * sin, z + lx * sin + lz * cos];

  const type = PIECE_TYPES[piece];
  const points = [];

  if (type.snapType === 'floor' || piece === 'foundation') {
    // Walls can snap to 4 edges
    const wallY = y + FLOOR_THICKNESS;
    const dirs = [
      { lx: 0, lz: -H, rot: 0 },         // north edge
      { lx: 0, lz: H, rot: Math.PI },     // south edge
      { lx: H, lz: 0, rot: Math.PI / 2 }, // east edge
      { lx: -H, lz: 0, rot: -Math.PI / 2 }, // west edge
    ];
    for (const d of dirs) {
      const [wx, wz] = rotate(d.lx, d.lz);
      points.push({
        position: [wx, wallY, wz],
        rotation: rotation + d.rot,
        accepts: ['wall', 'wallDoor', 'wallWindow', 'halfWall'],
        type: 'wall',
      });
    }
    // Floor/ceiling on top of walls (one story up)
    const floorAboveY = y + WALL_HEIGHT + FLOOR_THICKNESS;
    points.push({
      position: [x, floorAboveY, z],
      rotation: rotation,
      accepts: ['floor', 'foundation', 'ramp'],
      type: 'floor',
    });
    // Ramp from this level
    for (const d of dirs) {
      const [rx, rz] = rotate(d.lx * 2, d.lz * 2);
      points.push({
        position: [rx, y + FLOOR_THICKNESS, rz],
        rotation: rotation + d.rot,
        accepts: ['ramp'],
        type: 'ramp',
      });
    }
    // Adjacent foundations (4 sides)
    for (const d of dirs) {
      const [fx, fz] = rotate(d.lx * 2, d.lz * 2);
      points.push({
        position: [fx, y, fz],
        rotation: rotation,
        accepts: ['foundation'],
        type: 'floor',
      });
    }
  }

  if (type.snapType === 'wall') {
    // Floor/ceiling on top of wall
    // Walls sit at the edge of a foundation — floor snaps centered on the wall top
    const topY = y + WALL_HEIGHT;
    // The floor snaps on the "inside" of the wall (offset by H toward center)
    const [insideX, insideZ] = rotate(0, H);
    points.push({
      position: [insideX, topY, insideZ],
      rotation: rotation,
      accepts: ['floor', 'foundation'],
      type: 'floor',
    });
  }

  return points;
}

/* ================================================================
   localStorage persistence
   ================================================================ */
const LS_KEY = 'cf3d_building';

function loadBuilding() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveBuilding(pieces) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pieces));
  } catch {}
}

/* ================================================================
   Zustand Store
   ================================================================ */
const savedPieces = loadBuilding() || [];
let nextId = savedPieces.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;

export const useBuildingStore = create((set, get) => ({
  // ── Build mode state ──
  buildMode: false,           // is player in build mode?
  selectedPiece: 'foundation', // which piece type is selected
  ghostPosition: [0, 0, 0],  // preview position
  ghostRotation: 0,           // preview Y rotation (radians)
  ghostValid: false,          // can place here?
  ghostSnapId: null,          // which snap point we're locked to (or null for free/terrain)

  // ── Placed pieces ──
  pieces: savedPieces,        // array of { id, type, x, y, z, rotation, health, ownerId }

  // ── Actions ──
  toggleBuildMode: () => set(s => ({ buildMode: !s.buildMode })),
  enterBuildMode: () => set({ buildMode: true }),
  exitBuildMode: () => set({ buildMode: false }),

  selectPiece: (pieceId) => set({ selectedPiece: pieceId }),

  cyclePiece: (dir = 1) => set(s => {
    const idx = PIECE_ORDER.indexOf(s.selectedPiece);
    const next = (idx + dir + PIECE_ORDER.length) % PIECE_ORDER.length;
    return { selectedPiece: PIECE_ORDER[next] };
  }),

  setGhost: (position, rotation, valid, snapId = null) => set({
    ghostPosition: position,
    ghostRotation: rotation,
    ghostValid: valid,
    ghostSnapId: snapId,
  }),

  // Place a piece (checks resources, deducts cost, adds piece)
  placePiece: (ownerId = 'local') => {
    const s = get();
    if (!s.buildMode || !s.ghostValid) return null;
    const pieceDef = PIECE_TYPES[s.selectedPiece];
    if (!pieceDef) return null;

    // Check resource cost
    const { useInventoryStore } = require('./useInventoryStore');
    const inv = useInventoryStore.getState();
    for (const [resId, needed] of Object.entries(pieceDef.cost)) {
      if ((inv.resources[resId] || 0) < needed) return null; // not enough
    }
    // Deduct resources
    for (const [resId, needed] of Object.entries(pieceDef.cost)) {
      for (let i = 0; i < needed; i++) {
        inv.removeResource(resId);
      }
    }

    const newPiece = {
      id: nextId++,
      type: s.selectedPiece,
      x: s.ghostPosition[0],
      y: s.ghostPosition[1],
      z: s.ghostPosition[2],
      rotation: s.ghostRotation,
      health: 100,
      ownerId,
    };

    set(prev => {
      const updated = [...prev.pieces, newPiece];
      saveBuilding(updated);
      return { pieces: updated };
    });
    return newPiece;
  },

  // Remove a piece (returns half resources)
  removePiece: (pieceId) => {
    const s = get();
    const piece = s.pieces.find(p => p.id === pieceId);
    if (!piece) return;
    const pieceDef = PIECE_TYPES[piece.type];
    if (!pieceDef) return;

    // Refund half resources (rounded down)
    const { useInventoryStore } = require('./useInventoryStore');
    const inv = useInventoryStore.getState();
    for (const [resId, needed] of Object.entries(pieceDef.cost)) {
      const refund = Math.floor(needed / 2);
      for (let i = 0; i < refund; i++) {
        inv.addResource(resId);
      }
    }

    set(prev => {
      const updated = prev.pieces.filter(p => p.id !== pieceId);
      saveBuilding(updated);
      return { pieces: updated };
    });
  },

  // Damage a piece (from weapons)
  damagePiece: (pieceId, amount) => {
    set(prev => {
      const updated = prev.pieces.map(p => {
        if (p.id !== pieceId) return p;
        const newHealth = p.health - amount;
        if (newHealth <= 0) return null; // destroyed
        return { ...p, health: newHealth };
      }).filter(Boolean);
      saveBuilding(updated);
      return { pieces: updated };
    });
  },

  // Sync from server/WS (replace all pieces)
  syncPieces: (pieces) => {
    set({ pieces });
    saveBuilding(pieces);
  },

  // Add a single piece from remote player
  addRemotePiece: (piece) => {
    set(prev => {
      if (prev.pieces.find(p => p.id === piece.id)) return prev; // already exists
      const updated = [...prev.pieces, piece];
      saveBuilding(updated);
      return { pieces: updated };
    });
  },

  // Remove a single piece from remote player
  removeRemotePiece: (pieceId) => {
    set(prev => {
      const updated = prev.pieces.filter(p => p.id !== pieceId);
      saveBuilding(updated);
      return { pieces: updated };
    });
  },
}));
