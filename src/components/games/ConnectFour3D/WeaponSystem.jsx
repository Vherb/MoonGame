import React, { useRef, useMemo, useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useFBX, useTexture, PositionalAudio, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';

// Weapon definitions
export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    damage: 25,
    fireRate: 0.5, // seconds between shots
    ammo: 12,
    maxAmmo: 12,
    reloadTime: 1.5,
    bulletSpeed: 600, // units per second
    bulletType: 'instant', // instant raycast or 'projectile'
    modelPath: '/models/props/weapons/pistol.fbx',
    soundPath: '/sounds/weapons/pistol_shot.mp3',
    recoil: { x: 0.02, y: 0.05 },
    spread: 0.01,
  },
  rifle: {
    name: 'Rifle',
    damage: 35,
    fireRate: 0.15, // faster fire rate
    ammo: 30,
    maxAmmo: 30,
    reloadTime: 2.0,
    bulletSpeed: 800,
    bulletType: 'instant',
    modelPath: '/models/props/weapons/rifle.fbx',
    soundPath: '/sounds/weapons/rifle_shot.mp3',
    recoil: { x: 0.03, y: 0.06 },
    spread: 0.005,
  },
  shotgun: {
    name: 'Shotgun',
    damage: 15, // per pellet
    pellets: 5, // fires multiple pellets
    fireRate: 0.8, // slow fire rate
    ammo: 6,
    maxAmmo: 6,
    reloadTime: 2.5,
    bulletSpeed: 500,
    bulletType: 'instant',
    modelPath: '/models/props/weapons/shotgun.fbx',
    soundPath: '/sounds/weapons/shotgun_shot.mp3',
    recoil: { x: 0.08, y: 0.15 },
    spread: 0.05, // large spread
  },
};

// ── Module-level cached hit-target list ─────────────────────────────────────
let _hitTargets = [];
let _hitTargetTime = -1;
function getHitTargets(scene) {
  const t = performance.now();
  if (t - _hitTargetTime < 16) return _hitTargets;  // cache for one full frame (~16ms)
  _hitTargetTime = t;
  _hitTargets = [];
  scene.traverse(obj => {
    if (!obj.isMesh) return;
    const ud = obj.userData;
    if (ud && (ud.isPlayer || ud.isTerrain || ud.isDestructible)) _hitTargets.push(obj);
  });
  return _hitTargets;
}

