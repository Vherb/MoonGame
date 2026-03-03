// ConnectFour3D – space environment components
// Extracted from ConnectFour3DView.jsx

import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFBX } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
export function SpaceBackdrop({ speed = 0.3, dir = [1.0, 0.25], starIntensity = 1.8, clusterStrength = 2.2 }) {
  const domeMatRef = useRef();
  const planet1Ref = useRef();
  const planet2Ref = useRef();
  const dustRef = useRef();
  const groupRef = useRef();

  const uDir = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Star dome shader (inward-facing sphere)
  const domeShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: 0.35 },
      uNebula: { value: 0.0 },
      uIntensity: { value: starIntensity },
      uCluster: { value: clusterStrength },
      uDir: { value: new THREE.Vector2(uDir.x, uDir.y) },
      uSpeed: { value: speed },
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
      uniform float uTime, uTwinkle, uNebula, uIntensity, uCluster, uSpeed;
      uniform vec2 uDir;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i+vec2(1.,0.));
        float c = hash(i+vec2(0.,1.));
        float d = hash(i+vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }

      void main(){
        // Map world dir to a stable UV on the dome
        vec3 d = normalize(vWorldPos);
        float lon = atan(d.z, d.x); // -pi..pi
        float lat = asin(clamp(d.y, -1.0, 1.0)); // -pi/2..pi/2
        vec2 uv = vec2(lon/(6.28318530718)+0.5, lat/3.14159265359+0.5);

        // Scroll for subtle parallax in star pattern
        vec2 scroll = uDir * (uTime * uSpeed * 0.08);
  vec2 suv = uv * 220.0 + scroll; // much denser star field

        // Clustering mask (bigger, smoother regions of higher star density)
  float cl = fbm(uv*4.6 + scroll*0.12);
  float clusterMask = pow(smoothstep(0.45, 0.98, cl), 4.0) * (uCluster * 1.8); // stronger clusters

        // Multi-layer stars via noise thresholds
        float n1 = noise(suv);
        float n2 = noise(suv*1.7 + 5.17);
        float n3 = noise(suv*2.3 + 17.9);
  float starS = smoothstep(0.992, 1.0, n1);
  float starM = smoothstep(0.9965, 1.0, n2);
  float starL = smoothstep(0.9985, 1.0, n3);
        // Bright cores for the largest stars
  float core = pow(max(0.0, n3 - 0.9991)/0.0009, 3.0);

        // Twinkle modulation
        float tw1 = 0.5 + 0.5*sin(uTime*3.1 + 11.0*noise(suv*0.08));
        float tw2 = 0.5 + 0.5*sin(uTime*2.2 + 7.0*noise(suv*0.11 + 4.3));
        float twinkle = (0.6 + 0.4*mix(tw1, tw2, 0.5)) * (1.0 + 0.35*clusterMask) * uTwinkle;

        float stars = (starS*0.9 + starM*2.2 + starL*3.4 + core*4.0);
        stars *= (1.0 + clusterMask);
        stars *= (0.75 + twinkle);

        // Subtle nebula gradient (kept low to emphasize bright dots)
        float neb = fbm(uv*2.6 + scroll*0.12);
        vec3 nebCol = mix(vec3(0.03,0.02,0.05), vec3(0.08,0.05,0.12), neb) * uNebula;

        // Remove nebula tint to avoid dome â€œbubbleâ€ look; render only stars
        vec3 col = vec3(1.0)*stars*uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  }), [uDir, speed, starIntensity, clusterStrength]);

  // Simple procedural planet shader material factory
  const makePlanetShader = useCallback((baseA, baseB, banding, clouds) => ({
    uniforms: {
      uTime: { value: 0 },
      uBaseA: { value: new THREE.Color(baseA) },
      uBaseB: { value: new THREE.Color(baseB) },
      uBand: { value: banding },
      uClouds: { value: clouds },
      uLightDir: { value: new THREE.Vector3(-0.2, 0.9, 0.1).normalize() },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vN; varying vec3 vP;
      uniform vec3 uBaseA, uBaseB, uLightDir; uniform float uTime, uBand, uClouds;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5;} return v; }
      void main(){
        vec3 n = normalize(vN);
        // spherical uv from normal
        float lon = atan(n.z, n.x); float lat = asin(clamp(n.y,-1.0,1.0));
        vec2 uv = vec2(lon/6.2831853+0.5, lat/3.14159265+0.5);
        // gas bands or continents
        float bands = 0.5 + 0.5*sin((uv.y*6.28318)*uBand + 2.0*fbm(uv*4.0 + vec2(0.1*uTime)));
        vec3 base = mix(uBaseA, uBaseB, bands);
        // clouds
        float c = smoothstep(0.65, 0.9, fbm(uv*5.0 + vec2(0.05*uTime, 0.07*uTime)));
        vec3 col = base + vec3(1.0)*c*uClouds*0.25;
        // lighting
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        vec3 ambient = col*0.35; vec3 diffuse = col*0.85*ndl;
        float rim = pow(1.0 - clamp(dot(n, vec3(0,1,0)), 0.0, 1.0), 2.0)*0.25;
        col = ambient + diffuse + vec3(0.7,0.8,1.0)*rim*0.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }), []);

  // Create planet shader materials
  const planet1Shader = useMemo(() => makePlanetShader('#557799', '#88aacc', 18.0, 0.4), [makePlanetShader]);
  const planet2Shader = useMemo(() => makePlanetShader('#704a2a', '#c79a5f', 8.0, 0.15), [makePlanetShader]);

  // Dust points — spread across the larger scene
  const dustCount = 500;
  const dustGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i*3+0] = (Math.random()-0.5) * 12000;
      positions[i*3+1] = (Math.random()-0.1) * 8000;
      positions[i*3+2] = (Math.random()-0.5) * 16000;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  const dustMat = useMemo(() => new THREE.PointsMaterial({ size: 3.5, color: '#aab3ff', opacity: 0.45, transparent: true, depthWrite: false }), []);

  // Cleanup geometries/materials on unmount to avoid memory buildup in dev
  useEffect(() => {
    return () => {
      try { dustGeom?.dispose?.(); } catch {}
      try { dustMat?.dispose?.(); } catch {}
      try { if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.dispose(); } catch {}
      try { if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.dispose(); } catch {}
      try { domeMatRef.current?.dispose?.(); } catch {}
    };
  }, [dustGeom, dustMat]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    if (domeMatRef.current) domeMatRef.current.uniforms.uTime.value = t;
    if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.uniforms.uTime.value = t;
    if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.uniforms.uTime.value = t*0.8;
    // Drift dust opposite to travel dir
    if (dustRef.current) {
      const geom = dustRef.current.geometry; const pos = geom.getAttribute('position');
      const dx = -uDir.x * speed * 0.6 * delta * 60.0;
      const dz = -uDir.y * speed * 1.2 * delta * 60.0;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + dx; let z = pos.getZ(i) + dz;
        if (x > 6000) x = -6000; if (x < -6000) x = 6000;
        if (z > 8000) z = -8000; if (z < -8000) z = 8000;
        pos.setX(i, x); pos.setZ(i, z);
      }
      pos.needsUpdate = true;
    }
    // slow planet rotations
    if (planet1Ref.current) planet1Ref.current.rotation.y = t * 0.02;
    if (planet2Ref.current) planet2Ref.current.rotation.y = -t * 0.015;
  });

  const radius = 25000; // large enough to wrap entire terrain + far objects
  return (
    <group ref={groupRef}>
      {/* Stars dome */}
      <mesh renderOrder={-20}>
        <sphereGeometry args={[radius, 64, 48]} />
        <shaderMaterial ref={domeMatRef} args={[domeShader]} />
      </mesh>
      {/* Drifting dust for speed cue */}
      <points ref={dustRef} geometry={dustGeom} material={dustMat} renderOrder={-9} frustumCulled={false} />
      {/* Planets: pushed far into the sky as distant celestial bodies */}
      <BluePlanetFBX position={[-12000, 6000, -18000]} scale={80} />
      <PinkPlanetFBX position={[8000, 4500, -14000]} scale={12} />
      <PinkPlanetFBX position={[15000, 3000, 10000]} scale={15} />
      {/* Earth — large and distant */}
      <EarthPlanetFBX position={[-20000, 8000, 15000]} scale={120} />
    </group>
  );
}

