// ConnectFour3D – Inventory System (Zustand store)
// Manages collectible items, equipment slots, and persistence via localStorage.

import { create } from 'zustand';

/* ================================================================
   Item Catalog — every item the game knows about
   ================================================================ */
export const ITEM_CATALOG = {
  jetpack: {
    id: 'jetpack',
    label: 'Jetpack',
    glyph: '🚀',
    description: 'Strap on some thrust. Hold F or RT to fly.',
    slot: 'back',          // equipment slot
    rarity: 'epic',
    modelUrl: '/models/props/jetpack/Meshy_AI_jetpack_0226164513_texture.fbx',
    textureUrl: '/models/props/jetpack/Meshy_AI_jetpack_0226164513_texture.png',
    metallicUrl: '/models/props/jetpack/Meshy_AI_jetpack_0226164513_texture_metallic.png',
    normalUrl: '/models/props/jetpack/Meshy_AI_jetpack_0226164513_texture_normal.png',
    roughnessUrl: '/models/props/jetpack/Meshy_AI_jetpack_0226164513_texture_roughness.png',
    // Visual tuning for attachment on avatar back
    attachOffset: [-1.668, -0.739, -11.960],
    attachScale: 0.360,
    attachRotation: [-2.870, -0.063, 3.089],
    // Gameplay effect
    effect: 'enableJetpack',
  },
  // ── Resources (collectible & sellable, no equipment slot) ──
  moonRock: {
    id: 'moonRock',
    label: 'Moon Rock',
    glyph: '🪨',
    description: 'A common chunk of lunar regolith. Sell it at the depot.',
    type: 'resource',
    rarity: 'common',
    sellValue: 2,
  },
  lunarCrystal: {
    id: 'lunarCrystal',
    label: 'Lunar Crystal',
    glyph: '💎',
    description: 'A shimmering crystal found in the hills. Worth a decent amount.',
    type: 'resource',
    rarity: 'uncommon',
    sellValue: 10,
  },
  helium3: {
    id: 'helium3',
    label: 'Helium-3',
    glyph: '⚛️',
    description: 'Rare isotope trapped in moon dust. Highly valuable fusion fuel.',
    type: 'resource',
    rarity: 'rare',
    sellValue: 50,
  },
  alienArtifact: {
    id: 'alienArtifact',
    label: 'Alien Artifact',
    glyph: '🔮',
    description: 'A mysterious relic of unknown origin. Extremely valuable.',
    type: 'resource',
    rarity: 'epic',
    sellValue: 150,
  },
};

/* ================================================================
   Rarity colours (for UI borders / glow)
   ================================================================ */
export const RARITY_COLORS = {
  common:    '#9ca3af',
  uncommon:  '#22c55e',
  rare:      '#3b82f6',
  epic:      '#a855f7',
  legendary: '#f59e0b',
};

/* ================================================================
   Equipment slots
   ================================================================ */
export const EQUIP_SLOTS = ['head', 'back', 'hand', 'feet'];

/* ================================================================
   localStorage helpers
   ================================================================ */
const LS_KEY = 'cf3d_inventory';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveToStorage(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      ownedItems: state.ownedItems,
      equipped: state.equipped,
      resources: state.resources,
    }));
  } catch {}
}

/* ================================================================
   Zustand Store
   ================================================================ */
const saved = loadFromStorage();