// Simple weapon model component (box placeholder until actual models are added)
export function WeaponModel({ weaponType = 'pistol', position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const weapon = WEAPONS[weaponType];
  
  // Try to load actual model if it exists, otherwise use placeholder
  // const model = useFBX(weapon.modelPath);
  
  // Placeholder geometry for now
  const geometry = useMemo(() => {
    if (weaponType === 'pistol') {
      return <boxGeometry args={[0.15, 0.25, 0.4]} />;
    } else if (weaponType === 'rifle') {
      return <boxGeometry args={[0.12, 0.2, 0.8]} />;
    } else if (weaponType === 'shotgun') {
      return <boxGeometry args={[0.15, 0.25, 0.7]} />;
    }
    return <boxGeometry args={[0.15, 0.25, 0.4]} />;
  }, [weaponType]);
  
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow receiveShadow>
        {geometry}
        <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

// Bullet/Projectile component – with raycasting hit detection
export function Bullet({ 
  id,
  position = [0, 0, 0], 
  direction = [0, 0, -1], 
  speed = 100, 
  damage = 25,
  ownerId = null,
  onHit = null,
  onExpire = null,
  maxDistance = 200
}) {
  const ref = useRef();
  // Pre-compute direction & velocity once — reuse _moveVec every frame (zero per-frame alloc)
  const dirNorm = useMemo(() => new THREE.Vector3(...direction).normalize(), [direction]);
  const velocity = useMemo(() => dirNorm.clone().multiplyScalar(speed), [dirNorm, speed]);
  const _moveVec = useMemo(() => new THREE.Vector3(), []);
  const traveledDistance = useRef(0);
  const startTime = useRef(performance.now());
  const { scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dead = useRef(false); // prevents double-fire of callbacks

  // Set initial position ONCE on mount via ref — NOT as a JSX prop.
  // R3F re-applies position props on every re-render, which would snap
  // in-flight bullets back to their spawn point whenever weapon state
  // changes (e.g. firing another bullet, aiming, reloading).
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.position.set(position[0], position[1], position[2]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps = mount only
  
  useFrame((_, delta) => {
    if (!ref.current || dead.current) return;

    // Reuse vector — zero allocation per frame
    _moveVec.copy(velocity).multiplyScalar(delta);
    const moveLen = _moveVec.length();

    // Skip raycasting for bullets high in the sky (no targets up there)
    const bulletY = ref.current.position.y;
    if (bulletY < 150) {
      // ── Check enemy proximity (distance-based, using published enemy positions) ──
      const enemies = window.__CF_ENEMIES__;
      if (enemies && enemies.length > 0) {
        const bp = ref.current.position;
        for (const e of enemies) {
          const dx = bp.x - e.x;
          const dy = bp.y - (e.y + e.height * 0.5);
          const dz = bp.z - e.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          const hitRadius = (e.radius || 4) + 1.0;
          if (distSq < hitRadius * hitRadius) {
            dead.current = true;
            // Push to the global enemy hit queue consumed by EnemyWaveSystem
            if (!window.__CF_ENEMY_BULLET_HITS__) window.__CF_ENEMY_BULLET_HITS__ = [];
            window.__CF_ENEMY_BULLET_HITS__.push({ enemyId: e.id, damage });
            // Also fire onHit so bullet visuals (impact spark) appear
            if (onHit) {
              onHit({
                id,
                point: bp.clone(),
                hitObject: { userData: { isEnemy: true, enemyId: e.id } },
                normal: new THREE.Vector3(0, 1, 0),
                damage,
                ownerId,
              });
            }
            return;
          }
        }
      }

      const allTargets = getHitTargets(scene);
      if (allTargets.length > 0) {
        raycaster.set(ref.current.position, dirNorm);
        raycaster.far = moveLen + 1.0;
        raycaster.near = 0;
        const hits = raycaster.intersectObjects(allTargets, false);
        if (hits.length > 0) {
          const hit = ownerId
            ? hits.find(h => !(h.object.userData.isPlayer && h.object.userData.playerId === ownerId))
            : hits[0];
          if (hit) {
            dead.current = true;
            if (onHit) {
              onHit({
                id,
                point: hit.point,
                hitObject: hit.object,
                normal: hit.face?.normal || new THREE.Vector3(0, 1, 0),
                damage,
                ownerId,
              });
            }
            return;
          }
        }
      }
    }

    // ---- Move bullet forward ----
    ref.current.position.add(_moveVec);
    traveledDistance.current += moveLen;

    // Auto-expire after max distance or 2 s failsafe
    if (traveledDistance.current > maxDistance || performance.now() - startTime.current > 2000) {
      dead.current = true;
      if (onExpire) onExpire(id);
    }
  });
  
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.08, 4, 3]} />
      <meshBasicMaterial color="#ffdd44" />
    </mesh>
  );
}

// Muzzle flash effect
export function MuzzleFlash({ position = [0, 0, 0], active = false, onComplete = null }) {
  const ref = useRef();
  const materialRef = useRef();
  const [opacity, setOpacity] = useState(1);
  const activeTime = useRef(0);
  const { camera } = useThree();
  
  useFrame((_, delta) => {
    if (!active) return;
    
    activeTime.current += delta;
    
    // Flash lasts 0.1 seconds
    if (activeTime.current > 0.1) {
      activeTime.current = 0;
      if (onComplete) onComplete();
      return;
    }
    
    // Fade out quickly
    const newOpacity = 1 - (activeTime.current / 0.1);
    setOpacity(newOpacity);
    
    // Billboard effect - manually rotate to face camera
    if (ref.current && camera) {
      ref.current.quaternion.copy(camera.quaternion);
    }
  });
  
  if (!active) return null;
  
  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[0.5, 0.5]} />
      <meshBasicMaterial 
        ref={materialRef}
        color="#ffaa00" 
        transparent={true}
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Weapon sound effect
export function WeaponSound({ weaponType = 'pistol', position = [0, 0, 0], playTrigger = 0 }) {
  const audioRef = useRef();
  const lastTrigger = useRef(0);
  
  useEffect(() => {
    if (playTrigger !== lastTrigger.current && audioRef.current) {
      try {
        audioRef.current.stop();
        audioRef.current.play();
        lastTrigger.current = playTrigger;
      } catch (e) {
        console.warn('Failed to play weapon sound:', e);
      }
    }
  }, [playTrigger]);
  
  const weapon = WEAPONS[weaponType];
  
  return (
    <group position={position}>
      <PositionalAudio 
        ref={audioRef}
        url={weapon.soundPath}
        distance={50}
        autoplay={false}
      />
    </group>
  );
}

// ── Lazer Rifle FBX model (shared by FPS view + 3rd-person avatar) ──
const RIFLE_FBX = '/models/props/guns/lazer_rifle/Meshy_AI_lazer_rifle_0224032909_texture.fbx';
const RIFLE_TEX_BASE = '/models/props/guns/lazer_rifle/Meshy_AI_lazer_rifle_0224032909_texture';

export function LazerRifleModel({ scale = 1, position = [0,0,0], rotation = [0,0,0], visible = true }) {
  const fbx = useFBX(RIFLE_FBX);
  const [diffuse, normal, roughness, metalness] = useTexture([
    `${RIFLE_TEX_BASE}.png`,
    `${RIFLE_TEX_BASE}_normal.png`,
    `${RIFLE_TEX_BASE}_roughness.png`,
    `${RIFLE_TEX_BASE}_metallic.png`,
  ]);
  const rifleClone = useMemo(() => {
    if (!fbx) return null;
    const clone = fbx.clone(true);
    clone.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          map: diffuse,
          normalMap: normal,
          roughnessMap: roughness,
          metalnessMap: metalness,
          metalness: 0.7,
          roughness: 0.4,
        });
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [fbx, diffuse, normal, roughness, metalness]);
  if (!rifleClone) return null;
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  return (
    <group position={position} rotation={rotation} scale={s} visible={visible}>
      <primitive object={rifleClone} dispose={null} />
    </group>
  );
}

