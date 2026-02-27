// useBuildingStore.js — Zustand store for base-building system
// Manages piece types, placed pieces, build mode state, resource costs, and persistence.

import { create } from 'zustand';
import { getTerrainHeightXZ } from './terrainPhysics';
import { ROWS, CELL, GAP, GROUND_CLEAR } from './constants';

/* ================================================================
   Building Piece Definitions
   ================================================================ */
export const GRID_SIZE = 32;       // each piece occupies a 32×32 grid cell (player is ~14 tall)
export const WALL_HEIGHT = 30;     // wall height — ~2× player height
export const WALL_THICKNESS = 1.2;
export const FLOOR_THICKNESS = 1.2;
export const RAMP_HEIGHT = WALL_HEIGHT;

export const FENCE_HEIGHT = WALL_HEIGHT * 0.35; // short railing height

export const PIECE_TYPES = {
  foundation: {
    id: 'foundation',
    label: 'Foundation',
    glyph: '⬜',
    description: 'Flat platform base. Snaps to terrain.',
    dims: [GRID_SIZE, FLOOR_THICKNESS, GRID_SIZE], // width, height, depth
    cost: {},
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
    cost: {},
    color: '#9E9E9E',
    snapType: 'wall',
    walkable: false,
  },
  wallDoor: {
    id: 'wallDoor',
    label: 'Door Wall',
    glyph: '🚪',
    description: 'Wall with a door opening. Click door to open/close.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS],
    cost: {},
    color: '#8E8E8E',
    snapType: 'wall',
    walkable: false,
    hasDoor: true,
    doorWidth: 10.0,
    doorHeight: 22.0,
  },
  wallWindow: {
    id: 'wallWindow',
    label: 'Window Wall',
    glyph: '🪟',
    description: 'Wall with a window opening.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS],
    cost: {},
    color: '#8E8E8E',
    snapType: 'wall',
    walkable: false,
    hasWindow: true,
    windowWidth: 10.0,
    windowHeight: 8.0,
    windowY: 16.0,  // center Y of window relative to wall base
  },
  floor: {
    id: 'floor',
    label: 'Floor/Ceiling',
    glyph: '⬛',
    description: 'Horizontal slab for upper stories.',
    dims: [GRID_SIZE, FLOOR_THICKNESS, GRID_SIZE],
    cost: {},
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
    cost: {},
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
    cost: {},
    color: '#9E9E9E',
    snapType: 'wall',
    walkable: false,
  },
  fence: {
    id: 'fence',
    label: 'Fence',
    glyph: '🏗️',
    description: 'Metal railing fence. Blocks movement but allows visibility.',
    dims: [GRID_SIZE, FENCE_HEIGHT, WALL_THICKNESS],
    cost: {},
    color: '#A0A0A0',
    snapType: 'wall',
    walkable: false,
  },
  reinforcedWall: {
    id: 'reinforcedWall',
    label: 'Armored Wall',
    glyph: '🛡️',
    description: 'Triple-health wall. Resists raids.',
    dims: [GRID_SIZE, WALL_HEIGHT, WALL_THICKNESS * 2],
    cost: {},
    color: '#6A6A7A',
    snapType: 'wall',
    walkable: false,
    healthMultiplier: 3,
  },
  spikeTrap: {
    id: 'spikeTrap',
    label: 'Spike Trap',
    glyph: '⚠️',
    description: 'Floor trap. Damages enemies who walk over it.',
    dims: [GRID_SIZE, FLOOR_THICKNESS, GRID_SIZE],
    cost: {},
    color: '#884444',
    snapType: 'floor',
    walkable: true,
    isTrap: true,
    trapDamage: 15,
  },
  chest: {
    id: 'chest',
    label: 'Chest',
    glyph: '📦',
    description: 'Storage chest. Click to open inventory.',
    dims: [8, 6, 6],
    cost: {},
    color: '#8B6914',
    snapType: 'prop',
    walkable: false,
  },
  lightPost: {
    id: 'lightPost',
    label: 'Light Post',
    glyph: '💡',
    description: 'Illuminates the area around it.',
    dims: [2, 20, 2],
    cost: {},
    color: '#CCCCCC',
    snapType: 'prop',
    walkable: false,
    lightRadius: 60,
    lightIntensity: 2.5,
    lightColor: '#ffe4b5',
  },
  turret: {
    id: 'turret',
    label: 'Turret',
    glyph: '🔫',
    description: 'Auto-fires at nearby enemies.',
    dims: [6, 8, 6],
    cost: {},
    color: '#556B2F',
    snapType: 'prop',
    walkable: false,
    turretRange: 80,
    turretDamage: 10,
    turretFireRate: 1.5, // seconds between shots
  },

  /* ── Model-based props ─────────────────────────────────── */
  modelRocket: {
    id: 'modelRocket',
    label: 'Rocket',
    glyph: '🚀',
    description: 'Decorative rocket model.',
    dims: [8, 20, 8],
    cost: {},
    color: '#CC5500',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/rocket/rocket_pedestal.fbx',
    defaultScale: [0.08, 0.08, 0.08],
  },
  modelLaunchPad: {
    id: 'modelLaunchPad',
    label: 'Launch Pad',
    glyph: '🛸',
    description: 'Rocket launch pad structure.',
    dims: [12, 10, 12],
    cost: {},
    color: '#888888',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/launch_pad/Launchpad_Sentinel_1021052838_texture.fbx',
    defaultScale: [0.1, 0.1, 0.1],
  },
  modelRover: {
    id: 'modelRover',
    label: 'Rover',
    glyph: '🚗',
    description: 'Moon rover vehicle.',
    dims: [10, 6, 10],
    cost: {},
    color: '#AA8844',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/rover/dusty rover/Dusty_Explorer_1020195240_texture.fbx',
    defaultScale: [0.08, 0.08, 0.08],
  },
  modelTable: {
    id: 'modelTable',
    label: 'Table',
    glyph: '🪑',
    description: 'Fancy table furniture.',
    dims: [6, 6, 6],
    cost: {},
    color: '#8B6914',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/table/table.fbx',
    defaultScale: [0.15, 0.15, 0.15],
  },
  modelAsteroid: {
    id: 'modelAsteroid',
    label: 'Asteroid',
    glyph: '🪨',
    description: 'Decorative asteroid rock.',
    dims: [6, 6, 6],
    cost: {},
    color: '#666666',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/asteroid/asteroid.fbx',
    defaultScale: [0.06, 0.06, 0.06],
  },
  modelJetRocket: {
    id: 'modelJetRocket',
    label: 'Jet Rocket',
    glyph: '✈️',
    description: 'Space jet rocket.',
    dims: [8, 8, 12],
    cost: {},
    color: '#4477AA',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: '/models/props/jet rocket/Space_Jet_Ignition_1021061919_texture.fbx',
    defaultScale: [0.1, 0.1, 0.1],
  },
  modelCustom: {
    id: 'modelCustom',
    label: 'Custom Model',
    glyph: '🎨',
    description: 'Place any model from the library.',
    dims: [8, 8, 8],
    cost: {},
    color: '#9933CC',
    snapType: 'prop',
    walkable: false,
    isModel: true,
    modelPath: null, // set at place time from user selection
    defaultScale: [0.1, 0.1, 0.1],
  },
};

