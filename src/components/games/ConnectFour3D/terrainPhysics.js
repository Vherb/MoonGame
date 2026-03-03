// ConnectFour3D – terrain & physics utilities
// Extracted from ConnectFour3DView.jsx for modularization

import {
  COLS, ROWS, CELL, GAP, TERRAIN_RADIUS, GROUND_CLEAR,
  STAIR_POS_X, STAIR_POS_Z, STAIR_WIDTH, STAIR_RUN, STAIR_RISE, STAIR_STEPS,
  STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS,
  STAIR2_PLATFORM_DEPTH, STAIR2_PLATFORM_WIDTH, STAIR2_PLATFORM_THICKNESS,
  STAIR3_POS_X, STAIR3_POS_Z, STAIR3_BASE_Y, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS,
  STAIR3_PLATFORM_DEPTH, STAIR3_PLATFORM_WIDTH, STAIR3_PLATFORM_THICKNESS,
} from './constants';
// These module-scope vars are updated by the UI/child component so our physics samplers can read them.
export let EXTRA_STAIRS_DEF = null; // { posX, posZ, posY, yaw, width, depth, height, steps, run, rise, reverse }
export let EXTRA_STAIRS_WALKABLE = false;
export function setExtraStairsWalkable(flag){ EXTRA_STAIRS_WALKABLE = !!flag; }
export function setExtraStairsDef(def){ EXTRA_STAIRS_DEF = def; }

// Runtime-configurable placed cubes/spheres (for multiplayer sync and collision)
export let CURRENT_PLACED_CUBES = [];
export function updatePlacedCubesCache(cubes) { 
  CURRENT_PLACED_CUBES = cubes || [];
}

// Building pieces cache (registered by BuildingSystem)
export let CURRENT_BUILDING_PIECES = [];
export function updateBuildingPiecesCache(pieces) {
  CURRENT_BUILDING_PIECES = pieces || [];
}

/**
 * Check if a world position (wx, wz) at height feetY collides with any
 * non-walkable building piece (walls). Uses oriented AABB collision.
 * @param {number} wx - world X
 * @param {number} wz - world Z
 * @param {number} feetY - player feet Y (world, absolute)
 * @param {number} playerHeight - avatar height (default 14)
 * @param {number} collisionRadius - player collision radius (default 2)
 * @returns {boolean} true if position intersects a wall
 */
export function checkBuildingWallCollision(wx, wz, feetY, playerHeight = 14, collisionRadius = 2) {
  for (const p of CURRENT_BUILDING_PIECES) {
    if (!p || p.walkable) continue; // skip walkable pieces (foundations, floors, ramps)
    // Skip prop-type pieces (chest, lightPost, turret) — they don't block movement like walls
    const snapType = p.snapType;
    if (snapType === 'prop') continue;

    const w = p.dims?.[0] || 4;
    const h = p.dims?.[1] || 4;
    const d = p.dims?.[2] || 1;
    const rot = p.rotation || 0;
    const py = p.y || 0; // piece base Y (absolute world Y)

    // Vertical check: player's feet-to-head range must overlap the wall's vertical range
    const wallBottom = py;
    const wallTop = py + h;
    const headY = feetY + playerHeight;
    if (headY <= wallBottom || feetY >= wallTop) continue; // completely above or below wall

    // Transform player world coords into piece-local space
    const dx = wx - p.x;
    const dz = wz - p.z;
    const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
    const lx = dx * cosR - dz * sinR;
    const lz = dx * sinR + dz * cosR;

    // Expand wall bounds by collision radius for player body
    const halfW = w / 2 + collisionRadius;
    const halfD = d / 2 + collisionRadius;

    if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
      // Check for door opening: if the wall has a door, allow passage through the doorway
      if (p.type === 'wallDoor') {
        const doorW = (p.doorWidth || 10) / 2;
        const doorH = p.doorHeight || 22;
        // Door is centered in the wall (lx=0), from ground to doorH
        // Check door state — if door is open, always allow passage
        let doorOpen = false;
        try {
          const { useBuildingStore } = require('./useBuildingStore');
          doorOpen = !!useBuildingStore.getState().doorStates[p.id];
        } catch {}
        if (doorOpen) {
          // Door is open — allow passage through full door area
          if (lx >= -doorW && lx <= doorW && feetY < (py + doorH)) {
            continue;
          }
        }
        // Door is closed but still has the physical opening (frame cutout)
        // Block passage when door is closed
        if (!doorOpen && lx >= -doorW && lx <= doorW && feetY < (py + doorH)) {
          return true; // blocked by closed door
        }
      }
      // Check for window opening (windows are too high/small to walk through, but just in case)
      return true; // collision with wall
    }
  }
  return false;
}

/**
 * Check if a player's head at (wx, wz, headY) hits the underside of any
 * walkable building piece (foundation, floor, spikeTrap).  Returns the
 * lowest ceiling Y found, or Infinity if no ceiling above.
 */
export function checkBuildingCeilingCollision(wx, wz, headY, collisionRadius = 2) {
  let lowestCeiling = Infinity;
  for (const p of CURRENT_BUILDING_PIECES) {
    if (!p || !p.walkable) continue; // only walkable pieces act as ceilings
    if (p.type === 'ramp') continue;  // ramps don't have a flat ceiling face

    const w = p.dims?.[0] || 4;
    const h = p.dims?.[1] || 0.3;
    const d = p.dims?.[2] || 4;
    const rot = p.rotation || 0;
    const py = p.y || 0; // piece base Y (absolute world Y)

    const ceilingBottom = py;          // underside of the piece
    const ceilingTop    = py + h;      // top surface (walkable)

    // Only care about pieces whose underside is near/above the player's head
    // and that the head is actually trying to penetrate (head >= ceilingBottom)
    if (headY < ceilingBottom - 1) continue;  // head well below — no collision
    if (headY > ceilingTop + 2) continue;      // head well above — already on top

    // Transform player world coords into piece-local space
    const dx = wx - p.x;
    const dz = wz - p.z;
    const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
    const lx = dx * cosR - dz * sinR;
    const lz = dx * sinR + dz * cosR;

    const halfW = w / 2 + collisionRadius;
    const halfD = d / 2 + collisionRadius;

    if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
      if (ceilingBottom < lowestCeiling) {
        lowestCeiling = ceilingBottom;
      }
    }
  }
  return lowestCeiling;
}

// Giant walkable moon sphere (registered by GiantMoonSphere component)
export let GIANT_MOON_SPHERE = null; // { cx, cy, cz, radius, bumpAt }
export function setGiantMoonSphere(cfg) { GIANT_MOON_SPHERE = cfg; }

// Sphere-surface bump function (must match GiantMoonSphere geometry displacement exactly)
const _sHash = (x, y) => { let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return n - Math.floor(n); };
const _sNoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
  return _sHash(ix,iy)*(1-ux)*(1-uy) + _sHash(ix+1,iy)*ux*(1-uy) + _sHash(ix,iy+1)*(1-ux)*uy + _sHash(ix+1,iy+1)*ux*uy;
};
const _sFbm = (x, y, oct) => { let v=0,a=1,f=1; for(let i=0;i<oct;i++){v+=a*_sNoise(x*f,y*f);f*=2;a*=0.5;} return v; };
export function sphereBumpAt(nx, ny, nz) {
  const u1 = nx * 137.3 + ny * 271.9 + nz * 419.7;
  const v1 = nx * 317.1 + ny * 157.3 + nz * 233.9;
  return _sFbm(u1 * 0.015, v1 * 0.015, 4) * 12 + _sFbm(u1 * 0.008, v1 * 0.008, 3) * 20;
}

/**
 * Full-sphere surface data for spherical gravity mode.
 * Given a 3D world-space point, projects it onto the moon sphere surface
 * and returns the surface normal, surface point, and signed distance.
 * Works for the ENTIRE sphere (all directions from center).
 */