// Simple visible gun model (FPS view)
export function SimpleGun({ recoilAmount = 0 }) {
  const groupRef = useRef();
  const { camera } = useThree();
  
  useFrame(() => {
    if (!groupRef.current || !camera) return;
    
    // Position gun relative to camera (bottom-right of screen)
    const gunOffset = new THREE.Vector3(0.4, -0.3, -0.8);
    const worldOffset = gunOffset.applyQuaternion(camera.quaternion);
    groupRef.current.position.copy(camera.position).add(worldOffset);
    groupRef.current.quaternion.copy(camera.quaternion);
    
    // Apply recoil
    if (recoilAmount > 0) {
      groupRef.current.position.z += recoilAmount * 0.05;
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Gun barrel */}
      <mesh position={[0, 0, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
        <meshBasicMaterial color={'#4a5568'} />
      </mesh>
      {/* Gun body */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[0.08, 0.12, 0.25]} />
        <meshBasicMaterial color={'#2d3748'} />
      </mesh>
      {/* Cyan energy core */}
      <mesh position={[0, -0.05, -0.15]}>
        <boxGeometry args={[0.06, 0.06, 0.08]} />
        <meshBasicMaterial color={'#00ffff'} />
      </mesh>
      {/* Grip */}
      <mesh position={[0, -0.15, 0.05]} rotation={[-0.3, 0, 0]}>
        <boxGeometry args={[0.06, 0.15, 0.08]} />
        <meshBasicMaterial color={'#1a202c'} />
      </mesh>
    </group>
  );
}

// Crosshair/Reticle component (2D overlay)
export function Crosshair({ isAiming = false, spread = 0.01 }) {
  const spreadPixels = spread * 1000; // Convert to screen space
  
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 9999,
    }}>
      {/* Center dot */}
      <div style={{
        position: 'absolute',
        width: '4px',
        height: '4px',
        background: isAiming ? '#00ff00' : '#ffffff',
        borderRadius: '50%',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        boxShadow: '0 0 2px rgba(0,0,0,0.8)',
      }} />
      
      {/* Top line */}
      <div style={{
        position: 'absolute',
        width: '2px',
        height: '10px',
        background: isAiming ? '#00ff00' : '#ffffff',
        top: `calc(50% - ${10 + spreadPixels}px)`,
        left: '50%',
        transform: 'translateX(-50%)',
        boxShadow: '0 0 2px rgba(0,0,0,0.8)',
      }} />
      
      {/* Bottom line */}
      <div style={{
        position: 'absolute',
        width: '2px',
        height: '10px',
        background: isAiming ? '#00ff00' : '#ffffff',
        top: `calc(50% + ${spreadPixels}px)`,
        left: '50%',
        transform: 'translateX(-50%)',
        boxShadow: '0 0 2px rgba(0,0,0,0.8)',
      }} />
      
      {/* Left line */}
      <div style={{
        position: 'absolute',
        width: '10px',
        height: '2px',
        background: isAiming ? '#00ff00' : '#ffffff',
        top: '50%',
        left: `calc(50% - ${10 + spreadPixels}px)`,
        transform: 'translateY(-50%)',
        boxShadow: '0 0 2px rgba(0,0,0,0.8)',
      }} />
      
      {/* Right line */}
      <div style={{
        position: 'absolute',
        width: '10px',
        height: '2px',
        background: isAiming ? '#00ff00' : '#ffffff',
        top: '50%',
        left: `calc(50% + ${spreadPixels}px)`,
        transform: 'translateY(-50%)',
        boxShadow: '0 0 2px rgba(0,0,0,0.8)',
      }} />
    </div>
  );
}