// Load and display the blue planet FBX model

export function BluePlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/blue_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Slow rotation
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}

// Load and display the pink planet FBX model

export function PinkPlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/pink_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Slow rotation (slightly different speed for variety)
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * -0.015;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}

// Load and display the Earth planet FBX model

export function EarthPlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/earth_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Decent spin rate (faster than other planets for Earth)
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * 0.05;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}


export function FlybyAsteroids({ count = 3, speed = 0.22, dir = [1, 0.25] }) {
  const groupRef = useRef();
  
  // Seeded random function so all players see the same asteroids
  const seededRandom = useMemo(() => {
    let seed = 12345; // Fixed seed for deterministic asteroids
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }, []);
  
  const rng = useMemo(() => seededRandom() * 1000, [seededRandom]);
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  
  // Load the asteroid_fly FBX model
  const asteroidFBX = useFBX('/models/props/asteroid/asteroid_fly.fbx');
  
  const asteroids = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      // Distribute asteroids all around the playing area
      const angle = (i / count) * Math.PI * 2 + seededRandom() * 0.5;  // Spread around 360Â°
      
      // Varied distances: keep asteroids outside walking area (PLAY_AREA_RADIUS=450)
      const distanceType = i % 3; // Cycle through 3 distance types
      let radius, scale;
      if (distanceType === 0) {
        // Close asteroids - smaller scale, stay outside play area
        radius = 550 + seededRandom() * 500;  // 550-1050 (clear of 450 play area)
        scale = 0.5 + seededRandom() * 1.0;   // 0.5-1.5
      } else if (distanceType === 1) {
        // Medium asteroids - medium scale
        radius = 1100 + seededRandom() * 1000;  // 1100-2100
        scale = 1.0 + seededRandom() * 1.5;     // 1.0-2.5
      } else {
        // Far asteroids - bigger scale for visibility
        radius = 2200 + seededRandom() * 2000;  // 2200-4200
        scale = 2.0 + seededRandom() * 3.0;     // 2.0-5.0
      }
      
      // Mix of asteroids: some start below, some start above
      const startBelow = seededRandom() > 0.5;
      const heightVariation = startBelow 
        ? -1500 + seededRandom() * 1000  // Start below: -1500 to -500
        : 500 + seededRandom() * 2000;   // Start above: +500 to +2500
      
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = heightVariation;
      
      arr.push({
        pos: new THREE.Vector3(x, y, z),
        rot: new THREE.Euler(seededRandom()*Math.PI, seededRandom()*Math.PI, seededRandom()*Math.PI),
        rps: new THREE.Vector3((seededRandom()*0.2-0.1), (seededRandom()*0.2-0.1), (seededRandom()*0.2-0.1)),
        scale: scale,
        risingSpeed: 0.05 + seededRandom() * 0.1,  // Slow rising speed: 0.05 to 0.15
        opacity: 1.0,  // Track opacity for fading
        radius: radius  // Store radius for reference
      });
    }
    return arr;
  }, [count, seededRandom]);

  // Create clones of the FBX model for each asteroid
  const clones = useMemo(() => {
    if (!asteroidFBX) return [];
    const arr = [];
    for (let i = 0; i < count; i++) {
      const clone = skeletonClone(asteroidFBX);
      if (clone) arr.push(clone);
    }
    return arr;
  }, [asteroidFBX, count]);

  useFrame(() => {
    // Use time relative to a fixed reference point (Jan 1, 2025 UTC) 
    // so asteroids loop consistently when rejoining games
    const REFERENCE_TIME = 1735689600; // Unix timestamp for 2025-01-01T00:00:00Z in seconds
    const t = (Date.now() / 1000) - REFERENCE_TIME; // Keep decimal precision for smooth animation
    if (!groupRef.current) return;
    groupRef.current.children.forEach((m, i) => {
      const base = asteroids[i]; if (!base) return;
      
      // Time-based animation (deterministic, not accumulative)
      // Each asteroid gets a time offset based on its index for variety
      const asteroidTime = t + (i * 50); // Offset by index
      
      // Orbital rotation - deterministic based on time
      const orbitSpeed = speed * 0.025; // Increased from 0.018 for faster orbiting
      const baseAngle = Math.atan2(base.pos.z, base.pos.x);
      const angle = baseAngle + (asteroidTime * orbitSpeed);
      
      m.position.x = Math.cos(angle) * base.radius;
      m.position.z = Math.sin(angle) * base.radius;
      
      // Vertical movement — cycle above terrain (2000 to 12000)
      const verticalRange = 10000; // Total range: 2000 to 12000
      const verticalMin = 2000;
      const cycleSpeed = base.risingSpeed * 80;
      const rawPosition = asteroidTime * cycleSpeed;
      const progress = (rawPosition % verticalRange) / verticalRange;
      m.position.y = verticalMin + (progress * verticalRange);
      
      // Fade at extremes of vertical range
      if (m.position.y > 10000) {
        // Fade out near top (10000 to 12000)
        base.opacity = Math.max(0, 1 - (m.position.y - 10000) / 2000);
      } else if (m.position.y < 3500) {
        // Fade in near bottom (2000 to 3500)
        base.opacity = Math.min(1, (m.position.y - 2000) / 1500);
      } else {
        // Fully visible in the mid range (3500 to 10000)
        base.opacity = 1;
      }
      
      // Apply opacity to all materials
      m.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              mat.transparent = true;
              mat.opacity = base.opacity;
            });
          } else {
            child.material.transparent = true;
            child.material.opacity = base.opacity;
          }
        }
      });
      
      // Spinning rotation - time-based for synchronization (faster spin)
      m.rotation.x = base.rot.x + (asteroidTime * base.rps.x * 0.9);
      m.rotation.y = base.rot.y + (asteroidTime * base.rps.y * 0.9);
      m.rotation.z = base.rot.z + (asteroidTime * base.rps.z * 0.9);
    });
  });

  if (!asteroidFBX || clones.length === 0) return null;

  return (
    <group ref={groupRef} renderOrder={-7}>
      {asteroids.map((a, idx) => {
        const clone = clones[idx];
        if (!clone) return null;
        return (
          <primitive 
            key={idx} 
            object={clone} 
            position={a.pos} 
            rotation={a.rot} 
            scale={a.scale}
          />
        );
      })}
    </group>
  );
}

