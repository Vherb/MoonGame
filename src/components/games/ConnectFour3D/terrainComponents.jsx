// ConnectFour3D – terrain rendering components
// Extracted from ConnectFour3DView.jsx

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { TERRAIN_RADIUS, COLS, ROWS, CELL, GAP, GROUND_CLEAR } from './constants';
import { CURRENT_PLACED_CUBES, getTerrainHeightXZ, setGiantMoonSphere, sphereBumpAt } from './terrainPhysics';
export function TerrainSculptor({ enabled, brushSize, strength, placedCubes, onSculpt }) {
  const { camera, raycaster, scene, gl } = useThree();
  const [brushPosition, setBrushPosition] = useState(null);
  const [hoveredTerrainId, setHoveredTerrainId] = useState(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));

  // Track mouse movement
  useEffect(() => {
    if (!enabled) return;

    const canvas = gl.domElement;
    
    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      
      // Convert to normalized device coordinates (-1 to +1)
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
  }, [enabled, gl]);

  useFrame(() => {
    if (!enabled) {
      setBrushPosition(null);
      return;
    }

    raycaster.setFromCamera(mouseRef.current, camera);
    
    // Find terrain meshes
    const terrainObjects = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.userData.terrainId) {
        terrainObjects.push(obj);
      }
    });

    const intersects = raycaster.intersectObjects(terrainObjects, false);
    
    if (intersects.length > 0) {
      const hit = intersects[0];
      const newPos = hit.point.clone();
      
      // Only update if position changed significantly (prevent jitter from geometry updates)
      if (!brushPosition || brushPosition.distanceTo(newPos) > 0.1) {
        setBrushPosition(newPos);
      }
      setHoveredTerrainId(hit.object.userData.terrainId);
    } else {
      setBrushPosition(null);
      setHoveredTerrainId(null);
    }
  });

  // Handle arrow keys for sculpting
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      if (hoveredTerrainId && brushPosition) {
        if (e.key === ']') {
          e.preventDefault();
          onSculpt(hoveredTerrainId, brushPosition, brushSize, strength);
        } else if (e.key === '[') {
          e.preventDefault();
          onSculpt(hoveredTerrainId, brushPosition, brushSize, -strength);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, hoveredTerrainId, brushPosition, brushSize, strength, onSculpt]);

  if (!enabled || !brushPosition) return null;

  return (
    <mesh position={[brushPosition.x, brushPosition.y + 0.1, brushPosition.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[brushSize * 0.9, brushSize, 32]} />
      <meshBasicMaterial color="#00ff00" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Terrain geometry generator with procedural noise
// Floating labels for terrain identification

export function TerrainLabels({ cube, terrainIndex }) {
  if (!cube.isTerrain) return null;
  
  const labelHeight = 150; // Float WAY above terrain noise
  const edgeDistance = (cube.scale.x / 2) * 0.8; // 80% of the way to edge
  
  return (
    <group position={[cube.position.x, cube.position.y, cube.position.z]}>
      {/* Center ID Label */}
      <Text
        position={[0, labelHeight, 0]}
        fontSize={80}
        color="#00ffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={3}
        outlineColor="#000000"
      >
        {terrainIndex}
      </Text>
      
      {/* North Label */}
      <Text
        position={[0, labelHeight, edgeDistance]}
        fontSize={50}
        color="#ff6b6b"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        NORTH
      </Text>
      
      {/* South Label */}
      <Text
        position={[0, labelHeight, -edgeDistance]}
        fontSize={50}
        color="#4ecdc4"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        SOUTH
      </Text>
      
      {/* East Label */}
      <Text
        position={[edgeDistance, labelHeight, 0]}
        fontSize={50}
        color="#ffe66d"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        EAST
      </Text>
      
      {/* West Label */}
      <Text
        position={[-edgeDistance, labelHeight, 0]}
        fontSize={50}
        color="#a8e6cf"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        EAST
      </Text>
      
      {/* West Label */}
      <Text
        position={[-edgeDistance, labelHeight, 0]}
        fontSize={20}
        color="#a8e6cf"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.8}
        outlineColor="#000000"
      >
        WEST
      </Text>
    </group>
  );
}


export function TerrainGeometry({ cube }) {
  const geometry = React.useMemo(() => {
    const segments = cube.terrainSegments || 100;
    const sizeX = cube.scale.x;
    const sizeZ = cube.scale.z;
    
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments);
    
    // Get position attribute
    const positions = geo.attributes.position;
    
    // Heightmap function using noise
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
    
    // Apply height to vertices
    const terrainScale = cube.terrainScale || 0.015;
    const terrainHeightMultiplier = cube.terrainHeightMultiplier || 8;
    const terrainMoundScale = cube.terrainMoundScale || 0.008;
    const terrainMoundMultiplier = cube.terrainMoundMultiplier || 15;
    const terrainOctaves = cube.terrainOctaves || 4;
    
    const maxDistX = sizeX / 2;
    const maxDistZ = sizeZ / 2;
    
    // Storage for edge heights - will be saved to cube after generation
    const edgeHeights = {
      north: [],
      south: [],
      east: [],
      west: []
    };
    
    // Helper to get height from neighbor's saved edge
    // Supports MULTIPLE snapped edges - check snappedEdges object
    const getSavedEdgeHeight = (edge, localX, localZ) => {
      // Check if this specific edge has a neighbor
      if (!cube.snappedEdges || !cube.snappedEdges[edge]) return null;
      
      const neighborCubeId = cube.snappedEdges[edge];
      
      // Find the neighbor cube
      let neighborCube = null;
      if (typeof CURRENT_PLACED_CUBES !== 'undefined') {
        neighborCube = CURRENT_PLACED_CUBES.find(c => c.id === neighborCubeId);
      }
      
      if (!neighborCube || !neighborCube.savedEdgeHeights) return null;
      
      // IMPORTANT: Verify the cubes are actually still close together
      // If they've been moved apart, don't blend (prevents stale snappedEdges from causing issues)
      const distX = Math.abs(cube.position.x - neighborCube.position.x);
      const distZ = Math.abs(cube.position.z - neighborCube.position.z);
      const maxExpectedDist = (Math.max(cube.scale.x, cube.scale.z) + Math.max(neighborCube.scale.x, neighborCube.scale.z)) / 2 + 5;
      
      if (distX > maxExpectedDist || distZ > maxExpectedDist) {
        // Cubes are too far apart - they're not actually snapped anymore
        return null;
      }
      
      // ONE-WAY INHERITANCE: This terrain (NEW) adopts the neighbor's (OLD) edge heights
      // The existing terrain is the authority - we don't need mutual verification
      // This allows chaining: A â†’ B (adapts to A) â†’ C (adapts to B) â†’ etc.
      
      // Determine which edge of the neighbor we're matching
      const edgeMapping = {
        'north': 'south',
        'south': 'north',
        'east': 'west',
        'west': 'east'
      };
      const neighborEdge = edgeMapping[edge];
      const neighborEdgeData = neighborCube.savedEdgeHeights[neighborEdge];
      
      if (!neighborEdgeData || neighborEdgeData.length === 0) return null;
      
      // Transform local coordinates from this cube's space to neighbor's space
      // This is needed because each terrain has its own local coordinate system
      // IMPORTANT: Always transform BOTH X and Z coordinates relative to neighbor
      const worldOffsetX = cube.position.x - neighborCube.position.x;
      const worldOffsetZ = cube.position.z - neighborCube.position.z;
      let searchX = localX - worldOffsetX;
      let searchZ = localZ - worldOffsetZ;
      
      // Find closest saved point along the edge
      let closestHeight = null;
      let minDist = Infinity;
      
      for (const saved of neighborEdgeData) {
        let dist;
        if (edge === 'north' || edge === 'south') {
          // North/south edges vary in X, match by X coordinate
          dist = Math.abs(saved.localX - searchX);
        } else {
          // East/west edges vary in Z, match by Z coordinate
          dist = Math.abs(saved.localZ - searchZ);
        }
        
        if (dist < minDist) {
          minDist = dist;
          closestHeight = saved.height;
        }
      }
      
      // For corner blending: if we didn't find a close match, try to find ANY edge point
      // This helps when coordinate transformation is slightly off at corners
      if (minDist > 1.0 && neighborEdgeData.length > 0) {
        // Fall back to closest point overall (not just along one axis)
        for (const saved of neighborEdgeData) {
          const distX = Math.abs(saved.localX - searchX);
          const distZ = Math.abs(saved.localZ - searchZ);
          const totalDist = Math.sqrt(distX * distX + distZ * distZ);
          
          if (totalDist < minDist) {
            minDist = totalDist;
            closestHeight = saved.height;
          }
        }
      }
      
      return closestHeight;
    };
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = -positions.getY(i);
      
      const normalizedX = Math.abs(x) / maxDistX;
      const normalizedZ = Math.abs(z) / maxDistZ;
      
      // Generate base terrain - NO EDGE BLENDING
      const height = fbm(x * terrainScale, z * terrainScale, terrainOctaves) * terrainHeightMultiplier;
      const mounds = fbm(x * terrainMoundScale, z * terrainMoundScale, 3) * terrainMoundMultiplier;
      
      let finalHeight = height + mounds;
      
      // SAVE EDGE HEIGHTS FIRST - before any blending is applied
      // This ensures we save PURE terrain noise at edges, not blended values
      // When other terrains read these edges, they get the original heights
      const edgeTolerance = 0.02; // 2% tolerance for "exactly on edge"
      if (normalizedZ > (1 - edgeTolerance) && z > 0) {
        edgeHeights.north.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedZ > (1 - edgeTolerance) && z < 0) {
        edgeHeights.south.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedX > (1 - edgeTolerance) && x > 0) {
        edgeHeights.east.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedX > (1 - edgeTolerance) && x < 0) {
        edgeHeights.west.push({ localX: x, localZ: z, height: finalHeight });
      }
      
      // Edge zone: 20% of terrain width for smooth blending
      const blendZone = 0.20;
      
      // Check ALL edges for snapping - collect blend data
      const edgeBlends = [];
      
      // North edge check (positive Z, far edge)
      if (cube.snappedEdges && cube.snappedEdges.north && z > 0) {
        if (normalizedZ > (1 - blendZone)) {
          const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('north', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'north', blendFactor, savedHeight });
          }
        }
      }
      
      // South edge check (negative Z, near edge)
      if (cube.snappedEdges && cube.snappedEdges.south && z < 0) {
        if (normalizedZ > (1 - blendZone)) {
          const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('south', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'south', blendFactor, savedHeight });
          }
        }
      }
      
      // East edge check (positive X, right edge)
      if (cube.snappedEdges && cube.snappedEdges.east && x > 0) {
        if (normalizedX > (1 - blendZone)) {
          const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('east', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'east', blendFactor, savedHeight });
          }
        }
      }
      
      // West edge check (negative X, left edge)
      if (cube.snappedEdges && cube.snappedEdges.west && x < 0) {
        if (normalizedX > (1 - blendZone)) {
          const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('west', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'west', blendFactor, savedHeight });
          }
        }
      }
      
      // Apply edge blending
      if (edgeBlends.length > 0) {
        let targetEdgeHeight;
        let finalBlendFactor;
        
        if (edgeBlends.length === 1) {
          // Single edge: use that neighbor's height
          targetEdgeHeight = edgeBlends[0].savedHeight;
          finalBlendFactor = edgeBlends[0].blendFactor;
        } else {
          // Multiple edges (corner): Pick the edge with HIGHEST blend factor (closest to edge)
          // This avoids averaging - just use the most dominant neighbor
          const dominantEdge = edgeBlends.reduce((max, curr) => 
            curr.blendFactor > max.blendFactor ? curr : max
          );
          targetEdgeHeight = dominantEdge.savedHeight;
          finalBlendFactor = dominantEdge.blendFactor;
        }
        
        // Smoothstep for smooth transition from interior terrain to neighbor edge
        const smoothBlend = finalBlendFactor * finalBlendFactor * (3 - 2 * finalBlendFactor);
        
        // Blend from interior terrain (0) to neighbor edge (1)
        finalHeight = finalHeight * (1 - smoothBlend) + targetEdgeHeight * smoothBlend;
      }
      
      // Apply sculpting modifications (affects all vertices including edges)
      if (cube.heightModifications && cube.heightModifications.length > 0) {
        for (const mod of cube.heightModifications) {
          const dx = x - mod.x;
          const dz = z - mod.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          
          if (distance < mod.radius) {
            const falloff = 1 - (distance / mod.radius);
            const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
            const heightChange = mod.delta * smoothFalloff;
            finalHeight += heightChange;
          }
        }
      }
      
      // Set the height
      positions.setZ(i, finalHeight);
    }
    
    // Save edge heights to cube (will trigger re-render but that's OK)
    if (typeof CURRENT_PLACED_CUBES !== 'undefined') {
      const cubeToUpdate = CURRENT_PLACED_CUBES.find(c => c.id === cube.id);
      if (cubeToUpdate) {
        cubeToUpdate.savedEdgeHeights = edgeHeights;
      }
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [
    cube.id,
    cube.scale.x, 
    cube.scale.z, 
    cube.terrainSegments, 
    cube.terrainScale, 
    cube.terrainHeightMultiplier,
    cube.terrainMoundScale,
    cube.terrainMoundMultiplier,
    cube.terrainOctaves,
    JSON.stringify(cube.snappedEdges || {}), // Support multiple edge snaps
    JSON.stringify(cube.heightModifications || [])
  ]);
  
  return <primitive object={geometry} attach="geometry" />;
}