export function getSphereSurfaceData(wx, wy, wz) {
  if (!GIANT_MOON_SPHERE) return null;
  const ms = GIANT_MOON_SPHERE;
  const dx = wx - ms.cx;
  const dy = wy - ms.cy;
  const dz = wz - ms.cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.001) {
    // At the exact center — degenerate, return default up
    return {
      inRange: true,
      surfaceNormal: [0, 1, 0],
      surfacePoint: [ms.cx, ms.cy + ms.radius, ms.cz],
      surfaceRadius: ms.radius,
      distFromCenter: 0,
      distFromSurface: -ms.radius
    };
  }
  // Unit normal from center to point
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  // Bump at this direction (matches GiantMoonSphere geometry displacement)
  const bump = sphereBumpAt(nx, ny, nz);
  const surfR = ms.radius + bump;
  // Surface point in world space
  const sx = ms.cx + nx * surfR;
  const sy = ms.cy + ny * surfR;
  const sz = ms.cz + nz * surfR;
  return {
    inRange: dist < surfR + 500,
    surfaceNormal: [nx, ny, nz],
    surfacePoint: [sx, sy, sz],
    surfaceRadius: surfR,
    distFromCenter: dist,
    distFromSurface: dist - surfR  // positive = above surface, negative = inside
  };
}

// Shared terrain height calculation (matches the LunarTerrain geometry)
export function getTerrainHeightXZ(x, z, flatRadius = 50, maxRadius = TERRAIN_RADIUS) {
  // SQUARE boundary check - fall off if outside square terrain
  if (Math.abs(x) > maxRadius || Math.abs(z) > maxRadius) {
    return -9999; // Far below - player will fall
  }
  
  const distFromCenter = Math.sqrt(x * x + z * z);
  
  // Keep center area flat for Connect Four table
  if (distFromCenter < flatRadius) {
    return 0;
  }
  
  // Hills get taller as we move away from center
  const hillFactor = Math.min(1, (distFromCenter - flatRadius) / (maxRadius * 0.5));
  
  // Noise functions (same as in LunarTerrain)
  const hash21 = (x, y) => {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    
    const a = hash21(ix, iy);
    const b = hash21(ix + 1, iy);
    const c = hash21(ix, iy + 1);
    const d = hash21(ix + 1, iy + 1);
    
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    return a * (1 - ux) * (1 - uy) +
           b * ux * (1 - uy) +
           c * (1 - ux) * uy +
           d * ux * uy;
  };
  
  const fbm = (x, y, octaves = 5) => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise(x * frequency, y * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  };
  
  // Generate hills using fractal noise - same exact formula as geometry
  const scale = 0.015;
  const height = fbm(x * scale, z * scale, 4) * 30 * hillFactor; // Dramatic hills for large terrain
  
  // Add some larger mounds
  const moundScale = 0.008;
  const mounds = fbm(x * moundScale, z * moundScale, 3) * 50 * hillFactor; // Big rolling mounds
  
  // Single mountain feature (matches LunarTerrain exactly)
  const MT_X = -1800, MT_Z = 1400;
  const MT_HEIGHT = 300;
  const MT_RADIUS = 400;
  const mdx = x - MT_X, mdz = z - MT_Z;
  const mtDistSq = mdx * mdx + mdz * mdz;
  const mtFalloff = Math.exp(-mtDistSq / (2 * MT_RADIUS * MT_RADIUS));
  const mtDetail = 1 + fbm(x * 0.03, z * 0.03, 3) * 0.15;
  const mountains = MT_HEIGHT * mtFalloff * mtDetail * hillFactor;
  
  // Blend edge smoothly
  const edgeFactor = 1 - Math.max(0, Math.min(1, (distFromCenter - maxRadius * 0.9) / (maxRadius * 0.3)));
  
  // Base height at exact position
  const result = (height + mounds + mountains) * edgeFactor;
  
  // Sample 4 nearby points and take the maximum to avoid clipping through peaks
  // (the visual mesh is a discrete grid — physics must match the interpolated surface)
  const offset = 2.0; // sample radius (matches ~half a mesh cell at 500 segments)
  const h1 = result;
  
  const sampleAt = (dx, dz) => {
    const nx = x + dx;
    const nz = z + dz;
    const nDist = Math.sqrt(nx * nx + nz * nz);
    if (nDist < flatRadius) return 0;
    const nHillFactor = Math.min(1, (nDist - flatRadius) / (maxRadius * 0.5));
    const nHeight = fbm(nx * scale, nz * scale, 4) * 30 * nHillFactor;
    const nMounds = fbm(nx * moundScale, nz * moundScale, 3) * 50 * nHillFactor;
    const nmdx = nx - MT_X, nmdz = nz - MT_Z;
    const nMtDistSq = nmdx * nmdx + nmdz * nmdz;
    const nMtFalloff = Math.exp(-nMtDistSq / (2 * MT_RADIUS * MT_RADIUS));
    const nMtDetail = 1 + fbm(nx * 0.03, nz * 0.03, 3) * 0.15;
    const nMountains = MT_HEIGHT * nMtFalloff * nMtDetail * nHillFactor;
    const nEdgeFactor = 1 - Math.max(0, Math.min(1, (nDist - maxRadius * 0.9) / (maxRadius * 0.3)));
    return (nHeight + nMounds + nMountains) * nEdgeFactor;
  };
  
  const h2 = sampleAt(offset, 0);
  const h3 = sampleAt(-offset, 0);
  const h4 = sampleAt(0, offset);
  const h5 = sampleAt(0, -offset);
  
  // Return max + small bias to keep player above mesh in concave areas
  const naturalHeight = Math.max(h1, h2, h3, h4, h5) + 1.5;

  // ── Foundation terrain deformation (match visual mesh) ──
  // Blend terrain height toward foundation surface so physics matches visuals
  const BLEND_RADIUS = 24;
  const HALF_G = 16; // GRID_SIZE / 2
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const physGroundY = -fhForGround / 2 - GROUND_CLEAR;

  let bestInfluence = 0;
  let targetFoundationH = naturalHeight;

  for (const f of CURRENT_BUILDING_PIECES) {
    if (f.type !== 'foundation') continue;

    const cos = Math.cos(f.rotation || 0);
    const sin = Math.sin(f.rotation || 0);
    const dx = x - f.x;
    const dz = z - f.z;
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;

    const edgeDistX = Math.abs(localX) - HALF_G;
    const edgeDistZ = Math.abs(localZ) - HALF_G;
    const edgeDist = Math.max(edgeDistX, edgeDistZ);

    if (edgeDist > BLEND_RADIUS) continue;

    // Foundation surface height relative to groundY
    const foundationH = f.y - physGroundY;

    let influence;
    if (edgeDist <= 0) {
      influence = 1.0;
    } else {
      const t = edgeDist / BLEND_RADIUS;
      influence = 1 - (t * t * (3 - 2 * t));
    }

    if (influence > bestInfluence) {
      bestInfluence = influence;
      targetFoundationH = foundationH;
    }
  }

  if (bestInfluence > 0) {
    return naturalHeight + (targetFoundationH - naturalHeight) * bestInfluence;
  }
  return naturalHeight;
}