// Scope overlay — full-screen sniper scope when ADS
export function ScopeOverlay({ active = false }) {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setOpacity(1), 50);
      return () => clearTimeout(t);
    } else {
      setOpacity(0);
    }
  }, [active]);

  // Mil-dot markers along the crosshair lines
  const milDots = useMemo(() => {
    const dots = [];
    // Horizontal mil dots (left and right of center)
    for (let i = 1; i <= 4; i++) {
      const pct = 50 + i * 6;
      const pctL = 50 - i * 6;
      dots.push(<div key={`h${i}r`} className="scope-mil-h" style={{ left: `${pct}%` }} />);
      dots.push(<div key={`h${i}l`} className="scope-mil-h" style={{ left: `${pctL}%` }} />);
    }
    // Vertical mil dots (above and below center)
    for (let i = 1; i <= 4; i++) {
      const pct = 50 + i * 6;
      const pctT = 50 - i * 6;
      dots.push(<div key={`v${i}d`} className="scope-mil-v" style={{ top: `${pct}%` }} />);
      dots.push(<div key={`v${i}u`} className="scope-mil-v" style={{ top: `${pctT}%` }} />);
    }
    return dots;
  }, []);

  return (
    <div className="scope-overlay" style={{ opacity }}>
      <div className="scope-vignette">
        <div className="scope-lens" />
      </div>
      <div className="scope-crosshair">
        {milDots}
        <div className="scope-dot" />
      </div>
    </div>
  );
}