// Dense, small galaxy-like star clusters (hundreds of tight points per cluster)

export function GalaxyClusters({ clusterCount = 7, pointsPerCluster = 600, radius = 720, spread = 0.035, speed = 0.08, dir = [1, 0.25] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const childRefs = useRef([]);
  const axesRef = useRef([]);
  const spinRef = useRef([]);

  const clusters = useMemo(() => {
    const list = [];
    const randOnSphere = () => {
      // Bias to be mostly in the far background (z negative)
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v1 - 1);
        v = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
      } while (v.z > -0.1); // ensure itâ€™s generally behind
      return v.normalize();
    };
    for (let i = 0; i < clusterCount; i++) {
      const dirV = randOnSphere();
      // Build tangent frame (u,v) for sampling on the sphere around dirV
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      // Generate local points around origin; we'll place a group at `center`
      const positions = new Float32Array(pointsPerCluster * 3);
      const colors = new Float32Array(pointsPerCluster * 3);
      // random tilt of cluster disc within its own local frame (rotate u/v basis)
      const tilt = new THREE.Euler(Math.random()*0.6 - 0.3, Math.random()*Math.PI*2.0, Math.random()*0.6 - 0.3);
      const rotM = new THREE.Matrix4().makeRotationFromEuler(tilt);
      const uu = u.clone().applyMatrix4(rotM);
      const vv = v.clone().applyMatrix4(rotM);
      for (let p = 0; p < pointsPerCluster; p++) {
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const gx = r1 * Math.cos(th) * spread * radius;
        const gy = r1 * Math.sin(th) * spread * radius;
        const pos = uu.clone().multiplyScalar(gx).add(vv.clone().multiplyScalar(gy));
        positions[p*3+0] = pos.x; positions[p*3+1] = pos.y; positions[p*3+2] = pos.z;
        const c = 0.92 + Math.random()*0.08;
        colors[p*3+0] = c; colors[p*3+1] = c; colors[p*3+2] = 1.0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // random spin axis and speed per cluster
      const axis = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
      const spin = 0.0003 + Math.random()*0.0007; // slow spin
      list.push({ geometry: g, center, axis, spin });
    }
    return list;
  }, [clusterCount, pointsPerCluster, radius, spread]);

  const mat = useMemo(() => new THREE.PointsMaterial({ size: 4.0, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  // Dispose generated cluster geometries/material on unmount
  useEffect(() => {
    return () => {
      try { mat?.dispose?.(); } catch {}
      try { clusters?.forEach?.(c => c.geometry?.dispose?.()); } catch {}
    };
  }, [mat, clusters]);

  useFrame(() => {
    // Subtle drift and slow rotation to suggest movement
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.0006; // slow yaw
    groupRef.current.position.x += -d.x * speed * 0.5;
    groupRef.current.position.z += -d.y * speed * 0.9;
    // wrap position to prevent drift far from origin
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 800) groupRef.current.position.x = -800;
    if (gx < -800) groupRef.current.position.x = 800;
    if (gz > 800) groupRef.current.position.z = -800;
    if (gz < -800) groupRef.current.position.z = 800;
    // Per-cluster gentle spin
    if (childRefs.current) {
      for (let i = 0; i < childRefs.current.length; i++) {
        const child = childRefs.current[i];
        const axis = axesRef.current[i];
        const s = spinRef.current[i];
        if (child && axis && s) {
          child.rotateOnAxis(axis, s);
        }
      }
    }
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      {clusters.map((c, i) => (
        <group
          key={i}
          position={c.center}
          ref={el => { childRefs.current[i] = el; axesRef.current[i] = c.axis; spinRef.current[i] = c.spin; }}
        >
          <points geometry={c.geometry} material={mat} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Foreground "star swarms": occasional tight clusters of various sizes flying by

export function StarSwarms({ maxSwarms = 5, basePoints = 500, dir = [1.0, 0.25], speed = 0.18, spawnMin = 4, spawnMax = 9 }) {
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const groupRef = useRef();
  const timerRef = useRef(0);
  const nextSpawnRef = useRef((spawnMin + Math.random() * (spawnMax - spawnMin)));

  // Build N reusable swarm groups, each made of 3 point sets (small/med/large)
  const swarms = useMemo(() => {
    const makeGeom = (count, spread) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        // gaussian cluster around origin
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const rx = r1 * Math.cos(th) * spread;
        const ry = r1 * Math.sin(th) * spread * 0.6; // slightly flattened
        pos[i*3+0] = rx;
        pos[i*3+1] = (Math.random()-0.5) * spread * 0.4; // a little thickness
        pos[i*3+2] = ry;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return g;
    };
    const list = [];
    for (let i = 0; i < maxSwarms; i++) {
      // Less clustery, larger spread so it reads as a background galaxy patch
      const small = makeGeom(Math.floor(basePoints * 0.65), 200.0);
      const medium = makeGeom(Math.floor(basePoints * 0.28), 150.0);
      const large = makeGeom(Math.floor(basePoints * 0.12), 100.0);
      list.push({
        small, medium, large,
        state: { active: false, ttl: 0, spd: 0.5 + Math.random()*0.6 },
        ref: React.createRef()
      });
    }
    return list;
  }, [maxSwarms, basePoints]);

  const matSmall = useMemo(() => new THREE.PointsMaterial({ size: 3.0, color: '#e6ecff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matMedium = useMemo(() => new THREE.PointsMaterial({ size: 5.0, color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matLarge = useMemo(() => new THREE.PointsMaterial({ size: 8.0, color: '#fff7df', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  useEffect(() => {
    return () => { try { matSmall?.dispose?.(); matMedium?.dispose?.(); matLarge?.dispose?.(); } catch {} };
  }, [matSmall, matMedium, matLarge]);

  // Spawn a swarm from ahead in travel direction
  const spawnSwarm = useCallback((item) => {
    const g = item.ref.current;
    if (!g) return;
    // Place far in the background sky, outside terrain
    const zStart = -15000 + Math.random()*5000; // [-15000, -10000]
    const startX = (Math.random()-0.5) * 10000; // wide horizontal spread
    const updown = 3000 + (Math.random()-0.3) * 6000; // elevated 0-9000
    g.position.set(startX, updown, zStart);
    item.state.active = true;
    item.state.ttl = 15.0 + Math.random() * 7.0; // seconds
    item.state.spd = 0.6 + Math.random()*0.6;
    g.visible = true;
  }, [d]);

  useFrame((_, delta) => {
    timerRef.current += delta;
    if (timerRef.current >= nextSpawnRef.current) {
      // find an inactive swarm and spawn
      const target = swarms.find(s => !s.state.active);
      if (target) spawnSwarm(target);
      timerRef.current = 0;
      nextSpawnRef.current = (spawnMin + Math.random() * (spawnMax - spawnMin));
    }
    // update active swarms
    swarms.forEach((s) => {
      if (!s.state.active || !s.ref.current) return;
      s.state.ttl -= delta;
      // Drift mostly sideways across the background with minimal depth change
      const perp = new THREE.Vector2(-d.y, d.x);
      const vx = perp.x * speed * s.state.spd * 40.0 * delta;
      const vz = perp.y * speed * s.state.spd * 40.0 * delta + (-d.y * speed * 8.0 * delta);
      s.ref.current.position.x += vx;
      s.ref.current.position.z += vz;
      // Keep within far background band
      if (s.state.ttl <= 0 || Math.abs(s.ref.current.position.x) > 12000 || s.ref.current.position.z < -20000 || s.ref.current.position.z > -8000) {
        s.state.active = false;
        s.ref.current.visible = false;
      }
    });
  });

  return (
    <group ref={groupRef} renderOrder={-6}>
      {swarms.map((s, i) => (
        <group key={i} ref={s.ref} visible={false}>
          <points geometry={s.small} material={matSmall} frustumCulled={false} />
          <points geometry={s.medium} material={matMedium} frustumCulled={false} />
          <points geometry={s.large} material={matLarge} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Very dense galaxy field (~200k points) with tight clusters and mixed sizes

export function DenseGalaxyField({ totalPoints = 220000, clusters = 12, radius = 750, clusterSpread = 0.02, speed = 0.05, dir = [1.0, 0.25], sizeRange = [1.4, 3.6] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Generate cluster centers on far sphere (behind camera mostly)
  const centers = useMemo(() => {
    const arr = [];
    const pickDir = () => {
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2*Math.PI*u;
        const phi = Math.acos(2*v1-1);
        v = new THREE.Vector3(
          Math.sin(phi)*Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi)*Math.sin(theta)
        );
      } while (v.z > -0.05);
      return v.normalize();
    };
    for (let i=0;i<clusters;i++) {
      const dirV = pickDir();
      // build tangent basis
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      arr.push({ dirV, u, v, center, weight: 0.8 + Math.random()*0.6 });
    }
    return arr;
  }, [clusters, radius]);

  // Allocate attributes once with defensive fallback to avoid huge/NaN allocations
  const { geometry } = useMemo(() => {
    // Sanitize and clamp total points
    const maxPts = 350000;
    const minPts = 8000;
    let target = Number(totalPoints);
    if (!Number.isFinite(target) || target <= 0) target = 220000;
    if (process.env.NODE_ENV !== 'production') target = Math.min(target, 180000);
    target = Math.max(minPts, Math.min(maxPts, Math.floor(target)));

    let g = null;
    let attempts = 0;
    while (!g && target >= minPts && attempts < 6) {
      try {
        const positions = new Float32Array(target * 3);
        const colors = new Float32Array(target * 3);
        const sizes = new Float32Array(target);
        // Weighted cluster selection
        const weights = centers.map(c => c.weight);
        const sumW = weights.reduce((a,b)=>a+b,0) || 1;
        for (let i=0;i<target;i++){
          // pick a center
          let r = Math.random()*sumW; let k=0; for(;k<centers.length;k++){ r-=weights[k]; if (r<=0) break; }
          const C = centers[k] || centers[0];
          // 2D gaussian offset in tangent plane
          const r1 = Math.sqrt(-2.0*Math.log(Math.max(1e-6, Math.random())));
          const th = 2.0*Math.PI*Math.random();
          const gx = r1*Math.cos(th)*clusterSpread*radius;
          const gy = r1*Math.sin(th)*clusterSpread*radius*0.75;
          const pos = C.center.clone().add(C.u.clone().multiplyScalar(gx)).add(C.v.clone().multiplyScalar(gy));
          const npos = pos.normalize().multiplyScalar(radius);
          const idx = i*3;
          positions[idx+0]=npos.x; positions[idx+1]=npos.y; positions[idx+2]=npos.z;
          // color with slight blue-white variance
          const c = 0.9 + Math.random()*0.1;
          colors[idx+0]=c; colors[idx+1]=c; colors[idx+2]=1.0;
          // size: more small than large
          const tsize = Math.pow(Math.random(), 2.2); // bias small
          sizes[i] = sizeRange[0] + (sizeRange[1]-sizeRange[0]) * tsize;
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(positions,3));
        gg.setAttribute('color', new THREE.BufferAttribute(colors,3));
        gg.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));
        g = gg;
      } catch (e) {
        try { console.warn('[DenseGalaxyField] allocation failed for', target, 'points; reducing.', e?.message || e); } catch {}
        target = Math.floor(target * 0.6);
        attempts++;
      }
    }
    if (!g) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(minPts),1));
      return { geometry: gg };
    }
    return { geometry: g };
  }, [totalPoints, centers, clusterSpread, radius, sizeRange]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1.0 },
    },
    vertexShader: `
      attribute float aSize; varying vec3 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float size = aSize * (300.0 / max(1.0, dist));
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vColor; uniform float uOpacity;
      void main(){
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float r = dot(uv, uv);
        float alpha = smoothstep(1.0, 0.0, r);
        vec3 col = vColor * 1.15;
        gl_FragColor = vec4(col, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  // Cleanup to reduce memory pressure during hot reloads
  useEffect(() => {
    return () => {
      try { geometry?.dispose?.(); } catch {}
      try { material?.dispose?.(); } catch {}
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.00035; // slow yaw
    groupRef.current.position.x += -d.x * speed * 30.0 * delta;
    groupRef.current.position.z += -d.y * speed * 60.0 * delta;
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 800) groupRef.current.position.x = -800;
    if (gx < -800) groupRef.current.position.x = 800;
    if (gz > 800) groupRef.current.position.z = -800;
    if (gz < -800) groupRef.current.position.z = 800;
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

// Shooting stars / meteor streaks that flash across the sky periodically

export function ShootingStars({ maxActive = 2, minInterval = 3, maxInterval = 8 }) {
  const groupRef = useRef();
  const timerRef = useRef(0);
  const nextRef = useRef(minInterval + Math.random() * (maxInterval - minInterval));

  // Pre-allocate streak data
  const streaks = useMemo(() => {
    const list = [];
    for (let i = 0; i < maxActive; i++) {
      list.push({
        ref: React.createRef(),
        state: { active: false, age: 0, lifetime: 0 },
        startPos: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      });
    }
    return list;
  }, [maxActive]);

  // Trail geometry: thin stretched quad (2 triangles) for each streak
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // 4 vertices forming a thin ribbon
    const positions = new Float32Array(4 * 3);
    const uvs = new Float32Array(4 * 2);
    uvs[0] = 0; uvs[1] = 0;
    uvs[2] = 1; uvs[3] = 0;
    uvs[4] = 1; uvs[5] = 1;
    uvs[6] = 0; uvs[7] = 1;
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, []);

  const trailMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uOpacity;
      void main(){
        // Trail fades from bright head to transparent tail
        float fade = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        // Thin across the width
        float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        vec3 col = mix(vec3(1.0, 0.95, 0.8), vec3(0.8, 0.85, 1.0), vUv.x);
        float alpha = fade * edge * uOpacity;
        gl_FragColor = vec4(col * 1.5, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }), []);

  useEffect(() => {
    return () => {
      try { trailGeo?.dispose?.(); } catch {}
      try { trailMat?.dispose?.(); } catch {}
    };
  }, [trailGeo, trailMat]);

  const spawnStreak = useCallback((streak) => {
    const g = streak.ref.current;
    if (!g) return;
    // Random sky position: high up, anywhere around
    const angle = Math.random() * Math.PI * 2;
    const dist = 8000 + Math.random() * 10000;
    const y = 6000 + Math.random() * 10000;
    streak.startPos.set(
      Math.cos(angle) * dist,
      y,
      Math.sin(angle) * dist
    );
    // Fast diagonal velocity
    const speed = 3000 + Math.random() * 4000;
    const vAngle = angle + Math.PI * 0.3 + Math.random() * 0.4;
    streak.velocity.set(
      Math.cos(vAngle) * speed,
      -speed * (0.3 + Math.random() * 0.4), // downward
      Math.sin(vAngle) * speed
    );
    streak.state.active = true;
    streak.state.age = 0;
    streak.state.lifetime = 0.4 + Math.random() * 0.5; // 0.4-0.9 seconds
    g.visible = true;
  }, []);

  useFrame((_, delta) => {
    timerRef.current += delta;
    if (timerRef.current >= nextRef.current) {
      const target = streaks.find(s => !s.state.active);
      if (target) spawnStreak(target);
      timerRef.current = 0;
      nextRef.current = minInterval + Math.random() * (maxInterval - minInterval);
    }

    // Update active streaks
    streaks.forEach((s) => {
      if (!s.state.active || !s.ref.current) return;
      s.state.age += delta;
      const t = s.state.age / s.state.lifetime;
      if (t >= 1) {
        s.state.active = false;
        s.ref.current.visible = false;
        return;
      }

      // Current head position
      const head = s.startPos.clone().addScaledVector(s.velocity, s.state.age);
      // Trail tail (slightly behind)
      const trailLen = 600 + Math.random() * 200;
      const dir = s.velocity.clone().normalize();
      const tail = head.clone().addScaledVector(dir, -trailLen);

      // Build thin ribbon perpendicular to camera view
      const cam = new THREE.Vector3(0, 0, 0); // approximate camera at origin
      const toHead = head.clone().sub(cam).normalize();
      const cross = new THREE.Vector3().crossVectors(dir, toHead).normalize().multiplyScalar(15); // ribbon half-width

      const pos = s.ref.current.geometry?.getAttribute?.('position');
      if (!pos) return;
      // tail-left, tail-right, head-right, head-left
      pos.setXYZ(0, tail.x - cross.x, tail.y - cross.y, tail.z - cross.z);
      pos.setXYZ(1, tail.x + cross.x, tail.y + cross.y, tail.z + cross.z);
      pos.setXYZ(2, head.x + cross.x, head.y + cross.y, head.z + cross.z);
      pos.setXYZ(3, head.x - cross.x, head.y - cross.y, head.z - cross.z);
      pos.needsUpdate = true;

      // Fade in then out
      const opacity = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85);
      if (s.ref.current.material) {
        s.ref.current.material.uniforms.uOpacity.value = Math.max(0, opacity);
      }
    });
  });

  return (
    <group ref={groupRef} renderOrder={-5}>
      {streaks.map((s, i) => (
        <mesh key={i} ref={s.ref} visible={false} geometry={trailGeo} material={trailMat} frustumCulled={false} />
      ))}
    </group>
  );
}