// Get terrain height for a generated terrain cube at position (x, z)
// EXACTLY like main terrain - no edge blending, multi-point sampling
export function getGeneratedTerrainHeight(x, z, terrainCube) {
  // Check if position is within the terrain cube bounds (with small overlap for corners)
  const halfX = terrainCube.scale.x / 2;
  const halfZ = terrainCube.scale.z / 2;
  const overlap = 0.5; // Small overlap to ensure corners are always covered
  const minX = terrainCube.position.x - halfX - overlap;
  const maxX = terrainCube.position.x + halfX + overlap;
  const minZ = terrainCube.position.z - halfZ - overlap;
  const maxZ = terrainCube.position.z + halfZ + overlap;
  
  // Slightly expanded bounds prevent gaps at corners
  if (x < minX || x > maxX || z < minZ || z > maxZ) {
    return null; // Outside this terrain cube
  }
  
  // If terrain generation is not enabled, return flat top of box
  if (!terrainCube.hasTerrainNoise) {
    return terrainCube.position.y + (terrainCube.scale.y / 2);
  }
  
  // Calculate local position relative to terrain center
  const localX = x - terrainCube.position.x;
  const localZ = z - terrainCube.position.z;
  
  // Get terrain parameters
  const terrainScale = terrainCube.terrainScale || 0.015;
  const terrainHeightMultiplier = terrainCube.terrainHeightMultiplier || 8;
  const terrainMoundScale = terrainCube.terrainMoundScale || 0.008;
  const terrainMoundMultiplier = terrainCube.terrainMoundMultiplier || 15;
  const terrainOctaves = terrainCube.terrainOctaves || 4;
  
  // Noise functions (same as main terrain)
  const hash21 = (x, y) => {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    
    const a = hash21(ix, iy);
    const b = hash21(ix + 1, iy);
    const c = hash21(ix, iy + 1);
    const d = hash21(ix + 1, iy + 1);
    
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    return a * (1 - ux) * (1 - uy) +
           b * ux * (1 - uy) +
           c * (1 - ux) * uy +
           d * ux * uy;
  };
  
  const fbm = (x, y, octaves) => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise(x * frequency, y * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  };
  
  // Generate BASE terrain height (before edge blending)
  const height = fbm(localX * terrainScale, localZ * terrainScale, terrainOctaves) * terrainHeightMultiplier;
  const mounds = fbm(localX * terrainMoundScale, localZ * terrainMoundScale, 3) * terrainMoundMultiplier;
  
  const result = height + mounds;
  const offset = 0.5; // small offset for nearby sampling
  const h1 = result;
  
  // Multi-point sampling - Sample 4 nearby points and take max to catch peaks
  const hashOffset = (dx, dz) => {
    const nx = x + dx;
    const nz = z + dz;
    // Check bounds
    if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) return result;
    
    const nLocalX = nx - terrainCube.position.x;
    const nLocalZ = nz - terrainCube.position.z;
    const nHeight = fbm(nLocalX * terrainScale, nLocalZ * terrainScale, terrainOctaves) * terrainHeightMultiplier;
    const nMounds = fbm(nLocalX * terrainMoundScale, nLocalZ * terrainMoundScale, 3) * terrainMoundMultiplier;
    return nHeight + nMounds;
  };
  
  const h2 = hashOffset(offset, 0);
  const h3 = hashOffset(-offset, 0);
  const h4 = hashOffset(0, offset);
  const h5 = hashOffset(0, -offset);
  
  // Take max to avoid going through peaks
  let finalHeight = Math.max(h1, h2, h3, h4, h5);
  
  // EDGE BLENDING - Match visual mesh behavior (critical for corners!)
  if (terrainCube.snappedEdges && typeof CURRENT_PLACED_CUBES !== 'undefined') {
    const maxDistX = halfX;
    const maxDistZ = halfZ;
    const normalizedX = Math.abs(localX) / maxDistX;
    const normalizedZ = Math.abs(localZ) / maxDistZ;
    const blendZone = 0.20; // 20% edge blend zone (MUST match visual mesh)
    
    const edgeBlends = [];
    
    // Helper to get neighbor's edge height at this position
    const getNeighborEdgeHeight = (edge) => {
      const neighborId = terrainCube.snappedEdges[edge];
      if (!neighborId) return null;
      
      const neighbor = CURRENT_PLACED_CUBES.find(c => c.id === neighborId);
      if (!neighbor || !neighbor.savedEdgeHeights) return null;
      
      const edgeMap = { 'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east' };
      const neighborEdge = edgeMap[edge];
      const neighborEdgeData = neighbor.savedEdgeHeights[neighborEdge];
      if (!neighborEdgeData || neighborEdgeData.length === 0) return null;
      
      // Transform to neighbor's local space
      const worldOffsetX = terrainCube.position.x - neighbor.position.x;
      const worldOffsetZ = terrainCube.position.z - neighbor.position.z;
      const searchX = localX - worldOffsetX;
      const searchZ = localZ - worldOffsetZ;
      
      // Find closest saved point
      let closestHeight = null;
      let minDist = Infinity;
      for (const saved of neighborEdgeData) {
        const dist = (edge === 'north' || edge === 'south') 
          ? Math.abs(saved.localX - searchX)
          : Math.abs(saved.localZ - searchZ);
        if (dist < minDist) {
          minDist = dist;
          closestHeight = saved.height;
        }
      }
      return closestHeight;
    };
    
    // Check each edge for blending
    if (terrainCube.snappedEdges.north && localZ > 0 && normalizedZ > (1 - blendZone)) {
      const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('north');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.south && localZ < 0 && normalizedZ > (1 - blendZone)) {
      const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('south');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.east && localX > 0 && normalizedX > (1 - blendZone)) {
      const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('east');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.west && localX < 0 && normalizedX > (1 - blendZone)) {
      const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('west');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    // Apply blending (at corners, average neighbor heights for smooth transition)
    if (edgeBlends.length > 0) {
      let targetHeight, blendFactor;
      
      if (edgeBlends.length === 1) {
        // Single edge: blend to that neighbor
        targetHeight = edgeBlends[0].neighborHeight;
        blendFactor = edgeBlends[0].blendFactor;
      } else {
        // Corner (multiple edges): average the neighbor heights and use max blend factor
        // This ensures both edges converge to the same averaged height at the corner
        const avgHeight = edgeBlends.reduce((sum, e) => sum + e.neighborHeight, 0) / edgeBlends.length;
        const maxBlend = Math.max(...edgeBlends.map(e => e.blendFactor));
        targetHeight = avgHeight;
        blendFactor = maxBlend;
      }
      
      const smoothBlend = blendFactor * blendFactor * (3 - 2 * blendFactor);
      finalHeight = finalHeight * (1 - smoothBlend) + targetHeight * smoothBlend;
    }
  }
  
  // Apply sculpting modifications
  if (terrainCube.heightModifications && terrainCube.heightModifications.length > 0) {
    for (const mod of terrainCube.heightModifications) {
      const dx = localX - mod.x;
      const dz = localZ - mod.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < mod.radius) {
        const falloff = 1 - (distance / mod.radius);
        const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
        const heightChange = mod.delta * smoothFalloff;
        finalHeight += heightChange;
      }
    }
  }
  
  // Return floor top + terrain height
  return terrainCube.position.y + (terrainCube.scale.y / 2) + finalHeight;
}

export function getGroundHeightXZ(wx, wz) {
  // Compute the top surface height beneath (wx,wz) for both staircases and the large top platform
  const sampleStair = (posX, posZ, width, run, rise, steps, platformDepth = 0, platformWidth = null) => {
    const totalLen = steps * run;
    const halfW = width / 2;
    const zMin = posZ;
    const zMax = zMin + totalLen;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    // On steps
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      const dz = wz - zMin;
      const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(dz / run)));
      return (stepIndex + 1) * rise;
    }
    // On platform beyond the top (flat)
    if (platformDepth > 0) {
      const platZMin = zMax;
      const platZMax = zMax + platformDepth;
      const halfPlatW = (platformWidth != null ? platformWidth : width) / 2;
      const pxMin = posX - halfPlatW;
      const pxMax = posX + halfPlatW;
      if (wx >= pxMin && wx <= pxMax && wz >= platZMin && wz <= platZMax) {
        return steps * rise;
      }
    }
    return 0;
  };
  // Only stair2 - stair1 completely removed
  const h2 = sampleStair(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS, STAIR2_PLATFORM_DEPTH, STAIR2_PLATFORM_WIDTH);
  
  // Check if we're within the main terrain bounds (SQUARE boundary)
  const onMainTerrain = Math.abs(wx) <= TERRAIN_RADIUS && Math.abs(wz) <= TERRAIN_RADIUS;
  
  if (onMainTerrain) {
    // On main terrain - use main terrain height, ignore generated terrain below
    const terrainHeight = getTerrainHeightXZ(wx, wz);
    
    // If on stairs, use stair height, otherwise use terrain
    if (h2 > 0) {
      return h2;
    }
    
    return terrainHeight;
  } else {
    // OFF main terrain - check for generated terrain cubes to land on
    if (typeof CURRENT_PLACED_CUBES !== 'undefined' && CURRENT_PLACED_CUBES.length > 0) {
      for (const cube of CURRENT_PLACED_CUBES) {
        if (cube.isTerrain && cube.hasTerrainNoise) {
          const generatedHeight = getGeneratedTerrainHeight(wx, wz, cube);
          if (generatedHeight !== null) {
            // Found generated terrain at this position
            return generatedHeight;
          }
        }
      }
    }
    
    // No terrain found — check giant moon sphere
    if (GIANT_MOON_SPHERE) {
      const ms = GIANT_MOON_SPHERE;
      const dx = wx - ms.cx;
      const dz = wz - ms.cz;
      const distSqXZ = dx * dx + dz * dz;
      const rMax = ms.radius + 64;
      if (distSqXZ < rMax * rMax) {
        const rSq = ms.radius * ms.radius;
        const yOnSmooth0 = Math.sqrt(Math.max(0, rSq - distSqXZ));
        if (yOnSmooth0 > ms.radius * 0.3) {
          // Approximate unit normal from the smooth sphere
          const nx = dx / ms.radius;
          const ny0 = yOnSmooth0 / ms.radius;
          const nz = (wz - ms.cz) / ms.radius;
          const bump = sphereBumpAt(nx, ny0, nz);
          // The player's XZ includes radial bump displacement;
          // scale XZ back to the smooth-sphere equivalent so the
          // physics surface Y matches the visual mesh exactly.
          const bumpedR = ms.radius + bump;
          const distSqCorr = distSqXZ * (rSq / (bumpedR * bumpedR));
          const yOnCorr = Math.sqrt(Math.max(0, rSq - distSqCorr));
          const nyCorr = yOnCorr / ms.radius;
          return ms.cy + nyCorr * bumpedR;
        }
      }
    }
    return -9999;
  }
}

