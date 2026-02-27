import { useState, useRef, useCallback, useEffect } from 'react';
import { WEAPONS } from './WeaponSystem';

// Module-level health tracking for remote players (avoids re-render churn)
const _playerHealthMap = {};

/**
 * Custom hook for managing weapon state and shooting mechanics
 * ADAPTED FOR 3RD PERSON CONTROLLER GAMEPLAY
 * Uses RT (Right Trigger) for shooting, LT (Left Trigger) for aiming
 * D-pad for weapon switching
 */
export function useWeaponSystem({ 
  enabled = true,
  gamepadState = null, // Pass gamepad state ref from PlayerMover
  onShoot = null,
  onWeaponChange = null,
  onReload = null,
  onPlayerHit = null,  // callback(targetPlayerId, damage, hitPoint) — for multiplayer
  initialWeapon = 'pistol'
}) {
  // Current weapon state
  const [currentWeapon, setCurrentWeapon] = useState(initialWeapon);
  const [ammo, setAmmo] = useState(WEAPONS[initialWeapon].ammo);
  const [isReloading, setIsReloading] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  
  // Shooting cooldown
  const lastShotTime = useRef(0);
  const reloadTimeoutRef = useRef(null);
  
  // Bullet management
  const [bullets, setBullets] = useState([]);
  const bulletIdCounter = useRef(0);
  
  // Muzzle flash
  const [showMuzzleFlash, setShowMuzzleFlash] = useState(false);
  const [weaponSoundTrigger, setWeaponSoundTrigger] = useState(0);
  
  // Hit markers
  const [hitMarkers, setHitMarkers] = useState([]);
  
  // Player health
  const [health, setHealth] = useState(100);
  const [maxHealth] = useState(100);
  
  // Kill feed
  const [killFeed, setKillFeed] = useState([]);

  // Impact effects (visual sparks/decals at hit locations)
  const [impacts, setImpacts] = useState([]);

  // Damage flash overlay (red flash when taking damage)
  const [damageFlash, setDamageFlash] = useState(false);

  // Death state
  const [isDead, setIsDead] = useState(false);
  const respawnTimerRef = useRef(null);
  
  // Get current weapon config
  const weapon = WEAPONS[currentWeapon];
  
  /**
   * Switch to a different weapon
   */
  const switchWeapon = useCallback((weaponType) => {
    if (!WEAPONS[weaponType] || weaponType === currentWeapon) return;
    
    // Cancel reload if switching weapons
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }
    
    setCurrentWeapon(weaponType);
    setAmmo(WEAPONS[weaponType].ammo);
    setIsReloading(false);
    
    if (onWeaponChange) {
      onWeaponChange(weaponType);
    }
  }, [currentWeapon, onWeaponChange]);
  
  /**
   * Start reloading
   */
  const reload = useCallback(() => {
    if (isReloading || ammo === weapon.maxAmmo) return;
    
    setIsReloading(true);
    
    if (onReload) {
      onReload(currentWeapon);
    }
    
    reloadTimeoutRef.current = setTimeout(() => {
      setAmmo(weapon.maxAmmo);
      setIsReloading(false);
      reloadTimeoutRef.current = null;
    }, weapon.reloadTime * 1000);
  }, [isReloading, ammo, weapon, currentWeapon, onReload]);
  
  /**
   * Shoot weapon
   */
  const shoot = useCallback((shooterPosition, direction, ownerId) => {
    if (!enabled || isReloading || ammo === 0) return false;
    
    const now = Date.now() / 1000;
    if (now - lastShotTime.current < weapon.fireRate) return false;
    
    lastShotTime.current = now;
    
    // Decrease ammo
    setAmmo(prev => Math.max(0, prev - 1));
    
    // Show muzzle flash
    setShowMuzzleFlash(true);
    setTimeout(() => setShowMuzzleFlash(false), 100);
    
    // Play sound
    setWeaponSoundTrigger(prev => prev + 1);
    
    // Handle different weapon types
    if (weapon.bulletType === 'instant') {
      // Instant raycast weapons (pistol, rifle)
      if (weapon.pellets) {
        // Shotgun — batch ALL pellets into a single state update
        const newPellets = [];
        for (let i = 0; i < weapon.pellets; i++) {
          const spreadX = (Math.random() - 0.5) * weapon.spread;
          const spreadY = (Math.random() - 0.5) * weapon.spread;
          const bulletDir = [
            direction[0] + spreadX,
            direction[1] + spreadY,
            direction[2]
          ];
          const len = Math.sqrt(bulletDir[0]**2 + bulletDir[1]**2 + bulletDir[2]**2);
          bulletDir[0] /= len;
          bulletDir[1] /= len;
          bulletDir[2] /= len;
          newPellets.push({
            id: `bullet_${bulletIdCounter.current++}`,
            position: [...shooterPosition],
            direction: bulletDir,
            speed: weapon.bulletSpeed,
            damage: weapon.damage,
            ownerId
          });
        }
        setBullets(prev => [...prev, ...newPellets].slice(-24));
      } else {
        // Single shot weapons
        const spreadX = (Math.random() - 0.5) * weapon.spread;
        const spreadY = (Math.random() - 0.5) * weapon.spread;
        const bulletDir = [
          direction[0] + spreadX,
          direction[1] + spreadY,
          direction[2]
        ];
        
        // Normalize direction
        const len = Math.sqrt(bulletDir[0]**2 + bulletDir[1]**2 + bulletDir[2]**2);
        bulletDir[0] /= len;
        bulletDir[1] /= len;
        bulletDir[2] /= len;
        
        const bulletId = `bullet_${bulletIdCounter.current++}`;
        setBullets(prev => {
          const next = [...prev, {
            id: bulletId,
            position: [...shooterPosition],
            direction: bulletDir,
            speed: weapon.bulletSpeed,
            damage: weapon.damage,
            ownerId
          }];
          return next.length > 24 ? next.slice(-24) : next;
        });
      }
    }
    
    if (onShoot) {
      onShoot({
        weapon: currentWeapon,
        position: shooterPosition,
        direction,
        timestamp: now
      });
    }
    
    return true;
  }, [enabled, isReloading, ammo, weapon, currentWeapon, onShoot]);
  
  /**
   * Remove bullet when it expires or hits something
   */
  const removeBullet = useCallback((bulletId) => {
    setBullets(prev => prev.filter(b => b.id !== bulletId));
  }, []);
  
  /**
   * Add entry to kill feed
   */
  const addKillFeedEntry = useCallback((message) => {
    setKillFeed(prev => {
      const newFeed = [...prev, message];
      // Keep only last 5 entries
      return newFeed.slice(-5);
    });
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setKillFeed(prev => prev.filter(m => m !== message));
    }, 5000);
  }, []);

  /**
   * Handle bullet hit — players, terrain, destructible props
   */
  const handleBulletHit = useCallback((hitInfo) => {
    const { id, point, hitObject, damage: bulletDamage, ownerId } = hitInfo;
    const ud = hitObject?.userData || {};

    // Remove bullet regardless of hit type
    removeBullet(id);

    // --- Enemy hit (PvE) — damage already applied via window.__CF_ENEMY_BULLET_HITS__ ---
    if (ud.isEnemy) {
      // Show hit marker
      const markerId = `hit_${Date.now()}_${Math.random()}`;
      setHitMarkers(prev => [...prev, {
        id: markerId,
        offsetX: (Math.random() - 0.5) * 20,
        offsetY: (Math.random() - 0.5) * 20
      }]);
      setTimeout(() => setHitMarkers(prev => prev.filter(m => m.id !== markerId)), 500);

      // Impact spark at hit point
      if (point) {
        const impactId = `impact_${Date.now()}_${Math.random()}`;
        setImpacts(prev => {
          const next = [...prev, { id: impactId, position: [point.x, point.y, point.z], color: '#ff8800', type: 'enemy' }];
          return next.length > 8 ? next.slice(-8) : next;
        });
        setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== impactId)), 600);
      }
      return;
    }

    // --- Player hit ---
    if (ud.isPlayer) {
      // Add hit marker "✕" at screen center
      const markerId = `hit_${Date.now()}_${Math.random()}`;
      setHitMarkers(prev => [...prev, {
        id: markerId,
        offsetX: (Math.random() - 0.5) * 20,
        offsetY: (Math.random() - 0.5) * 20
      }]);
      setTimeout(() => {
        setHitMarkers(prev => prev.filter(m => m.id !== markerId));
      }, 500);

      // Notify multiplayer layer
      const targetId = ud.playerId || 'unknown';
      if (onPlayerHit) {
        onPlayerHit(targetId, bulletDamage, point);
      }

      // ── Track per-player health locally so we can trigger death ──
      if (targetId && targetId !== 'unknown') {
        if (!_playerHealthMap[targetId]) _playerHealthMap[targetId] = 100;
        _playerHealthMap[targetId] = Math.max(0, _playerHealthMap[targetId] - (bulletDamage || 25));
        // When target reaches 0 hp, broadcast their death via the avatar global
        if (_playerHealthMap[targetId] <= 0) {
          // Tell remote avatar to play dying animation
          window.dispatchEvent(new CustomEvent('cf:player_killed', { detail: { playerId: targetId } }));
          // Respawn them after 3s
          setTimeout(() => { _playerHealthMap[targetId] = 100; }, 3000);
        }
      }

      // Also apply damage to our own weapon system when WE get hit (local testing)
      // (The shooter detects the hit, so dispatch damage to the target's local client)
      window.dispatchEvent(new CustomEvent('cf:remote_player_hit', { detail: { targetId, damage: bulletDamage, point } }));

      // Impact spark at hit point (cap at 8)
      const impactId = `impact_${Date.now()}_${Math.random()}`;
      setImpacts(prev => {
        const next = [...prev, { id: impactId, position: [point.x, point.y, point.z], color: '#ff4444', type: 'player' }];
        return next.length > 8 ? next.slice(-8) : next;
      });
      setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== impactId)), 600);
      return;
    }

    // --- Destructible prop hit ---
    if (ud.isDestructible) {
      // Reduce prop health
      ud.health = (ud.health || 100) - (bulletDamage || 25);
      if (ud.health <= 0) {
        // Hide destroyed prop
        hitObject.visible = false;
        // Also hide parent group if it exists
        if (hitObject.parent) {
          hitObject.parent.visible = false;
        }
        addKillFeedEntry('Destroyed an object!');
      }

      // Impact spark (cap at 8)
      const impactId = `impact_${Date.now()}_${Math.random()}`;
      setImpacts(prev => {
        const next = [...prev, { id: impactId, position: [point.x, point.y, point.z], color: '#ff8800', type: 'prop' }];
        return next.length > 8 ? next.slice(-8) : next;
      });
      setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== impactId)), 600);
      return;
    }

    // --- Terrain hit ---
    if (ud.isTerrain) {
      const impactId = `impact_${Date.now()}_${Math.random()}`;
      setImpacts(prev => {
        const next = [...prev, { id: impactId, position: [point.x, point.y, point.z], color: '#cccccc', type: 'terrain' }];
        return next.length > 8 ? next.slice(-8) : next;
      });
      setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== impactId)), 400);
      return;
    }

    // --- Generic hit (anything else tagged in scene) ---
    const impactId = `impact_${Date.now()}_${Math.random()}`;
    setImpacts(prev => {
      const next = [...prev, { id: impactId, position: [point.x, point.y, point.z], color: '#ffffff', type: 'generic' }];
      return next.length > 8 ? next.slice(-8) : next;
    });
    setTimeout(() => setImpacts(prev => prev.filter(i => i.id !== impactId)), 400);
  }, [removeBullet, onPlayerHit, addKillFeedEntry]);
  
  /**
   * Take damage — reduces health, triggers damage flash, handles death
   */
  const takeDamage = useCallback((damage) => {
    if (isDead) return;
    // Flash red
    setDamageFlash(true);
    setTimeout(() => setDamageFlash(false), 300);

    setHealth(prev => {
      const newHealth = Math.max(0, prev - damage);
      if (newHealth === 0 && !isDead) {
        // Player died — enter death state
        setIsDead(true);
        addKillFeedEntry('You died!');
        // Auto-respawn after 3 seconds
        respawnTimerRef.current = setTimeout(() => {
          setHealth(100);
          setIsDead(false);
        }, 3000);
      }
      return newHealth;
    });
  }, [isDead, addKillFeedEntry]);
  
  /**
   * Controller & Keyboard controls for weapon switching and reload
   * RT (Right Trigger) = Shoot
   * LT (Left Trigger) = Aim
   * LB (Left Bumper) = Previous weapon
   * RB (Right Bumper) = Next weapon
   * Y button = Reload
   */
  const prevGamepadButtons = useRef({});
  
  useEffect(() => {
    if (!enabled) return;
    
    // Keyboard controls
    const handleKeyDown = (e) => {
      // Weapon switching (1, 2, 3)
      if (e.key === '1') {
        switchWeapon('pistol');
      } else if (e.key === '2') {
        switchWeapon('rifle');
      } else if (e.key === '3') {
        switchWeapon('shotgun');
      } else if (e.key === 'r' || e.key === 'R') {
        reload();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, switchWeapon, reload]);
  
  /**
   * Gamepad weapon switching controls (checked in useFrame via gamepadState)
   */
  const checkGamepadControls = useCallback(() => {
    if (!enabled || !gamepadState || !gamepadState.current) return;
    
    const gs = gamepadState.current;
    
    // LB (button 4) - switch to previous weapon
    if (gs.lbButton && !prevGamepadButtons.current.lbButton) {
      const weapons = ['pistol', 'rifle', 'shotgun'];
      const currentIndex = weapons.indexOf(currentWeapon);
      const prevIndex = (currentIndex - 1 + weapons.length) % weapons.length;
      switchWeapon(weapons[prevIndex]);
    }
    
    // RB (button 5) - switch to next weapon
    if (gs.rbButton && !prevGamepadButtons.current.rbButton) {
      const weapons = ['pistol', 'rifle', 'shotgun'];
      const currentIndex = weapons.indexOf(currentWeapon);
      const nextIndex = (currentIndex + 1) % weapons.length;
      switchWeapon(weapons[nextIndex]);
    }
    
    // Y button (button 3) - reload
    if (gs.yButton && !prevGamepadButtons.current.yButton) {
      reload();
    }
    
    // Update previous states
    prevGamepadButtons.current = {
      lbButton: gs.lbButton,
      rbButton: gs.rbButton,
      yButton: gs.yButton
    };
  }, [enabled, gamepadState, currentWeapon, switchWeapon, reload]);
  
  /**
   * Auto-reload when ammo runs out
   */
  useEffect(() => {
    if (ammo === 0 && !isReloading) {
      // Auto-reload after a short delay
      setTimeout(() => {
        if (ammo === 0 && !isReloading) {
          reload();
        }
      }, 500);
    }
  }, [ammo, isReloading, reload]);
  
  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
      if (respawnTimerRef.current) {
        clearTimeout(respawnTimerRef.current);
      }
    };
  }, []);
  
  return {
    // Weapon state
    currentWeapon,
    ammo,
    maxAmmo: weapon.maxAmmo,
    isReloading,
    isAiming,
    setIsAiming,
    
    // Shooting
    shoot,
    canShoot: !isReloading && ammo > 0 && !isDead,
    showMuzzleFlash,
    weaponSoundTrigger,
    
    // Bullets
    bullets,
    removeBullet,
    handleBulletHit,
    
    // Health & death
    health,
    maxHealth,
    takeDamage,
    isDead,
    damageFlash,
    
    // Impact effects
    impacts,
    
    // UI
    hitMarkers,
    killFeed,
    addKillFeedEntry,
    
    // Actions
    switchWeapon,
    reload,
    checkGamepadControls, // Export this so PlayerMover can call it in useFrame
  };
}