export const useInventoryStore = create((set, get) => ({
  // Items the player owns (array of item IDs)
  ownedItems: saved?.ownedItems || ['jetpack'], // start with jetpack in inventory

  // Currently equipped items: { [slot]: itemId | null }
  equipped: saved?.equipped || { head: null, back: 'jetpack', hand: null, feet: null },

  // Resource stacks: { [resourceId]: count }
  resources: saved?.resources || {},

  // SC balance (local cache — synced to server when selling)
  scBalance: 0,

  // UI state
  isOpen: false,
  openInventory: () => set({ isOpen: true }),
  closeInventory: () => set({ isOpen: false }),
  toggleInventory: () => set(s => ({ isOpen: !s.isOpen })),

  // ---- Actions ----

  /** Give the player an item (no duplicates) */
  addItem: (itemId) => {
    set(s => {
      if (s.ownedItems.includes(itemId)) return s;
      const next = { ...s, ownedItems: [...s.ownedItems, itemId] };
      saveToStorage(next);
      return next;
    });
  },

  /** Remove an item (also unequips if equipped) */
  removeItem: (itemId) => {
    set(s => {
      const next = {
        ...s,
        ownedItems: s.ownedItems.filter(id => id !== itemId),
        equipped: { ...s.equipped },
      };
      // Unequip if currently equipped
      for (const slot of EQUIP_SLOTS) {
        if (next.equipped[slot] === itemId) next.equipped[slot] = null;
      }
      saveToStorage(next);
      return next;
    });
  },

  /** Equip an item into its slot (unequips previous occupant) */
  equipItem: (itemId) => {
    const catalog = ITEM_CATALOG[itemId];
    if (!catalog) return;
    set(s => {
      if (!s.ownedItems.includes(itemId)) return s;
      const next = {
        ...s,
        equipped: { ...s.equipped, [catalog.slot]: itemId },
      };
      saveToStorage(next);
      return next;
    });
  },

  /** Unequip an item from its slot */
  unequipItem: (itemId) => {
    const catalog = ITEM_CATALOG[itemId];
    if (!catalog) return;
    set(s => {
      if (s.equipped[catalog.slot] !== itemId) return s;
      const next = {
        ...s,
        equipped: { ...s.equipped, [catalog.slot]: null },
      };
      saveToStorage(next);
      return next;
    });
  },

  /** Toggle equip / unequip */
  toggleEquip: (itemId) => {
    const catalog = ITEM_CATALOG[itemId];
    if (!catalog) return;
    const s = get();
    if (s.equipped[catalog.slot] === itemId) {
      get().unequipItem(itemId);
    } else {
      get().equipItem(itemId);
    }
  },

  /** Check if a specific effect is active (any equipped item provides it) */
  hasEffect: (effect) => {
    const s = get();
    return Object.values(s.equipped).some(id => {
      if (!id) return false;
      const cat = ITEM_CATALOG[id];
      return cat && cat.effect === effect;
    });
  },

  /** Get the catalog entry for an equipped slot */
  getEquippedInSlot: (slot) => {
    const id = get().equipped[slot];
    return id ? ITEM_CATALOG[id] : null;
  },

  // ── Resource actions ──

  /** Add a collected resource (stacks) */
  addResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return;
    set(s => {
      const next = {
        ...s,
        resources: { ...s.resources, [resourceId]: (s.resources[resourceId] || 0) + 1 },
      };
      saveToStorage(next);
      return next;
    });
  },

  /** Sell one unit of a resource for SC */
  sellResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return 0;
    const s = get();
    const count = s.resources[resourceId] || 0;
    if (count <= 0) return 0;
    const value = catalog.sellValue || 0;
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, [resourceId]: count - 1 },
        scBalance: prev.scBalance + value,
      };
      saveToStorage(next);
      return next;
    });
    return value;
  },

  /** Sell all units of a specific resource */
  sellAllOfResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return 0;
    const s = get();
    const count = s.resources[resourceId] || 0;
    if (count <= 0) return 0;
    const totalValue = (catalog.sellValue || 0) * count;
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, [resourceId]: 0 },
        scBalance: prev.scBalance + totalValue,
      };
      saveToStorage(next);
      return next;
    });
    return totalValue;
  },

  /** Sell ALL resources */
  sellAllResources: () => {
    const s = get();
    let totalValue = 0;
    const cleared = {};
    for (const [id, count] of Object.entries(s.resources)) {
      if (count <= 0) continue;
      const catalog = ITEM_CATALOG[id];
      if (!catalog || catalog.type !== 'resource') continue;
      totalValue += (catalog.sellValue || 0) * count;
      cleared[id] = 0;
    }
    if (totalValue === 0) return 0;
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, ...cleared },
        scBalance: prev.scBalance + totalValue,
      };
      saveToStorage(next);
      return next;
    });
    return totalValue;
  },

  /** Get total resource count across all types */
  getTotalResourceCount: () => {
    const s = get();
    return Object.values(s.resources).reduce((sum, c) => sum + (c || 0), 0);
  },

  /** Set SC balance (for syncing from server) */
  setSCBalance: (bal) => set({ scBalance: bal }),
}));
