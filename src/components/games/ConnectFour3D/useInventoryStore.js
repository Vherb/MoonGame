// ConnectFour3D – Inventory System (Zustand store)
// Manages collectible items, equipment slots, and persistence via localStorage + server DB.

import { create } from 'zustand';
import { resolveServerHost, httpProto } from '../../../config';

/* ================================================================
   API helpers — persist resources + SC to server DB
   ================================================================ */
function getApiBase() {
  // In dev, use relative URLs so CRA proxy handles routing (no CORS issues).
  // In prod, build the full URL.
  if (typeof window !== 'undefined') {
    const port = window.location.port || '';
    if (port === '3000') return ''; // relative — goes through CRA proxy to :3002
    if (!port || port === '443' || port === '80') return '/api'; // production
    const host = resolveServerHost();
    const proto = httpProto();
    const targetPort = port === '3000' ? '3002' : port;
    return `${proto}://${host}:${targetPort}`;
  }
  const host = resolveServerHost();
  const proto = httpProto();
  return `${proto}//${host}:3002`;
}

function authHeaders() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Fetch SC balance from the existing /balance endpoint (proven working) */
async function fetchBalanceFromServer() {
  const h = authHeaders();
  if (!h) return null;
  try {
    const r = await fetch(`${getApiBase()}/balance`, { headers: h });
    if (!r.ok) { console.warn('[Inventory] /balance failed:', r.status); return null; }
    const d = await r.json();
    return Number(d.sc_balance) || 0;
  } catch (e) { console.warn('[Inventory] /balance error:', e); return null; }
}

/** Fetch SC balance + resources from /resources endpoint */
async function fetchServerInventory() {
  const h = authHeaders();
  if (!h) return null;
  try {
    const r = await fetch(`${getApiBase()}/resources`, { headers: h });
    if (!r.ok) { console.warn('[Inventory] /resources failed:', r.status); return null; }
    return await r.json(); // { resources, sc_balance }
  } catch (e) { console.warn('[Inventory] /resources error:', e); return null; }
}

/** Save resources to server (fire-and-forget, debounced externally) */
function saveResourcesToServer(resources) {
  const h = authHeaders();
  if (!h) return;
  fetch(`${getApiBase()}/resources/save`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ resources }),
  }).catch(() => {});
}

/** Sell resources on server — returns { sc_balance, resources, earned } */
async function sellOnServer(sellItems, currentResources) {
  const h = authHeaders();
  if (!h) return null;
  try {
    const r = await fetch(`${getApiBase()}/resources/sell`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ sellItems, currentResources }),
    });
    if (!r.ok) { console.warn('[Inventory] sell failed:', r.status); return null; }
    return await r.json();
  } catch (e) { console.warn('[Inventory] sell error:', e); return null; }
}

// Debounce timer for resource saves
let _saveTimer = null;
function debouncedSaveResources(resources) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { saveResourcesToServer(resources); _saveTimer = null; }, 2000);
}

// Retry timer for loadFromServer
let _retryTimer = null;
let _retryCount = 0;
const MAX_RETRIES = 10;

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
   Zustand Store
   (Inventory syncs to/from server DB — no localStorage)
   ================================================================ */