// Edge snapping helper for terrain floors
// Detects ALL edges that can snap to neighbors - supports multiple simultaneous snaps

export function AsteroidFloor({ opacity = 1.0, radius = TERRAIN_RADIUS, speed = 0.35, dir = [1.0, 0.25], scale = 0.8 }) {
  // Same ground reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // height of the floor
  const groundY = -fh / 2 - GROUND_CLEAR; // position of the ground
  const matRef = useRef();
  const shader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uRadius: { value: radius },
      uSpeed: { value: speed },
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
      uScale: { value: scale },
  // Greyer rock palette
  uRockA: { value: new THREE.Color('#5e5f63') },
  uRockB: { value: new THREE.Color('#8a8b90') },
  uRockC: { value: new THREE.Color('#3a3b3f') },
      uLightDir: { value: new THREE.Vector3(-0.25, 1.0, 0.15).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime, uOpacity, uRadius, uSpeed, uScale;
      uniform vec2 uDir;
      uniform vec3 uRockA, uRockB, uRockC;
      uniform vec3 uLightDir;

      // Hashes and noise
      float hash11(float n){ return fract(sin(n)*43758.5453123); }
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.,0.));
        float c = hash21(i + vec2(0.,1.));
        float d = hash21(i + vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c - a)*u.y*(1.-u.x) + (d - b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){
          v += a * noise(p); p *= 2.02; a *= 0.5;
        }
        return v;
      }

      // Crater field using nearest random point in a 3x3 cell neighborhood
      float craterField(vec2 p, out vec2 craterUV){
        vec2 ip = floor(p);
        vec2 fp = fract(p);
        float dmin = 1e9; vec2 closest = vec2(0.0);
        for(int j=-1;j<=1;j++){
          for(int i=-1;i<=1;i++){
            vec2 cell = ip + vec2(float(i), float(j));
            vec2 rnd = vec2(hash21(cell), hash21(cell+7.77));
            vec2 c = rnd*0.8 + 0.1; // random center inside cell
            vec2 diff = fp - (c + vec2(float(i), float(j)));
            float d = dot(diff, diff);
            if(d < dmin){ dmin = d; closest = diff; }
          }
        }
        float r = sqrt(dmin);
        craterUV = vec2(r, 0.0);
        // Profile: depression with a raised rim
        float rim = smoothstep(0.22, 0.18, r) - smoothstep(0.12, 0.10, r);
        float bowl = 0.35 * (1.0 - smoothstep(0.0, 0.22, r));
        return clamp(bowl - rim*0.45, -0.6, 0.6);
      }

      // Compute terrain height from fbm and craters
      float height(vec2 p){
        vec2 cuv; float cr = craterField(p*1.2, cuv);
        float base = fbm(p*1.8)*0.7 + fbm(p*4.3)*0.18;
        return base - cr; // lower in craters
      }

      // Approximate normal via central differences
      vec3 normalFromHeight(vec2 p){
        float e = 0.0025;
        float h = height(p);
        float hx = height(p + vec2(e,0.)) - h;
        float hy = height(p + vec2(0.,e)) - h;
        vec3 n = normalize(vec3(-hx, 1.0/e, -hy));
        return n;
      }

      void main(){
        // Irregular edge mask so the platform silhouette looks like an asteroid
        float distXZ = length(vWorldPos.xz);
        float rad = max(1.0, uRadius);
        // wobble the edge using low frequency fbm for jagged outline
        float edgeNoise = fbm(vWorldPos.xz * 0.12 + vec2(0.05*uTime, -0.04*uTime));
        float edged = distXZ / rad + (edgeNoise - 0.5) * 0.08; // +/- 4% wobble
        // 0..1, 1 inside, 0 outside with a narrow irregular falloff band
        float inside = 1.0 - smoothstep(0.94, 1.02, edged);
        if (inside <= 0.001) discard;
        // keep a secondary soft fade for the very outer rim
        float ring = smoothstep(0.0, 0.2, inside);

        // Scroll world to simulate flying forward
        vec2 dir = normalize(uDir);
        vec2 p = (vWorldPos.xz * uScale) + dir * (uTime * uSpeed * 12.0);

        // Terrain
        float h = height(p);
        vec3 n = normalFromHeight(p);

        // Rock albedo
        float c1 = smoothstep(0.0, 1.0, h);
        float c2 = smoothstep(0.2, 0.8, fbm(p*2.7));
        vec3 albedo = mix(uRockA, uRockB, c1);
        albedo = mix(albedo, uRockC, 0.25*(1.0-c2));

        // Lighting: single directional + ambient + subtle rim
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, vec3(0.0,1.0,0.0)), 0.0, 1.0), 1.6);
        vec3 ambient = albedo * 0.40;
        vec3 diffuse = albedo * (0.80 * ndl);
        vec3 rimCol = vec3(0.45,0.5,0.6) * rim * 0.18;
        vec3 col = ambient + diffuse + rimCol;

        // Alpha: fully opaque inside, fade only near irregular edge so stars never show over the floor
        float a = mix(uOpacity, 0.0, 1.0 - ring);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: true,
  }), [opacity, radius, speed, dir, scale]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  const planeSize = radius * 2.6;
  return (
    <group position={[0, groundY, 0]}>
      <mesh rotation={[-Math.PI/2, 0, 0]} renderOrder={-3} receiveShadow={false}>
        <planeGeometry args={[planeSize, planeSize, 1, 1]} />
        <shaderMaterial ref={matRef} args={[shader]} />
      </mesh>
      {/* Subtle texture overlay + shadow catcher slightly above to avoid perfectly flat look */}
      <TexturedShadowOverlay size={planeSize} />
    </group>
  );
}


