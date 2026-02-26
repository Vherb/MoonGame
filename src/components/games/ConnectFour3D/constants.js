// ConnectFour3D – shared constants
// Extracted from ConnectFour3DView.jsx for modularization

// ── Board geometry ──
export const COLS = 7;
export const ROWS = 6;
export const CELL = 1;
export const GAP = 0.1;
export const BOARD_THICK = 0.22;

// ── Terrain visual size ──
export const TERRAIN_RADIUS = 5000;
export const PLAY_AREA_RADIUS = 99999;

// ── Staircase 1 (removed from gameplay but constants remain for reference) ──
export const STAIR_POS_X = 28;
export const STAIR_POS_Z = 0;
export const STAIR_WIDTH = 10;
export const STAIR_RUN = 2.0;
export const STAIR_RISE = 1.8;
export const STAIR_STEPS = 10;
export const STEP_CLIMB_MAX = 6.0;

// ── Staircase 2 (25 % larger, opposite side) ──
export const STAIR2_POS_X = -28;
export const STAIR2_POS_Z = 0;
export const STAIR2_WIDTH = STAIR_WIDTH * 1.25;
export const STAIR2_RUN = STAIR_RUN * 1.25;
export const STAIR2_RISE = STAIR_RISE * 1.25;
export const STAIR2_STEPS = STAIR_STEPS;
export const STAIR2_PLATFORM_DEPTH = 140;
export const STAIR2_PLATFORM_WIDTH = STAIR2_WIDTH * 15;
export const STAIR2_PLATFORM_THICKNESS = 1.5;

// ── Staircase 3 (rotated 90°, on STAIR2 platform) ──
export const STAIR3_POS_X = STAIR2_POS_X - (STAIR2_PLATFORM_WIDTH / 2) + 20;
export const STAIR3_POS_Z = STAIR2_POS_Z + (STAIR2_RUN * STAIR2_STEPS) + (STAIR2_PLATFORM_DEPTH / 2);
export const STAIR3_BASE_Y = STAIR2_RISE * STAIR2_STEPS;
export const STAIR3_WIDTH = STAIR2_WIDTH;
export const STAIR3_RUN = STAIR2_RUN;
export const STAIR3_RISE = STAIR2_RISE;
export const STAIR3_STEPS = STAIR2_STEPS;
export const STAIR3_YAW = -Math.PI / 2;
export const STAIR3_PLATFORM_DEPTH = 140;
export const STAIR3_PLATFORM_WIDTH = STAIR3_WIDTH * 15;
export const STAIR3_PLATFORM_THICKNESS = 1.5;

// ── Vertical clearance & avatar sizing ──
export const GROUND_CLEAR = 2.8;
export const AVATAR_BASE_HEIGHT = 2.2;
export const AVATAR_FINAL_HEIGHT = 14.0;
export const SHARK_SCALE_BOOST = 2.2;
export const CAPUCCINO_SCALE_BOOST = 2.0;

// ── Idle animation tuning ──
export const AVATAR_IDLE_AMP_Y = 0.14;
export const AVATAR_IDLE_SWAY_Z = 0.03;
export const AVATAR_IDLE_SPEED_Y = 0.36;
export const AVATAR_IDLE_SPEED_Z = 0.30;

// ── Avatar X offsets ──
export const AVATAR_X_FRONT = 0.22;
export const AVATAR_X_BACK = -3.44;

// ── Baked avatar transform ──
export const AVATAR_BAKED_POS = [1.9, 0.3, -12.0];
export const AVATAR_BAKED_SCALE_MUL = 1;

// ── Animation speed defaults ──
export const DEFAULT_WALK_ANIM_TIMESCALE = 0.6;
export const DEFAULT_RUN_ANIM_TIMESCALE = 0.9;
export const WALK_ANIM_TIMESCALE = DEFAULT_WALK_ANIM_TIMESCALE;
export const RUN_ANIM_TIMESCALE = DEFAULT_RUN_ANIM_TIMESCALE;

// ── Character-specific defaults ──
export const ASTRONAUT_WALK_DEFAULT = 0.55;
export const ASTRONAUT_RUN_DEFAULT = 0.45;
export const ASTRONAUT_Y_OFFSET = -0.5;
export const GUY1_WALK_DEFAULT = 0.55;
export const GUY1_RUN_DEFAULT = 0.45;
export const GUY1_Y_OFFSET = -0.5;

// ── Runtime animation speed helper ──
export function getAnimSpeed(which, fallback) {
  try {
    const o = (typeof window !== 'undefined' && window.__CF_ANIM_SPEEDS__) || {};
    const v = o && o[which];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
  } catch {
    return fallback;
  }
}