// Ordered list for cycling through pieces
export const PIECE_ORDER = [
  'foundation', 'wall', 'wallDoor', 'wallWindow', 'floor', 'ramp',
  'halfWall', 'fence', 'reinforcedWall', 'spikeTrap', 'chest', 'lightPost', 'turret',
  // Model props
  'modelRocket', 'modelLaunchPad', 'modelRover', 'modelTable', 'modelAsteroid', 'modelJetRocket', 'modelCustom',
  'demolish',
];

// Helper: all model prop type ids
export const MODEL_PIECE_IDS = Object.keys(PIECE_TYPES).filter(k => PIECE_TYPES[k].isModel);

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
        accepts: ['wall', 'wallDoor', 'wallWindow', 'halfWall', 'fence', 'reinforcedWall'],
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
    // Adjacent foundations (4 sides) — Y adjusted for terrain at the new location
    const _fhG = ROWS * (CELL + GAP) - GAP + 0.6;
    const _groundY = -_fhG / 2 - GROUND_CLEAR;
    for (const d of dirs) {
      const [fx, fz] = rotate(d.lx * 2, d.lz * 2);
      // Sample terrain at new position's 4 corners + center, take max
      const halfG = GRID_SIZE / 2;
      const hC = getTerrainHeightXZ(fx, fz);
      const hNE = getTerrainHeightXZ(fx + halfG, fz - halfG);
      const hNW = getTerrainHeightXZ(fx - halfG, fz - halfG);
      const hSE = getTerrainHeightXZ(fx + halfG, fz + halfG);
      const hSW = getTerrainHeightXZ(fx - halfG, fz + halfG);
      const terrainY = _groundY + Math.max(0, Math.max(hC, hNE, hNW, hSE, hSW));
      // Use the higher of parent Y or terrain Y so foundation doesn't clip
      const adjY = Math.max(y, terrainY);
      points.push({
        position: [fx, adjY, fz],
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

  // Props can snap to center of any foundation/floor
  if (type.snapType === 'floor' || piece === 'foundation') {
    points.push({
      position: [x, y + FLOOR_THICKNESS, z],
      rotation: rotation,
      accepts: ['chest', 'lightPost', 'turret', 'spikeTrap',
        ...Object.keys(PIECE_TYPES).filter(k => PIECE_TYPES[k].isModel)],
      type: 'prop',
    });
  }

  return points;
}

/* ================================================================
   localStorage persistence
   ================================================================ */
const LS_KEY = 'cf3d_building';
const LS_VERSION_KEY = 'cf3d_building_v';
const BUILDING_VERSION = `g${GRID_SIZE}_w${WALL_HEIGHT}`; // auto-invalidates on size change

function loadBuilding() {
  try {
    // If building dimensions changed, wipe old saves (they'd look wrong)
    const savedVersion = localStorage.getItem(LS_VERSION_KEY);
    if (savedVersion && savedVersion !== BUILDING_VERSION) {
      console.log('[Building] Grid/wall size changed — clearing old saved buildings');
      localStorage.removeItem(LS_KEY);
      localStorage.setItem(LS_VERSION_KEY, BUILDING_VERSION);
      return null;
    }
    localStorage.setItem(LS_VERSION_KEY, BUILDING_VERSION);
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
  deleteMode: false,          // is the demolish tool active?
  deleteTargetId: null,       // id of piece being targeted for deletion
  ghostPosition: [0, 0, 0],  // preview position
  ghostRotation: 0,           // preview Y rotation (radians)
  ghostValid: false,          // can place here?
  ghostSnapId: null,          // which snap point we're locked to (or null for free/terrain)

  // ── Model prop state ──
  customModelPath: null,      // path selected for modelCustom placement
  selectedPropId: null,       // which placed model prop is selected for transform editing

  // ── Placed pieces ──
  pieces: savedPieces,        // array of { id, type, x, y, z, rotation, health, ownerId }

  // ── Door states ── (maps pieceId → boolean open)
  doorStates: {},             // { [pieceId]: true/false }

  // ── Actions ──
  toggleBuildMode: () => set(s => ({ buildMode: !s.buildMode })),
  enterBuildMode: () => set({ buildMode: true }),
  exitBuildMode: () => set({ buildMode: false }),

  selectPiece: (pieceId) => set({ selectedPiece: pieceId, deleteMode: pieceId === 'demolish' }),
  setDeleteTarget: (pieceId) => set({ deleteTargetId: pieceId }),
  setCustomModelPath: (path) => set({ customModelPath: path }),
  setSelectedProp: (pieceId) => set({ selectedPropId: pieceId }),

  // Update a placed piece's transform (position/rotation/scale) — for model prop editing
  updatePieceTransform: (pieceId, transform) => {
    set(prev => {
      const updated = prev.pieces.map(p => {
        if (p.id !== pieceId) return p;
        const patched = { ...p };
        if (transform.position) {
          patched.x = transform.position.x;
          patched.y = transform.position.y;
          patched.z = transform.position.z;
        }
        if (transform.rotation !== undefined) patched.rotation = transform.rotation;
        if (transform.modelScale) patched.modelScale = [...transform.modelScale];
        return patched;
      });
      saveBuilding(updated);
      return { pieces: updated };
    });
  },

  // Toggle a door open/closed
  toggleDoor: (pieceId) => {
    set(prev => {
      const isOpen = !prev.doorStates[pieceId];
      return { doorStates: { ...prev.doorStates, [pieceId]: isOpen } };
    });
    return get().doorStates;
  },

  setDoorState: (pieceId, isOpen) => {
    set(prev => ({ doorStates: { ...prev.doorStates, [pieceId]: !!isOpen } }));
  },

  cyclePiece: (dir = 1) => set(s => {
    const idx = PIECE_ORDER.indexOf(s.selectedPiece);
    const next = (idx + dir + PIECE_ORDER.length) % PIECE_ORDER.length;
    const newPiece = PIECE_ORDER[next];
    return { selectedPiece: newPiece, deleteMode: newPiece === 'demolish' };
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

    // Prevent placing modelCustom without a selected model path
    if (s.selectedPiece === 'modelCustom' && !s.customModelPath) return null;

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
      health: 100 * (pieceDef.healthMultiplier || 1),
      ownerId,
    };

    // Attach model data for model-based props
    if (pieceDef.isModel) {
      newPiece.modelPath = s.selectedPiece === 'modelCustom'
        ? (s.customModelPath || pieceDef.modelPath)
        : pieceDef.modelPath;
      newPiece.modelScale = pieceDef.defaultScale ? [...pieceDef.defaultScale] : [0.1, 0.1, 0.1];
    }

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
    // Update nextId to avoid collisions with server-synced pieces
    const maxId = pieces.reduce((max, p) => Math.max(max, p.id || 0), 0);
    if (maxId >= nextId) nextId = maxId + 1;
    set({ pieces });
    saveBuilding(pieces);
  },

  // Add a single piece from remote player
  addRemotePiece: (piece) => {
    if (piece.id >= nextId) nextId = piece.id + 1;
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