export function TexturedShadowOverlay({ size }){
  const tex = useTexture('/textures/metal_floor.png');
  useEffect(()=>{
    if(tex){ tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; tex.repeat.set(size/48, size/48); tex.needsUpdate = true; }
  }, [tex, size]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} receiveShadow renderOrder={-2}>
      <planeGeometry args={[size, size, 1, 1]} />
      <meshStandardMaterial transparent opacity={0.12} color={'#0b1220'} map={tex || null} />
    </mesh>
  );
}

// Lunar terrain with hills and mounds - characters can walk on the surface

export function LunarTerrain({ radius = TERRAIN_RADIUS, flatRadius = 50, showCollisionBox = false }) {
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  const materialRef = useRef();
  
  // Load lunar surface texture
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/lunar_surface.png',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(90, 90); // Scaled tiling for 5000-radius terrain
        texture.anisotropy = 16; // Increase anisotropic filtering for better quality
        texture.needsUpdate = true;
        if (materialRef.current) {
          materialRef.current.map = texture;
          materialRef.current.needsUpdate = true;
        }
      },
      undefined,
      (error) => {
        console.log('Lunar texture not found, using procedural material');
      }
    );
  }, []);
  
  // Create terrain geometry with heightmap
  const terrainGeometry = useMemo(() => {
    const segments = 500; // high resolution so mesh closely matches physics noise
    const size = radius * 2.2;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    
    // Get position attribute
    const positions = geo.attributes.position;
    
    // Heightmap function using noise
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
    
    // Apply height to vertices
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = -positions.getY(i); // Note: PlaneGeometry Y becomes -Z in world space when rotated -90Â° around X
      
      // Distance from center
      const distFromCenter = Math.sqrt(x * x + z * z);
      
      // Keep center area flat for Connect Four table
      if (distFromCenter < flatRadius) {
        positions.setZ(i, 0);
      } else {
        // Hills get taller as we move away from center
        const hillFactor = Math.min(1, (distFromCenter - flatRadius) / (radius * 0.5));
        
        // Generate hills using fractal noise - increased height for more dramatic terrain
        const scale = 0.015;
        const height = fbm(x * scale, z * scale, 4) * 30 * hillFactor; // Dramatic hills for large terrain
        
        // Add some larger mounds
        const moundScale = 0.008;
        const mounds = fbm(x * moundScale, z * moundScale, 3) * 50 * hillFactor; // Big rolling mounds
        
        // Mountains — very low frequency, tall peaks with threshold so only some areas rise
        const mtScale = 0.002;
        const mtRaw = fbm(x * mtScale, z * mtScale, 3);
        // Only raise terrain where noise > 0.55 (creates isolated mountain ranges)
        const mtThreshold = 0.55;
        const mtPeak = Math.max(0, mtRaw - mtThreshold) / (1 - mtThreshold); // 0-1 above threshold
        const mountains = mtPeak * mtPeak * 250 * hillFactor; // Up to 250 units tall, squared for sharp peaks
        
        // Blend edge smoothly
        const edgeFactor = 1 - Math.max(0, Math.min(1, (distFromCenter - radius * 0.9) / (radius * 0.3)));
        
        positions.setZ(i, (height + mounds + mountains) * edgeFactor);
      }
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [radius, flatRadius]);
  
  return (
    <group position={[0, groundY, 0]}>
      <mesh
        ref={(el) => { if (el) el.userData.isTerrain = true; }}
        rotation={[-Math.PI / 2, 0, 0]} geometry={terrainGeometry} receiveShadow castShadow>
        <meshStandardMaterial 
          ref={materialRef}
          color="#b0b0b0"
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>
      
      {/* Collision box visualization */}
      {showCollisionBox && (
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[100, 1, 100]} />
          <meshBasicMaterial color="#10b981" wireframe opacity={0.3} transparent />
        </mesh>
      )}
    </group>
  );
}