// Combat UI overlay
export function CombatUI({ 
  currentWeapon = 'pistol',
  ammo = 12,
  maxAmmo = 12,
  health = 100,
  maxHealth = 100,
  isReloading = false,
  killFeed = []
}) {
  const weapon = WEAPONS[currentWeapon];
  
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      pointerEvents: 'none',
      padding: '20px',
      zIndex: 9998,
    }}>
      {/* Health bar (bottom left) */}
      <div style={{
        position: 'absolute',
        bottom: '120px',
        left: '40px',
      }}>
        <div style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: health > 50 ? '#00ff00' : health > 25 ? '#ffaa00' : '#ff0000',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
          marginBottom: '8px',
        }}>
          HP: {health}/{maxHealth}
        </div>
        <div style={{
          width: '300px',
          height: '30px',
          background: 'rgba(0,0,0,0.7)',
          border: '3px solid rgba(255,255,255,0.5)',
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${(health / maxHealth) * 100}%`,
            height: '100%',
            background: `linear-gradient(to right, 
              ${health > 50 ? '#00ff00' : health > 25 ? '#ffaa00' : '#ff0000'},
              ${health > 50 ? '#00aa00' : health > 25 ? '#ff8800' : '#cc0000'})`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>
      
      {/* Weapon info (bottom right) */}
      <div style={{
        position: 'absolute',
        bottom: '120px',
        right: '40px',
        textAlign: 'right',
      }}>
        <div style={{
          fontSize: '28px',
          fontWeight: 'bold',
          color: '#ffffff',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
          marginBottom: '8px',
        }}>
          {weapon.name}
        </div>
        <div style={{
          fontSize: '42px',
          fontWeight: 'bold',
          color: ammo === 0 ? '#ff0000' : '#00ff00',
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        }}>
          {isReloading ? 'RELOADING...' : `${ammo} / ${maxAmmo}`}
        </div>
        {ammo === 0 && !isReloading && (
          <div style={{
            fontSize: '20px',
            color: '#ff0000',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
            animation: 'pulse 1s infinite',
          }}>
            Press R to Reload
          </div>
        )}
      </div>
      
      {/* Kill feed (top right) */}
      {killFeed.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          maxWidth: '300px',
        }}>
          {killFeed.slice(-5).map((feed, i) => (
            <div 
              key={i}
              style={{
                background: 'rgba(0,0,0,0.7)',
                padding: '8px 12px',
                marginBottom: '5px',
                borderRadius: '5px',
                fontSize: '14px',
                color: '#ffffff',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              {feed}
            </div>
          ))}
        </div>
      )}
      
      {/* Weapon wheel hint (center bottom) */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '14px',
        color: 'rgba(255,255,255,0.7)',
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
      }}>
        [1] Pistol | [2] Rifle | [3] Shotgun | [R] Reload
      </div>
    </div>
  );
}

// Hit marker (appears when you hit an enemy)
export function HitMarker({ hits = [] }) {
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 9999,
    }}>
      {hits.map((hit, i) => (
        <div
          key={hit.id || i}
          style={{
            position: 'absolute',
            color: '#ff0000',
            fontSize: '48px',
            fontWeight: 'bold',
            textShadow: '0 0 10px rgba(255,0,0,0.8)',
            animation: 'hitMarkerFade 0.5s ease-out forwards',
            top: `${hit.offsetY || 0}px`,
            left: `${hit.offsetX || 0}px`,
          }}
        >
          ✕
        </div>
      ))}
    </div>
  );
}

// Bullet impact spark — small 3D flash at hit location that fades quickly
export function BulletImpact({ position = [0,0,0], color = '#ffffff' }) {
  const ref = useRef();
  const startTime = useRef(performance.now());

  useFrame(() => {
    if (!ref.current) return;
    const elapsed = (performance.now() - startTime.current) / 1000;
    const scale = 1 + elapsed * 8; // expand outward
    ref.current.scale.setScalar(scale);
    const opacity = Math.max(0, 1 - elapsed * 2.5); // fade in ~0.4s
    if (ref.current.children[0]?.material) {
      ref.current.children[0].material.opacity = opacity;
    }
    if (ref.current.children[1]?.material) {
      ref.current.children[1].material.opacity = opacity * 0.5;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.8, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Damage flash overlay — fullscreen red flash when taking damage
export function DamageFlash({ active = false }) {
  if (!active) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'radial-gradient(ellipse at center, transparent 30%, rgba(255,0,0,0.4) 100%)',
      pointerEvents: 'none',
      zIndex: 10000,
      animation: 'damageFlashFade 0.3s ease-out forwards',
    }} />
  );
}

// Death screen overlay — shown when health reaches 0
export function DeathScreen({ active = false }) {
  if (!active) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(139, 0, 0, 0.6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 10001,
    }}>
      <div style={{
        fontSize: '64px',
        fontWeight: 'bold',
        color: '#ff0000',
        textShadow: '0 0 30px rgba(255,0,0,0.8), 0 0 60px rgba(255,0,0,0.4)',
        marginBottom: '20px',
      }}>
        YOU DIED
      </div>
      <div style={{
        fontSize: '24px',
        color: '#ffffff',
        textShadow: '0 0 10px rgba(0,0,0,0.8)',
      }}>
        Respawning...
      </div>
    </div>
  );
}