export const useInventoryStore = create((set, get) => ({
  // Items the player owns (array of item IDs)
  ownedItems: [], // empty — equipment must be found in-world

  // Currently equipped items: { [slot]: itemId | null }
  equipped: { head: null, back: null, hand: null, feet: null },

  // Resource stacks: { [resourceId]: count }
  resources: {},

  // SC balance (synced to/from server DB)
  scBalance: 0,
  _serverLoaded: false,

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

  /** Add a collected resource (stacks) — also saves to server DB */
  addResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return;
    set(s => {
      const next = {
        ...s,
        resources: { ...s.resources, [resourceId]: (s.resources[resourceId] || 0) + 1 },
      };
      debouncedSaveResources(next.resources);
      return next;
    });
  },

  /** Remove one unit of a resource (for spending, e.g. building) */
  removeResource: (resourceId) => {
    const s = get();
    const count = s.resources[resourceId] || 0;
    if (count <= 0) return false;
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, [resourceId]: count - 1 },
      };
      return next;
    });
    return true;
  },

  /** Sell one unit of a resource for SC — persists to server DB */
  sellResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return 0;
    const s = get();
    const count = s.resources[resourceId] || 0;
    if (count <= 0) return 0;
    const value = catalog.sellValue || 0;
    // Optimistic local update
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, [resourceId]: count - 1 },
        scBalance: prev.scBalance + value,
      };
      return next;
    });
    // Persist to server (send current resources as fallback for first-time sync)
    sellOnServer({ [resourceId]: 1 }, s.resources).then(resp => {
      if (resp) set({ scBalance: resp.sc_balance, resources: resp.resources });
    });
    return value;
  },

  /** Sell all units of a specific resource — persists to server DB */
  sellAllOfResource: (resourceId) => {
    const catalog = ITEM_CATALOG[resourceId];
    if (!catalog || catalog.type !== 'resource') return 0;
    const s = get();
    const count = s.resources[resourceId] || 0;
    if (count <= 0) return 0;
    const totalValue = (catalog.sellValue || 0) * count;
    // Optimistic local update
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, [resourceId]: 0 },
        scBalance: prev.scBalance + totalValue,
      };
      return next;
    });
    // Persist to server (send current resources as fallback)
    sellOnServer({ [resourceId]: count }, s.resources).then(resp => {
      if (resp) set({ scBalance: resp.sc_balance, resources: resp.resources });
    });
    return totalValue;
  },

  /** Sell ALL resources — persists to server DB */
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
    // Optimistic local update
    set(prev => {
      const next = {
        ...prev,
        resources: { ...prev.resources, ...cleared },
        scBalance: prev.scBalance + totalValue,
      };
      return next;
    });
    // Persist to server (send current resources as fallback)
    sellOnServer('all', s.resources).then(resp => {
      if (resp) set({ scBalance: resp.sc_balance, resources: resp.resources });
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

  /** Add SC to balance (rewards, wave bonuses) */
  addSC: (amount) => set(prev => ({ scBalance: prev.scBalance + amount })),

  /** Load resources + SC from server DB. Can be called multiple times. */
  loadFromServer: async (force = false) => {
    if (get()._serverLoaded && !force) return;
    if (!localStorage.getItem('token')) return;

    console.log('[Inventory] Loading from server...');

    // Strategy 1: try /resources (returns both resources + SC balance)
    const data = await fetchServerInventory();
    if (data) {
      const merged = { ...get().resources };
      if (data.resources && typeof data.resources === 'object') {
        for (const [id, count] of Object.entries(data.resources)) {
          merged[id] = Math.max(Number(count) || 0, merged[id] || 0);
        }
      }
      const scBal = Number(data.sc_balance) || 0;
      console.log('[Inventory] Loaded from /resources — SC:', scBal, 'resources:', merged);
      set({
        resources: merged,
        scBalance: scBal,
        _serverLoaded: true,
      });
      return;
    }

    // Strategy 2: /resources failed — at least get SC from /balance (always works)
    const bal = await fetchBalanceFromServer();
    if (bal !== null) {
      console.log('[Inventory] Loaded from /balance — SC:', bal);
      set({ scBalance: bal, _serverLoaded: true });
      return;
    }

    // Both failed — schedule retry
    console.warn('[Inventory] Server load failed, will retry...');
    if (_retryCount < MAX_RETRIES && !_retryTimer) {
      _retryCount++;
      const delay = Math.min(2000 * _retryCount, 15000);
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        useInventoryStore.getState().loadFromServer(true);
      }, delay);
    }
  },
}));

// Auto-load from server when user is logged in — try immediately + after a delay
function _tryAutoLoad() {
  if (!localStorage.getItem('token')) return;
  _retryCount = 0;
  useInventoryStore.getState().loadFromServer(true);
}

if (typeof window !== 'undefined') {
  // On module init
  setTimeout(_tryAutoLoad, 300);
  // Also listen for login events (token being set)
  window.addEventListener('storage', (e) => {
    if (e.key === 'token' && e.newValue) {
      setTimeout(_tryAutoLoad, 200);
    }
  });
  // Publish a global so the depot UI can force-refresh
  window.__CF_RELOAD_INVENTORY__ = () => useInventoryStore.getState().loadFromServer(true);
}