export function getGroundHeightXZAtY(wx, wz, worldY) {
  // Base ground Y used by the scene
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;

  // Stairs-only sampler (no platform)
  const sampleStairOnly = (posX, posZ, width, run, rise, steps) => {
    const totalLen = steps * run;
    const halfW = width / 2;
    const zMin = posZ;
    const zMax = zMin + totalLen;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      const dz = wz - zMin;
      const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(dz / run)));
      return (stepIndex + 1) * rise;
    }
    return 0;
  };

  // Flat platform beyond Stair 2
  const samplePlatform = (posX, posZ, width, depth, rise, steps) => {
    const stairsLen = steps * STAIR2_RUN; // use Stair 2 run for its platform extent
    const zMin = posZ + stairsLen;
    const zMax = zMin + depth;
    const halfW = width / 2;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      return steps * rise;
    }
    return 0;
  };

  // Built-in stairs - only stair2 (stair1 removed)
  const h2 = sampleStairOnly(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS);
  let maxH = Math.max(h2, 0);

  // Optional extra (decorative) stairs if configured as walkable
  if (EXTRA_STAIRS_WALKABLE && EXTRA_STAIRS_DEF) {
    try {
      const { posX, posZ, posY = 0, yaw = 0, width, depth, steps, run, rise, reverse } = EXTRA_STAIRS_DEF;
      const halfW = width / 2;
      const halfD = depth / 2;
      // Transform world to stairs-local
      const dx = wx - posX;
      const dz = wz - posZ;
      const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
        let lz01 = lz + halfD; // [0, depth]
        if (reverse) lz01 = depth - lz01;
        const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(lz01 / run)));
        const hExtra = (stepIndex + 1) * rise;
        maxH = Math.max(maxH, posY + hExtra);
      }
    } catch {}
  }

  // Third staircase - rotated 90Â° clockwise (goes in -X direction from origin)
  const sampleStair3Rotated = () => {
    const halfW = STAIR3_WIDTH / 2;
    const zMin = STAIR3_POS_Z - halfW;
    const zMax = STAIR3_POS_Z + halfW;
    const xMax = STAIR3_POS_X;
    const xMin = xMax - (STAIR3_STEPS * STAIR3_RUN);
    if (wz >= zMin && wz <= zMax && wx >= xMin && wx <= xMax) {
      const dx = xMax - wx; // distance from start going in -X direction
      const stepIndex = Math.max(0, Math.min(STAIR3_STEPS - 1, Math.floor(dx / STAIR3_RUN)));
      return (stepIndex + 1) * STAIR3_RISE;
    }
    return 0;
  };
  const h3 = sampleStair3Rotated();
  if (h3 > 0) {
    maxH = Math.max(maxH, STAIR3_BASE_Y + h3);
  }

  // Third platform - rotated 90Â°, extends in -X direction beyond stairs
  const samplePlatform3Rotated = () => {
    const stairsLen = STAIR3_STEPS * STAIR3_RUN;
    const xMax = STAIR3_POS_X - stairsLen;
    const xMin = xMax - STAIR3_PLATFORM_DEPTH;
    const halfW = STAIR3_PLATFORM_WIDTH / 2;
    const zMin = STAIR3_POS_Z - halfW;
    const zMax = STAIR3_POS_Z + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      return STAIR3_STEPS * STAIR3_RISE;
    }
    return 0;
  };
  
  // Sample placed stairs2 - EXACT same ground sampling as STAIR3
  const samplePlacedStairs2 = () => {
    const cubes = CURRENT_PLACED_CUBES || [];
    let maxStairH = 0;
    for (const cube of cubes) {
      if (cube.modelType !== 'stairs2' || !cube.hasCollision) continue;
      
      const width = STAIR2_WIDTH * (cube.scale.x || 1);
      const run = STAIR2_RUN * (cube.scale.z || 1);
      const rise = STAIR2_RISE * (cube.scale.y || 1);
      const steps = STAIR2_STEPS;
      const posX = cube.position.x || 0;
      const posY = cube.position.y || 0;
      const posZ = cube.position.z || 0;
      const rotY = cube.rotation.y || 0;
      
      // Calculate baseY (same as makeForPlacedStairs2)
      const fh = ROWS * (CELL + GAP) - GAP + 0.6;
      const groundY = -fh / 2 - GROUND_CLEAR;
      const baseY = posY - groundY;
      
      const cos = Math.cos(-rotY);
      const sin = Math.sin(-rotY);
      
      // Transform world to local
      const dx = wx - posX;
      const dz = wz - posZ;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      
      // Check bounds (relaxed like STAIR2/STAIR3 with extra margin)
      const halfW = width / 2;
      const totalLen = steps * run;
      const margin = run * 0.75; // extra margin like STAIR2/STAIR3
      if (lx >= -halfW && lx <= halfW && lz >= -margin && lz <= totalLen + margin) {
        // Clamp to actual stair range for step calculation
        const clampedLz = Math.max(0, Math.min(totalLen, lz));
        const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(clampedLz / run)));
        const localHeight = (stepIndex + 1) * rise;
        // Return baseY + localHeight (same pattern as STAIR3_BASE_Y + h3)
        maxStairH = Math.max(maxStairH, baseY + localHeight);
      }
    }
    return maxStairH;
  };
  const placedStairsH = samplePlacedStairs2();
  if (placedStairsH > 0) {
    maxH = Math.max(maxH, placedStairsH);
  }
  
  // STAIR3 Platform and STAIR2 Platform
  const hp3 = samplePlatform3Rotated();
  const stair3Height = hp3 > 0 ? STAIR3_BASE_Y + hp3 : 0;
  
  const hp = samplePlatform(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_PLATFORM_WIDTH, STAIR2_PLATFORM_DEPTH, STAIR2_RISE, STAIR2_STEPS);
  const stair2Height = hp > 0 ? hp : 0;
  
  // Only use platform height if you're above it (not walking underneath)
  // This prevents snapping up when walking under platforms
  const PLATFORM_UNDERPASS_THRESHOLD = 5.0; // height clearance for walking under
  
  if (stair3Height > 0) {
    const platformTopWorldY = groundY + stair3Height;
    // Only use this platform if we're close to or above its top surface
    if (worldY >= platformTopWorldY - PLATFORM_UNDERPASS_THRESHOLD) {
      maxH = Math.max(maxH, stair3Height);
    }
  }
  if (stair2Height > 0) {
    const platformTopWorldY = groundY + stair2Height;
    // Only use this platform if we're close to or above its top surface
    if (worldY >= platformTopWorldY - PLATFORM_UNDERPASS_THRESHOLD) {
      maxH = Math.max(maxH, stair2Height);
    }
  }

  // Check if on Connect Four table top platform
  try {
    const tableData = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
    const tableTopY = (typeof window !== 'undefined' && Number.isFinite(window.__CF_TABLE_TOP_Y__))
      ? Number(window.__CF_TABLE_TOP_Y__)
      : groundY + 37.0;
    
    if (tableData && Number.isFinite(tableData.minX) && Number.isFinite(tableData.maxX) && 
        Number.isFinite(tableData.minZ) && Number.isFinite(tableData.maxZ)) {
      const minX = tableData.minX;
      const maxX = tableData.maxX;
      const minZ = tableData.minZ;
      const maxZ = tableData.maxZ;
      
      // Check if position is on the table
      if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
        const tableHeight = tableTopY - groundY;
        // Only use table height if we're close to or above its top surface
        if (worldY >= tableTopY - PLATFORM_UNDERPASS_THRESHOLD) {
          maxH = Math.max(maxH, tableHeight);
        }
      }
    }
  } catch {}

  // ── Giant moon sphere walkable surface ──
  if (GIANT_MOON_SPHERE) {
    const ms = GIANT_MOON_SPHERE;
    const dx = wx - ms.cx;
    const dz = wz - ms.cz;
    const distSqXZ = dx * dx + dz * dz;
    const rMax = ms.radius + 64;
    if (distSqXZ < rMax * rMax) {
      const rSq = ms.radius * ms.radius;
      const yOnSmooth0 = Math.sqrt(Math.max(0, rSq - distSqXZ));
      if (yOnSmooth0 > ms.radius * 0.3) {
        // Approximate unit normal
        const nx = dx / ms.radius;
        const ny0 = yOnSmooth0 / ms.radius;
        const nz = (wz - ms.cz) / ms.radius;
        const bump = sphereBumpAt(nx, ny0, nz);
        // Correct for radial bump displacement so physics matches visual mesh
        const bumpedR = ms.radius + bump;
        const distSqCorr = distSqXZ * (rSq / (bumpedR * bumpedR));
        const yOnCorr = Math.sqrt(Math.max(0, rSq - distSqCorr));
        const nyCorr = yOnCorr / ms.radius;
        const surfaceY = ms.cy + nyCorr * bumpedR;
        if (worldY >= surfaceY - 8.0) {
          const sphereH = surfaceY - groundY;
          maxH = Math.max(maxH, sphereH);
        }
      }
    }
  }

  // Check if on placed sphere/cylinder/cube with walkableTop enabled
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    for (const cube of cubes) {
      if (cube.hasCollision && cube.walkableTop) {
        if (cube.shape === 'sphere') {
          // Sphere: calculate curved surface height based on distance from center
          const visualRadius = (((cube.scale.x || 5) + (cube.scale.y || 5) + (cube.scale.z || 5)) / 3 * 0.5);
          const centerX = cube.position.x || 0;
          const centerY = cube.position.y || 0;
          const centerZ = cube.position.z || 0;
          
          const dx = wx - centerX;
          const dz = wz - centerZ;
          const distFromCenterXZ = Math.sqrt(dx * dx + dz * dz);
          
          // Only walk on sphere if within horizontal radius
          if (distFromCenterXZ <= visualRadius) {
            // Calculate Y height on sphere surface using Pythagorean theorem
            // For a sphere: xÂ² + yÂ² + zÂ² = rÂ²
            // So: y = sqrt(rÂ² - xÂ² - zÂ²)
            const distSqXZ = dx * dx + dz * dz;
            const radiusSq = visualRadius * visualRadius;
            const yOnSphere = Math.sqrt(Math.max(0, radiusSq - distSqXZ));
            const surfaceY = centerY + yOnSphere; // Y position on top of sphere
            
            const sphereHeight = surfaceY - groundY;
            // Only use this height if we're close to or above the surface
            if (worldY >= surfaceY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, sphereHeight);
            }
          }
        } else if (cube.shape === 'cylinder') {
          // Cylinder: flat top (not curved)
          const visualRadius = ((cube.scale.x || 5) * 0.5);
          const centerX = cube.position.x || 0;
          const centerZ = cube.position.z || 0;
          const topY = (cube.position.y || 0) + (cube.scale.y || 5) * 0.5;
          
          const dx = wx - centerX;
          const dz = wz - centerZ;
          const distSq = dx * dx + dz * dz;
          
          if (distSq <= (visualRadius * visualRadius)) {
            const cylinderHeight = topY - groundY;
            if (worldY >= topY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, cylinderHeight);
            }
          }
        } else {
          // Cube: rectangular bounds check
          const halfX = (cube.scale.x || 5) / 2;
          const halfY = (cube.scale.y || 5) / 2;
          const halfZ = (cube.scale.z || 5) / 2;
          const centerX = cube.position.x || 0;
          const centerZ = cube.position.z || 0;
          const topY = (cube.position.y || 0) + halfY;
          
          // Check if position is within horizontal bounds (rectangular check)
          if (wx >= centerX - halfX && wx <= centerX + halfX &&
              wz >= centerZ - halfZ && wz <= centerZ + halfZ) {
            const cubeHeight = topY - groundY;
            // Only use this height if we're close to or above its top surface
            if (worldY >= topY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, cubeHeight);
            }
          }
        }
      }
    }
  } catch {}
  
  // Check for generated terrain cubes with terrain noise (ALWAYS check, not just walkableTop)
  let foundGeneratedTerrain = false;
  let generatedTerrainHeight = null;
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    
    // Check ALL terrain cubes and take the MAXIMUM height (handles overlapping corners)
    for (const cube of cubes) {
      if (cube.isTerrain && cube.hasTerrainNoise) {
        const genHeight = getGeneratedTerrainHeight(wx, wz, cube);
        if (genHeight !== null) {
          const terrainHeightFromGround = genHeight - groundY;
          // At corners where multiple terrains overlap, use the HIGHEST terrain
          if (!foundGeneratedTerrain || terrainHeightFromGround > generatedTerrainHeight) {
            generatedTerrainHeight = terrainHeightFromGround;
            foundGeneratedTerrain = true;
          }
        }
      }
    }
  } catch {}

  // Always sample main terrain height
  const terrainHeight = getTerrainHeightXZ(wx, wz);
  
  // If off main terrain, check giant moon sphere or generated terrain
  if (terrainHeight === -9999) {
    // Moon sphere surface can serve as ground even outside main terrain
    if (maxH > -9000) return maxH;
    if (foundGeneratedTerrain) {
      return generatedTerrainHeight;
    }
    // No surfaces found - fall
    return -9999;
  }
  
  // On main terrain - use highest surface
  let surfaceMax = foundGeneratedTerrain
    ? Math.max(maxH, terrainHeight, generatedTerrainHeight)
    : Math.max(maxH, terrainHeight);

  // ── Building pieces: walk on foundations/floors ──
  try {
    for (const p of CURRENT_BUILDING_PIECES) {
      if (!p || !p.type) continue;
      // Only walkable pieces (foundation, floor, ramp)
      const w = p.dims?.[0] || 4;
      const h = p.dims?.[1] || 0.3;
      const d = p.dims?.[2] || 4;
      const rot = p.rotation || 0;

      // Transform world coords into piece-local space
      const dx = wx - p.x;
      const dz = wz - p.z;
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;

      const halfW = w / 2, halfD = d / 2;

      if (p.walkable && p.type !== 'ramp' && p.type !== 'stairs') {
        // Flat walkable surface (foundation, floor, platform)
        if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
          const topY = (p.y - groundY) + h; // surface top Y relative to groundY
          // Only stand on it if player is above or near the top
          if (worldY === undefined || worldY >= (p.y + h - 2)) {
            surfaceMax = Math.max(surfaceMax, topY);
          }
        }
      } else if (p.type === 'ramp') {
        // Ramp: linear interpolation of height along local Z
        if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
          const t = (lz + halfD) / (halfD * 2); // 0 at back, 1 at front
          const rampH = t * (p.dims?.[1] || 4);  // ramp height
          const topY = (p.y - groundY) + rampH;
          surfaceMax = Math.max(surfaceMax, topY);
        }
      } else if (p.type === 'stairs') {
        // Stairs: step-wise height increase along local Z
        if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
          const steps = p.stairSteps || 8;
          const t = (lz + halfD) / (halfD * 2); // 0 at back, 1 at front
          const stepIndex = Math.min(Math.floor(t * steps), steps - 1);
          const stepH = ((stepIndex + 1) / steps) * (p.dims?.[1] || 4);
          const topY = (p.y - groundY) + stepH;
          surfaceMax = Math.max(surfaceMax, topY);
        }
      }
    }
  } catch {}

  return surfaceMax;
}

