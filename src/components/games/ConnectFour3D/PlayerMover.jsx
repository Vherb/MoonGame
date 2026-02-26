// ConnectFour3D – PlayerMover component
// Extracted from ConnectFour3DView.jsx

import React, { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  COLS, ROWS, CELL, GAP, GROUND_CLEAR, TERRAIN_RADIUS, PLAY_AREA_RADIUS,
  STEP_CLIMB_MAX, AVATAR_FINAL_HEIGHT,
  STAIR_POS_X, STAIR_POS_Z, STAIR_WIDTH, STAIR_RUN, STAIR_RISE, STAIR_STEPS,
  STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS,
  STAIR2_PLATFORM_DEPTH, STAIR2_PLATFORM_WIDTH,
  STAIR3_POS_X, STAIR3_POS_Z, STAIR3_BASE_Y, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS,
  STAIR3_PLATFORM_DEPTH, STAIR3_PLATFORM_WIDTH,
} from './constants';
import { getGroundHeightXZAtY, buildStairAABBsWorld, getTerrainHeightXZ, CURRENT_PLACED_CUBES, GIANT_MOON_SPHERE, getSphereSurfaceData, sphereBumpAt } from './terrainPhysics';
import { useWeaponSystem } from './useWeaponSystem';
import { FootstepAudio } from './audioComponents';
import { useInventoryStore } from './useInventoryStore';
export function PlayerMover({ firstPersonMode = false, setFirstPersonMode = null, followCam = false, enabled = false, maxRadius = PLAY_AREA_RADIUS, speed = 16, baseOffset = [0,0], onPositionChange, onAvatarMove = null, moveTarget = null, onArrive, turnSpeed = 2.4, turnSensitivity = 1.5, initialYaw = 0, invertForward = false, clickYawOffset = 0, obstacles = [], collisionRadius = 2.2, collisionForwardOffset = -1.05, groundSamplePush = 2.3, backProbeMag = null, stairMagMul = 1.0, labelName = null, labelSide = null, characterId = null, showCollisionBoxes = false, settingsMenuOpen = false, setShowEditMenu = null, setShowChatUI = null, setFullCamera = null, setFollowCam = null, showEditMenu = false, activeEditorTab = 'objects', setActiveEditorTab = null, selectedSectionIndex = 0, setSelectedSectionIndex = null, isInSection = false, setIsInSection = null, selectedItemIndex = 0, setSelectedItemIndex = null, isInSubMenu = false, setIsInSubMenu = null, selectedSubItemIndex = 0, setSelectedSubItemIndex = null, cubeEditMode = false, placedCubes = [], onWeaponSystemUpdate = null, children }) {
  // Physics constants for jump/fall
  const GRAVITY_FAST = -920.0;         // fast gravity for stairs and general falling
  const GRAVITY_SLOW_FALL = -84.0;     // slowest fall when stepping off the big top platform
  const GRAVITY_JUMP = -135.0;         // another 25% weaker for an even slower/smoother jump arc
  const GRAVITY_FALL = -94.5;          // keep non-platform falls ~30% weaker than jump
  const TARGET_JUMP_HEIGHT = 6.0;     // modest jump apex in world units
  // Jetpack physics constants
  const JETPACK_THRUST       = 70;     // upward acceleration (smooth ramp, not rocket-fast)
  const JETPACK_GRAVITY      = -50;   // very floaty space gravity while jetpacking
  const JETPACK_MAX_VY       = 120;   // terminal velocity cap (higher to allow boost ascents)
  const JETPACK_AIR_SPEED_MUL = 0.7;  // base XZ speed multiplier while hovering still
  const JETPACK_FWD_SPEED_BOOST = 2.5; // max XZ speed multiplier when stick fully forward while flying
  const JETPACK_MAX_FUEL     = 6.0;   // seconds of continuous thrust (unlimited but shown on HUD)
  const JETPACK_RECHARGE_RATE = 2.0;  // fuel/s recharge while grounded
  const JETPACK_FLY_RADIUS   = 5000;  // expanded boundary while jetpacking
  const JETPACK_XZ_ACCEL     = 3.5;   // how fast XZ velocity ramps toward target (lower = glidier)
  const JETPACK_XZ_DRAG      = 0.97;  // per-frame momentum retention @60fps (high = more drift)
  const JETPACK_BOOST_MUL    = 3.5;   // L3 super-boost multiplier (~5x walk when combined with forward)
  const JETPACK_BOOST_TILT   = 1.05;  // ~60° forward lean during boost
  const ref = useRef();
  const pressed = useRef({});
  const justPressed = useRef({});
  const lastSent = useRef({ x: Infinity, z: Infinity, yaw: 0, t: 0, lift: 0, isJumping: false });
  const targetRef = useRef(null);
  const yawRef = useRef(0);
  const velRef = useRef({ x: 0, z: 0 });
  const childRef = useRef();
  const dbgSize = useRef(new THREE.Vector3(0,0,0));
  const dbgCenter = useRef(new THREE.Vector3(0,0,0));
  const prevLocalPos = useRef(new THREE.Vector3(0,0,0));
  // Jump physics
  const [jumpY, setJumpY] = useState(0);
  const jumpVyRef = useRef(0);
  const [isJumping, setIsJumping] = useState(false);
  // Jetpack state
  const isJetpackingRef = useRef(false);
  const [isJetpacking, setIsJetpacking] = useState(false);
  const jetpackFuelRef = useRef(JETPACK_MAX_FUEL);
  const jetpackRtAnalogRef = useRef(0); // 0-1 analog trigger value
  const jetpackTiltXRef = useRef(0);   // smoothed forward/back tilt (radians)
  const jetpackTiltZRef = useRef(0);   // smoothed left/right tilt (radians)
  const jetpackVxRef = useRef(0);      // world-space horizontal X velocity (momentum)
  const jetpackVzRef = useRef(0);      // world-space horizontal Z velocity (momentum)
  const jetpackLandTimerRef = useRef(null); // delayed fly→idle anim transition
  const [isFalling, setIsFalling] = useState(false); // true when descending during jetpack → triggers jump/fall anim
  // ── Sphere mode state (spherical gravity on the giant moon) ──
  const sphereModeRef = useRef(0);                          // 0 = flat terrain, 1 = on sphere
  const sphereBlendRef = useRef(0);                          // gradual 0→1 blend for smooth transition
  const sphereTargetRef = useRef(0);                         // target blend value (0 or 1)
  const sphereUpRef = useRef(new THREE.Vector3(0, 1, 0));   // surface normal (world space)
  const sphereQRef = useRef(new THREE.Quaternion());         // cached sphere orientation quaternion
  const sphereJumpYRef = useRef(0);                           // synchronous jumpY for sphere mode (avoids 1-frame React state lag)
  const spherePlatformLiftRef = useRef(0);                    // synchronous platformLift for sphere mode
  const _Y_AXIS = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const _tmpV3a = useMemo(() => new THREE.Vector3(), []);
  const _tmpV3b = useMemo(() => new THREE.Vector3(), []);
  const _tmpQ1 = useMemo(() => new THREE.Quaternion(), []);
  const _tmpQ2 = useMemo(() => new THREE.Quaternion(), []);
  const _flatQ = useMemo(() => new THREE.Quaternion(), []);  // for blending flat↔sphere orientation
  // Platform support: allow landing on the tabletop and staying there
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const localGroundY = -fhForGround / 2 - GROUND_CLEAR;
  // Tabletop: compute lift from the actual FBX tabletop world Y when available for exact alignment
  const [tableTopLift, setTableTopLift] = useState(() => {
    const top = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    if (Number.isFinite(top)) {
      // localGroundY is the scene's floor Y; lift is worldY - groundY
      return (top - localGroundY);
    }
    // Fallback to previous approximate offset
    return (-localGroundY + 37.0);
  });
  useEffect(() => {
    const onReady = (e) => {
      try {
        const ty = Number(e?.detail?.topY ?? window.__CF_TABLE_TOP_Y__);
        if (Number.isFinite(ty)) setTableTopLift(ty - localGroundY);
      } catch {}
    };
    try { window.addEventListener('cf:table-ready', onReady); } catch {}
    return () => { try { window.removeEventListener('cf:table-ready', onReady); } catch {} };
  }, [localGroundY]);
  const [platformLift, setPlatformLift] = useState(0); // 0=ground, tableTopLift=on table
  const [onTable, setOnTable] = useState(false);
  // Current gravity used while in jump/fall mode (can switch to slow when walking off top platform)
  const curGravityRef = useRef(GRAVITY_FAST);
  // Live HUD text above head (updated ~10Hz to avoid excessive re-renders)
  const [hudText, setHudText] = useState('');
  const [isWalking, setIsWalking] = useState(false);
  const [isWalkingBackward, setIsWalkingBackward] = useState(false);
  const [isStrafeLeft, setIsStrafeLeft] = useState(false);
  const [isStrafeRight, setIsStrafeRight] = useState(false);
  const hudTick = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  // Collision and marker: shift forward along facing (local -Z)
  const COLLISION_FWD_OFFSET = Number.isFinite(Number(collisionForwardOffset)) ? Number(collisionForwardOffset) : -1.05;
  const GROUND_SAMPLE_PUSH = Number.isFinite(Number(groundSamplePush)) ? Number(groundSamplePush) : 2.3;
  const FWD_PROBE_MAG_DEFAULT = Math.abs(GROUND_SAMPLE_PUSH);
  const BACK_PROBE_MAG = Number.isFinite(Number(backProbeMag)) ? Math.abs(Number(backProbeMag)) : null;
  const getForwardProbeMag = () => FWD_PROBE_MAG_DEFAULT;
  const getBehindProbeMag = () => (BACK_PROBE_MAG ?? FWD_PROBE_MAG_DEFAULT);
  const STAIR_MAG_MUL = Number.isFinite(Number(stairMagMul)) ? Number(stairMagMul) : 1.0;
  // Short-term latches to stabilize descend/ascend detection
  const lastDescendFwdTimeRef = React.useRef(0);
  const lastDescendBackTimeRef = React.useRef(0);
  const lastAscendBackTimeRef = React.useRef(0);
  // Smooth lift constants (controls how quickly platformLift eases to target)
  const LIFT_SMOOTH_UP_K = 50;   // Original value for responsive stair climbing
  const LIFT_SMOOTH_DOWN_K = 50; // Matched to upward for consistent movement
  useEffect(() => { targetRef.current = moveTarget; }, [moveTarget]);
  useLayoutEffect(() => { yawRef.current = Number(initialYaw)||0; if(ref.current){ ref.current.rotation.y = yawRef.current; } }, [initialYaw]);
  // One-time spawn nudge: move slightly backward along facing (~0.7)
  useLayoutEffect(() => {
    try {
      if (ref.current) {
        const yaw = yawRef.current || 0;
        const back = new THREE.Vector3(0,0,1); // local +Z is backward (forward is -Z)
        back.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
        const DIST = 0.7;
        ref.current.position.x += back.x * DIST;
        ref.current.position.z += back.z * DIST;
      }
    } catch {}
  }, []);
  // Compute debug bounds for child once (approx)
  useEffect(() => {
    if (!childRef.current || !ref.current) return;
    try {
      const box = new THREE.Box3();
      childRef.current.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) {
            bb.applyMatrix4(o.matrixWorld);
            box.union(bb);
          }
        }
      });
      if (!box.isEmpty()) {
        const size = new THREE.Vector3(); box.getSize(size);
        const centerW = new THREE.Vector3(); box.getCenter(centerW);
        const centerL = centerW.clone();
        ref.current.worldToLocal(centerL);
        dbgSize.current.copy(size);
        dbgCenter.current.copy(centerL);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!enabled) return; // no listeners if not enabled
    const down = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      
      // Don't intercept arrow keys when settings menu is open (let sliders work)
      if (settingsMenuOpen) return;
      
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
    if (keyToken === 'ArrowUp' || keyToken === 'ArrowDown' || keyToken === 'ArrowLeft' || keyToken === 'ArrowRight' ||
      keyToken === 'w' || keyToken === 'a' || keyToken === 's' || keyToken === 'd' || keyToken === 'f' || keyToken === 'F' ||
      keyToken === 'W' || keyToken === 'A' || keyToken === 'S' || keyToken === 'D' ||
      keyToken === 'r' || keyToken === 'R' || keyToken === 'Space') {
        if (!pressed.current[keyToken]) { justPressed.current[keyToken] = true; }
        pressed.current[keyToken] = true;
        try { e.preventDefault(); } catch {}
      }
    };
    const up = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      
      // Don't intercept arrow keys when settings menu is open
      if (settingsMenuOpen) return;
      
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
      if (pressed.current[keyToken]) delete pressed.current[keyToken];
      try { e.preventDefault(); } catch {}
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    // Clear all pressed keys when the window loses focus to prevent stuck movement
    const blur = () => { pressed.current = {}; };
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, settingsMenuOpen]);
  
  // Mouse click for shooting
  const mouseDownRef = useRef(false);
  // Track shooting state for animation broadcast (stays true for ~200ms after each shot)
  const isShootingRef = useRef(false);
  const shootTimerRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    
    const handleMouseDown = (e) => {
      // Only left click
      if (e.button !== 0) return;
      
      // Don't shoot if clicking on UI elements
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      
      // Don't shoot if menu is open
      if (settingsMenuOpen) return;

      // Don't shoot if interacting with rifle or jetpack gizmo
      if (window.__CF_RIFLE_DRAGGING__ || window.__CF_JETPACK_DRAGGING__) return;

      // In FPS mode, only shoot when pointer is locked (first click acquires lock, not shoot)
      if (firstPersonMode && !document.pointerLockElement) return;
      
      mouseDownRef.current = true;
    };
    
    const handleMouseUp = (e) => {
      if (e.button !== 0) return;
      mouseDownRef.current = false;
    };
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enabled, settingsMenuOpen, firstPersonMode]);

  // Xbox controller state refs
  const gamepadState = useRef({
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    bButton: false,
    bButtonPressed: false,
    leftStickClick: false,
    lb: false,
    rb: false,
    lbButton: false,  // Left bumper for previous weapon
    rbButton: false,  // Right bumper for next weapon
    dpadUp: false,
    dpadDown: false,
    aButton: false,
    bButtonForMenu: false,
    rtButton: false,  // Right trigger for shooting
    rtAnalog: 0,      // Right trigger analog value (0-1) for jetpack
    ltButton: false,  // Left trigger for aiming
    yButton: false,   // Y button for reload
    dpadLeft: false,
    dpadRight: false,
    dpadRightWeapon: false, // Separate flag for weapon switching vs menu
  });

  // Stable ref for onAvatarMove so callbacks don't trigger re-renders
  const onAvatarMoveRef = useRef(onAvatarMove);
  useEffect(() => { onAvatarMoveRef.current = onAvatarMove; }, [onAvatarMove]);

  // Weapon system for 3rd person shooting
  const weaponSystem = useWeaponSystem({
    enabled: enabled,
    gamepadState: gamepadState,
    initialWeapon: 'pistol',
    onShoot: (shootInfo) => {
      // Broadcast shoot to multiplayer via WebSocket
      if (onAvatarMoveRef.current) {
        onAvatarMoveRef.current({
          type: 'shoot',
          position: shootInfo.position,
          direction: shootInfo.direction,
          weaponType: shootInfo.weapon || 'pistol',
          speed: 200,
          damage: shootInfo.damage || 25
        });
      }
    },
    onPlayerHit: (targetId, damage, hitPoint) => {
      // Report hit to server for damage sync
      if (onAvatarMoveRef.current) {
        onAvatarMoveRef.current({
          type: 'playerHit',
          targetId,
          damage,
          hitPosition: hitPoint ? [hitPoint.x, hitPoint.y, hitPoint.z] : [0, 0, 0]
        });
      }
    }
  });
  
  // Listen for remote damage events (from other players shooting us)
  useEffect(() => {
    const handleRemoteDamage = (e) => {
      const { damage } = e.detail || {};
      if (typeof damage === 'number' && damage > 0) {
        weaponSystem.takeDamage(damage);
      }
    };
    window.addEventListener('cf:take_damage', handleRemoteDamage);
    return () => window.removeEventListener('cf:take_damage', handleRemoteDamage);
  }, [weaponSystem.takeDamage]);

  // Publish volatile weapon data (bullets, impacts, hitMarkers) to a window global.
  // This lets a dedicated BulletRenderer in the Canvas read them without triggering
  // a full parent re-render on every bullet add/remove.
  window.__CF_WEAPON_SYS__ = weaponSystem;

  // Send STABLE weapon system data to parent for UI rendering.
  // bullets / impacts / hitMarkers are excluded — they change every frame and would
  // cascade into a full ConnectFour3DView re-render + CameraFollower remount.
  useEffect(() => {
    if (onWeaponSystemUpdate) {
      onWeaponSystemUpdate(weaponSystem);
    }
  }, [weaponSystem.currentWeapon, weaponSystem.ammo, weaponSystem.health, weaponSystem.isAiming, weaponSystem.isReloading, weaponSystem.killFeed, weaponSystem.isDead, weaponSystem.damageFlash, onWeaponSystemUpdate]);

  useFrame((state, dt) => {
    if (!enabled || !ref.current) return;
    
    const camera = state.camera;
    
    // Poll gamepad input — only when this tab is visible.
    // Use document.hidden instead of document.hasFocus() because hasFocus()
    // returns false after page reload until the canvas is clicked, blocking input.
    // document.hidden is only true when the tab is actually in the background.
    const tabVisible = !document.hidden;
    const gamepads = tabVisible && navigator.getGamepads ? navigator.getGamepads() : [];
    const gamepad = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
    
    if (gamepad) {
      // Debug: Log button 13 state
      if (gamepad.buttons[13]?.pressed) {
        console.log('Button 13 (D-pad Down) is pressed!', {
          showEditMenu,
          setSelectedSectionIndex: !!setSelectedSectionIndex,
          setSelectedItemIndex: !!setSelectedItemIndex,
          isInSection,
          selectedSectionIndex
        });
      }
      
      // Left stick for movement (axis 0 = left/right, axis 1 = up/down)
      const deadzone = 0.15; // Ignore small stick movements
      const leftX = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
      const leftY = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
      
      gamepadState.current.leftStickX = leftX;
      gamepadState.current.leftStickY = leftY;
      
      // Right stick for camera (axis 2 = left/right, axis 3 = up/down)
      const rightX = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
      const rightY = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
      
      gamepadState.current.rightStickX = rightX;
      gamepadState.current.rightStickY = rightY;
      
      // B button for jump (button 1 on Xbox controller)
      const bButtonNow = gamepad.buttons[1]?.pressed || false;
      gamepadState.current.bButtonPressed = bButtonNow && !gamepadState.current.bButton;
      gamepadState.current.bButton = bButtonNow;
      
      // Back/Select button (button 8) to toggle edit menu
      const backButtonNow = gamepad.buttons[8]?.pressed || false;
      const backButtonPressed = backButtonNow && !gamepadState.current.backButton;
      gamepadState.current.backButton = backButtonNow;
      
      if (backButtonPressed && setShowEditMenu) {
        setShowEditMenu(prev => !prev);
      }
      
      // D-pad Right button (button 15) - horizontal menu navigation when in section, or toggle chat UI
      const dpadRightNow = gamepad.buttons[15]?.pressed || false;
      const dpadRightPressed = dpadRightNow && !gamepadState.current.dpadRight;
      gamepadState.current.dpadRight = dpadRightNow;
      
      if (dpadRightPressed) {
        // Priority: Sub-menu horizontal navigation
        if (showEditMenu && isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Right pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups:
            // 0-1: Duplicate/Delete buttons
            // 2-3: Collision/Walkable checkboxes
            // 4-6: Box/Sphere/Cylinder collision shapes
            if (prev >= 0 && prev <= 1) {
              // Navigate between Duplicate (0) and Delete (1)
              return prev === 0 ? 1 : 0;
            } else if (prev >= 2 && prev <= 3) {
              // Navigate between Collision (2) and Walkable (3)
              return prev === 2 ? 3 : 2;
            } else if (prev >= 4 && prev <= 6) {
              // Navigate between Box (4), Sphere (5), Cylinder (6)
              const newIndex = prev >= 6 ? 6 : prev + 1; // Stop at 6, no wrap
              return newIndex;
            }
            return prev;
          });
        }
        // Priority: Horizontal navigation in Object Placer section when inside and on collision shapes
        else if (showEditMenu && isInSection && selectedSectionIndex === 0 && cubeEditMode && selectedItemIndex >= 1 && selectedItemIndex <= 3 && setSelectedItemIndex) {
          console.log('D-pad Right: navigating collision shapes');
          setSelectedItemIndex(prev => {
            const newIndex = prev >= 3 ? 3 : prev + 1; // Stop at 3, no wrap
            console.log('Navigating collision shapes right, prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Priority: Horizontal navigation in Collision Shapes section (2x2 grid)
        else if (showEditMenu && isInSection && selectedSectionIndex === 1 && setSelectedItemIndex) {
          console.log('D-pad Right: navigating Collision Shapes section 2x2 grid');
          setSelectedItemIndex(prev => {
            // Top row: 0 (Box) -> 1 (Sphere)
            if (prev === 0) return 1;
            // Bottom row: 2 (Cylinder) -> 3 (Capsule)
            if (prev === 2) return 3;
            // Already at right edge (1 or 3), stay there
            return prev;
          });
        }
        // Fallback: Toggle chat UI when not navigating menu
        else if (setShowChatUI) {
          console.log('D-pad right pressed, toggling chat UI');
          setShowChatUI(prev => {
            console.log('Chat UI toggled from', prev, 'to', !prev);
            return !prev;
          });
        }
      }
      
      // D-pad Up button (button 12) - menu navigation when edit menu open, camera toggle when closed
      const dpadUpNow = gamepad.buttons[12]?.pressed || false;
      const dpadUpPressed = dpadUpNow && !gamepadState.current.dpadUp;
      gamepadState.current.dpadUp = dpadUpNow;
      
      if (dpadUpPressed) {
        // Priority: Sub-menu navigation when in sub-menu
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Up pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups (skip entire groups, don't navigate within them):
            // Group 1: 0-1 (Duplicate/Delete)
            // Group 2: 2-3 (Collision/Walkable)  
            // Group 3: 4-6 (Box/Sphere/Cylinder)
            
            let newIndex;
            if (prev >= 4 && prev <= 6) {
              // From collision shapes group → jump to Collision checkbox group (start at 2)
              newIndex = 2;
            } else if (prev >= 2 && prev <= 3) {
              // From checkboxes group → jump to Duplicate/Delete group (start at 0)
              newIndex = 0;
            } else {
              // From Duplicate/Delete group → wrap to collision shapes (start at 4)
              newIndex = 4;
            }
            
            console.log('Navigating sub-items up (group jump), prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Priority: Menu navigation when edit menu is open
        else if (showEditMenu && setSelectedSectionIndex && setSelectedItemIndex) {
          console.log('D-pad Up pressed! isInSection:', isInSection, 'current selectedSectionIndex:', selectedSectionIndex);
          if (isInSection) {
            // Navigate items within section upward
            setSelectedItemIndex(prev => {
              // Determine max items for current section
              let maxItems = 0;
              if (selectedSectionIndex === 0) {
                // Object Placer: 0=checkbox, 1-3=collision shapes, 4+=placed objects (excluding terrain)
                if (cubeEditMode) {
                  const numPlacedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain).length;
                  maxItems = 3 + numPlacedObjects; // checkbox + 3 shapes + placed objects (no terrain)
                } else {
                  maxItems = 0;
                }
              } else if (selectedSectionIndex === 1) {
                // Collision Shapes section - 4 buttons in 2x2 grid
                maxItems = 3; // 0=Box, 1=Sphere, 2=Cylinder, 3=Capsule
              } else if (selectedSectionIndex === 2) {
                // Primitives section - removed
                maxItems = 0;
              }
              
              // D-pad Up: When in section 1 (Collision Shapes), navigate within 2x2 grid
              if (selectedSectionIndex === 1 && isInSection) {
                // From bottom row (2,3) to top row (0,1)
                if (prev === 2) return 0; // Bottom Left to Top Left
                if (prev === 3) return 1; // Bottom Right to Top Right
                // Already in top row (0,1), stay there (don't exit)
                return prev;
              }
              
              // D-pad Up: In section 0, handle navigation
              if (selectedSectionIndex === 0) {
                // From shapes (1-3), go to checkbox (0)
                if (prev >= 1 && prev <= 3) return 0;
                // From first placed object (4), go to middle shape (2 - Sphere)
                if (prev === 4) return 2;
              }
              
              const newIndex = prev <= 0 ? 0 : prev - 1; // Stop at top, no wrap
              console.log('Navigating items up, prev:', prev, 'max:', maxItems, 'new:', newIndex);
              return newIndex;
            });
          } else {
            // Navigate sections upward (stop at 0, no wrap)
            setSelectedSectionIndex(prev => {
              const newIndex = prev <= 0 ? 0 : prev - 1;
              console.log('Navigating sections up, prev:', prev, 'new:', newIndex);
              return newIndex;
            });
          }
        } 
        // Fallback: Cycle camera modes (3rd person → 1st person → free camera)
        else if (setFullCamera && setFollowCam) {
          console.log('D-pad up pressed, cycling camera mode');
          
          if (followCam) {
            // From 3rd person to 1st person
            console.log('Switching to 1st person mode');
            setFollowCam(false);
            setFirstPersonMode(true);
            setFullCamera(false);
          } else if (firstPersonMode) {
            // From 1st person to free camera
            console.log('Switching to free camera mode');
            // Sync character yaw to FPS camera direction so avatar doesn't snap 180°
            if (typeof window.__CF_FPS_CAMERA_YAW__ === 'number') {
              yawRef.current = window.__CF_FPS_CAMERA_YAW__;
            }
            setFollowCam(false);
            setFirstPersonMode(false);
            setFullCamera(true);
          } else {
            // From free camera back to 3rd person
            console.log('Switching to 3rd person mode');
            // Sync character yaw to FPS camera direction so avatar doesn't snap 180°
            if (typeof window.__CF_FPS_CAMERA_YAW__ === 'number') {
              yawRef.current = window.__CF_FPS_CAMERA_YAW__;
            }
            setFollowCam(true);
            setFirstPersonMode(false);
            setFullCamera(false);
          }
        }
      }
      
      // LB (Left Bumper - button 4) to cycle tabs left
      const lbNow = gamepad.buttons[4]?.pressed || false;
      const lbPressed = lbNow && !gamepadState.current.lb;
      gamepadState.current.lb = lbNow;
      
      if (lbPressed && setActiveEditorTab && showEditMenu) {
        const tabs = ['objects', 'models', 'transform', 'audio', 'settings'];
        const currentIndex = tabs.indexOf(activeEditorTab);
        const newIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        setActiveEditorTab(tabs[newIndex]);
      }
      
      // RB (Right Bumper - button 5) to cycle tabs right
      const rbNow = gamepad.buttons[5]?.pressed || false;
      const rbPressed = rbNow && !gamepadState.current.rb;
      gamepadState.current.rb = rbNow;
      
      if (rbPressed && setActiveEditorTab && showEditMenu) {
        const tabs = ['objects', 'models', 'transform', 'audio', 'settings'];
        const currentIndex = tabs.indexOf(activeEditorTab);
        const newIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
        setActiveEditorTab(tabs[newIndex]);
      }
      
      // D-pad Down (button 13) for menu section navigation when edit menu is open
      const dpadDownNow = gamepad.buttons[13]?.pressed || false;
      const dpadDownPressed = dpadDownNow && !gamepadState.current.dpadDown;
      gamepadState.current.dpadDown = dpadDownNow;
      
      if (dpadDownNow) {
        console.log('D-pad Down state:', { dpadDownNow, wasPressedBefore: !dpadDownPressed, dpadDownPressed });
      }
      
      if (dpadDownPressed) {
        // Priority: Sub-menu navigation when in sub-menu
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Down pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups (skip entire groups, don't navigate within them):
            // Group 1: 0-1 (Duplicate/Delete)
            // Group 2: 2-3 (Collision/Walkable)
            // Group 3: 4-6 (Box/Sphere/Cylinder)
            
            let newIndex;
            if (prev >= 0 && prev <= 1) {
              // From Duplicate/Delete group → jump to Collision/Walkable group (start at 2)
              newIndex = 2;
            } else if (prev >= 2 && prev <= 3) {
              // From checkboxes group → jump to collision shapes group (start at 4)
              newIndex = 4;
            } else {
              // From collision shapes group → wrap to Duplicate/Delete (start at 0)
              newIndex = 0;
            }
            
            console.log('Navigating sub-items down (group jump), prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Menu navigation when edit menu is open
        else if (showEditMenu && setSelectedSectionIndex && setSelectedItemIndex) {
          console.log('D-pad Down pressed! isInSection:', isInSection, 'current selectedSectionIndex:', selectedSectionIndex);
          if (isInSection) {
            // Navigate items within section
            setSelectedItemIndex(prev => {
              // Determine max items for current section
              let maxItems = 0;
              if (selectedSectionIndex === 0) {
                // Object Placer: 0=checkbox, 1-3=collision shapes, 4+=placed objects (excluding terrain)
                if (cubeEditMode) {
                  const numPlacedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain).length;
                  maxItems = 3 + numPlacedObjects; // checkbox + 3 shapes + placed objects (no terrain)
                } else {
                  maxItems = 0;
                }
              } else if (selectedSectionIndex === 1) {
                // Collision Shapes section - 3 buttons horizontal (Box, Sphere, Cylinder)
                maxItems = 2; // 0=Box, 1=Sphere, 2=Cylinder
              } else if (selectedSectionIndex === 2) {
                // Primitives section - removed
                maxItems = 0;
              }
              
              // D-pad Down: When in section 1 (Collision Shapes), navigate within 2x2 grid
              if (selectedSectionIndex === 1 && isInSection) {
                // From top row (0,1) to bottom row (2,3)
                if (prev === 0) return 2; // Top Left to Bottom Left
                if (prev === 1) return 3; // Top Right to Bottom Right
                // Already in bottom row (2,3), stay there (don't exit)
                return prev;
              }
              
              // D-pad Down: In section 0, handle navigation
              if (selectedSectionIndex === 0) {
                // From checkbox (0), go to first shape (1)
                if (prev === 0) return 1;
                // From any shape (1-3), go to first placed object (4) or stay on last shape
                if (prev >= 1 && prev <= 3) return 4;
              }
              
              const newIndex = prev >= maxItems ? maxItems : prev + 1; // Stop at bottom, no wrap
              console.log('Navigating items, prev:', prev, 'max:', maxItems, 'new:', newIndex);
              return newIndex;
            });
          } else {
            // Navigate sections (stop at 1, no wrap - only 2 sections now)
            setSelectedSectionIndex(prev => {
              const newIndex = prev >= 1 ? 1 : prev + 1;
              console.log('Navigating sections, prev:', prev, 'new:', newIndex);
              return newIndex;
            });
          }
        }
      }
      
      // A button (button 0) to enter/activate in menu
      const aButtonNow = gamepad.buttons[0]?.pressed || false;
      const aButtonPressed = aButtonNow && !gamepadState.current.aButton;
      gamepadState.current.aButton = aButtonNow;
      
      if (aButtonPressed && showEditMenu && setIsInSection) {
        console.log('A button pressed! isInSection:', isInSection, 'isInSubMenu:', isInSubMenu, 'selectedSectionIndex:', selectedSectionIndex, 'selectedItemIndex:', selectedItemIndex);
        if (!isInSection) {
          // Enter the selected section to navigate items inside
          setIsInSection(true);
          setSelectedItemIndex && setSelectedItemIndex(0);
          console.log('Entered section', selectedSectionIndex);
        } else if (isInSection && !isInSubMenu) {
          // Check if we're on a placed object (item >= 4 in section 0)
          if (selectedSectionIndex === 0 && selectedItemIndex >= 4) {
            // Enter sub-menu to navigate buttons/toggles inside the placed object
            console.log('🎮 Entering sub-menu for placed object', selectedItemIndex);
            setIsInSubMenu && setIsInSubMenu(true);
            setSelectedSubItemIndex && setSelectedSubItemIndex(0);
          } else {
            // Activate/click the selected item
            console.log('🎮 A BUTTON: Clicking item', selectedItemIndex, 'in section', selectedSectionIndex);
            
            // Section 0 = Object Placer
            if (selectedSectionIndex === 0) {
              console.log('🎮 Dispatching event for section 0, item', selectedItemIndex);
              const event = new CustomEvent('controllerMenuItemActivate', {
                detail: { section: 0, item: selectedItemIndex }
              });
              window.dispatchEvent(event);
              console.log('🎮 Event dispatched!');
            }
            // Section 1 = Collision Shapes
            else if (selectedSectionIndex === 1) {
              const event = new CustomEvent('controllerMenuItemActivate', {
                detail: { section: 1, item: selectedItemIndex }
              });
              window.dispatchEvent(event);
            }
          }
        } else if (isInSubMenu) {
          // Activate/click the selected sub-item
          console.log('🎮 A BUTTON: Clicking sub-item', selectedSubItemIndex, 'of placed object', selectedItemIndex);
          const event = new CustomEvent('controllerSubMenuItemActivate', {
            detail: { objectIndex: selectedItemIndex, subItem: selectedSubItemIndex }
          });
          window.dispatchEvent(event);
        }
      }
      
      // B button (button 1) to exit from sub-menu or section
      const bButtonForMenuNow = gamepad.buttons[1]?.pressed || false;
      const bButtonForMenuPressed = bButtonForMenuNow && !gamepadState.current.bButtonForMenu;
      gamepadState.current.bButtonForMenu = bButtonForMenuNow;
      
      if (bButtonForMenuPressed && showEditMenu) {
        if (isInSubMenu && setIsInSubMenu) {
          // Exit sub-menu back to placed object list
          console.log('B button pressed - exiting sub-menu');
          setIsInSubMenu(false);
          setSelectedSubItemIndex && setSelectedSubItemIndex(0);
        } else if (isInSection && setIsInSection) {
          // Exit section back to section navigation
          console.log('B button pressed - exiting section');
          setIsInSection(false);
          setSelectedItemIndex && setSelectedItemIndex(0);
        }
      }
      
      // D-pad Left (button 14) for horizontal item navigation
      const dpadLeftNow = gamepad.buttons[14]?.pressed || false;
      const dpadLeftPressed = dpadLeftNow && !gamepadState.current.dpadLeft;
      gamepadState.current.dpadLeft = dpadLeftNow;
      
      if (dpadLeftPressed && showEditMenu) {
        // Priority: Sub-menu horizontal navigation
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Left pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups:
            // 0-1: Duplicate/Delete buttons
            // 2-3: Collision/Walkable checkboxes
            // 4-6: Box/Sphere/Cylinder collision shapes
            if (prev >= 0 && prev <= 1) {
              // Navigate between Duplicate (0) and Delete (1)
              return prev === 0 ? 1 : 0;
            } else if (prev >= 2 && prev <= 3) {
              // Navigate between Collision (2) and Walkable (3)
              return prev === 2 ? 3 : 2;
            } else if (prev >= 4 && prev <= 6) {
              // Navigate between Box (4), Sphere (5), Cylinder (6)
              const newIndex = prev <= 4 ? 4 : prev - 1; // Stop at 4, no wrap
              return newIndex;
            }
            return prev;
          });
        }
        // Section item navigation
        else if (setSelectedItemIndex && isInSection) {
          console.log('D-pad Left pressed! selectedSectionIndex:', selectedSectionIndex, 'selectedItemIndex:', selectedItemIndex);
          setSelectedItemIndex(prev => {
            // For Object Placer section 0: items 1, 2, 3 are the collision shape buttons (horizontal)
            if (selectedSectionIndex === 0 && cubeEditMode) {
              // If on items 1-3 (collision shapes), navigate left
              if (prev >= 1 && prev <= 3) {
                const newIndex = prev <= 1 ? 1 : prev - 1; // Stop at 1, no wrap
                console.log('Navigating collision shapes left, prev:', prev, 'new:', newIndex);
                return newIndex;
              }
            }
            // For Collision Shapes section 1: 2x2 grid
            else if (selectedSectionIndex === 1) {
              // Top row: 1 (Sphere) -> 0 (Box)
              if (prev === 1) return 0;
              // Bottom row: 3 (Capsule) -> 2 (Cylinder)
              if (prev === 3) return 2;
              // Already at left edge (0 or 2), stay there
              return prev;
            }
            return prev; // No horizontal navigation for other items/sections
          });
        }
      }
      
      // Left stick click for run (button 10 on Xbox controller - L3)
      gamepadState.current.leftStickClick = gamepad.buttons[10]?.pressed || false;
      
      // Weapon controls - RT (Right Trigger) to shoot, LT (Left Trigger) to aim
      // Right Trigger (button 7 or axis 5) - Shoot
      const rtValue = gamepad.buttons[7]?.value || (gamepad.axes[5] !== undefined ? (gamepad.axes[5] + 1) / 2 : 0);
      const rtPressed = rtValue > 0.5;
      gamepadState.current.rtButton = rtPressed;
      gamepadState.current.rtAnalog = rtValue;
      // Only feed RT to jetpack when NOT in first-person mode (FPS uses RT for shooting)
      // AND jetpack is equipped in inventory
      if (!firstPersonMode && useInventoryStore.getState().hasEffect('enableJetpack')) {
        jetpackRtAnalogRef.current = rtValue;
      } else if (firstPersonMode) {
        jetpackRtAnalogRef.current = 0;
      }
      
      // Left Trigger (button 6 or axis 4) - Aim
      const ltValue = gamepad.buttons[6]?.value || (gamepad.axes[4] !== undefined ? (gamepad.axes[4] + 1) / 2 : 0);
      const ltPressed = ltValue > 0.5;
      gamepadState.current.ltButton = ltPressed;
      weaponSystem.setIsAiming(ltPressed);
      
      // LB (Left Bumper - button 4) - Previous weapon
      gamepadState.current.lbButton = gamepad.buttons[4]?.pressed || false;
      
      // RB (Right Bumper - button 5) - Next weapon
      gamepadState.current.rbButton = gamepad.buttons[5]?.pressed || false;
      
      // Y button (button 3) - Reload or Exit Vehicle
      const yButtonNow = gamepad.buttons[3]?.pressed || false;
      const yButtonPressed = yButtonNow && !gamepadState.current.yButton;
      gamepadState.current.yButton = yButtonNow;
      
      // Check if we're in a vehicle and handle exit
      const vehicleSys = window.__CF_VEHICLE_SYSTEM__;
      if (yButtonPressed && vehicleSys && vehicleSys.isInVehicle) {
        vehicleSys.exitVehicle();
      }
      
      // X button (button 2) - Enter Vehicle (E key equivalent)
      const xButtonNow = gamepad.buttons[2]?.pressed || false;
      const xButtonPressed = xButtonNow && !gamepadState.current.xButton;
      gamepadState.current.xButton = xButtonNow;
      
      // Debug X button press
      if (xButtonPressed) {
        console.log('🎮 [VEHICLE] X button pressed!', {
          hasVehicleSys: !!vehicleSys,
          nearVehicle: vehicleSys?.nearVehicle,
          isInVehicle: vehicleSys?.isInVehicle
        });
      }
      
      // Check if near vehicle and handle enter
      if (xButtonPressed && vehicleSys && vehicleSys.nearVehicle && !vehicleSys.isInVehicle) {
        console.log('🚁 [VEHICLE] Entering vehicle from X button!');
        vehicleSys.enterVehicle({
          position: vehicleSys.nearVehicle.position,
          rotation: new THREE.Euler(0, 0, 0)
        });
      }
      
      // Handle keyboard E key for entering vehicle (using justPressed to prevent holding)
      const eKeyJustPressed = justPressed.current['e'] || justPressed.current['E'];
      if (eKeyJustPressed && vehicleSys && vehicleSys.nearVehicle && !vehicleSys.isInVehicle) {
        console.log('🚁 [VEHICLE] Entering vehicle from E key!');
        vehicleSys.enterVehicle({
          position: vehicleSys.nearVehicle.position,
          rotation: new THREE.Euler(0, 0, 0)
        });
        // Clear just pressed
        delete justPressed.current['e'];
        delete justPressed.current['E'];
      }
      
      // Check weapon controls (LB/RB for weapon switching, etc.)
      weaponSystem.checkGamepadControls();
      
      // Shoot when RT pressed (only if not in menu and not jetpacking)
      // When jetpack is equipped AND we're not in first-person mode, RT is used for
      // jetpack thrust instead of shooting — skip the shoot branch entirely.
      const jetpackOwned = useInventoryStore.getState().hasEffect('enableJetpack');
      const rtIsForJetpack = jetpackOwned && !firstPersonMode;
      if (!settingsMenuOpen && rtPressed && !isJetpackingRef.current && !rtIsForJetpack && weaponSystem.canShoot && ref.current) {
        let shootPos, direction;
        
        if (firstPersonMode) {
          // FPS: derive position & direction from published globals, NOT camera object.
          // After weapon state changes, CameraFollower remounts and its useFrame moves
          // to end-of-queue — OrbitControls then overwrites camera.position before we
          // read it.  The published globals are always correct.
          const fpsYaw   = window.__CF_FPS_CAMERA_YAW__ || 0;
          const fpsPitch = window.__CF_CAM_V_ANGLE__    || 0;
          const fpsPos   = window.__CF_FPS_CAM_POS__;
          if (!fpsPos) return; // first frame guard
          const cosPitch = Math.cos(fpsPitch);
          direction = [
            -cosPitch * Math.sin(fpsYaw),   // camera forward X
             Math.sin(fpsPitch),            // camera forward Y (pitch)
            -cosPitch * Math.cos(fpsYaw)    // camera forward Z
          ];
          const forwardOffset = 2.5;
          shootPos = [
            fpsPos[0] + direction[0] * forwardOffset,
            fpsPos[1] + direction[1] * forwardOffset,
            fpsPos[2] + direction[2] * forwardOffset
          ];
        } else {
          // Third-person: shoot from character position in character facing direction
          const avatar = window.__CF_LOCAL_AVATAR__ || {};
          const yaw = avatar.yaw || yawRef.current;
          direction = [
            Math.sin(yaw),
            0, // Shoot horizontally in 3rd person
            Math.cos(yaw)
          ];
          
          const weaponOffset = 1.5;
          // Use ref world position for accurate height
          const worldPos = new THREE.Vector3();
          ref.current.getWorldPosition(worldPos);
          shootPos = [
            worldPos.x + direction[0] * weaponOffset,
            worldPos.y + 5.0 + (avatar.lift || 0),
            worldPos.z + direction[2] * weaponOffset
          ];
        }
        
        weaponSystem.shoot(shootPos, direction, characterId);
        // Mark shooting for animation broadcast
        isShootingRef.current = true;
        shootTimerRef.current = 0.2; // 200ms decay
      }
    }
    
    // Mouse shooting (left click) — skip if gizmo is active
    if (!settingsMenuOpen && !window.__CF_RIFLE_DRAGGING__ && mouseDownRef.current && weaponSystem.canShoot && ref.current) {
      let shootPos, direction;
      
      if (firstPersonMode) {
        // FPS: derive position & direction from published globals (see RT block above)
        const fpsYaw   = window.__CF_FPS_CAMERA_YAW__ || 0;
        const fpsPitch = window.__CF_CAM_V_ANGLE__    || 0;
        const fpsPos   = window.__CF_FPS_CAM_POS__;
        if (!fpsPos) return; // first frame guard
        const cosPitch = Math.cos(fpsPitch);
        direction = [
          -cosPitch * Math.sin(fpsYaw),
           Math.sin(fpsPitch),
          -cosPitch * Math.cos(fpsYaw)
        ];
        const forwardOffset = 2.5;
        shootPos = [
          fpsPos[0] + direction[0] * forwardOffset,
          fpsPos[1] + direction[1] * forwardOffset,
          fpsPos[2] + direction[2] * forwardOffset
        ];
      } else {
        // Third-person: shoot from character position
        const avatar = window.__CF_LOCAL_AVATAR__ || {};
        const yaw = avatar.yaw || yawRef.current;
        direction = [
          Math.sin(yaw),
          0,
          Math.cos(yaw)
        ];
        
        const weaponOffset = 1.5;
        // Use ref world position for accurate height
        const worldPos = new THREE.Vector3();
        ref.current.getWorldPosition(worldPos);
        shootPos = [
          worldPos.x + direction[0] * weaponOffset,
          worldPos.y + 5.0 + (avatar.lift || 0),
          worldPos.z + direction[2] * weaponOffset
        ];
      }
      
      weaponSystem.shoot(shootPos, direction, characterId);
      // Mark shooting for animation broadcast
      isShootingRef.current = true;
      shootTimerRef.current = 0.2; // 200ms decay
    }
    
    // Decay shooting timer
    if (shootTimerRef.current > 0) {
      shootTimerRef.current -= dt;
      if (shootTimerRef.current <= 0) {
        isShootingRef.current = false;
        shootTimerRef.current = 0;
      }
    }
    
    // Check proximity to vehicle (find jet model in placedCubes)
    const vehicleSys = window.__CF_VEHICLE_SYSTEM__;
    if (vehicleSys && ref.current && !vehicleSys.isInVehicle && placedCubes) {
      const playerPos = new THREE.Vector3();
      ref.current.getWorldPosition(playerPos);
      

      
      // Find any placed model with "jet" in its model path
      const jetCube = placedCubes.find(cube => 
        cube.customModelPath && (
          cube.customModelPath.toLowerCase().includes('jet') || 
          cube.customModelPath.toLowerCase().includes('space') ||
          cube.customModelPath.toLowerCase().includes('plane') ||
          cube.customModelPath.toLowerCase().includes('aircraft') ||
          cube.customModelPath.toLowerCase().includes('ship')
        )
      );
      
      if (jetCube) {
        
        // Use the jet's position from placedCubes
        const vehiclePos = new THREE.Vector3(
          jetCube.position[0], 
          jetCube.position[1], 
          jetCube.position[2]
        );
        
        // Calculate HORIZONTAL distance only (ignore Y axis)
        const horizontalDist = Math.sqrt(
          Math.pow(playerPos.x - vehiclePos.x, 2) + 
          Math.pow(playerPos.z - vehiclePos.z, 2)
        );
        

        
        // Use horizontal distance for proximity check (15 units)
        // Pass the ACTUAL vehicle position for storage, distance check uses horizontal only
        if (horizontalDist <= 15) {
          vehicleSys.checkNearVehicle(playerPos, vehiclePos, horizontalDist);
        } else {
          // Clear nearVehicle if too far
          vehicleSys.checkNearVehicle(playerPos, vehiclePos, 999);
        }
      }
    }
    
    const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const p = pressed.current;
    const jp = justPressed.current;
  // Tank controls with incremental turns on key tap (disabled when menu open)
    let turning = 0, moving = 0, strafing = 0;
  const leftHeld = !settingsMenuOpen && !!(p['ArrowLeft'] || p['a'] || p['A']);
  const rightHeld = !settingsMenuOpen && !!(p['ArrowRight'] || p['d'] || p['D']);
  if (firstPersonMode) {
    // FPS: A/D = strafe, W/S = forward/back
    if (leftHeld) strafing -= 1;  // strafe left
    if (rightHeld) strafing += 1;  // strafe right
  } else {
    // 3rd person: A/D = turn
    if (leftHeld) turning += 1;
    if (rightHeld) turning -= 1;
  }
    if (!settingsMenuOpen) {
      if (p['ArrowUp'] || p['w'] || p['W']) moving += 1;      // forward
      if (p['ArrowDown'] || p['s'] || p['S']) moving -= 1;    // backward
    }
    
    // Add gamepad input (only if menu is closed)
    const gp = gamepadState.current;
    if (!settingsMenuOpen) {
      if (firstPersonMode) {
        // FPS: left stick X = strafe, right stick X = camera only (handled by CameraFollower)
        if (gp.leftStickX !== 0) {
          strafing += gp.leftStickX; // Left stick X → strafe
        }
      } else {
        // 3rd person: both sticks turn character
        if (gp.leftStickX !== 0) {
          turning -= gp.leftStickX * (turnSensitivity * 0.5);
        }
        if (gp.rightStickX !== 0) {
          turning -= gp.rightStickX * turnSensitivity;
        }
      }
      if (gp.leftStickY !== 0) {
        moving -= gp.leftStickY; // Left stick up/down for forward/backward (inverted)
      }
    }
    
    if (invertForward) moving = -moving; // flip forward/back mapping for near side if needed
  // Running: Up/Down + 'R' key OR left stick click (independent of invertForward) - disabled when menu open
  const forwardKey = !!(p['ArrowUp'] || p['w'] || p['W']) || (!settingsMenuOpen && gp.leftStickY < -0.3);
  const backwardKey = !!(p['ArrowDown'] || p['s'] || p['S']) || (!settingsMenuOpen && gp.leftStickY > 0.3);
  const rPressed = !!(p['r'] || p['R']) || (!settingsMenuOpen && gp.leftStickClick);
  const runningNow = (forwardKey || backwardKey) && rPressed; // forward or backward + sprint
  const jetpackBoostActive = isJetpackingRef.current && rPressed && (Math.abs(moving) > 0.3 || Math.abs(strafing) > 0.3);
  if (runningNow !== isRunning) setIsRunning(runningNow);

  const keysActive = (turning !== 0) || (moving !== 0) || (strafing !== 0) || Object.keys(jp).length > 0;

  // Track backward movement for animation (AFTER invertForward flip so animations match actual movement direction)
  const anyMovement = moving !== 0 || strafing !== 0;
  if (moving < 0 && !isWalkingBackward) {
    setIsWalkingBackward(true);
    setIsWalking(false); // Clear forward walk when going backward
  } else if (moving > 0 || (strafing !== 0 && moving >= 0)) {
    // Moving forward or strafing - set walking and clear backward
    if (isWalkingBackward) setIsWalkingBackward(false);
    if (!isWalking) setIsWalking(true);
  } else if (!anyMovement && (isWalkingBackward || isWalking) && !targetRef.current) {
    setIsWalkingBackward(false);
    setIsWalking(false);
  }
  // Track strafe state for rifle-strafe animations (FPS mode only)
  // Use a dead zone and suppress strafe when forward/back movement dominates
  const strafeMag = Math.abs(strafing);
  const moveMag = Math.abs(moving);
  const strafeActive = firstPersonMode && strafeMag > 0.45 && strafeMag > moveMag;
  const strafeL = strafeActive && strafing < 0;
  const strafeR = strafeActive && strafing > 0;
  if (strafeL !== isStrafeLeft) setIsStrafeLeft(strafeL);
  if (strafeR !== isStrafeRight) setIsStrafeRight(strafeR);

    // Apply incremental turn on tap (discrete nudge), plus continuous when held
  const turnStep = 0.12; // ~6.9° per tap
    if (!settingsMenuOpen && !firstPersonMode) {
      // Only apply tap-turn in 3rd person; FPS uses A/D for strafe
      if (jp['ArrowLeft'] || jp['a'] || jp['A']) { yawRef.current += turnStep; }
      if (jp['ArrowRight'] || jp['d'] || jp['D']) { yawRef.current -= turnStep; }
    }
    // Clear justPressed after consuming
    justPressed.current = {};
    // Continuous turn while held (3rd person only; FPS turning is handled by CameraFollower)
    if (turning !== 0 && !firstPersonMode) {
      yawRef.current += turning * (turnSpeed || 0) * dt;
    }
    // In FPS mode, read the final camera yaw published by CameraFollower
    // CameraFollower computes totalYaw = behindYaw + horizontalAngle and writes it each frame
    // We use it directly for character rotation and movement — no absorb/reset needed
    const effYaw = firstPersonMode
      ? (window.__CF_FPS_CAMERA_YAW__ ?? yawRef.current ?? 0)
      : (yawRef.current || 0);
    // In sphere mode, orientation is set via quaternion — don't overwrite with Euler yaw
    // During transition (blend between 0 and 1), we handle rotation in the sphere block
    if (sphereBlendRef.current < 0.01) {
      ref.current.rotation.y = effYaw;
    }
    // Update turning state flags for animations - disabled in FPS and when menu open
    const turningLeftNow = !firstPersonMode && !settingsMenuOpen && ((leftHeld || gp.leftStickX < -0.3 || gp.rightStickX < -0.3) && moving === 0);
    const turningRightNow = !firstPersonMode && !settingsMenuOpen && ((rightHeld || gp.leftStickX > 0.3 || gp.rightStickX > 0.3) && moving === 0);
    setIsTurningLeft(turningLeftNow);
    setIsTurningRight(turningRightNow);

    // Jump trigger on Space press OR B button (only if grounded / not already jumping)
    // B button only triggers jump when edit menu is closed
  const spaceTapped = !!(jp['Space']) || (gp.bButtonPressed && !showEditMenu);
    const grounded = (jumpY <= 0.0001);
    // Current world Y of the avatar's feet (local ground baseline + platform lift + jump offset)
    const feetWorldY = localGroundY + platformLift + jumpY;
    if (spaceTapped && grounded && !isJumping) {
      // Set initial upward velocity based on desired apex height: vy = sqrt(2 * |g| * H)
      // Jumps use gentler gravity for a slower-looking arc
      curGravityRef.current = GRAVITY_JUMP;
      const vy0 = Math.sqrt(2 * Math.abs(curGravityRef.current) * TARGET_JUMP_HEIGHT);
      jumpVyRef.current = vy0;
      setIsJumping(true);
    }

    // ── Jetpack logic ──────────────────────────────────────────────────
    const jetpackUnlocked = useInventoryStore.getState().hasEffect('enableJetpack');
    const rtAnalog = jetpackRtAnalogRef.current;
    const fKeyHeld = !!(pressed.current['f'] || pressed.current['F']);
    const jetpackInput = (!settingsMenuOpen && jetpackUnlocked) ? Math.max(fKeyHeld ? 1.0 : 0, rtAnalog) : 0;
    const fuel = jetpackFuelRef.current;

    if (jetpackInput > 0.1) {
      // Activate jetpack (unlimited fuel)
      if (!isJetpackingRef.current) {
        isJetpackingRef.current = true;
        setIsJetpacking(true);
        // If grounded, initiate takeoff
        if (grounded && !isJumping) {
          curGravityRef.current = JETPACK_GRAVITY;
          jumpVyRef.current = JETPACK_THRUST * 0.3; // initial kick
          setIsJumping(true);
        }
      }
      // Fuel is unlimited — keep at max
      jetpackFuelRef.current = JETPACK_MAX_FUEL;
    } else if (isJetpackingRef.current && grounded) {
      // Landed while jetpacking → deactivate physics immediately, delay animation for smooth crossfade
      isJetpackingRef.current = false;
      jetpackVxRef.current = 0; jetpackVzRef.current = 0;
      if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
      jetpackLandTimerRef.current = setTimeout(() => setIsJetpacking(false), 300);
    }

    // Recharge fuel when grounded and not jetpacking
    if (grounded && !isJetpackingRef.current) {
      jetpackFuelRef.current = Math.min(JETPACK_MAX_FUEL, jetpackFuelRef.current + JETPACK_RECHARGE_RATE * dt);
    }
    // ── Jetpack tilt (proportional to left stick, extra lean during boost) ─
    if (isJetpackingRef.current) {
      // moving: -1 (back) to +1 (forward), turning: left/right stick combined
      const tiltMag = jetpackBoostActive ? JETPACK_BOOST_TILT : 0.52; // ~60° boost vs ~30° normal
      const tiltTargetX = -moving * tiltMag;
      const tiltTargetZ = turning * 0.35;   // ~20° side lean
      const tiltRate = jetpackBoostActive ? 4 : 6; // slightly slower ramp into boost lean
      jetpackTiltXRef.current += (tiltTargetX - jetpackTiltXRef.current) * Math.min(1, tiltRate * dt);
      jetpackTiltZRef.current += (tiltTargetZ - jetpackTiltZRef.current) * Math.min(1, tiltRate * dt);
    } else {
      // Lerp back to upright when not jetpacking
      jetpackTiltXRef.current += (0 - jetpackTiltXRef.current) * Math.min(1, 10 * dt);
      jetpackTiltZRef.current += (0 - jetpackTiltZRef.current) * Math.min(1, 10 * dt);
    }
    // ── End jetpack logic ──────────────────────────────────────────────

  // ══════════════════════════════════════════════════════════════════
  // ── SPHERE MODE: full spherical gravity on the giant moon ────────
  // ══════════════════════════════════════════════════════════════════
  let sphereHandled = false;
  {
    const ms = GIANT_MOON_SPHERE;
    if (ms) {
      // Current world position (3D)
      const bx = baseOffset?.[0] || 0;
      const bz = baseOffset?.[1] || 0;
      const curWx = bx + ref.current.position.x;
      const curWz = bz + ref.current.position.z;
      // In flat mode, world Y for the avatar's feet:
      const curWy = sphereModeRef.current >= 0.5
        ? ref.current.position.y   // sphere mode: Y is stored in ref
        : (localGroundY + platformLift + jumpY); // flat mode: derived from lift

      // Distance from player to sphere center
      const dx = curWx - ms.cx;
      const dy = curWy - ms.cy;
      const dz = curWz - ms.cz;
      const distToCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Sphere mode entry/exit thresholds
      const SPHERE_ENTRY_DIST = 120;   // start blending when within 120 units of surface
      const SPHERE_EXIT_DIST  = 200;   // start blending out when > 200 units from surface
      const SPHERE_BLEND_SPEED = 0.8;  // blend speed (0→1 in ~1.25 seconds)
      const surfData = getSphereSurfaceData(curWx, curWy, curWz);
      const distFromSurf = surfData ? surfData.distFromSurface : 9999;

      // Set blend target based on distance
      if (Math.abs(distFromSurf) < SPHERE_ENTRY_DIST) {
        sphereTargetRef.current = 1; // want to be in sphere mode
      } else if (Math.abs(distFromSurf) > SPHERE_EXIT_DIST) {
        sphereTargetRef.current = 0; // want to leave sphere mode
      }
      // Gradually lerp blend toward target
      const prevBlend = sphereBlendRef.current;
      const target = sphereTargetRef.current;
      if (Math.abs(prevBlend - target) > 0.001) {
        sphereBlendRef.current += (target - prevBlend) * Math.min(1, SPHERE_BLEND_SPEED * dt);
        if (Math.abs(sphereBlendRef.current - target) < 0.005) sphereBlendRef.current = target;
      }
      const blend = sphereBlendRef.current;

      // Hard switch for physics mode (which coordinate system to use)
      // Physics switches at blend=0.5, but orientation/camera blend smoothly
      if (sphereModeRef.current < 0.5 && blend >= 0.5) {
        // ── ENTER sphere physics ──
        sphereModeRef.current = 1;
        // Immediately project ref onto the sphere surface so avatar and camera agree on frame 1
        if (surfData) {
          ref.current.position.x = surfData.surfacePoint[0] - bx;
          ref.current.position.y = surfData.surfacePoint[1];
          ref.current.position.z = surfData.surfacePoint[2] - bz;
        } else {
          ref.current.position.y = curWy;
        }
        const entryJumpY = Math.max(0, distFromSurf);
        setPlatformLift(-localGroundY);
        setJumpY(entryJumpY);
        sphereJumpYRef.current = entryJumpY;            // sync ref (avoids stale React state)
        spherePlatformLiftRef.current = -localGroundY;  // sync ref
        // Start falling toward the surface
        if (entryJumpY > 1) {
          curGravityRef.current = GRAVITY_FALL;
          if (!isJumping) setIsJumping(true);
        }
        jumpVyRef.current = jumpVyRef.current; // keep current velocity for smooth transition
      } else if (sphereModeRef.current >= 0.5 && blend < 0.5) {
        // ── EXIT sphere physics ──
        sphereModeRef.current = 0;
        // Transfer sphere 3D position back into flat-mode paradigm
        const savedY = ref.current.position.y;
        ref.current.position.y = 0;
        ref.current.quaternion.identity();
        ref.current.rotation.y = yawRef.current || 0;
        // Convert world Y back into platformLift + jumpY for flat mode
        const flatGroundH = getGroundHeightXZAtY(curWx, curWz, savedY);
        // If we're high above flat ground, start a fall
        const heightAboveGround = savedY - (localGroundY + flatGroundH);
        if (heightAboveGround > 2.0) {
          // High up: start falling from current height
          setPlatformLift(0);
          setJumpY(savedY - localGroundY);
          jumpVyRef.current = jumpVyRef.current; // preserve downward velocity
          curGravityRef.current = GRAVITY_FALL;
          if (!isJumping) setIsJumping(true);
        } else {
          // Close to ground: just snap to ground
          setPlatformLift(flatGroundH);
          setJumpY(0);
          jumpVyRef.current = 0;
        }
      }

      // ── Compute sphere orientation (always, for smooth blending) ──
      if (surfData) {
        const sn = surfData.surfaceNormal;
        const surfNormal = _tmpV3a.set(sn[0], sn[1], sn[2]);
        sphereUpRef.current.lerp(surfNormal, Math.min(1, 6 * dt)); // smooth normal transition
        sphereUpRef.current.normalize();

        // Build sphere orientation quaternion
        _tmpQ1.setFromUnitVectors(_Y_AXIS, sphereUpRef.current);
        _tmpQ2.setFromAxisAngle(sphereUpRef.current, effYaw);
        sphereQRef.current.copy(_tmpQ2).multiply(_tmpQ1);

        // Build flat orientation quaternion (just yaw around world Y)
        _flatQ.setFromAxisAngle(_Y_AXIS, effYaw);

        // Slerp between flat and sphere orientation based on blend
        // Use a dampened curve (blend^3) so orientation barely changes during approach
        // and only really kicks in once nearly grounded
        if (blend > 0.01) {
          const bodyBlend = blend * blend * blend; // cubic ease-in: 0.5→0.125, 0.8→0.512
          _flatQ.slerp(sphereQRef.current, bodyBlend);
          ref.current.quaternion.copy(_flatQ);
        }
      }

      // ── Process sphere-mode physics ──
      if (sphereModeRef.current >= 0.5 && surfData) {
        sphereHandled = true;

        // ── Movement in tangent plane ──
        const inputMag = Math.min(1, Math.sqrt(moving * moving + strafing * strafing));
        if (inputMag > 0.001) {
          // Forward and right directions in tangent plane (derived from sphere orientation)
          const fwd3D = _tmpV3a.set(0, 0, -1).applyQuaternion(sphereQRef.current);
          const right3D = _tmpV3b.set(1, 0, 0).applyQuaternion(sphereQRef.current);
          // Combined movement direction
          const dirX = fwd3D.x * moving + right3D.x * strafing;
          const dirY = fwd3D.y * moving + right3D.y * strafing;
          const dirZ = fwd3D.z * moving + right3D.z * strafing;
          const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
          const ndx = dirLen > 0.001 ? dirX / dirLen : 0;
          const ndy = dirLen > 0.001 ? dirY / dirLen : 0;
          const ndz = dirLen > 0.001 ? dirZ / dirLen : 0;

          // Compute step size (same as flat mode)
          let step;
          if (isJetpackingRef.current) {
            const jetSpdBase = JETPACK_AIR_SPEED_MUL + inputMag * (JETPACK_FWD_SPEED_BOOST - JETPACK_AIR_SPEED_MUL);
            const boostMul = jetpackBoostActive ? JETPACK_BOOST_MUL : 1.0;
            step = speed * jetSpdBase * boostMul * inputMag * dt;
          } else {
            const speedMul = runningNow ? 2.0 : 1.0;
            step = speed * speedMul * dt * inputMag;
          }

          // Move along tangent plane
          const movedX = curWx + ndx * step;
          const movedY = curWy + ndy * step;
          const movedZ = curWz + ndz * step;

          // Project back onto sphere surface
          const pdx = movedX - ms.cx;
          const pdy = movedY - ms.cy;
          const pdz = movedZ - ms.cz;
          const pDist = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
          if (pDist > 0.001) {
            const pnx = pdx / pDist;
            const pny = pdy / pDist;
            const pnz = pdz / pDist;
            const bump = sphereBumpAt(pnx, pny, pnz);
            const surfR = ms.radius + bump;
            // Position ref at surface point (jumpY is handled by avatar's extraLiftY)
            const newX = ms.cx + pnx * surfR;
            const newY = ms.cy + pny * surfR;
            const newZ = ms.cz + pnz * surfR;
            ref.current.position.x = newX - bx;
            ref.current.position.y = newY;
            ref.current.position.z = newZ - bz;
          }
        }

        // ── Radial gravity / jump physics on sphere ──
        const sphereGrounded = (jumpY <= 0.001);
        if (isJumping || jumpY > 0.001) {
          let vy;
          if (isJetpackingRef.current) {
            const jetInput = Math.max((pressed.current['f'] || pressed.current['F']) ? 1.0 : 0, jetpackRtAnalogRef.current);
            if (jetInput > 0.1) {
              vy = jumpVyRef.current + (JETPACK_THRUST * jetInput + JETPACK_GRAVITY) * dt;
            } else {
              vy = jumpVyRef.current + JETPACK_GRAVITY * dt;
            }
            vy = Math.max(-JETPACK_MAX_VY, Math.min(JETPACK_MAX_VY, vy));
            const hasStickInput = Math.abs(moving) > 0.15 || Math.abs(strafing) > 0.15;
            const descending = vy < -1;
            setIsFalling(descending && !hasStickInput && (Math.max((pressed.current['f'] || pressed.current['F']) ? 1.0 : 0, jetpackRtAnalogRef.current) < 0.1));
          } else {
            vy = jumpVyRef.current + curGravityRef.current * dt;
          }
          let y = jumpY + vy * dt;

          // Landing on sphere surface
          if (y <= 0) {
            y = 0; vy = 0;
            setIsJumping(false); setIsFalling(false);
            if (isJetpackingRef.current) {
              isJetpackingRef.current = false;
              jetpackVxRef.current = 0; jetpackVzRef.current = 0;
              if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
              setIsJetpacking(false);
            }
          }
          jumpVyRef.current = vy;
          sphereJumpYRef.current = y;  // sync ref for publish (avoids 1-frame lag)
          if (Math.abs(y - jumpY) > 0.00001) setJumpY(y);

          // Update ref.position for new jumpY
          const reSurf = getSphereSurfaceData(
            bx + ref.current.position.x,
            ref.current.position.y,
            bz + ref.current.position.z
          );
          if (reSurf) {
            const rsn = reSurf.surfaceNormal;
            const rsp = reSurf.surfacePoint;
            // Keep ref at surface point; jumpY offset is handled by avatar extraLiftY
            ref.current.position.x = rsp[0] - bx;
            ref.current.position.y = rsp[1];
            ref.current.position.z = rsp[2] - bz;
          }
        }

        // No movement → still re-project onto sphere each frame (in case we just entered)
        if (inputMag <= 0.001 && jumpY <= 0.001 && !isJumping) {
          const reSurf2 = getSphereSurfaceData(
            bx + ref.current.position.x,
            ref.current.position.y,
            bz + ref.current.position.z
          );
          if (reSurf2) {
            ref.current.position.x = reSurf2.surfacePoint[0] - bx;
            ref.current.position.y = reSurf2.surfacePoint[1];
            ref.current.position.z = reSurf2.surfacePoint[2] - bz;
          }
        }
      } // end sphere physics
    } // end if (ms)
  } // end sphere mode block

  // ══════════════════════════════════════════════════════════════════
  // ── FLAT MODE: normal terrain movement (skipped if sphere handled)
  // ══════════════════════════════════════════════════════════════════
  if (!sphereHandled) {

  // Apply forward/back + strafe movement using facing direction
    // effYaw already contains camera yaw in FPS mode, character yaw in 3rd person
    const moveYaw = effYaw;
    if (moving !== 0 || strafing !== 0) {
      // Forward direction based on effYaw (camera yaw in FPS, character yaw in 3rd person)
      const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), effYaw);
      fwd.y = 0; fwd.normalize();
      // Right direction (perpendicular to forward on XZ plane)
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // cross(up, fwd) = true right
      // Combined direction: forward/back + strafe
      const dir = new THREE.Vector3(
        fwd.x * moving + right.x * strafing,
        0,
        fwd.z * moving + right.z * strafing
      );
      if (dir.length() > 0) dir.normalize();
      // Dynamic forward collision offset: reduce when descending forward to avoid hanging at bottom
      let dynamicFwd = COLLISION_FWD_OFFSET;
      let descendingForward = false;
      let ascendingBackward = false;
  if (moving > 0) {
        const wxNowKeys = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
        const wzNowKeys = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
        const fwdKeys = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), moveYaw);
        fwdKeys.y = 0; fwdKeys.normalize();
    const swxKeys = wxNowKeys + fwdKeys.x * GROUND_SAMPLE_PUSH;
    const swzKeys = wzNowKeys + fwdKeys.z * GROUND_SAMPLE_PUSH;
  const gyAhead = getGroundHeightXZAtY(swxKeys, swzKeys, feetWorldY);
        descendingForward = (gyAhead < (platformLift - 0.05));
        if (descendingForward) {
          lastDescendFwdTimeRef.current = nowT;
          // At the top of stairs (high drop), use SHORT offset to allow entering
          // At the bottom of stairs (small drop), use LONG offset to clear nosing
          const drop = platformLift - gyAhead;
          const atTop = drop > (STAIR_RISE * 2); // More than 2 steps drop = at top
          const baseMag = atTop ? 0.5 : 6.0; // Short at top, long at bottom
          const mag = baseMag * STAIR_MAG_MUL;
          dynamicFwd = (COLLISION_FWD_OFFSET >= 0) ? mag : -mag;
        }
      } else if (moving < 0) {
        // Backward motion: detect ascending backward using ground sample behind the avatar
        const wxNowKeys = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
        const wzNowKeys = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
        const fwdKeys = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), moveYaw);
        fwdKeys.y = 0; fwdKeys.normalize();
  // Probe farther behind to detect upcoming riser early for backward ascent
  const backMagKeys = Math.max(getBehindProbeMag(), 4.6 * STAIR_MAG_MUL);
  const swxBack = wxNowKeys - fwdKeys.x * backMagKeys;
  const swzBack = wzNowKeys - fwdKeys.z * backMagKeys;
  const gyBehind = getGroundHeightXZAtY(swxBack, swzBack, feetWorldY);
  ascendingBackward = (gyBehind > (platformLift + 0.05));
        // Also detect descending while moving backward: if ground ahead of us (relative to movement) is lower
        const swxBackAhead = wxNowKeys + fwdKeys.x * GROUND_SAMPLE_PUSH; // "ahead" in world = toward facing, but we're moving back relative to it
        const swzBackAhead = wzNowKeys + fwdKeys.z * GROUND_SAMPLE_PUSH;
        const gyBackAhead = getGroundHeightXZAtY(swxBackAhead, swzBackAhead, feetWorldY);
        const descendingBackward = (gyBackAhead < (platformLift - 0.05));
        if (descendingBackward) {
          lastDescendBackTimeRef.current = nowT;
          // Place collision center behind while descending backward to keep the back end clear of nosing
          const baseMag = 8.0;
          const mag = baseMag * STAIR_MAG_MUL;
          dynamicFwd = -Math.abs(mag);
        }
        if (ascendingBackward) {
          lastAscendBackTimeRef.current = nowT;
          // Place collision center behind to match movement side, keep it out a bit to avoid early hang-ups
          const baseMag = 8.0;
          const mag = baseMag * STAIR_MAG_MUL;
          // Always place collision center behind relative to facing when moving backward
          dynamicFwd = -Math.abs(mag);
        }
      }
  const descendActive = descendingForward || ((nowT - lastDescendFwdTimeRef.current) < 900) || (((nowT - lastDescendBackTimeRef.current) < 900));
      const ascendBackActive = ascendingBackward || ((nowT - lastAscendBackTimeRef.current) < 900);
      const offX = dir.x * dynamicFwd;
      const offZ = dir.z * dynamicFwd;
  // ── Jetpack momentum-based XZ or normal position step ──
  // Combined input magnitude for movement (forward/back + strafe)
  const inputMag = Math.min(1, Math.sqrt(moving * moving + strafing * strafing));
  let nx, nz, step;
  if (isJetpackingRef.current) {
    // Momentum-based: compute target speed, lerp velocity, apply drag
    const jetSpdBase = JETPACK_AIR_SPEED_MUL + inputMag * (JETPACK_FWD_SPEED_BOOST - JETPACK_AIR_SPEED_MUL);
    const boostMul = jetpackBoostActive ? JETPACK_BOOST_MUL : 1.0;
    const targetSpeed = speed * jetSpdBase * boostMul * inputMag;
    const targetVx = dir.x * targetSpeed;
    const targetVz = dir.z * targetSpeed;
    // Lerp toward target velocity (lower JETPACK_XZ_ACCEL = more glide)
    const lerpFactor = Math.min(1, JETPACK_XZ_ACCEL * dt);
    jetpackVxRef.current += (targetVx - jetpackVxRef.current) * lerpFactor;
    jetpackVzRef.current += (targetVz - jetpackVzRef.current) * lerpFactor;
    // Frame-rate-independent drag (momentum retention when no input)
    const dragPow = Math.pow(JETPACK_XZ_DRAG, dt * 60);
    jetpackVxRef.current *= dragPow;
    jetpackVzRef.current *= dragPow;
    nx = ref.current.position.x + jetpackVxRef.current * dt;
    nz = ref.current.position.z + jetpackVzRef.current * dt;
    step = 0; // not used during jetpack (collision bypassed), but keeps variable in scope
  } else {
    // Normal ground movement: instant position step (unchanged)
    const speedMul = (runningNow ? 2.0 : 1.0);
    step = speed * speedMul * dt * inputMag;
    nx = ref.current.position.x + dir.x * step;
    nz = ref.current.position.z + dir.z * step;
  }
      // remember velocity for optional facing logic (disabled during keys)
      velRef.current.x = dir.x * moving;
      velRef.current.z = dir.z * moving;
      // Collision against rectangular obstacles (world coords) + stair AABBs (XZ walls)
      const wxTry = nx + (baseOffset?.[0] || 0);
      const wzTry = nz + (baseOffset?.[1] || 0);
  const intersectsAny = (xw, zw) => {
        let rectHit = false;
        let stairHit = false;
        // Apply forward offset to collision center in world space
        const xw2 = xw + offX;
        const zw2 = zw + offZ;
        // Compute stair XZ footprints once (stair2 and stair3)
        const stair2HalfW = STAIR2_WIDTH / 2;
        const stair2XMin = STAIR2_POS_X - stair2HalfW - collisionRadius;
        const stair2XMax = STAIR2_POS_X + stair2HalfW + collisionRadius;
        const stair2ZMin = STAIR2_POS_Z - 0.01;
        const stair2ZMax = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4);
        
        // STAIR3 - rotated 90° (goes in -X direction)
        const stair3HalfW = STAIR3_WIDTH / 2;
        const stair3ZMin = STAIR3_POS_Z - stair3HalfW - collisionRadius;
        const stair3ZMax = STAIR3_POS_Z + stair3HalfW + collisionRadius;
        const stair3XMax = STAIR3_POS_X + 0.01;
        const stair3XMin = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN - (STAIR3_RUN * 2.4);
        
        const inAnyStairXZ = (xx, zz) => (
          (xx >= stair2XMin && xx <= stair2XMax && zz >= stair2ZMin && zz <= stair2ZMax) ||
          (xx >= stair3XMin && xx <= stair3XMax && zz >= stair3ZMin && zz <= stair3ZMax)
        );
        // Wider corridor check that accounts for the forward-offset green dot and gives extra margin at edges
        const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
        const extraZ = Math.max(0.15, STAIR2_RUN * 1.2);
        const stair2XMinWide = STAIR2_POS_X - stair2HalfW - extraXM;
        const stair2XMaxWide = STAIR2_POS_X + stair2HalfW + extraXM;
        const stair2ZMinWide = STAIR2_POS_Z - extraZ;
        const stair2ZMaxWide = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4) + extraZ;
        
        // STAIR3 wide (rotated)
        const extraZ3 = Math.max(0.15, STAIR3_RUN * 1.2);
        const stair3ZMinWide = STAIR3_POS_Z - stair3HalfW - extraZ3;
        const stair3ZMaxWide = STAIR3_POS_Z + stair3HalfW + extraZ3;
        const stair3XMaxWide = STAIR3_POS_X + extraXM;
        const stair3XMinWide = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN - (STAIR3_RUN * 2.4) - extraXM;
        
        const inAnyStairXZWide = (xx, zz) => {
          // Check built-in stairs
          if ((xx >= stair2XMinWide && xx <= stair2XMaxWide && zz >= stair2ZMinWide && zz <= stair2ZMaxWide) ||
              (xx >= stair3XMinWide && xx <= stair3XMaxWide && zz >= stair3ZMinWide && zz <= stair3ZMaxWide)) {
            return true;
          }
          // Check placed stairs2 models (EXACT same as STAIR3)
          const cubes = CURRENT_PLACED_CUBES || [];
          for (const cube of cubes) {
            if (cube.modelType !== 'stairs2' || !cube.hasCollision) continue;
            const width = STAIR2_WIDTH * (cube.scale.x || 1);
            const run = STAIR2_RUN * (cube.scale.z || 1);
            const steps = STAIR2_STEPS;
            const posX = cube.position.x || 0;
            const posZ = cube.position.z || 0;
            const halfW = width / 2;
            const totalLen = steps * run;
            const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
            const xMin = posX - halfW - extraXM;
            const xMax = posX + halfW + extraXM;
            const extraZM = run * 0.75;
            const zMin = posZ - extraZM;
            const zMax = posZ + totalLen + extraZM;
            if (xx >= xMin && xx <= xMax && zz >= zMin && zz <= zMax) {
              return true;
            }
          }
          return false;
        };
        // OLD TABLE COLLISION (obstacles array) - DISABLED, now using height-bounded AABB system
        // The table collision is now handled below in the aabbs loop with proper height checking
        /* for (const r of obstacles || []) {
          if (!r) continue;
          const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
          if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
            // Expand rect by radius
            if (xw2 >= (minX - collisionRadius) && xw2 <= (maxX + collisionRadius) &&
                zw2 >= (minZ - collisionRadius) && zw2 <= (maxZ + collisionRadius)) {
              // If we're inside the stair corridor, ignore rectangular obstacle to allow entering steps
              const inStairXZ = inAnyStairXZWide(xw, zw) || inAnyStairXZWide(xw2, zw2);
              if (!inStairXZ) rectHit = true;
            }
          }
        } */
        // Stair walls in XZ (block only if feet are below step top)
        const aabbs = buildStairAABBsWorld();
        const feetY = localGroundY + platformLift + jumpY;
        // If we're inside the stair corridor (with generous margin) and descending, don't block on stair AABBs
        const inStairXZHereWide = inAnyStairXZWide(xw, zw) || inAnyStairXZWide(xw2, zw2);
        for (const b of aabbs) {
          const idx = (typeof b.idx === 'number') ? b.idx : 99;
          const isRailBox = b.isRailBox === true; // rail boxes are treated as regular collision objects
          const isPlatform = b.isPlatform === true; // platform boxes are solid collision surfaces (includes table)
          const isPlatformEdge = b.isPlatformEdge === true; // platform edge walls - always solid
          
          // Skip ALL stair step boxes - only process rail boxes, platforms, and edges
          if (!isRailBox && !isPlatform && !isPlatformEdge) {
            continue; // Skip all stair steps - no collision
          }
          
          // Rail boxes use fixed expand for consistent behavior, stairs use reduced expand for smaller characters
          // Astronaut (3.7): railExpand = 1.0, Alien (3.75): railExpand = 3.0
          const railExpand = collisionRadius <= 3.7 ? 1.0 : collisionRadius <= 3.75 ? 3.0 : 3.0;
          const stairExpand = collisionRadius <= 1.0 ? 0.0 : collisionRadius;
          const platformExpand = 0.0; // no expansion for platform collision (exact bounds, includes table)
          const edgeExpand = collisionRadius * 1.5; // platform edges use 1.5x expansion to catch collision early
          const expand = isPlatformEdge ? edgeExpand : (isPlatform ? platformExpand : (isRailBox ? railExpand : ((idx <= 5) ? 0.0 : (idx <= 6 ? (stairExpand * 0.10) : stairExpand))));
          // Test probe points - three-point collision check for all characters (base, offset, midpoint)
          const pmx = (xw + xw2) * 0.5, pmz = (zw + zw2) * 0.5; // midpoint between base and offset
          const hitAt = (xx, zz, b, expand) => {
            // Use circular collision for rocket base / placed spheres
            if (b.isRocketBase && b.centerX !== undefined && b.centerZ !== undefined && b.radius !== undefined) {
              const dx = xx - b.centerX;
              const dz = zz - b.centerZ;
              const dist = Math.sqrt(dx * dx + dz * dz);
              return dist < (b.radius + expand);
            }
            // Regular box collision
            const minX = b.min.x - expand, maxX = b.max.x + expand;
            const minZ = b.min.z - expand, maxZ = b.max.z + expand;
            return (xx >= minX && xx <= maxX && zz >= minZ && zz <= maxZ);
          };
          // All characters use three-point check: offset point, base point, and midpoint probe
          const hit = hitAt(xw2, zw2, b, expand) || hitAt(xw, zw, b, expand) || hitAt(pmx, pmz, b, expand);
          if (hit) {
            // Platform edge walls use post-movement clamping (like world edge) - skip here
            if (isPlatformEdge) {
              continue;
            }
            
            // Platform boxes block horizontal movement when you're at their vertical level
            // BUT: Skip this check for circular platforms (isRocketBase) - they have custom handling below
            if (isPlatform && !b.isRocketBase) {
              const topY = b.max.y;
              const bottomY = b.min.y;
              const avatarHeight = 14.0; // typical avatar height
              // feetY already calculated above at line ~5211
              const headY = feetY + avatarHeight;
              
              // Only block if:
              // 1. Walking into side: feet are INSIDE the platform volume (with tolerance for stair transition)
              // 2. Walking under: head hits the bottom surface from below
              const tolerance = 2.0; // large tolerance - stairs are lower than platform bottom, allow smooth transition
              const walkingIntoSide = (feetY > (bottomY + tolerance) && feetY < topY);
              const headHitsCeiling = (headY > bottomY && headY < topY && feetY < bottomY);
              
              if (walkingIntoSide || headHitsCeiling) {
                stairHit = true;
                break;
              }
              continue;
            }
            
            // Rail boxes are treated as regular collision objects - no special handling
            // While descending, completely ignore more steps for small collision radius (astronaut)
            const descendIgnoreSteps = collisionRadius < 1.0 ? 6 : 3;
            if (!isRailBox && descendActive && idx <= descendIgnoreSteps) {
              continue;
            }
            if (!isRailBox && descendActive && inStairXZHereWide) {
              // Allow free descent within staircase corridor
              continue;
            }
            // If descending forward, ignore blocking from stair boxes that are behind us (tail area)
            if (!isRailBox && descendActive) {
              const bx = (b.min.x + b.max.x) * 0.5;
              const bz = (b.min.z + b.max.z) * 0.5;
              const toBoxX = bx - xw2;
              const toBoxZ = bz - zw2;
              const dot = toBoxX * dir.x + toBoxZ * dir.z;
              if (dot < 0) { continue; }
            }
            if (!isRailBox && ascendBackActive && inStairXZHereWide) {
              // Allow free ascent within staircase corridor when going up backwards
              continue;
            }
            // If ascending backward, ignore stair boxes ahead of facing (we're moving opposite)
            if (!isRailBox && ascendBackActive) {
              const bx = (b.min.x + b.max.x) * 0.5;
              const bz = (b.min.z + b.max.z) * 0.5;
              const toBoxX = bx - xw2;
              const toBoxZ = bz - zw2;
              const dot = toBoxX * dir.x + toBoxZ * dir.z;
              if (dot > 0) { continue; }
            }
            const topY = b.max.y;
            // Near the lower steps, require a much larger clearance before blocking (not for rail boxes)
            const blockThresh = isRailBox ? 0.02 : ((idx <= 5) ? 0.80 : (idx <= 7 ? 0.50 : 0.02));
            // When descending, allow passing OVER stair boxes if feet are above them
            // Use STAIR_RISE (1.8) as threshold since that's the height between steps
            if (descendActive && feetY > topY + (STAIR_RISE * 0.5)) {
              continue; // Feet are above this step - allow passing over to descend
            }
            if (feetY < topY - blockThresh) { stairHit = true; break; }
          }
        }
        return { rect: rectHit, stair: stairHit };
      };
      // Allow passing through table rect when sufficiently airborne or already on table
  const allowRectPass = onTable || ((platformLift + jumpY) >= (tableTopLift * 0.6));
      const shouldBlock = (xw, zw) => {
        // Skip all collisions while jetpacking (fly over everything)
        if (isJetpackingRef.current) return false;
        const hit = intersectsAny(xw, zw);
        return hit.stair || (hit.rect && !allowRectPass);
      };
      if (shouldBlock(wxTry, wzTry)) {
        // Wall sliding like modern games: try to maintain movement along the wall
        let slid = false;
        
        // First, try pure axis sliding (zero out one component of movement)
        // Try sliding along Z only (lock X position) - best for rails that run along Z
        const nxZ = ref.current.position.x;
        const nzZ = ref.current.position.z + dir.z * step;
        const wxZ = nxZ + (baseOffset?.[0] || 0);
        const wzZ = nzZ + (baseOffset?.[1] || 0);
        if (!shouldBlock(wxZ, wzZ)) {
          nx = nxZ;
          nz = nzZ;
          slid = true;
        }
        
        // Try sliding along X only (lock Z position) if Z-slide failed
        if (!slid) {
          const nxX = ref.current.position.x + dir.x * step;
          const nzX = ref.current.position.z;
          const wxX = nxX + (baseOffset?.[0] || 0);
          const wzX = nzX + (baseOffset?.[1] || 0);
          if (!shouldBlock(wxX, wzX)) {
            nx = nxX;
            nz = nzX;
            slid = true;
          }
        }
        
        // Try partial Z-axis sliding at reduced speeds
        if (!slid) {
          for (let zFrac = 0.9; zFrac >= 0.4; zFrac -= 0.1) {
            const nxTest = ref.current.position.x;
            const nzTest = ref.current.position.z + dir.z * step * zFrac;
            const wxTest = nxTest + (baseOffset?.[0] || 0);
            const wzTest = nzTest + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxTest, wzTest)) {
              nx = nxTest;
              nz = nzTest;
              slid = true;
              break;
            }
          }
        }
        
        // Try partial X-axis sliding at reduced speeds
        if (!slid) {
          for (let xFrac = 0.9; xFrac >= 0.4; xFrac -= 0.1) {
            const nxTest = ref.current.position.x + dir.x * step * xFrac;
            const nzTest = ref.current.position.z;
            const wxTest = nxTest + (baseOffset?.[0] || 0);
            const wzTest = nzTest + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxTest, wzTest)) {
              nx = nxTest;
              nz = nzTest;
              slid = true;
              break;
            }
          }
        }
        
        // Try partial diagonal sliding as last resort
        if (!slid) {
          for (let frac = 0.7; frac >= 0.2; frac -= 0.1) {
            const nxPartial = ref.current.position.x + dir.x * step * frac;
            const nzPartial = ref.current.position.z + dir.z * step * frac;
            const wxPartial = nxPartial + (baseOffset?.[0] || 0);
            const wzPartial = nzPartial + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxPartial, wzPartial)) {
              nx = nxPartial;
              nz = nzPartial;
              slid = true;
              break;
            }
          }
        }
        
        // If sliding fails, attempt auto-step-up for stair climbing
        if (!slid) {
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const lastStepUp = (ref.current && ref.current.__lastStepUpTime) || 0;
          const STEP_UP_COOLDOWN_MS = 90;
          const aabbs = buildStairAABBsWorld();
          const feetY = localGroundY + platformLift + jumpY;
          const ASCEND_FWD_PROBE_BASE = 4.6;
          const probeMag = (moving > 0) ? (ASCEND_FWD_PROBE_BASE * STAIR_MAG_MUL) : (moving < 0 ? (-ASCEND_FWD_PROBE_BASE * STAIR_MAG_MUL) : 0);
          const wxTry2 = wxTry + dir.x * probeMag;
          const wzTry2 = wzTry + dir.z * probeMag;
          let stepped = false;
          for (const b of aabbs) {
            const minX = b.min.x - collisionRadius, maxX = b.max.x + collisionRadius;
            const minZ = b.min.z - collisionRadius, maxZ = b.max.z + collisionRadius;
            if (wxTry2 >= minX && wxTry2 <= maxX && wzTry2 >= minZ && wzTry2 <= maxZ) {
              const topY = b.max.y;
              const delta = topY - feetY;
              if (delta > 0 && delta <= STEP_CLIMB_MAX && (now - lastStepUp) > STEP_UP_COOLDOWN_MS) {
                const newLift = (topY - localGroundY);
                setPlatformLift(newLift);
                const idx = (typeof b.idx === 'number') ? b.idx : 99;
                const minNudge = (idx === 0) ? 1.1 : (idx <= 2 ? 0.8 : 0.2);
                nx = ref.current.position.x + dir.x * Math.max(minNudge, step * 1.3);
                nz = ref.current.position.z + dir.z * Math.max(minNudge, step * 1.3);
                if (ref.current) ref.current.__lastStepUpTime = now;
                stepped = true;
              }
              break;
            }
          }
          // Only block completely if step-up also failed
          if (!stepped) {
            nx = ref.current.position.x;
            nz = ref.current.position.z;
          }
        }
      }
      // Clamp based on world position = parent + baseOffset (SQUARE boundary)
      const wx = nx + (baseOffset?.[0] || 0);
      const wz = nz + (baseOffset?.[1] || 0);
      
      // Square boundary check instead of circular
      const effectiveRadius = isJetpackingRef.current ? JETPACK_FLY_RADIUS : maxRadius;
      const maxX = effectiveRadius;
      const maxZ = effectiveRadius;
      
      if (Math.abs(wx) <= maxX && Math.abs(wz) <= maxZ) {
        // Inside square boundary - allow movement
        ref.current.position.x = nx;
        ref.current.position.z = nz;
      } else {
        // Outside square boundary - clamp to edges
        const clampedWx = Math.max(-maxX, Math.min(maxX, wx));
        const clampedWz = Math.max(-maxZ, Math.min(maxZ, wz));
        ref.current.position.x = clampedWx - (baseOffset?.[0] || 0);
        ref.current.position.z = clampedWz - (baseOffset?.[1] || 0);
      }
      
      // Clamp to platform edges and rocket base (like world edge - simple position clamping)
      const aabbs = buildStairAABBsWorld();
      for (const b of aabbs) {
        if (!b.isPlatformEdge && !b.isRocketBase) continue;
        const wx2 = ref.current.position.x + (baseOffset?.[0] || 0);
        const wz2 = ref.current.position.z + (baseOffset?.[1] || 0);
        const margin = collisionRadius * 1.5;
        
        // Only apply collision if player is within the wall's vertical bounds
        const feetY = localGroundY + platformLift + jumpY;
        const headY = feetY + AVATAR_FINAL_HEIGHT; // approximate head height
        if (feetY > b.max.y) continue; // Above the wall (feet above top), no collision
        if (headY < b.min.y) continue; // Below the wall (head below bottom), no collision
        
        // Handle circular rocket base collision
        if (b.isRocketBase) {
          const allowWalkOnTop = b.walkableTop === true;
          
          // Check if feet are near/on the top surface
          // For spheres (top hemisphere), use larger threshold so you can approach and climb on
          // For cylinders (flat top), use smaller threshold
          const isSphereTop = b.min.y > (b.max.y - b.radius); // Sphere top starts at center Y
          const topThreshold = isSphereTop ? 100.0 : 1.0; // 100 units for sphere, 1 unit for cylinder
          const onTopOfCylinder = feetY >= b.max.y - topThreshold;
          
          if (onTopOfCylinder && allowWalkOnTop) {
            // When on top, check if we're within the top disk radius
            const dx = wx2 - b.centerX;
            const dz = wz2 - b.centerZ;
            const distFromCenter = Math.sqrt(dx * dx + dz * dz);
            
            // If within the top disk, skip all collision (standing on flat top)
            // If outside the top disk but still near top height, skip collision (falling off edge)
            // This prevents the side walls from catching you as you walk off the flat top
            continue; // Always skip collision when at top height (whether inside or outside disk)
          }
          
          // Below the top: apply normal circular side collision
          const dx = wx2 - b.centerX;
          const dz = wz2 - b.centerZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const minDist = b.radius + margin;
          if (dist < minDist && dist > 0.001) {
            // Push player away from center (only applies when NOT on top)
            const pushX = b.centerX + (dx / dist) * minDist;
            const pushZ = b.centerZ + (dz / dist) * minDist;
            ref.current.position.x = pushX - (baseOffset?.[0] || 0);
            ref.current.position.z = pushZ - (baseOffset?.[1] || 0);
          }
          continue;
        }
        
        // Special handling for table box - block on 4 sides, but allow standing on top if walkableTop is enabled
        if (b.isTableBox) {
          // If walkableTop is enabled AND feet are at or above the top surface, don't apply side collision (standing on top)
          const onTopOfBox = feetY >= b.max.y - 1.0; // within 1 unit of top
          const allowWalkOnTop = b.walkableTop === true; // Check if this box allows walking on top
          
          if (onTopOfBox && allowWalkOnTop) {
            continue; // skip collision for this box when standing on top (only if walkableTop enabled)
          }
          
          const inXBounds = wx2 >= b.min.x && wx2 <= b.max.x;
          const inZBounds = wz2 >= b.min.z && wz2 <= b.max.z;
          
          // Check all 4 sides and push out from whichever is closest
          if (inXBounds && inZBounds) {
            // Inside the box - push out to nearest edge
            const distLeft = wx2 - b.min.x;
            const distRight = b.max.x - wx2;
            const distFront = wz2 - b.min.z;
            const distBack = b.max.z - wz2;
            const minDist = Math.min(distLeft, distRight, distFront, distBack);
            
            if (minDist === distLeft) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (minDist === distRight) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            } else if (minDist === distFront) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (minDist === distBack) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          } else if (inXBounds) {
            // In X bounds, check Z sides
            if (wz2 < b.min.z && wz2 > b.min.z - margin) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (wz2 > b.max.z && wz2 < b.max.z + margin) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          } else if (inZBounds) {
            // In Z bounds, check X sides
            if (wx2 < b.min.x && wx2 > b.min.x - margin) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (wx2 > b.max.x && wx2 < b.max.x + margin) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            }
          }
          continue;
        }
        
        // Only clamp if within the ACTUAL wall bounds (not at the ends)
        const inXBounds = wx2 >= b.min.x && wx2 <= b.max.x;
        const inZBounds = wz2 >= b.min.z && wz2 <= b.max.z;
        
        // Determine if this is an X-axis wall (long in X) or Z-axis wall (long in Z)
        const wallLengthX = b.max.x - b.min.x;
        const wallLengthZ = b.max.z - b.min.z;
        const isXWall = wallLengthX > wallLengthZ; // wall runs along X axis
        
        if (isXWall) {
          // X-axis wall: only clamp Z if within X bounds
          if (inXBounds) {
            const tooFront = wz2 < b.min.z;
            const tooBack = wz2 > b.max.z;
            if (tooFront && wz2 > b.min.z - margin) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (tooBack && wz2 < b.max.z + margin) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          }
        } else {
          // Z-axis wall: only clamp X if within Z bounds
          if (inZBounds) {
            const tooLeft = wx2 < b.min.x;
            const tooRight = wx2 > b.max.x;
            if (tooLeft && wx2 > b.min.x - margin) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (tooRight && wx2 < b.max.x + margin) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            }
          }
        }
      }
    // mark walking when keys cause translation
    setIsWalking(true);
  } else if (targetRef.current) {
      // Click-to-move: ease toward target when no key input
      const tx = Number(targetRef.current.x);
      const tz = Number(targetRef.current.z);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
        const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
        let vx = tx - wx;
        let vz = tz - wz;
        let dist = Math.hypot(vx, vz);
        const arriveEps = 0.25;
        if (dist <= arriveEps) {
          // Snap to target and notify arrival
          const localX = tx - (baseOffset?.[0] || 0);
          const localZ = tz - (baseOffset?.[1] || 0);
          // Clamp by world radius
          const rr = Math.hypot(tx, tz);
          if (rr <= maxRadius) {
            ref.current.position.x = localX;
            ref.current.position.z = localZ;
          } else {
            const ang = Math.atan2(tz, tx);
            ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
          }
          // On arrival: face a canonical board-facing yaw (0 radians)
          yawRef.current = 0;
          try {
            const wxFinal = (baseOffset?.[0] || 0) + ref.current.position.x;
            const wzFinal = (baseOffset?.[1] || 0) + ref.current.position.z;
            if (typeof onPositionChange === 'function') onPositionChange(wxFinal, wzFinal, yawRef.current || 0);
          } catch {}
          if (typeof onArrive === 'function') { try { onArrive(); } catch {} }
          targetRef.current = null;
          setIsWalking(false);
        } else {
          // Move toward target with same speed as keys
          vx /= (dist || 1);
          vz /= (dist || 1);
          const step = speed * dt;
          let nx = ref.current.position.x + vx * step;
          let nz = ref.current.position.z + vz * step;
          // remember velocity for facing
          velRef.current.x = vx;
          velRef.current.z = vz;
          // Collision against rectangular obstacles (world coords) + stair AABBs (XZ walls)
          const wxTry = nx + (baseOffset?.[0] || 0);
          const wzTry = nz + (baseOffset?.[1] || 0);
          // Compute forward offset from current yaw to shift collision center
          const face = new THREE.Vector3(0,0,-1);
          face.applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
          face.y = 0; face.normalize();
          // Determine descending-forward / descending-backward / ascending-backward for click path
          let descendingForwardClickFlag = false;
          let descendingBackwardClickFlag = false;
          let ascendingBackwardClickFlag = false;
          {
            const fwdEval = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
            fwdEval.y = 0; fwdEval.normalize();
            const swxAhead = wxTry + fwdEval.x * GROUND_SAMPLE_PUSH;
            const swzAhead = wzTry + fwdEval.z * GROUND_SAMPLE_PUSH;
            const gyAheadEval = getGroundHeightXZAtY(swxAhead, swzAhead, feetWorldY);
            descendingForwardClickFlag = (gyAheadEval < (platformLift - 0.05));
            const backMagClick = getBehindProbeMag();
            const swxBehind = wxTry - fwdEval.x * backMagClick;
            const swzBehind = wzTry - fwdEval.z * backMagClick;
            const gyBehindEval = getGroundHeightXZAtY(swxBehind, swzBehind, feetWorldY);
            ascendingBackwardClickFlag = (gyBehindEval > (platformLift + 0.05));
            // If moving backward relative to facing and the ground toward facing is lower, treat as descending backward
            const moveDot = (vx * fwdEval.x + vz * fwdEval.z);
            if (moveDot < 0) {
              const gyBackAheadEval = gyAheadEval; // sample toward facing as the next stair when backing down
              if (gyBackAheadEval < (platformLift - 0.05)) {
                descendingBackwardClickFlag = true;
              }
            }
          }
          // Apply dynamic forward offset for click path (similar to keys)
          let dynamicFwdClick = COLLISION_FWD_OFFSET;
          if (descendingForwardClickFlag) {
            const baseMag = 6.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? mag : -mag;
          } else if (descendingBackwardClickFlag) {
            // While backing down, place collision center behind to keep tail clear
            const baseMag = 8.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? -mag : mag;
          } else if (ascendingBackwardClickFlag) {
            const baseMag = 8.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? -mag : mag;
          }
          if (descendingBackwardClickFlag) { lastDescendBackTimeRef.current = nowT; }
          const descendActiveClick = descendingForwardClickFlag || descendingBackwardClickFlag || ((nowT - lastDescendFwdTimeRef.current) < 900) || (((nowT - lastDescendBackTimeRef.current) < 900));
          // Lengthen backward-ascend latch for click to match keyboard path
          const ascendBackActiveClick = ascendingBackwardClickFlag || ((nowT - lastAscendBackTimeRef.current) < 900);
          const offX = face.x * dynamicFwdClick;
          const offZ = face.z * dynamicFwdClick;
          const intersectsAny = (xw, zw) => {
            let rectHit = false;
            let stairHit = false;
            // Bypass rectangular obstacles inside stair corridor (only stair2 - stair1 removed)
            const stair2HalfW = STAIR2_WIDTH / 2;
            const stair2XMin = STAIR2_POS_X - stair2HalfW - collisionRadius;
            const stair2XMax = STAIR2_POS_X + stair2HalfW + collisionRadius;
            const stair2ZMin = STAIR2_POS_Z - 0.01;
            const stair2ZMax = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4);
            const xw2 = xw + offX; const zw2 = zw + offZ;
            // Wider corridor that accounts for offset and margins near edges
            const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
            const extraZ = Math.max(0.15, STAIR2_RUN * 1.2);
            const stair2XMinWide = STAIR2_POS_X - stair2HalfW - extraXM;
            const stair2XMaxWide = STAIR2_POS_X + stair2HalfW + extraXM;
            const stair2ZMinWide = STAIR2_POS_Z - extraZ;
            const stair2ZMaxWide = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4) + extraZ;
            for (const r of obstacles || []) {
              if (!r) continue;
              const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
              if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
                if (xw2 >= (minX - collisionRadius) && xw2 <= (maxX + collisionRadius) &&
                    zw2 >= (minZ - collisionRadius) && zw2 <= (maxZ + collisionRadius)) {
                  const inStair1 = false; // stair1 disabled
                  const inStair2 = (xw2 >= stair2XMinWide && xw2 <= stair2XMaxWide && zw2 >= stair2ZMinWide && zw2 <= stair2ZMaxWide);
                  const inStairXZ = inStair1 || inStair2;
                  if (!inStairXZ) rectHit = true;
                }
              }
            }
            const aabbs = buildStairAABBsWorld();
            const feetY = localGroundY + platformLift + jumpY;
            for (const b of aabbs) {
              const idx = (typeof b.idx === 'number') ? b.idx : 99;
              const isRailBox = b.isRailBox === true;
              const isPlatform = b.isPlatform === true; // platform boxes are solid collision surfaces
              const isPlatformEdge = b.isPlatformEdge === true; // platform edge walls - always solid
              // Do not relax for rail boxes, platforms, or edges; otherwise never block on the bottom four steps
              if (!isRailBox && !isPlatform && !isPlatformEdge && idx <= 3) {
                continue;
              }
              // Rail boxes use fixed expand for consistent behavior, stairs use reduced expand for smaller characters
              // Astronaut (3.7): railExpand = 1.0, Alien (3.75): railExpand = 3.0
              const railExpand = collisionRadius <= 3.7 ? 1.0 : collisionRadius <= 3.75 ? 3.0 : 3.0;
              const stairExpand = collisionRadius <= 1.0 ? 0.0 : collisionRadius;
              const platformExpand = 0.0; // no expansion for platform collision (exact bounds)
              const edgeExpand = collisionRadius * 1.5; // platform edges use 1.5x expansion to catch collision early
              const expand = isPlatformEdge ? edgeExpand : (isPlatform ? platformExpand : (isRailBox ? railExpand : ((idx <= 5) ? 0.0 : (idx <= 6 ? (stairExpand * 0.10) : stairExpand))));
              // Test probe points - three-point collision check for all characters (base, offset, midpoint)
              const pmx = (xw + xw2) * 0.5, pmz = (zw + zw2) * 0.5;
              const hitAt = (xx, zz, b, expand) => {
                // Use circular collision for rocket base / placed spheres
                if (b.isRocketBase && b.centerX !== undefined && b.centerZ !== undefined && b.radius !== undefined) {
                  const dx = xx - b.centerX;
                  const dz = zz - b.centerZ;
                  const dist = Math.sqrt(dx * dx + dz * dz);
                  return dist < (b.radius + expand);
                }
                // Regular box collision
                const minX = b.min.x - expand, maxX = b.max.x + expand;
                const minZ = b.min.z - expand, maxZ = b.max.z + expand;
                return (xx >= minX && xx <= maxX && zz >= minZ && zz <= maxZ);
              };
              // All characters use three-point check: offset point, base point, and midpoint probe
              const hit = hitAt(xw2, zw2, b, expand) || hitAt(xw, zw, b, expand) || hitAt(pmx, pmz, b, expand);
              if (hit) {
                // Platform edge walls use post-movement clamping (like world edge) - skip here
                if (isPlatformEdge) {
                  continue;
                }
                
                // Platform boxes block horizontal movement when you're at their vertical level
                if (isPlatform) {
                  const topY = b.max.y;
                  const bottomY = b.min.y;
                  const avatarHeight = 14.0; // typical avatar height
                  // feetY already calculated above at line ~5550
                  const headY = feetY + avatarHeight;
                  
                  // Only block if:
                  // 1. Walking into side: feet are INSIDE the platform volume (with tolerance for stair transition)
                  // 2. Walking under: head hits the bottom surface from below
                  const tolerance = 2.0; // large tolerance - stairs are lower than platform bottom, allow smooth transition
                  const walkingIntoSide = (feetY > (bottomY + tolerance) && feetY < topY);
                  const headHitsCeiling = (headY > bottomY && headY < topY && feetY < bottomY);
                  
                  if (walkingIntoSide || headHitsCeiling) {
                    stairHit = true;
                    break;
                  }
                  continue;
                }
                
                const inStair1Here = false; // stair1 disabled
                const inStair2Here = (xw2 >= stair2XMinWide && xw2 <= stair2XMaxWide && zw2 >= stair2ZMinWide && zw2 <= stair2ZMaxWide);
                const inStairXZHere = inStair1Here || inStair2Here;
                // While descending, completely ignore more steps for small collision radius (astronaut)
                const descendIgnoreSteps = collisionRadius < 1.0 ? 6 : 3;
                if (!isRailBox && descendActiveClick && idx <= descendIgnoreSteps) {
                  continue;
                }
                if (!isRailBox && descendActiveClick && inStairXZHere) {
                  // Allow free descent within staircase corridor
                  continue;
                }
                if (!isRailBox && ascendBackActiveClick && inStairXZHere) {
                  // Allow free ascent within staircase corridor when going up backwards
                  continue;
                }
                // If descending forward (click path), ignore stair boxes behind us
                if (!isRailBox && descendActiveClick) {
                  const bx = (b.min.x + b.max.x) * 0.5;
                  const bz = (b.min.z + b.max.z) * 0.5;
                  const toBoxX = bx - xw2;
                  const toBoxZ = bz - zw2;
                  const dot = toBoxX * face.x + toBoxZ * face.z;
                  if (dot < 0) { continue; }
                }
                // If ascending backward (click path), ignore stair boxes ahead of facing
                if (!isRailBox && ascendBackActiveClick) {
                  const bx = (b.min.x + b.max.x) * 0.5;
                  const bz = (b.min.z + b.max.z) * 0.5;
                  const toBoxX = bx - xw2;
                  const toBoxZ = bz - zw2;
                  const dot = toBoxX * face.x + toBoxZ * face.z;
                  if (dot > 0) { continue; }
                }
                const topY = b.max.y;
                const blockThresh = isRailBox ? 0.02 : ((idx <= 5) ? 0.80 : (idx <= 7 ? 0.50 : 0.02));
                if (feetY < topY - blockThresh) { stairHit = true; break; }
              }
            }
            return { rect: rectHit, stair: stairHit };
          };
          const allowRectPass = onTable || ((platformLift + jumpY) >= (tableTopLift * 0.6));
          const shouldBlock = (xw, zw) => {
            const hit = intersectsAny(xw, zw);
            return hit.stair || (hit.rect && !allowRectPass);
          };
          if (shouldBlock(wxTry, wzTry)) {
            // Wall sliding like modern games: try to maintain movement along the wall
            let slid = false;
            
            // First, try pure axis sliding (zero out one component of movement)
            // Try sliding along Z only (lock X position) - best for rails that run along Z
            const nxZ = ref.current.position.x;
            const nzZ = ref.current.position.z + vz * step;
            const wxZ = nxZ + (baseOffset?.[0] || 0);
            const wzZ = nzZ + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxZ, wzZ)) {
              nx = nxZ;
              nz = nzZ;
              slid = true;
            }
            
            // Try sliding along X only (lock Z position) if Z-slide failed
            if (!slid) {
              const nxX = ref.current.position.x + vx * step;
              const nzX = ref.current.position.z;
              const wxX = nxX + (baseOffset?.[0] || 0);
              const wzX = nzX + (baseOffset?.[1] || 0);
              if (!shouldBlock(wxX, wzX)) {
                nx = nxX;
                nz = nzX;
                slid = true;
              }
            }
            
            // Try partial Z-axis sliding at reduced speeds
            if (!slid) {
              for (let zFrac = 0.9; zFrac >= 0.4; zFrac -= 0.1) {
                const nxTest = ref.current.position.x;
                const nzTest = ref.current.position.z + vz * step * zFrac;
                const wxTest = nxTest + (baseOffset?.[0] || 0);
                const wzTest = nzTest + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxTest, wzTest)) {
                  nx = nxTest;
                  nz = nzTest;
                  slid = true;
                  break;
                }
              }
            }
            
            // Try partial X-axis sliding at reduced speeds
            if (!slid) {
              for (let xFrac = 0.9; xFrac >= 0.4; xFrac -= 0.1) {
                const nxTest = ref.current.position.x + vx * step * xFrac;
                const nzTest = ref.current.position.z;
                const wxTest = nxTest + (baseOffset?.[0] || 0);
                const wzTest = nzTest + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxTest, wzTest)) {
                  nx = nxTest;
                  nz = nzTest;
                  slid = true;
                  break;
                }
              }
            }
            
            // Try partial diagonal sliding as last resort
            if (!slid) {
              for (let frac = 0.7; frac >= 0.2; frac -= 0.1) {
                const nxPartial = ref.current.position.x + vx * step * frac;
                const nzPartial = ref.current.position.z + vz * step * frac;
                const wxPartial = nxPartial + (baseOffset?.[0] || 0);
                const wzPartial = nzPartial + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxPartial, wzPartial)) {
                  nx = nxPartial;
                  nz = nzPartial;
                  slid = true;
                  break;
                }
              }
            }
            
            // If sliding fails, attempt auto-step-up
            if (!slid) {
              let stepped = false;
              const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
              const lastStepUp = (ref.current && ref.current.__lastStepUpTime) || 0;
              const STEP_UP_COOLDOWN_MS = 90;
              const aabbs = buildStairAABBsWorld();
              const feetY = localGroundY + platformLift + jumpY;
              const tryX = ref.current.position.x + vx * step;
              const tryZ = ref.current.position.z + vz * step;
              if (Number.isFinite(tryX) && Number.isFinite(tryZ)) {
                const twx = tryX + (baseOffset?.[0] || 0);
                const twz = tryZ + (baseOffset?.[1] || 0);
                // Probe ahead for step-up detection
                const face2 = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
                face2.y = 0; face2.normalize();
                const ASCEND_FWD_PROBE_BASE = 4.6;
                const moveDot = (vx * face2.x + vz * face2.z);
                const probeMag2 = (moveDot >= 0 ? ASCEND_FWD_PROBE_BASE : -ASCEND_FWD_PROBE_BASE) * STAIR_MAG_MUL;
                const offX2 = face2.x * probeMag2;
                const offZ2 = face2.z * probeMag2;
                const twx2 = twx + offX2;
                const twz2 = twz + offZ2;
                for (const b of aabbs) {
                  const minX = b.min.x - collisionRadius, maxX = b.max.x + collisionRadius;
                  const minZ = b.min.z - collisionRadius, maxZ = b.max.z + collisionRadius;
                  if (twx2 >= minX && twx2 <= maxX && twz2 >= minZ && twz2 <= maxZ) {
                    const topY = b.max.y;
                    const delta = topY - feetY;
                    if (delta > 0 && delta <= STEP_CLIMB_MAX && (now - lastStepUp) > STEP_UP_COOLDOWN_MS) {
                      const newLift = (topY - localGroundY);
                      const cur = platformLift;
                      const k = LIFT_SMOOTH_UP_K;
                      const nextLift = cur + (newLift - cur) * Math.min(1, k * dt);
                      setPlatformLift(nextLift);
                      const idx = (typeof b.idx === 'number') ? b.idx : 99;
                      const minNudge = (idx === 0) ? 1.1 : (idx <= 2 ? 0.8 : 0.2);
                      nx = ref.current.position.x + vx * Math.max(minNudge, step * 1.3);
                      nz = ref.current.position.z + vz * Math.max(minNudge, step * 1.3);
                      if (ref.current) ref.current.__lastStepUpTime = now;
                      stepped = true;
                    }
                    break;
                  }
                }
              }
              // Only block completely if step-up also failed
              if (!stepped) {
                nx = ref.current.position.x;
                nz = ref.current.position.z;
              }
            }
          }
          // Clamp to radius from world origin considering baseOffset
          const nwx = nx + (baseOffset?.[0] || 0);
          const nwz = nz + (baseOffset?.[1] || 0);
          const r = Math.hypot(nwx, nwz);
          const effectiveRadiusCTM = isJetpackingRef.current ? JETPACK_FLY_RADIUS : maxRadius;
          if (r <= effectiveRadiusCTM) {
            ref.current.position.x = nx;
            ref.current.position.z = nz;
          } else {
            const ang = Math.atan2(nwz, nwx);
            ref.current.position.x = Math.cos(ang) * effectiveRadiusCTM - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * effectiveRadiusCTM - (baseOffset?.[1] || 0);
          }
          setIsWalking(true);
        }
      }
    } else {
      // No keys and no click target: clear residual velocity so we don't auto-face old movement
      velRef.current.x = 0;
      velRef.current.z = 0;
      // ── Jetpack drift: keep applying momentum when stick is released ──
      if (isJetpackingRef.current && (Math.abs(jetpackVxRef.current) > 0.01 || Math.abs(jetpackVzRef.current) > 0.01)) {
        // Apply drag to bleed off speed (frame-rate independent)
        const dragPow = Math.pow(JETPACK_XZ_DRAG, dt * 60);
        jetpackVxRef.current *= dragPow;
        jetpackVzRef.current *= dragPow;
        // Also lerp toward zero (no stick input → target velocity is 0)
        const lerpFactor = Math.min(1, JETPACK_XZ_ACCEL * dt);
        jetpackVxRef.current *= (1 - lerpFactor);
        jetpackVzRef.current *= (1 - lerpFactor);
        // Apply drift position
        let driftNx = ref.current.position.x + jetpackVxRef.current * dt;
        let driftNz = ref.current.position.z + jetpackVzRef.current * dt;
        // Boundary clamp
        const driftWx = driftNx + (baseOffset?.[0] || 0);
        const driftWz = driftNz + (baseOffset?.[1] || 0);
        const effectiveRadiusDrift = JETPACK_FLY_RADIUS;
        if (Math.abs(driftWx) <= effectiveRadiusDrift && Math.abs(driftWz) <= effectiveRadiusDrift) {
          ref.current.position.x = driftNx;
          ref.current.position.z = driftNz;
        }
      }
      // defer isWalking decision to displacement check below
    }

    // Update jump physics and tabletop interactions
    // World position for tabletop checks
    const wxNow = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
    const wzNow = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
    // Consider tabletop "overlap" if the avatar's collision disk overlaps the tabletop rect
    const overlapsTable = (() => {
      for (const r of obstacles || []) {
        if (!r) continue;
        const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
        if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
          if (wxNow >= (minX - collisionRadius) && wxNow <= (maxX + collisionRadius) &&
              wzNow >= (minZ - collisionRadius) && wzNow <= (maxZ + collisionRadius)) {
            return true;
          }
        }
      }
      return false;
    })();

  if (isJumping || jumpY > 0.0001) {
  let committedLift = platformLift; // track actual platformLift through this frame (React state is stale until next render)
  const g = curGravityRef.current; // use current gravity (jump/slow-fall/fast as set)
      let vy;
      // ── Jetpack thrust integration ──
      if (isJetpackingRef.current) {
        const jetInput = Math.max((pressed.current['f'] || pressed.current['F']) ? 1.0 : 0, jetpackRtAnalogRef.current);
        if (jetInput > 0.1) {
          vy = jumpVyRef.current + (JETPACK_THRUST * jetInput + JETPACK_GRAVITY) * dt;
        } else {
          vy = jumpVyRef.current + JETPACK_GRAVITY * dt; // no thrust → falling with jetpack gravity
        }
        vy = Math.max(-JETPACK_MAX_VY, Math.min(JETPACK_MAX_VY, vy));
        // Switch to falling animation only when descending with no stick AND no throttle (pure free-fall)
        const hasStickInput = Math.abs(moving) > 0.15 || Math.abs(turning) > 0.15;
        const descending = vy < -1;
        setIsFalling(descending && !hasStickInput && jetInput < 0.1);
      } else {
        vy = jumpVyRef.current + g * dt;
      }
      let y = jumpY + vy * dt;
      // Absolute height above ground plane
      let absY = platformLift + y;
      // Handle landing on tabletop if descending and near/below plane (with snap band to be forgiving)
  const TABLE_SNAP_BAND = 8.0; // allow fast descents to snap reliably
      if (!onTable && overlapsTable && vy < 0 && absY <= (tableTopLift + TABLE_SNAP_BAND)) {
        // Snap to tabletop
        y = 0; vy = 0; absY = tableTopLift; setPlatformLift(tableTopLift); committedLift = tableTopLift; setOnTable(true); setIsJumping(false); setIsFalling(false);
        if (isJetpackingRef.current) {
          isJetpackingRef.current = false; jetpackVxRef.current = 0; jetpackVzRef.current = 0;
          if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
          setIsJetpacking(false);
        }
      } else if (onTable) {
        if (!overlapsTable) {
          // Stepping/falling off the table: convert platform height into jump height to fall down
          const carry = platformLift + y;
          setPlatformLift(0); committedLift = 0; setOnTable(false);
          y = Math.max(0, carry); // start falling from current absolute height
          // keep vy as-is; if upward it's fine, if downward, continue falling
        } else if (vy < 0 && y <= 0) {
          // Land back on the tabletop
          y = 0; vy = 0; setIsJumping(false); setIsFalling(false);
          if (isJetpackingRef.current) {
            isJetpackingRef.current = false; jetpackVxRef.current = 0; jetpackVzRef.current = 0;
            if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
            setIsJetpacking(false);
          }
        }
  } else if (!onTable && vy < 0) {
        // Descending: snap to step top when close
        // Sample ground both in front and behind (using the same magnitude) to avoid sinking while turning on stairs
        const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), (yawRef.current || 0));
        fwd.y = 0; fwd.normalize();
  const magF = getForwardProbeMag();
  const magB = getBehindProbeMag();
  const swxF = wxNow + fwd.x * magF;
  const swzF = wzNow + fwd.z * magF;
  const swxB = wxNow - fwd.x * magB;
  const swzB = wzNow - fwd.z * magB;
  // Use current falling position (not old platformLift) to detect ground, prevents snapping back to old platform
  const currentFallingY = localGroundY + platformLift + y;
  const gyF = getGroundHeightXZAtY(swxF, swzF, currentFallingY);
  const gyB = getGroundHeightXZAtY(swxB, swzB, currentFallingY);
  const gyCenter = getGroundHeightXZAtY(wxNow, wzNow, currentFallingY);
        // When jetpacking, always use MAX to land ON the terrain (min can pick flat zone = 0 if probes straddle boundary).
        // For normal stair falls (fast), use MIN to avoid snapping back to the platform you jumped from.
        // For slow descents (walking off edges), use MAX to avoid sinking into stairs.
        const gy = isJetpackingRef.current
          ? Math.max(gyF, gyB, gyCenter)
          : (vy < -5 ? Math.min(gyF, gyB, gyCenter) : Math.max(gyF, gyB, gyCenter));
        let targetAbs = localGroundY + gy;
        const curAbs = localGroundY + platformLift + y;
        
        // During fast falls from high places, use tighter snap band to prevent false landings
        // When falling slowly (normal jumps/stairs), use normal snap band
        const isFallingFast = Math.abs(vy) > 20; // Fast fall from high edge
        const isJetpackFall = isJetpackingRef.current;
        const SNAP_BAND = isJetpackFall ? 4.0 : (isFallingFast ? 0.5 : Math.max(0.1, 0.25 * STAIR_RISE));
        
        if (curAbs <= targetAbs + SNAP_BAND) {
          // Simple landing: just snap to the ground height and stop jumping
          // This matches the smooth falling behavior when running off a ledge
          setPlatformLift(gy); committedLift = gy;
          y = 0; 
          vy = 0; 
          setIsJumping(false); setIsFalling(false);
          if (isJetpackingRef.current) {
            isJetpackingRef.current = false; jetpackVxRef.current = 0; jetpackVzRef.current = 0;
            if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
            setIsJetpacking(false);
          }
        }
      }
      // Commit
      jumpVyRef.current = vy;

      // ── Terrain-aware floor clamp ──────────────────────────────────────
      // Sample the actual terrain height at the avatar's current XZ so we
      // never render below the hilly lunar surface — even for a single frame.
      const terrainGy = getGroundHeightXZAtY(wxNow, wzNow, committedLift + y);
      const minLocalY = terrainGy - committedLift;   // local-space floor

      if (y < minLocalY) {
        // Avatar is below terrain → force an immediate landing snap
        setPlatformLift(terrainGy); committedLift = terrainGy;
        y  = 0;
        vy = 0;
        jumpVyRef.current = 0;
        setIsJumping(false); setIsFalling(false);
        if (isJetpackingRef.current) {
          isJetpackingRef.current = false;
          jetpackVxRef.current = 0;
          jetpackVzRef.current = 0;
          if (jetpackLandTimerRef.current) clearTimeout(jetpackLandTimerRef.current);
          setIsJetpacking(false);
        }
      }
      // ──────────────────────────────────────────────────────────────────

      if (Math.abs(y - jumpY) > 0.00001) setJumpY(y);
    }
    // If grounded (not jumping) and not on table, snap to stair ground height (skip while jetpacking)
    if (!isJumping && !onTable && !isJetpackingRef.current) {
      // Grounded: sample ground both in front and behind using same magnitude to stabilize when turning on stairs
      const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), (yawRef.current || 0));
      fwd.y = 0; fwd.normalize();
      const magF2 = getForwardProbeMag();
      const magB2 = getBehindProbeMag();
      const swxF = wxNow + fwd.x * magF2;
      const swzF = wzNow + fwd.z * magF2;
      const swxB = wxNow - fwd.x * magB2;
      const swzB = wzNow - fwd.z * magB2;
      const gyF = getGroundHeightXZAtY(swxF, swzF, feetWorldY);
      const gyB = getGroundHeightXZAtY(swxB, swzB, feetWorldY);
      // Use average of front and back samples for ultra-smooth descent (no switching/oscillation)
      const cur = platformLift;
      let targetGy = (gyF + gyB) / 2; // Smooth average prevents oscillation
      
      // Limit descent rate near stairs to prevent stepping off into thin air
      if (targetGy < cur) {
        const stairHalfW2 = STAIR2_WIDTH / 2;
        const stairHalfW3 = STAIR3_WIDTH / 2;
        const totalLen2 = STAIR2_STEPS * STAIR2_RUN;
        const totalLen3 = STAIR3_STEPS * STAIR3_RUN;
        
        const stair2XMin = STAIR2_POS_X - stairHalfW2 - collisionRadius;
        const stair2XMax = STAIR2_POS_X + stairHalfW2 + collisionRadius;
        const stair2ZMin = STAIR2_POS_Z - (STAIR2_RUN * 0.75);
        const stair2ZMax = STAIR2_POS_Z + totalLen2 + (STAIR2_RUN * 0.75);
        
        const stair3ZMin = STAIR3_POS_Z - stairHalfW3 - collisionRadius;
        const stair3ZMax = STAIR3_POS_Z + stairHalfW3 + collisionRadius;
        const stair3XMax = STAIR3_POS_X + (STAIR3_RUN * 0.75);
        const stair3XMin = STAIR3_POS_X - totalLen3 - (STAIR3_RUN * 0.75);
        
        const nearStair2 = (wxNow >= stair2XMin && wxNow <= stair2XMax && wzNow >= stair2ZMin && wzNow <= stair2ZMax);
        const nearStair3 = (wxNow >= stair3XMin && wxNow <= stair3XMax && wzNow >= stair3ZMin && wzNow <= stair3ZMax);
        
        if (nearStair2 || nearStair3) {
          // On stairs: limit drop to prevent stepping through - but use generous limit for smooth ramps
          const MAX_RISE = Math.max(STAIR2_RISE, STAIR3_RISE);
          const maxStepDown = (MAX_RISE * 2.5); // 2.5 steps max drop (was 1.05 - much more generous now)
          targetGy = Math.max(targetGy, cur - maxStepDown);
        }
      }
      
      if (Math.abs(targetGy - cur) > 0.0001) {
  const goingUp = targetGy > cur;
        if (!goingUp) {
          // If the drop is large (e.g., walking off platform edge), enter fall instead of snapping down
          const drop = cur - targetGy;
          // Increased threshold to prevent false falls on slopes - only trigger on actual cliff edges
          const FALL_TRIGGER_DROP = Math.max(3.5 * STAIR_RISE, 6.0); // ~6.3 units minimum
          if (drop > FALL_TRIGGER_DROP) {
            // Begin a gentle fall: transfer current lift into jump height and let gravity handle descent
            // Determine if we're stepping off the big top platform area; use slow gravity there
            const isOverTopPlatform = (() => {
              const stairsLen = STAIR2_STEPS * STAIR2_RUN;
              const zMin = STAIR2_POS_Z + stairsLen;
              const zMax = zMin + STAIR2_PLATFORM_DEPTH;
              const halfW = STAIR2_PLATFORM_WIDTH / 2;
              const xMin = STAIR2_POS_X - halfW;
              const xMax = STAIR2_POS_X + halfW;
              return (wxNow >= xMin && wxNow <= xMax && wzNow >= zMin && wzNow <= zMax);
            })();
            // If we triggered a fall (not a jump), use slow fall on platform, else use softer fall
            curGravityRef.current = isOverTopPlatform ? GRAVITY_SLOW_FALL : GRAVITY_FALL;
            setPlatformLift(0);
            setIsJumping(true);
            jumpVyRef.current = 0;
            setJumpY(cur);
          } else {
            // Downward movement: use same smooth lerp as upward movement (no clamping for consistent smoothness)
            const k = LIFT_SMOOTH_DOWN_K;
            const nextLift = cur + (targetGy - cur) * Math.min(1, k * dt);
            setPlatformLift(nextLift);
          }
        } else {
          const k = LIFT_SMOOTH_UP_K;
          const nextLift = cur + (targetGy - cur) * Math.min(1, k * dt);
          setPlatformLift(nextLift);
        }
      }
    }
    // If standing on the table and walking off its core without jumping, start a fall
    if (onTable && !overlapsTable && !isJumping) {
      const carry = platformLift + 0;
  // Table falls use the softer fall gravity (25% slower than jump)
  curGravityRef.current = GRAVITY_FALL;
      setPlatformLift(0); setOnTable(false);
      // Begin falling from current absolute height
      setIsJumping(true);
      jumpVyRef.current = 0;
      if (carry > 0) setJumpY(carry);
    }
    // Smoothly rotate toward click-move direction only when keys are not active
    if (ref.current && !keysActive && !!targetRef.current) {
      const vx = velRef.current.x;
      const vz = velRef.current.z;
      const mag = Math.hypot(vx, vz);
      const movingVec = mag > 0.001;
      if (movingVec) {
        let cur = yawRef.current || 0;
        // Align with arrow-move mapping: dir = R_y(yaw) * (0,0,-1)
        // So yaw should be atan2(vx, vz) + PI for a world direction (vx,vz)
        const desired = Math.atan2(vx, vz) + Math.PI + (clickYawOffset || 0);
        let diff = ((desired - cur + Math.PI) % (2 * Math.PI)) - Math.PI;
        cur += Math.sign(diff) * Math.min(Math.abs(diff), ((turnSpeed || 0) * dt));
        yawRef.current = cur;
        ref.current.rotation.y = cur;
      }
    }
    } // ── end if (!sphereHandled) — flat mode block ──
    // Publish world position and yaw (baseOffset + local). Also publish when yaw changes while standing still.
    if (ref.current) {
      // Displacement-based walking detection (covers all motion sources)
      const cx = ref.current.position.x;
      const cz = ref.current.position.z;
      const dxLoc = cx - prevLocalPos.current.x;
      const dzLoc = cz - prevLocalPos.current.z;
      const disp = Math.hypot(dxLoc, dzLoc);
      prevLocalPos.current.set(cx, 0, cz);
      // Toggle walk if moved more than a tiny epsilon this frame
      const movingNow = disp > 0.0002;
      if (!targetRef.current && moving === 0) {
        // when neither keys nor click-to-move is active, use displacement to decide
        if (movingNow !== isWalking) setIsWalking(movingNow);
      }
  const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
  const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
  // In FPS mode, use base yawRef for CameraFollower (it adds horizontalAngle on its own)
  // For broadcast/remote players, use effYaw which includes camera direction
  const localYaw = yawRef.current || 0;
  const broadcastYaw = firstPersonMode ? effYaw : localYaw;
  // In FPS mode the player is inherently aiming (holding rifle), so remote players see rifle stance
  const aimingNow = !!(firstPersonMode || weaponSystem.isAiming);
  // Publish local avatar pose globally for follow camera (uses base yaw, CameraFollower adds orbit)
  const _sphereOn = sphereModeRef.current >= 0.5;
  const _sphereBlend = sphereBlendRef.current;
  const _sphereUpArr = (_sphereBlend > 0.01) ? [sphereUpRef.current.x, sphereUpRef.current.y, sphereUpRef.current.z] : null;
  // In sphere mode, compute the player's actual 3D position (surface + jumpY along normal)
  // Use sphereJumpYRef (synchronous) rather than jumpY (React state, 1 frame behind)
  const _sphereJY = _sphereOn ? sphereJumpYRef.current : 0;
  const _spherePlayerPos = _sphereOn ? [
    wx + sphereUpRef.current.x * _sphereJY,
    ref.current.position.y + sphereUpRef.current.y * _sphereJY,
    wz + sphereUpRef.current.z * _sphereJY
  ] : null;
  try {
    window.__CF_LOCAL_AVATAR__ = { x: wx, z: wz, yaw: localYaw, isRunning: runningNow, isWalking: !!(isWalking || isWalkingBackward || isStrafeLeft || isStrafeRight), isJumping: !!isJumping, isJetpacking: !!isJetpackingRef.current, jetpackFuel: jetpackFuelRef.current, isBoost: !!jetpackBoostActive, lift: (platformLift + jumpY), jetpackTiltX: jetpackTiltXRef.current, jetpackTiltZ: jetpackTiltZRef.current, isShooting: !!isShootingRef.current, isAiming: aimingNow, isScoping: !!weaponSystem.isAiming, isWalkingBackward, isStrafeLeft, isStrafeRight, isDead: !!weaponSystem.isDead, pitch: window.__CF_CAM_V_ANGLE__ || 0, sphereMode: _sphereOn ? 1 : 0, sphereBlend: _sphereBlend, sphereUp: _sphereUpArr, spherePlayerPos: _spherePlayerPos };
    window.__CF_COLLISION_FWD__ = COLLISION_FWD_OFFSET;
  } catch {}
      const t = performance.now();
      const dxs = Math.abs(wx - lastSent.current.x);
      const dzs = Math.abs(wz - lastSent.current.z);
      // shortest angular difference in radians
      const yawDiff = (((broadcastYaw - (lastSent.current.yaw||0)) + Math.PI) % (2*Math.PI)) - Math.PI;
      const yawChanged = Math.abs(yawDiff) > 0.02; // ~1.1°
      // Also send when turning-in-place so spectators see live yaw; align throttle with server (~35ms)
      const turningNow = !!(pressed.current['ArrowLeft'] || pressed.current['a'] || pressed.current['A'] || pressed.current['ArrowRight'] || pressed.current['d'] || pressed.current['D']);
      const liftNow = (platformLift + jumpY);
      const liftDiff = Math.abs(liftNow - (lastSent.current.lift || 0));
      const jumpChanged = (!!isJumping !== !!lastSent.current.isJumping);
      const jetChanged = (!!isJetpackingRef.current !== !!lastSent.current.isJetpacking);
      const shootChanged = (!!isShootingRef.current !== !!lastSent.current.isShooting) || (aimingNow !== !!lastSent.current.isAiming);
      const strafeChanged = (isStrafeLeft !== !!lastSent.current.isStrafeLeft) || (isStrafeRight !== !!lastSent.current.isStrafeRight);
      const backChanged = (isWalkingBackward !== !!lastSent.current.isWalkingBackward);
      const deadChanged = (!!weaponSystem.isDead !== !!lastSent.current.isDead);
      const curPitch = window.__CF_CAM_V_ANGLE__ || 0;
      const pitchChanged = Math.abs(curPitch - (lastSent.current.pitch || 0)) > 0.02;
      const isFlying = !!isJetpackingRef.current;
      const minInterval = isFlying ? 16 : 35; // Higher frequency during jetpack for smoother remote view
      if (typeof onPositionChange === 'function' && (((dxs + dzs) > 0.1) || yawChanged || turningNow || liftDiff > 0.5 || jumpChanged || jetChanged || shootChanged || strafeChanged || backChanged || deadChanged || pitchChanged) && (t - lastSent.current.t) > minInterval) {
        lastSent.current = { x: wx, z: wz, yaw: broadcastYaw, t, lift: liftNow, isJumping: !!isJumping, isJetpacking: !!isJetpackingRef.current, isShooting: !!isShootingRef.current, isAiming: aimingNow, isStrafeLeft, isStrafeRight, isWalkingBackward, isDead: !!weaponSystem.isDead, pitch: curPitch };
        onPositionChange(wx, wz, broadcastYaw);
      }
      // Update HUD every ~100ms
      hudTick.current += dt;
      if (hudTick.current >= 0.1) {
        hudTick.current = 0;
        const yawDeg = ((yawRef.current * 180 / Math.PI) % 360 + 360) % 360;
        setHudText(`x: ${wx.toFixed(1)}  z: ${wz.toFixed(1)}  yaw: ${yawDeg.toFixed(0)}°`);
      }
    }
  });

  // Hide local avatar mesh in first-person mode so camera doesn't clip inside it
  useEffect(() => {
    if (childRef.current) {
      childRef.current.visible = !firstPersonMode;
    }
  }, [firstPersonMode]);

  // Inject motion props into the first child (avatar), preserve other children
  const childWithMotion = useMemo(() => {
    const arr = React.Children.toArray(children);
    if (arr.length > 0 && React.isValidElement(arr[0])) {
      try { arr[0] = React.cloneElement(arr[0], { isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, isShooting: !!isShootingRef.current, isAiming: !!(firstPersonMode || weaponSystem.isAiming || window.__CF_FORCE_AIM__), isStrafeLeft, isStrafeRight, isDead: !!weaponSystem.isDead, jetpackTiltX: jetpackTiltXRef.current, jetpackTiltZ: jetpackTiltZRef.current, extraLiftY: sphereModeRef.current >= 0.5 ? (spherePlatformLiftRef.current + sphereJumpYRef.current) : (platformLift + jumpY), pitch: window.__CF_CAM_V_ANGLE__ || 0 }); } catch {}
    }
    // Also adjust the Billboard / name label (idx=1) Y position to follow character lift
    if (arr.length > 1 && React.isValidElement(arr[1])) {
      try {
        const pos = arr[1].props?.position;
        if (pos) {
          const [px, py, pz] = pos;
          arr[1] = React.cloneElement(arr[1], { position: [px, py + platformLift + jumpY, pz] });
        }
      } catch {}
    }
    return arr;
  }, [children, isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, isJetpacking, isFalling, jumpY, platformLift, weaponSystem.isDead, weaponSystem.isAiming]);

  return (
    <group position={[ (baseOffset?.[0]||0), 0, (baseOffset?.[1]||0) ]}>
      <group ref={ref}>
        <group ref={childRef}>{childWithMotion}</group>
        
        {/* Weapon System Components - DISABLED due to material uniform errors */}
        {/* {enabled && weaponSystem.currentWeapon && (
          <group>
            <WeaponModel
              weaponType={weaponSystem.currentWeapon}
              position={[0.5, 1.5, -0.3]}
              rotation={[0, 0, 0]}
            />
          </group>
        )} */}
        
        {showCollisionBoxes && (
          <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, localGroundY + platformLift + jumpY + 0.02, COLLISION_FWD_OFFSET]}>
            <ringGeometry args={[Math.max(0.001, collisionRadius-0.05), collisionRadius, 24]} />
            <meshBasicMaterial color={'#f97316'} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        {showCollisionBoxes && (
          <mesh position={[0, localGroundY + platformLift + jumpY + 0.02, COLLISION_FWD_OFFSET]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color={'#10b981'} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// Settings Menu Component with Controller Navigation