// Giant walkable moon sphere with the same terrain noise as LunarTerrain
export function GiantMoonSphere({ position = [2000, -12000, -4000], radius = 15000 }) {
  const materialRef = useRef();
  const meshRef = useRef();

  // Build bumpy sphere geometry using the shared noise function
  const bumpyGeo = useMemo(() => {
    const geo = new THREE.SphereGeometry(radius, 128, 64);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const len = Math.sqrt(x*x + y*y + z*z) || 1;
      const nx = x/len, ny = y/len, nz = z/len;
      const bump = sphereBumpAt(nx, ny, nz);
      pos.setXYZ(i, nx * (radius + bump), ny * (radius + bump), nz * (radius + bump));
    }
    geo.computeVertexNormals();
    return geo;
  }, [radius]);

  // Register this sphere as a walkable physics surface
  useEffect(() => {
    setGiantMoonSphere({ cx: position[0], cy: position[1], cz: position[2], radius });
    return () => setGiantMoonSphere(null);
  }, [position, radius]);

  // Load the same lunar_surface texture used by LunarTerrain
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/lunar_surface.png',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(40, 20);
        texture.anisotropy = 16;
        texture.needsUpdate = true;
        if (materialRef.current) {
          materialRef.current.map = texture;
          materialRef.current.needsUpdate = true;
        }
      },
      undefined,
      (error) => console.log('GiantMoonSphere: lunar texture not found, using fallback color')
    );
  }, []);

  // No rotation — physics surface must match visual mesh

  return (
    <mesh ref={meshRef} position={position} receiveShadow frustumCulled={false}
      geometry={bumpyGeo}>
      <meshStandardMaterial
        ref={materialRef}
        color="#b0b0b0"
        roughness={0.95}
        metalness={0.05}
      />
    </mesh>
  );
}

// Star dome + drifting dust + a couple of procedural planets for deep space vibe