// Debug toggle for showing collision boxes - moved to component state (showCollisionMeshes)

export function buildStairAABBsWorld() {
  // Returns an array of {min:{x,y,z}, max:{x,y,z}} in world coordinates for both staircases
  const makeFor = (posX, posZ, width, run, rise, steps, baseY = 0) => {
    const aabbs = [];
    const halfW = width / 2;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    // World ground Y
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    for (let i = 0; i < steps; i++) {
      const zStart = posZ + i * run;
      const zEnd = zStart + run;
      const y0 = baseY + i * rise;
      const y1 = y0 + rise;
      aabbs.push({
        min: { x: xMin, y: groundY + y0, z: zStart },
        max: { x: xMax, y: groundY + y1, z: zEnd },
        idx: i,
      });
    }
    return aabbs;
  };
  
  // Rotated version for STAIR3 (goes in -X direction)
  const makeForRotated90 = (posX, posZ, width, run, rise, steps, baseY = 0) => {
    const aabbs = [];
    const halfW = width / 2;
    const zMin = posZ - halfW;
    const zMax = posZ + halfW;
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    for (let i = 0; i < steps; i++) {
      const xStart = posX - i * run;      // going in -X direction
      const xEnd = xStart - run;          // end is further in -X
      const y0 = baseY + i * rise;
      const y1 = y0 + rise;
      aabbs.push({
        min: { x: Math.min(xStart, xEnd), y: groundY + y0, z: zMin },
        max: { x: Math.max(xStart, xEnd), y: groundY + y1, z: zMax },
        idx: i,
        stair3: true, // mark for debugging
      });
    }
    return aabbs;
  };
  
  // Helper for placed stairs2 models - EXACT same as makeFor + rails (with groundY calculation like STAIR3)
  const makeForPlacedStairs2 = (cube) => {
    const aabbs = [];
    const width = STAIR2_WIDTH * (cube.scale.x || 1);
    const run = STAIR2_RUN * (cube.scale.z || 1);
    const rise = STAIR2_RISE * (cube.scale.y || 1);
    const steps = STAIR2_STEPS;
    const posX = cube.position.x || 0;
    const posY = cube.position.y || 0; // This is world space, will convert to baseY
    const posZ = cube.position.z || 0;
    const rotY = cube.rotation.y || 0;
    const halfW = width / 2;
    const railWidth = 0.8; // same as STAIR2/STAIR3
    const railHeight = 16.0; // 2x taller for better containment (was 8.0)
    const railInset = -1.5; // Negative = inset from edge (was 0.45 outside)
    
    // Calculate groundY same as makeFor/makeForRotated90
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    
    // Convert world posY to baseY (offset from ground)
    const baseY = posY - groundY;
    
    // No rotation - use simple boxes like makeFor
    if (Math.abs(rotY) < 0.01) {
      const xMin = posX - halfW;
      const xMax = posX + halfW;
      // Step boxes (EXACT same formula as makeFor/STAIR2)
      for (let i = 0; i < steps; i++) {
        const zStart = posZ + i * run;
        const zEnd = zStart + run;
        const y0 = baseY + i * rise;
        const y1 = y0 + rise;
        aabbs.push({
          min: { x: xMin, y: groundY + y0, z: zStart },
          max: { x: xMax, y: groundY + y1, z: zEnd },
          idx: i,
        });
      }
      // Rail boxes (OUTSIDE the stairs like STAIR2/STAIR3) - use platform edge collision for smooth sliding
      const leftX = posX - halfW - railInset;
      const rightX = posX + halfW + railInset;
      for (let i = 0; i < steps; i++) {
        const zStart = posZ + i * run;
        const zEnd = zStart + run;
        const yBase = groundY + baseY + i * rise;
        
        aabbs.push({
          min: { x: leftX - railWidth/2, y: yBase, z: zStart },
          max: { x: leftX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        aabbs.push({
          min: { x: rightX - railWidth/2, y: yBase, z: zStart },
          max: { x: rightX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2 + 1,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    } else {
      // With rotation - transform corners (EXACT same formula as STAIR3)
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      // Step boxes
      for (let i = 0; i < steps; i++) {
        const zStart = i * run;
        const zEnd = zStart + run;
        const y0 = baseY + i * rise;
        const y1 = y0 + rise;
        
        const corners = [
          [-halfW, zStart], [halfW, zStart],
          [halfW, zEnd], [-halfW, zEnd],
        ];
        
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [lx, lz] of corners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minX = Math.min(minX, wx);
          maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz);
          maxZ = Math.max(maxZ, wz);
        }
        
        aabbs.push({
          min: { x: minX, y: groundY + y0, z: minZ },
          max: { x: maxX, y: groundY + y1, z: maxZ },
          idx: i,
        });
      }
      // Rail boxes (OUTSIDE the stairs, with rotation - EXACT same as STAIR3)
      const leftXLocal = -halfW - railInset;
      const rightXLocal = halfW + railInset;
      for (let i = 0; i < steps; i++) {
        const zStart = i * run;
        const zEnd = zStart + run;
        const yBase = groundY + baseY + i * rise;
        
        // Left rail
        const leftCorners = [
          [leftXLocal - railWidth/2, zStart], [leftXLocal + railWidth/2, zStart],
          [leftXLocal + railWidth/2, zEnd], [leftXLocal - railWidth/2, zEnd],
        ];
        
        let minXL = Infinity, minZL = Infinity, maxXL = -Infinity, maxZL = -Infinity;
        for (const [lx, lz] of leftCorners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minXL = Math.min(minXL, wx);
          maxXL = Math.max(maxXL, wx);
          minZL = Math.min(minZL, wz);
          maxZL = Math.max(maxZL, wz);
        }
        
        aabbs.push({
          min: { x: minXL, y: yBase, z: minZL },
          max: { x: maxXL, y: yBase + railHeight, z: maxZL },
          idx: 9100 + i * 2,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        // Right rail
        const rightCorners = [
          [rightXLocal - railWidth/2, zStart], [rightXLocal + railWidth/2, zStart],
          [rightXLocal + railWidth/2, zEnd], [rightXLocal - railWidth/2, zEnd],
        ];
        
        let minXR = Infinity, minZR = Infinity, maxXR = -Infinity, maxZR = -Infinity;
        for (const [lx, lz] of rightCorners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minXR = Math.min(minXR, wx);
          maxXR = Math.max(maxXR, wx);
          minZR = Math.min(minZR, wz);
          maxZR = Math.max(maxZR, wz);
        }
        
        aabbs.push({
          min: { x: minXR, y: yBase, z: minZR },
          max: { x: maxXR, y: yBase + railHeight, z: maxZR },
          idx: 9100 + i * 2 + 1,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    }
    return aabbs;
  };
  
  const boxes = [
    // Stairs1 completely removed
    // Stairs2 (active)
    ...makeFor(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS),
    // Stairs3 (rotated 90Â°, starts on top of STAIR2 platform)
    ...makeForRotated90(STAIR3_POS_X, STAIR3_POS_Z, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS, STAIR3_BASE_Y),
  ];

  // Optionally add AABBs for the extra FBX stairs by bounding the rotated step prisms
  if (EXTRA_STAIRS_WALKABLE && EXTRA_STAIRS_DEF) {
    try {
      const { posX, posZ, posY = 0, yaw, width, depth, steps, run, rise, reverse } = EXTRA_STAIRS_DEF;
      const halfW = width / 2;
      const halfD = depth / 2;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      // World ground Y
      const fh = ROWS * (CELL + GAP) - GAP + 0.6;
      const groundY = -fh / 2 - GROUND_CLEAR;
      for (let i = 0; i < steps; i++) {
        const zStartLocal = reverse ? (halfD - (i + 1) * run) : (-halfD + i * run);
        const zEndLocal   = zStartLocal + run;
        const y0 = i * rise;
        const y1 = y0 + rise;
        // 4 local XY corners for bottom/top faces
        const localCorners = [
          [-halfW, zStartLocal],
          [ halfW, zStartLocal],
          [ halfW, zEndLocal],
          [-halfW, zEndLocal],
        ];
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [lx, lz] of localCorners) {
          // rotate and translate into world XZ
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
          if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
        }
        boxes.push({
          min: { x: minX, y: groundY + posY + y0, z: minZ },
          max: { x: maxX, y: groundY + posY + y1, z: maxZ },
          idx: i,
          extra: true,
        });
      }
    } catch {}
  }
  
  // Add rail collision boxes (not walls) alongside stairs
  try {
    const fh2 = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY2 = -fh2 / 2 - GROUND_CLEAR;
    
    // Rail box dimensions
    const railWidth = 0.8;  // width of the rail post/box
    const railHeight = 16.0; // 2x taller for better containment (was 8.0)
    
    // Stair 1 rails removed - only keeping Stair 2 rails
    
    // Stair 2 rails (long stairs)
    {
      const railInset = -1.5; // Negative = inset from edge (was 0.45 outside)
      const leftX = STAIR2_POS_X - STAIR2_WIDTH/2 - railInset;
      const rightX = STAIR2_POS_X + STAIR2_WIDTH/2 + railInset;
      
      // Create rail boxes along the stairs
      for (let i = 0; i < STAIR2_STEPS; i++) {
        const zStart = STAIR2_POS_Z + i * STAIR2_RUN;
        const zEnd = zStart + STAIR2_RUN;
        const yBase = groundY2 + i * STAIR2_RISE;
        
        // Left rail box
        boxes.push({
          min: { x: leftX - railWidth/2, y: yBase, z: zStart },
          max: { x: leftX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2, // unique index for left rail
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        // Right rail box
        boxes.push({
          min: { x: rightX - railWidth/2, y: yBase, z: zStart },
          max: { x: rightX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2 + 1, // unique index for right rail
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    }
    
    // Stair 3 rails (rotated 90Â° - goes in -X direction)
    {
      const railInset = -1.5; // Negative = inset from edge (2x taller rails)
      const leftZ = STAIR3_POS_Z - STAIR3_WIDTH/2 - railInset;
      const rightZ = STAIR3_POS_Z + STAIR3_WIDTH/2 + railInset;
      
      // Create rail boxes along the stairs (going in -X direction)
      for (let i = 0; i < STAIR3_STEPS; i++) {
        const xStart = STAIR3_POS_X - i * STAIR3_RUN;
        const xEnd = xStart - STAIR3_RUN;
        const yBase = groundY2 + STAIR3_BASE_Y + i * STAIR3_RISE;
        
        // Left rail box (along leftZ)
        boxes.push({
          min: { x: Math.min(xStart, xEnd), y: yBase, z: leftZ - railWidth/2 },
          max: { x: Math.max(xStart, xEnd), y: yBase + railHeight, z: leftZ + railWidth/2 },
          idx: 9200 + i * 2, // unique index for left rail
          isRailBox: true,
          isPlatformEdge: true, // Use platform edge collision (post-movement clamping)
          stair3: true
        });
        
        // Right rail box (along rightZ)
        boxes.push({
          min: { x: Math.min(xStart, xEnd), y: yBase, z: rightZ - railWidth/2 },
          max: { x: Math.max(xStart, xEnd), y: yBase + railHeight, z: rightZ + railWidth/2 },
          idx: 9200 + i * 2 + 1, // unique index for right rail
          isRailBox: true,
          isPlatformEdge: true, // Use platform edge collision (post-movement clamping)
          stair3: true
        });
      }
    }
    
    // Add platform collision boxes for visualization and edge detection
    
    // STAIR2 Platform
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platWidth = STAIR2_PLATFORM_WIDTH;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      
      boxes.push({
        min: { 
          x: STAIR2_POS_X - platWidth/2, 
          y: stair2TopY - platThickness, 
          z: stair2TopZ 
        },
        max: { 
          x: STAIR2_POS_X + platWidth/2, 
          y: stair2TopY, 
          z: stair2TopZ + platDepth 
        },
        idx: 9300,
        isPlatform: true
      });
    }
    
    // STAIR3 Platform (rotated - extends in -X direction)
    {
      const stair3TopY = groundY2 + STAIR3_BASE_Y + STAIR3_STEPS * STAIR3_RISE;
      const stair3TopX = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN;
      const plat3Depth = STAIR3_PLATFORM_DEPTH;
      const plat3Width = STAIR3_PLATFORM_WIDTH;
      const plat3Thickness = STAIR3_PLATFORM_THICKNESS;
      
      boxes.push({
        min: { 
          x: stair3TopX - plat3Depth, 
          y: stair3TopY - plat3Thickness, 
          z: STAIR3_POS_Z - plat3Width/2 
        },
        max: { 
          x: stair3TopX, 
          y: stair3TopY, 
          z: STAIR3_POS_Z + plat3Width/2 
        },
        idx: 9301,
        isPlatform: true,
        stair3: true
      });
    }
    
    // Platform edge walls - match railing height, start at platform bottom
    const edgeThickness = 1.0; // wall thickness
    const railingHeight = 7.0; // match the railing post height
    
    // STAIR2 Platform Edges
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      const platformBottomY = stair2TopY - platThickness; // start walls at platform bottom
      const wallTopY = stair2TopY + railingHeight; // extend up to match railing height
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platWidth = STAIR2_PLATFORM_WIDTH;
      const xMin = STAIR2_POS_X - platWidth/2;
      const xMax = STAIR2_POS_X + platWidth/2;
      const zMin = stair2TopZ;
      const zMax = stair2TopZ + platDepth;
      // NO FRONT EDGE - stairs enter here
      
      // Back edge (far from stairs)
      boxes.push({
        min: { x: xMin - edgeThickness, y: platformBottomY, z: zMax },
        max: { x: xMax + edgeThickness, y: wallTopY, z: zMax + edgeThickness },
        idx: 9311,
        isPlatformEdge: true
      });
      
      // Left edge - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platformBottomY, z: zMin },
        max: { x: xMin, y: wallTopY, z: zMax + edgeThickness },
        idx: 9312,
        isPlatformEdge: true
      });
      
      // Right edge - extend to overlap with back wall
      boxes.push({
        min: { x: xMax, y: platformBottomY, z: zMin },
        max: { x: xMax + edgeThickness, y: wallTopY, z: zMax + edgeThickness },
        idx: 9313,
        isPlatformEdge: true
      });
    }
    
    // STAIR3 Platform Edges (rotated)
    {
      const stair3TopY = groundY2 + STAIR3_BASE_Y + STAIR3_STEPS * STAIR3_RISE;
      const plat3Thickness = STAIR3_PLATFORM_THICKNESS;
      const platform3BottomY = stair3TopY - plat3Thickness; // start walls at platform bottom
      const wall3TopY = stair3TopY + railingHeight; // extend up to match railing height
      const stair3TopX = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN;
      const plat3Depth = STAIR3_PLATFORM_DEPTH;
      const plat3Width = STAIR3_PLATFORM_WIDTH;
      const xMin = stair3TopX - plat3Depth;
      const xMax = stair3TopX;
      const zMin = STAIR3_POS_Z - plat3Width/2;
      const zMax = STAIR3_POS_Z + plat3Width/2;
      // NO FRONT EDGE (+X side) - stairs enter here
      
      // Back edge (far from stairs, -X side) - extend to overlap with side walls
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMin - edgeThickness },
        max: { x: xMin, y: wall3TopY, z: zMax + edgeThickness },
        idx: 9321,
        isPlatformEdge: true,
        stair3: true
      });
      
      // Left edge (-Z side) - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMin - edgeThickness },
        max: { x: xMax, y: wall3TopY, z: zMin },
        idx: 9322,
        isPlatformEdge: true,
        stair3: true
      });
      
      // Right edge (+Z side) - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMax },
        max: { x: xMax, y: wall3TopY, z: zMax + edgeThickness },
        idx: 9323,
        isPlatformEdge: true,
        stair3: true
      });
    }
    
    // Rocket pedestal circular collision wall
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platCenterZ = stair2TopZ + platDepth / 2;
      // Rocket collision removed - now moves with rocket as child
    }
    
    // Connect Four Table Collision Box (one thick solid cube)
    {
      // Get table dimensions from window global (set by WoodenTable loader)
      const tableData = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
      const tableTopY = (typeof window !== 'undefined' && Number.isFinite(window.__CF_TABLE_TOP_Y__))
        ? Number(window.__CF_TABLE_TOP_Y__)
        : groundY2 + 37.0;
      
      if (tableData && Number.isFinite(tableData.minX) && Number.isFinite(tableData.maxX) && 
          Number.isFinite(tableData.minZ) && Number.isFinite(tableData.maxZ)) {
        const minX = tableData.minX;
        const maxX = tableData.maxX;
        const minZ = tableData.minZ;
        const maxZ = tableData.maxZ;
        const tableBottomY = groundY2;
        const wallTopY = tableTopY;
        
        // One thick solid collision box
        boxes.push({
          min: { x: minX, y: tableBottomY, z: minZ },
          max: { x: maxX, y: wallTopY, z: maxZ },
          idx: 9501,
          isPlatformEdge: true,
          isTableBox: true,
          walkableTop: true // Always allow standing on the Connect Four table
        });
      }
    }
  } catch {}
  
  // Add placed cubes and spheres with collision enabled (use runtime cache for real-time updates)
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    cubes.forEach((cube, idx) => {
      // For child collision objects, get live position/scale from parent transform
      let livePosition = cube.position;
      let liveScale = cube.scale;
      
      if (cube.parentId && window.__CF_PARENT_TRANSFORMS__) {
        const parentTransform = window.__CF_PARENT_TRANSFORMS__[cube.parentId];
        if (parentTransform && cube.followParentScale) {
          // Get live position from parent
          livePosition = {
            x: parentTransform.position.x,
            y: parentTransform.position.y,
            z: parentTransform.position.z
          };
          
          // Get live scale from parent bounds
          const parentCube = cubes.find(c => c.id === cube.parentId);
          if (parentCube && parentCube.modelBounds) {
            const bounds = parentCube.modelBounds;
            liveScale = {
              x: bounds.width * parentTransform.scale.x,
              y: bounds.height * parentTransform.scale.y,
              z: bounds.depth * parentTransform.scale.z
            };
          }
        }
      }
      
      if (cube.hasCollision) {
        // stairs2 uses makeForPlacedStairs2 - EXACT same as makeFor
        if (cube.modelType === 'stairs2') {
          boxes.push(...makeForPlacedStairs2(cube));
        } else if (cube.shape === 'sphere' || cube.shape === 'cylinder') {
          // Sphere and Cylinder collision - use circular collision logic (like rocket base)
          const avgScale = ((liveScale.x || 5) + (liveScale.y || 5) + (liveScale.z || 5)) / 3;
          const radius = avgScale * 0.5; // sphere/cylinder geometry has radius 0.5
          
          // For cylinders with walkableTop, create TWO boxes: top platform + side walls (ORIGINAL BEHAVIOR)
          if (cube.shape === 'cylinder' && cube.walkableTop) {
            const radiusXZ = (liveScale.x || 5) * 0.5; // horizontal radius
            const height = (liveScale.y || 5);
            const centerX = livePosition.x || 0;
            const centerY = livePosition.y || 0;
            const centerZ = livePosition.z || 0;
            const topY = centerY + height * 0.5;
            const bottomY = centerY - height * 0.5;
            
            // 1. Top platform box (thin disk) - treated as isPlatform like Connect Four table
            const platformThickness = 2.0; // thin platform at top
            boxes.push({
              min: { x: centerX - radiusXZ, y: topY - platformThickness, z: centerZ - radiusXZ },
              max: { x: centerX + radiusXZ, y: topY, z: centerZ + radiusXZ },
              idx: 10000 + idx,
              isPlatform: true, // Platform collision - blocks side movement when feet are inside
              centerX: centerX,
              centerZ: centerZ,
              radius: radiusXZ,
              walkableTop: true
            });
            
            // 2. Side wall collision (full height cylinder, no top platform behavior)
            boxes.push({
              min: { x: centerX - radiusXZ, y: bottomY, z: centerZ - radiusXZ },
              max: { x: centerX + radiusXZ, y: topY - platformThickness, z: centerZ + radiusXZ },
              idx: 10000 + idx + 0.1, // slightly different idx
              isRocketBase: true, // Circular side collision only
              centerX: centerX,
              centerZ: centerZ,
              radius: radiusXZ,
              walkableTop: false // No walkable top on side walls
            });
          } else if (cube.shape === 'sphere') {
            // Sphere: same collision structure as cylinder for walkable top
            const centerX = livePosition.x || 0;
            const centerY = livePosition.y || 0;
            const centerZ = livePosition.z || 0;
            const sphereRadius = radius;
            
            if (cube.walkableTop) {
              // Walkable sphere: Only side collision (bottom half acts as wall)
              // The top surface is handled entirely by ground height sampling
              const bottomY = centerY - sphereRadius;
              const sideWallHeight = centerY; // Up to the center/equator
              
              boxes.push({
                min: { x: centerX - sphereRadius, y: bottomY, z: centerZ - sphereRadius },
                max: { x: centerX + sphereRadius, y: sideWallHeight, z: centerZ + sphereRadius },
                idx: 10000 + idx + 0.1,
                isRocketBase: true, // Circular collision for sides
                centerX: centerX,
                centerZ: centerZ,
                radius: sphereRadius,
                walkableTop: false // Not walkable, just a wall
              });
            } else {
              // Non-walkable sphere: single full collision box
              boxes.push({
                min: { x: centerX - sphereRadius, y: centerY - sphereRadius, z: centerZ - sphereRadius },
                max: { x: centerX + sphereRadius, y: centerY + sphereRadius, z: centerZ + sphereRadius },
                idx: 10000 + idx,
                isRocketBase: true,
                centerX: centerX,
                centerZ: centerZ,
                radius: sphereRadius,
                isPlacedSphere: true,
                walkableTop: false
              });
            }
          } else {
            // Non-walkable cylinder: single collision box
            boxes.push({
              min: {
                x: (livePosition.x || 0) - radius,
                y: (livePosition.y || 0) - radius,
                z: (livePosition.z || 0) - radius
              },
              max: {
                x: (livePosition.x || 0) + radius,
                y: (livePosition.y || 0) + radius,
                z: (livePosition.z || 0) + radius
              },
              idx: 10000 + idx,
              isRocketBase: true, // Use circular collision logic
              centerX: livePosition.x || 0,
              centerZ: livePosition.z || 0,
              radius: radius,
              isPlacedSphere: true,
              walkableTop: false
            });
          }
        } else {
          // Box collision - exactly like Connect Four table
          const halfX = (liveScale.x || 5) / 2;
          const halfY = (liveScale.y || 5) / 2;
          const halfZ = (liveScale.z || 5) / 2;
          const centerX = livePosition.x || 0;
          const centerY = livePosition.y || 0;
          const centerZ = livePosition.z || 0;
          
          // Single box with exact same attributes as Connect Four table
          boxes.push({
            min: { x: centerX - halfX, y: centerY - halfY, z: centerZ - halfZ },
            max: { x: centerX + halfX, y: centerY + halfY, z: centerZ + halfZ },
            idx: 10000 + idx,
            isPlatformEdge: true, // Same as Connect Four table
            isTableBox: true, // Same as Connect Four table
            walkableTop: cube.walkableTop || false // Same as Connect Four table (always true for table)
          });
        }
      }
    });
  } catch (e) {
    console.warn('Failed to load cube collisions:', e);
  }

  // Giant moon sphere – lower hemisphere acts as a wall, top is walkable via ground sampling
  if (GIANT_MOON_SPHERE) {
    const ms = GIANT_MOON_SPHERE;
    // Side wall collision up to the equator (lower hemisphere blocks)
    boxes.push({
      min: { x: ms.cx - ms.radius, y: ms.cy - ms.radius, z: ms.cz - ms.radius },
      max: { x: ms.cx + ms.radius, y: ms.cy, z: ms.cz + ms.radius },
      idx: 99000,
      isRocketBase: true,   // circular collision logic
      centerX: ms.cx,
      centerZ: ms.cz,
      radius: ms.radius,
      walkableTop: false
    });
  }
  
  return boxes;
}