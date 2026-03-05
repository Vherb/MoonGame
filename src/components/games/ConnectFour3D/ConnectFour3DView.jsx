// ConnectFour3DView.jsx – main 3D world component
// Sub-components extracted into separate modules for maintainability

import React, { useMemo, useRef, useLayoutEffect, Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { OrbitControls, TransformControls, useGLTF, useFBX, useAnimations, Text, Billboard, useTexture, RoundedBox, PositionalAudio, Html } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { useWeaponSystem } from './useWeaponSystem';
import { WeaponModel, Bullet, MuzzleFlash, BulletImpact, Crosshair, ScopeOverlay, CombatUI, HitMarker, SimpleGun, LazerRifleModel, DamageFlash, DeathScreen } from './WeaponSystem';
import { useVehicleSystem, SpaceJet, VehicleHUD, VehicleInteractionPrompt, VehiclePhysicsController } from './VehicleSystem';
import './WeaponSystem.css';

// ── Extracted modules ──
import {
  COLS, ROWS, CELL, GAP, BOARD_THICK, TERRAIN_RADIUS, PLAY_AREA_RADIUS,
  STAIR_POS_X, STAIR_POS_Z, STAIR_WIDTH, STAIR_RUN, STAIR_RISE, STAIR_STEPS, STEP_CLIMB_MAX,
  STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS,
  STAIR2_PLATFORM_DEPTH, STAIR2_PLATFORM_WIDTH, STAIR2_PLATFORM_THICKNESS,
  STAIR3_POS_X, STAIR3_POS_Z, STAIR3_BASE_Y, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS,
  STAIR3_YAW, STAIR3_PLATFORM_DEPTH, STAIR3_PLATFORM_WIDTH, STAIR3_PLATFORM_THICKNESS,
  GROUND_CLEAR, AVATAR_BASE_HEIGHT, AVATAR_FINAL_HEIGHT, SHARK_SCALE_BOOST, CAPUCCINO_SCALE_BOOST,
  AVATAR_IDLE_AMP_Y, AVATAR_IDLE_SWAY_Z, AVATAR_IDLE_SPEED_Y, AVATAR_IDLE_SPEED_Z,
  AVATAR_X_FRONT, AVATAR_X_BACK, AVATAR_BAKED_POS, AVATAR_BAKED_SCALE_MUL,
  DEFAULT_WALK_ANIM_TIMESCALE, DEFAULT_RUN_ANIM_TIMESCALE, WALK_ANIM_TIMESCALE, RUN_ANIM_TIMESCALE,
  ASTRONAUT_WALK_DEFAULT, ASTRONAUT_RUN_DEFAULT, ASTRONAUT_Y_OFFSET,
  GUY1_WALK_DEFAULT, GUY1_RUN_DEFAULT, GUY1_Y_OFFSET,
  getAnimSpeed,
} from './constants';

import {
  CURRENT_PLACED_CUBES, EXTRA_STAIRS_DEF, EXTRA_STAIRS_WALKABLE,
  setExtraStairsWalkable, setExtraStairsDef, updatePlacedCubesCache,
  getTerrainHeightXZ, getGeneratedTerrainHeight, getGroundHeightXZ, getGroundHeightXZAtY,
  buildStairAABBsWorld,
} from './terrainPhysics';

import { ModelErrorBoundary, RoundedRectShape, FrontPlate, SideSupports, BackShadowCatcher, NeonRings, NeonBorder, Piece } from './boardComponents';
import { TableFBX, ClassicTableFBX } from './tableComponents';
import { SpaceBackdrop, BluePlanetFBX, PinkPlanetFBX, EarthPlanetFBX, FlybyAsteroids, GalaxyClusters, StarSwarms, DenseGalaxyField, ShootingStars } from './spaceEnvironment';
import { TerrainSculptor, TerrainLabels, TerrainGeometry, AsteroidFloor, TexturedShadowOverlay, LunarTerrain, GiantMoonSphere } from './terrainComponents';
import { DraggableObject, Stairs2PlacedModel, AsteroidPlacedModel, RoverPlacedModel, CustomPlacedModel, TablePlacedModel, detectEdgeSnap, AIContentRenderer, AIContentSyncedWithMesh, PlacedCube } from './placedObjects';
import { AsteroidFBXProp, AsteroidScatter, RocketPedestal, ExtraStairsFBX, Staircase, PlatformBlock, StairCollisionDebug } from './staircaseComponents';
import {
  OpponentAvatar, resolveAvatarUrl, LoadedOpponent, CapuccinoOpponent, GLTFOpponent,
  RawSharkOpponent, SharkFixed, SkinnedGLTFOpponent, AlienSandboxOpponent,
  Alien2FBXOpponent, AstronautFBXOpponent, Guy1FBXOpponent, Robot4FBXOpponent,
  RemoteAvatarGroup,
  CameraFacingBillboard,
} from './avatarComponents';
import { FootstepAudio, RocketAmbience, AudioRangeVisualizer, CustomPositionalAudio, EditableAudioVisualizer } from './audioComponents';
import { PlayerMover } from './PlayerMover';
import CameraFollower from './CameraFollower';
import { SettingsMenu } from './SettingsMenu';
import { CharacterSelectMenu } from './CharacterSelectMenu';
import LoadingScreen, { LoadingGate } from './LoadingScreen';
import { InventoryMenu } from './InventoryMenu';
import ResourceSpawner, { ResourceOverlays } from './ResourceNodes';
import MineableAsteroidSpawner, { MiningOverlays } from './MineableAsteroids';
import EnemyWaveManager, { WaveOverlays } from './EnemyWaveSystem';
import BuildingSystem, { BuildingOverlays } from './BuildingSystem';
import EquipmentPickups, { EquipmentPickupOverlays } from './EquipmentPickups';
import GamepadHUD from './GamepadHUD';

// Extend Three.js to make postprocessing classes available in JSX
extend({ EffectComposer, RenderPass, UnrealBloomPass });

// ── BulletRenderer — decoupled from parent re-render cycle ───────────────────
// Defined OUTSIDE ConnectFour3DView so React identity is stable.
// Reads bullet/impact arrays from a window global published by PlayerMover's
// useWeaponSystem each frame.  This avoids the expensive cascade:
//   setBullets → onWeaponSystemUpdate → setWeaponSystemData → full view re-render
function BulletRenderer({ remoteBullets, removeRemoteBullet }) {
  const [localBullets, setLocalBullets] = React.useState([]);
  const [localImpacts, setLocalImpacts] = React.useState([]);
  const prevBulletIds = React.useRef('');
  const prevImpactIds = React.useRef('');

  useFrame(() => {
    const ws = window.__CF_WEAPON_SYS__;
    if (!ws) return;

    // Fast-path: skip string work when arrays are empty & state is already empty
    const bullets = ws.bullets || [];
    const impacts = ws.impacts || [];

    if (bullets.length === 0 && prevBulletIds.current === '') {
      // nothing to do
    } else {
      const bIds = bullets.map(b => b.id).join(',');
      if (bIds !== prevBulletIds.current) {
        prevBulletIds.current = bIds;
        setLocalBullets([...bullets]);
      }
    }

    if (impacts.length === 0 && prevImpactIds.current === '') {
      // nothing to do
    } else {
      const iIds = impacts.map(i => i.id).join(',');
      if (iIds !== prevImpactIds.current) {
        prevImpactIds.current = iIds;
        setLocalImpacts([...impacts]);
      }
    }
  });

  return (
    <>
      {localBullets.map(bullet => (
        <Bullet
          key={bullet.id}
          {...bullet}
          onHit={(hitInfo) => window.__CF_WEAPON_SYS__?.handleBulletHit?.(hitInfo)}
          onExpire={(bulletId) => window.__CF_WEAPON_SYS__?.removeBullet?.(bulletId)}
        />
      ))}
      {remoteBullets.map(bullet => (
        <Bullet
          key={bullet.id}
          {...bullet}
          onHit={() => removeRemoteBullet(bullet.id)}
          onExpire={() => removeRemoteBullet(bullet.id)}
        />
      ))}
      {localImpacts.map(impact => (
        <BulletImpact key={impact.id} position={impact.position} color={impact.color} />
      ))}
    </>
  );
}

function ConnectFour3DView({ board, lastMove, colors, onSelectColumn, flip180 = false, myCharacterId = 'astronaut', oppCharacterId = 'alien', onAvatarMove, myName = 'You', oppName = 'Opponent', remotePlayers, charMenuOpen = false, onCharacterChange, onCharMenuClose }) {
  // Loading screen state
  const [assetsReady, setAssetsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const showLoading = !assetsReady && !charMenuOpen;
  
  // Track drei useProgress from outside Canvas via polling
  useEffect(() => {
    if (assetsReady) return;
    const poll = setInterval(() => {
      // useProgress stores state on a module-level store — we read via the selector
      try {
        const progress = window.__CF_LOADING_PROGRESS__;
        if (typeof progress === 'number') setLoadProgress(progress);
      } catch {}
    }, 200);
    return () => clearInterval(poll);
  }, [assetsReady]);

  const handleAssetsReady = useCallback(() => {
    setAssetsReady(true);
  }, []);

  // Clean up cached world state on mount to ensure stability across hot reloads
  useEffect(() => {
    try {
      // Clear table rect cache to force fresh recalculation (prevents stale invisible collision boxes)
      if (window.__CF_TABLE_RECT__) {
        delete window.__CF_TABLE_RECT__;
      }
      // DON'T reset lift values - let them persist so opponents stay at correct height on hot reload
    } catch {}
  }, []);
  
  // Function to actually leave the game
  const leaveGame = useCallback(() => {
    try {
      // Trigger the game:leaveRequested event that parent components can listen to
      window.dispatchEvent(new CustomEvent('game:leaveRequested'));
      
      // Try to programmatically click the Leave button in GameBoard if it exists
      setTimeout(() => {
        const leaveButton = document.querySelector('.btn-outline-secondary');
        if (leaveButton && leaveButton.textContent.includes('Leave')) {
          leaveButton.click();
        }
      }, 100);
    } catch (e) {
      console.error('Failed to leave game:', e);
    }
  }, []);
  
  // Use baked constants for avatar X offsets
  const xFront = AVATAR_X_FRONT;
  const xBack = AVATAR_X_BACK;

  // Define a simple rectangular obstacle for the wooden table top to prevent walking through it
  const tableRect = useMemo(() => {
    // Prefer the actual FBX footprint if available (published by WoodenTable loader)
    try {
      const r = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
      if (r && Number.isFinite(r.minX) && Number.isFinite(r.maxX) && Number.isFinite(r.minZ) && Number.isFinite(r.maxZ)) {
        return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      }
    } catch {}
    // Fallback to baked dimensions
    const fw = COLS * (CELL + GAP) - GAP + 0.6;
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const topW = Math.max(fw + 4.0, 12.0);
    const topD = Math.max(fh + 6.0, 16.0);
    return { minX: -topW / 2, maxX: topW / 2, minZ: -topD / 2, maxZ: topD / 2 };
  }, []);

  // Baked-in transform (scale override) + dynamic facing toward camera
  const effScaleMulOverride = AVATAR_BAKED_SCALE_MUL;
  // Screen size first (used for camera defaults)
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  // Camera side: Player 1 sees from +Z (front), Player 2 from -Z (back)
  // Start 75% farther back so it loads more zoomed out
  const camPosFront = isNarrow ? [0, 13.0, 31.5] : [0, 10.5, 25.4];
  const camPosBack  = isNarrow ? [0, 13.0,-31.5] : [0, 10.5,-25.4];
  const camPos  = flip180 ? camPosBack : camPosFront;
  const camFov  = isNarrow ? 54 : 40;
  // UI toggles
  const [showSelf, setShowSelf] = useState(!!remotePlayers);
  const [moveEnabled, setMoveEnabled] = useState(true);
  const [isDraggingCube, setIsDraggingCube] = useState(false); // Track if user is dragging an object
  
  // Store drag state in window global so PlayerMover can check it
  React.useEffect(() => {
    window.__CF_IS_DRAGGING_CUBE__ = isDraggingCube;
    
    // Provide callback for CustomPlacedModel to set drag state
    window.__CF_SET_DRAGGING_CUBE__ = setIsDraggingCube;
    
    return () => {
      delete window.__CF_SET_DRAGGING_CUBE__;
    };
  }, [isDraggingCube]);
  
  const [clickMove, setClickMove] = useState(true);
  const [fullCamera, setFullCamera] = useState(false);
  const [followCam, setFollowCam] = useState(false);
  const [followSeed, setFollowSeed] = useState(0);
  const [firstPersonMode, setFirstPersonMode] = useState(false);

  // ── Gun tuner state — controls YOUR OWN rifle transform ──
  const [gunTunerPos, setGunTunerPos] = useState([0.144, 29.905, 5.401]);
  const [gunTunerRot, setGunTunerRot] = useState([0.199, 0.544, -1.539]);
  const [gunTunerScale, setGunTunerScale] = useState(0.497);
  const [gunTunerForceVisible, setGunTunerForceVisible] = useState(false);
  const [gunTunerForceAim, setGunTunerForceAim] = useState(false);
  const [gunTunerMode, setGunTunerMode] = useState('translate'); // translate | rotate | scale
  const [gunTunerEnabled, setGunTunerEnabled] = useState(false);
  const [gunEditorOpen, setGunEditorOpen] = useState(false);
  // ── FPV (first-person viewmodel) gun transform — separate from 3rd-person hand-mounted gun ──
  const [fpvGunPos, setFpvGunPos] = useState([0.090, -0.230, -0.600]);
  const [fpvGunRot, setFpvGunRot] = useState([0.000, 4.712, 0.000]);
  const [fpvGunScale, setFpvGunScale] = useState(0.006);
  const fpvGunRef = useRef({ pos: [0.090, -0.230, -0.600], rot: [0.000, 4.712, 0.000], scale: 0.006 });
  const gunTunerRef = useRef({ pos: [0.144, 29.905, 5.401], rot: [0.199, 0.544, -1.539], scale: 0.497 });
  useEffect(() => {
    gunTunerRef.current = { pos: gunTunerPos, rot: gunTunerRot, scale: gunTunerScale };
    // Broadcast to window global so all avatars can read rifle transform every frame
    window.__CF_RIFLE_TUNER__ = { pos: [...gunTunerPos], rot: [...gunTunerRot], scale: gunTunerScale, forceVisible: gunTunerForceVisible };
    // Force-aim override for local avatar via window flag  
    window.__CF_FORCE_AIM__ = gunTunerForceAim;
  }, [gunTunerPos, gunTunerRot, gunTunerScale, gunTunerForceVisible, gunTunerForceAim]);
  useEffect(() => {
    fpvGunRef.current = { pos: fpvGunPos, rot: fpvGunRot, scale: fpvGunScale };
  }, [fpvGunPos, fpvGunRot, fpvGunScale]);

  // ── Jetpack tuner state — controls jetpack model transform on back ──
  const [jetpackTunerPos, setJetpackTunerPos] = useState([-1.668, -0.739, -11.960]);
  const [jetpackTunerRot, setJetpackTunerRot] = useState([-2.870, -0.063, 3.089]);
  const [jetpackTunerScale, setJetpackTunerScale] = useState(0.360);
  const [jetpackTunerForceVisible, setJetpackTunerForceVisible] = useState(false);
  const [jetpackTunerMode, setJetpackTunerMode] = useState('translate');
  const [jetpackTunerEnabled, setJetpackTunerEnabled] = useState(false);
  const [jetpackEditorOpen, setJetpackEditorOpen] = useState(false);
  const [jetpackFlamePos, setJetpackFlamePos] = useState([0.5, -94.0, 51.0]);
  const [jetpackFlameSpread, setJetpackFlameSpread] = useState(48.0);
  useEffect(() => {
    window.__CF_JETPACK_TUNER__ = {
      pos: [...jetpackTunerPos],
      rot: [...jetpackTunerRot],
      scale: jetpackTunerScale,
      forceVisible: jetpackTunerForceVisible,
      flamePos: [...jetpackFlamePos],
      flameSpread: jetpackFlameSpread,
    };
  }, [jetpackTunerPos, jetpackTunerRot, jetpackTunerScale, jetpackTunerForceVisible, jetpackFlamePos, jetpackFlameSpread]);

  // ── Turret Top offset editor state — adjusts turret-top model position on base ──
  const [turretTopOffsetPos, setTurretTopOffsetPos] = useState([0, 0, 0]);
  const [turretTopOffsetRot, setTurretTopOffsetRot] = useState([0, 0, 0]);
  const [turretTopOffsetScale, setTurretTopOffsetScale] = useState(1.0);
  const [turretEditorOpen, setTurretEditorOpen] = useState(false);
  const [turretFreezeRotation, setTurretFreezeRotation] = useState(false);
  useEffect(() => {
    window.__CF_TURRET_TOP_OFFSET__ = {
      pos: [...turretTopOffsetPos],
      rot: [...turretTopOffsetRot],
      scale: turretTopOffsetScale,
      freeze: turretFreezeRotation,
    };
  }, [turretTopOffsetPos, turretTopOffsetRot, turretTopOffsetScale, turretFreezeRotation]);

  // First-person camera adjustment state
  const [fpCamHeight, setFpCamHeight] = useState(9.5);
  const [fpCamForward, setFpCamForward] = useState(0);
  
  // Settings menu state
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  // Inventory menu state
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [saveNotification, setSaveNotification] = useState(false);
  const [gameSettings, setGameSettings] = useState({
    turnSensitivity: 1.5,
    cameraDistance: 50,
    cameraHeight: 15
  });
  const [liveSettings, setLiveSettings] = useState({
    turnSensitivity: 1.5,
    cameraDistance: 50,
    cameraHeight: 15
  });
  const startButtonRef = useRef({ pressed: false });
  
  // Rocket camera following
  const [followRocket, setFollowRocket] = useState(false);
  const rocketPositionRef = useRef(null);
  
  // Vehicle system
  const vehicleSystem = useVehicleSystem();
  
  // Expose vehicle system globally for PlayerMover access
  useEffect(() => {
    window.__CF_VEHICLE_SYSTEM__ = vehicleSystem;
    console.log('🚁 [VEHICLE SYSTEM] Initialized and exposed globally:', vehicleSystem);
    return () => {
      delete window.__CF_VEHICLE_SYSTEM__;
    };
  }, [vehicleSystem]);
  
  // Weapon system state (lifted from PlayerMover for UI access)
  const [weaponSystemData, setWeaponSystemData] = useState(null);
  
  // Remote bullets received from other players over WebSocket
  const [remoteBullets, setRemoteBullets] = useState([]);
  useEffect(() => {
    const handleRemoteShoot = () => {
      // Consume queued remote bullets from window global
      const queue = window.__CF_REMOTE_BULLETS__;
      if (Array.isArray(queue) && queue.length > 0) {
        const newBullets = queue.splice(0, queue.length); // drain queue
        setRemoteBullets(prev => [...prev, ...newBullets]);
      }
    };
    window.addEventListener('cf:remote_shoot', handleRemoteShoot);
    return () => window.removeEventListener('cf:remote_shoot', handleRemoteShoot);
  }, []);
  // Auto-remove remote bullets after 3 seconds (visual only, no collision)
  const removeRemoteBullet = useCallback((bulletId) => {
    setRemoteBullets(prev => prev.filter(b => b.id !== bulletId));
  }, []);
  
  // Debug weapon system data updates
  useEffect(() => {
    console.log('[WEAPON DATA UPDATE]', { weaponSystemData, showSelf, moveEnabled });
  }, [weaponSystemData, showSelf, moveEnabled]);
  
  // Opponent disconnect detection
  const [opponentConnected, setOpponentConnected] = useState(true);
  const opponentConnectedRef = useRef(true); // Ref to track state without causing useEffect re-runs
  const [disconnectNotification, setDisconnectNotification] = useState(null);
  const [reconnectNotification, setReconnectNotification] = useState(null);
  const lastOpponentActivityRef = useRef(Date.now());
  const gameWasActiveRef = useRef(false); // Track if game was ever active (for fallback detection)
  
  // Refs to store latest position broadcast data (avoids dependency issues)
  const positionBroadcastRef = useRef({ onAvatarMove: null, flip180: false });
  
  // Listen for server disconnect events
  useEffect(() => {
    const handlePlayerLeft = (event) => {
      try {
        const data = event.detail;
        // When server notifies us the opponent left
        if (data && data.type === 'playerLeft') {
          gameWasActiveRef.current = true; // Mark that game events are active
          opponentConnectedRef.current = false;
          setOpponentConnected(false);
          setDisconnectNotification(`${oppName} has logged out`);
          setReconnectNotification(null); // Clear any reconnect message
          // Clear notification after 5 seconds
          setTimeout(() => setDisconnectNotification(null), 5000);
          
          // Clear remote avatar data to prevent fallback from seeing stale position
          try {
            if (window.__CF_REMOTE_AVATAR__) {
              delete window.__CF_REMOTE_AVATAR__.x;
              delete window.__CF_REMOTE_AVATAR__.z;
            }
          } catch {}
        }
      } catch {}
    };
    
    const handlePlayerBack = (event) => {
      try {
        const data = event.detail;
        // When opponent reconnects
        if (data && data.type === 'playerBack') {
          gameWasActiveRef.current = true; // Mark that game events are active
          opponentConnectedRef.current = true;
          setOpponentConnected(true);
          setDisconnectNotification(null); // Clear disconnect message
          setReconnectNotification(`${oppName} has reconnected`);
          // Clear notification after 4 seconds
          setTimeout(() => setReconnectNotification(null), 4000);
          
          // CRITICAL: Broadcast our current position to the reconnected opponent
          // This ensures they see us at our Connect Four spot immediately
          // Multiple broadcasts with delays to ensure delivery
          const broadcastPosition = () => {
            try {
              const { onAvatarMove, flip180 } = positionBroadcastRef.current;
              if (!onAvatarMove) return;
              
              const youAreP2 = !!flip180;
              const la = window.__CF_LOCAL_AVATAR__ || {};
              
              if (la.x !== undefined && la.z !== undefined) {
                const playerNum = youAreP2 ? 2 : 1;
                const run = !!la.isRunning;
                const isJumping = !!la.isJumping;
                const lift = typeof la.lift === 'number' ? la.lift : undefined;
                const yaw = typeof la.yaw === 'number' ? la.yaw : 0;
                
                // Send position update to reconnected opponent
                const isJetpacking = !!la.isJetpacking;
                const tiltX = la.jetpackTiltX || 0; const tiltZ = la.jetpackTiltZ || 0;
                const isShooting = !!la.isShooting; const isAiming = !!la.isAiming;
                onAvatarMove({ player: playerNum, x: la.x, z: la.z, yaw, run, isJumping, isJetpacking, lift, tiltX, tiltZ, isShooting, isAiming });
              } else {
                // If no local avatar position is set, use base player position
                const dist = 75;
                const baseX = youAreP2 ? -dist : dist;
                const baseZ = youAreP2 ? dist : -dist;
                const playerNum = youAreP2 ? 2 : 1;
                onAvatarMove({ player: playerNum, x: baseX, z: baseZ, yaw: 0, run: false, isJumping: false, lift: 0 });
              }
            } catch (err) {
              console.warn('Failed to broadcast position on reconnect:', err);
            }
          };
          
          // Broadcast multiple times to ensure it gets through
          setTimeout(broadcastPosition, 100);
          setTimeout(broadcastPosition, 300);
          setTimeout(broadcastPosition, 600);
        }
      } catch {}
    };
    
    // Listen for websocket messages dispatched as custom events
    window.addEventListener('cf:playerLeft', handlePlayerLeft);
    window.addEventListener('cf:playerBack', handlePlayerBack);
    
    // Listen for initial opponent position ready event
    const handleOpponentPositionReady = () => {
      try {
        // Opponent is in the game - they'll send their position via broadcasts
        // No need to do anything here - just rely on avatarUpdate messages
      } catch {}
    };
    window.addEventListener('cf:opponentPositionReady', handleOpponentPositionReady);
    
    return () => {
      window.removeEventListener('cf:playerLeft', handlePlayerLeft);
      window.removeEventListener('cf:playerBack', handlePlayerBack);
      window.removeEventListener('cf:opponentPositionReady', handleOpponentPositionReady);
    };
  }, [oppName]);
  
  // Detect when game becomes active (board has pieces or lastMove exists)
  // This enables disconnect/reconnect tracking
  useEffect(() => {
    if (!gameWasActiveRef.current && board && board.length > 0) {
      // Check if board has any pieces (game has started)
      const hasPieces = board.some(row => row && row.some(cell => cell !== null && cell !== 0));
      if (hasPieces || lastMove) {
        gameWasActiveRef.current = true;
      }
    }
  }, [board, lastMove]);
  
  // Fallback: Also check for no activity timeout (in case events don't fire)
  // Only runs if game was previously active (prevents false positives during setup)
  useEffect(() => {
    const DISCONNECT_TIMEOUT = 15000; // 15 seconds of no activity = disconnected
    
    const checkInterval = setInterval(() => {
      // Skip fallback detection if game has never been active
      if (!gameWasActiveRef.current) return;
      
      try {
        const msg = window.__CF_REMOTE_AVATAR__;
        if (msg && (msg.x !== undefined || msg.z !== undefined)) {
          // If we received a message recently, update last activity
          lastOpponentActivityRef.current = Date.now();
          if (!opponentConnectedRef.current) {
            // Restore connection state silently (no notification)
            // This handles the case where cf:playerBack event didn't fire
            opponentConnectedRef.current = true;
            setOpponentConnected(true);
            setDisconnectNotification(null);
            // Note: Don't show reconnect notification here - only from cf:playerBack events
            // This prevents false "reconnected" when toggling character visibility
          }
        } else {
          // Check if timeout exceeded - detect disconnects only
          const now = Date.now();
          const timeSinceActivity = now - lastOpponentActivityRef.current;
          if (timeSinceActivity > DISCONNECT_TIMEOUT && opponentConnectedRef.current) {
            opponentConnectedRef.current = false;
            setOpponentConnected(false);
            setReconnectNotification(null);
            setDisconnectNotification(`${oppName} has logged out`);
            setTimeout(() => setDisconnectNotification(null), 5000);
            
            // Clear remote avatar data to prevent it from being reused
            try {
              if (window.__CF_REMOTE_AVATAR__) {
                delete window.__CF_REMOTE_AVATAR__.x;
                delete window.__CF_REMOTE_AVATAR__.z;
              }
            } catch {}
          }
        }
      } catch {}
    }, 2000);
    
    return () => clearInterval(checkInterval);
  }, [oppName]);
  
  // Poll gamepad for Start button (menu button with 3 lines)
  useEffect(() => {
    const pollInterval = setInterval(() => {
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[0];
        
        if (gamepad) {
          // Button 9 = Start button (3 lines/menu button)
          const startButtonNow = gamepad.buttons[9]?.pressed || false;
          
          // Detect button press (not hold)
          if (startButtonNow && !startButtonRef.current.pressed) {
            // Toggle settings menu
            setSettingsMenuOpen(prev => !prev);
          }
          
          startButtonRef.current.pressed = startButtonNow;
        }
      } catch {}
    }, 50); // Poll 20 times per second
    
    return () => clearInterval(pollInterval);
  }, []);
  
  // Handle settings save
  const handleSettingsSave = useCallback((newSettings) => {
    setGameSettings(newSettings);
    setLiveSettings(newSettings);
    // Don't close menu - let user close it manually
    // Show brief notification
    setSaveNotification(true);
    setTimeout(() => setSaveNotification(false), 2000); // Fade after 2 seconds
  }, []);
  
  // Handle live settings update (while adjusting sliders)
  const handleLiveSettingsUpdate = useCallback((newSettings) => {
    setLiveSettings(newSettings);
  }, []);
  
  // Hide footer when game board is active (has pieces)
  useEffect(() => {
    const gameHasStarted = board && board.some(row => row.some(cell => cell !== 0));
    if (gameHasStarted) {
      document.body.classList.add('hide-footer');
      // Also set --footer-h to 0 so UI elements that use it adjust
      document.documentElement.style.setProperty('--footer-h', '0px');
    } else {
      document.body.classList.remove('hide-footer');
      // Footer will restore its own height when visible
    }
    return () => {
      document.body.classList.remove('hide-footer');
    };
  }, [board]);
  
  // Decorative stairs UI state
  const [showEditMenu, setShowEditMenu] = useState(false); // Toggle for edit menu visibility
  const [showCollisionMeshes, setShowCollisionMeshes] = useState(false); // Toggle for collision box visibility
  const [showChatUI, setShowChatUI] = useState(true); // Toggle for chat UI visibility (D-pad right)
  
  // Audio Visualizer state
  const [audioVisualizers, setAudioVisualizers] = useState(() => {
    // Load from server snapshot if available (set by roomJoined handler)
    try {
      if (window.__CF_REMOTE_VISUALIZERS__ && Array.isArray(window.__CF_REMOTE_VISUALIZERS__)) {
        return window.__CF_REMOTE_VISUALIZERS__;
      }
      return [];
    } catch (err) {
      console.warn('Failed to load visualizers:', err);
      return [];
    }
  });
  const [selectedVisualizer, setSelectedVisualizer] = useState(null);
  const [availableSounds, setAvailableSounds] = useState(['rocket_ambience.mp3']); // List of available sound files
  const [customModels, setCustomModels] = useState([]); // List of uploaded custom models
  const [availableModels, setAvailableModels] = useState([]); // List of all available models from props folder
  const [selectedModelToLoad, setSelectedModelToLoad] = useState(null); // Selected model from dropdown
  const [activeEditorTab, setActiveEditorTab] = useState('objects'); // Active tab in editor panel
  
  // Controller navigation state for editor menu
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0); // Which section is selected
  const [isInSection, setIsInSection] = useState(false); // Whether we're inside a section navigating items
  const [selectedItemIndex, setSelectedItemIndex] = useState(0); // Which item in the section is selected
  const [isInSubMenu, setIsInSubMenu] = useState(false); // Whether we're inside a placed object's sub-menu
  const [selectedSubItemIndex, setSelectedSubItemIndex] = useState(0); // Which button/toggle in the sub-menu is selected
  
  // Scroll selected placed object into view when navigating with controller
  useEffect(() => {
    if (isInSection && selectedSectionIndex === 0 && selectedItemIndex >= 4) {
      // This is a placed object (items 4+)
      const element = document.querySelector(`[data-placed-object-index="${selectedItemIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedItemIndex, isInSection, selectedSectionIndex]);
  
  // Scroll selected section into view when navigating main menu with controller
  useEffect(() => {
    if (!isInSection && showEditMenu) {
      // When not inside a section, scroll the section itself into view
      const element = document.querySelector(`[data-section-index="${selectedSectionIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedSectionIndex, isInSection, showEditMenu]);
  
  // Load available models from server on mount
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          console.log(`Loaded ${data.models.length} available models from props folder`);
        }
      })
      .catch(err => console.error('Failed to load models:', err));
  }, []);
  
  // Load available sound files on mount
  useEffect(() => {
    fetch('/api/sounds')
      .then(res => res.json())
      .then(data => {
        if (data.sounds && data.sounds.length > 0) {
          setAvailableSounds(data.sounds);
        }
      })
      .catch(err => console.error('Failed to load sounds:', err));
  }, []);
  
  // Load custom models on mount
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setCustomModels(data.models);
        }
      })
      .catch(err => console.error('Failed to load custom models:', err));
  }, []);
  
  // ===== CUBE PLACEMENT SYSTEM =====
  const [placedCubes, setPlacedCubes] = useState(() => {
    // Load from server snapshot if available (set by roomJoined handler)
    try {
      if (window.__CF_REMOTE_CUBES__ && Array.isArray(window.__CF_REMOTE_CUBES__)) {
        return window.__CF_REMOTE_CUBES__.map(cube => ({
          ...cube,
          modelType: cube.modelType || 'none'
        }));
      }
    } catch {}
    // In multiplayer, start empty — roomJoined will populate
    return [];
  });
  const [cubeEditMode, setCubeEditMode] = useState(false); // Enable cube editing
  const [selectedCubeId, setSelectedCubeId] = useState(null); // Currently selected cube
  const [cubeTransformMode, setCubeTransformMode] = useState('translate'); // translate, rotate, scale
  const [cubeDragMode, setCubeDragMode] = useState(false); // Enable free-drag movement
  const [cubeSnap, setCubeSnap] = useState(true);
  const [cubeTranslateSnap, setCubeTranslateSnap] = useState(1.0);
  
  // Terrain sculpting state
  const [sculptMode, setSculptMode] = useState(false); // Enable terrain sculpting
  const [sculptBrushSize, setSculptBrushSize] = useState(5); // Brush radius
  const [sculptStrength, setSculptStrength] = useState(0.5); // How much to raise/lower per scroll
  const [sculptHistory, setSculptHistory] = useState([]); // History of sculpt operations for undo
  const [cubeRotateSnapDeg, setCubeRotateSnapDeg] = useState(15);
  const [cubeScaleSnap, setCubeScaleSnap] = useState(0.1);
  
  // Edge snap confirmation state
  const [snapConfirmDialog, setSnapConfirmDialog] = useState(null); // { cubeId, snapInfo, position }
  const [pendingSnapCubeId, setPendingSnapCubeId] = useState(null); // Track which cube is awaiting snap confirmation
  
  // AI Box editor state
  const [aiBoxEditorOpen, setAIBoxEditorOpen] = useState(false);
  const [aiBoxEditTitle, setAIBoxEditTitle] = useState('');
  const [aiBoxEditPrompt, setAIBoxEditPrompt] = useState('');
  
  // Server restart countdown state (compact - shows in status button)
  const [restartCountdown, setRestartCountdown] = useState(null); // null, 5, 4, 3, 2, 1, 'disconnected', 'reconnecting', 'reconnected'
  const countdownIntervalRef = useRef(null);
  
  // Server status state
  const [showServerStatus, setShowServerStatus] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking'); // 'online', 'offline', 'checking'
  
  // Check server status periodically
  useEffect(() => {
    const checkServer = () => {
      fetch('/api/models')
        .then(() => setServerStatus('online'))
        .catch(() => setServerStatus('offline'));
    };
    
    checkServer(); // Check immediately
    const interval = setInterval(checkServer, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  // Open AI Box editor when an AI Box is selected
  useEffect(() => {
    if (selectedCubeId) {
      const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
      if (selectedCube && selectedCube.isAIBox) {
        setAIBoxEditorOpen(true);
        // Auto-enable editing mode and collision boxes when opening editor
        setCubeEditMode(true);
        setShowCollisionMeshes(true);
        // Extract custom title (remove "AI Box #" prefix if exists)
        const label = selectedCube.aiBoxLabel || '';
        const match = label.match(/AI Box #(\d+)(?:\s*-\s*(.+))?/);
        if (match && match[2]) {
          setAIBoxEditTitle(match[2]); // Extract custom title after " - "
        } else {
          setAIBoxEditTitle(''); // No custom title yet
        }
        // Load AI prompt if it exists
        setAIBoxEditPrompt(selectedCube.aiPrompt || '');
      } else {
        setAIBoxEditorOpen(false);
      }
    } else {
      setAIBoxEditorOpen(false);
    }
  }, [selectedCubeId, placedCubes]);

  // Auto-toggle editing mode and collision boxes when edit menu opens/closes
  useEffect(() => {
    if (showEditMenu) {
      setCubeEditMode(true);
      setShowCollisionMeshes(true);
    } else {
      setCubeEditMode(false);
      setShowCollisionMeshes(false);
    }
  }, [showEditMenu]);
  
  // Listen for server restart countdown (broadcast from other player or received via WebSocket)
  useEffect(() => {
    console.log('🔄 [RESTART] Event listener registered for cf:server-restart-countdown');
    
    const handleRestartCountdown = (e) => {
      try {
        console.log('🔄 [RESTART] Event received:', e.detail);
        
        if (e.detail && typeof e.detail.countdown === 'number') {
          console.log('🔄 [RESTART] Starting countdown from:', e.detail.countdown);
          
          // Clear any existing countdown interval
          if (countdownIntervalRef.current) {
            console.log('🔄 [RESTART] Clearing existing interval');
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          
          setRestartCountdown(e.detail.countdown);
          console.log('🔄 [RESTART] Set restartCountdown state to:', e.detail.countdown);
          
          // Start countdown timer
          let count = e.detail.countdown - 1;
          countdownIntervalRef.current = setInterval(() => {
            if (count > 0) {
              setRestartCountdown(count);
              count--;
            } else {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
              setRestartCountdown('disconnected');
              
              // Clean up initiator flag if it exists
              if (window.__CF_RESTART_INITIATOR__) {
                delete window.__CF_RESTART_INITIATOR__;
              }
            }
          }, 1000);
        } else if (e.detail && e.detail.countdown === 'disconnected') {
          setRestartCountdown('disconnected');
        }
      } catch (err) {
        console.error('Failed to handle restart countdown:', err);
      }
    };
    
    window.addEventListener('cf:server-restart-countdown', handleRestartCountdown);
    return () => {
      window.removeEventListener('cf:server-restart-countdown', handleRestartCountdown);
      // Clean up interval on unmount
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);
  
  // Expose test function to window for manual testing
  useEffect(() => {
    window.__CF_TEST_RESTART_COUNTDOWN__ = (countdown = 5) => {
      console.log('🧪 [TEST] Manually triggering countdown:', countdown);
      console.log('🧪 [TEST] Current restartCountdown state:', restartCountdown);
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown } 
      }));
      console.log('🧪 [TEST] Event dispatched successfully');
    };
    
    // Also expose direct state setter for testing
    window.__CF_TEST_SET_COUNTDOWN_STATE__ = (value) => {
      console.log('🧪 [TEST] Directly setting restartCountdown state to:', value);
      setRestartCountdown(value);
    };
    
    return () => {
      delete window.__CF_TEST_RESTART_COUNTDOWN__;
      delete window.__CF_TEST_SET_COUNTDOWN_STATE__;
    };
  }, [restartCountdown]);
  
  // Handle WebSocket reconnection after server restart
  useEffect(() => {
    if (restartCountdown === 'disconnected') {
      // Start checking for reconnection immediately
      let checkInterval;
      const startChecking = () => {
        checkInterval = setInterval(() => {
          // Check if we're reconnected by looking for the global WebSocket ready state
          if (window.__CF_WS_READY__) {
            clearInterval(checkInterval);
            setRestartCountdown('reconnected');
            // Fade away after 2 seconds
            setTimeout(() => setRestartCountdown(null), 2000);
          }
          // If not reconnected, stay on 'disconnected' - keep checking
        }, 500);
      };
      
      // Start checking after a brief delay (server needs time to restart)
      const delayTimer = setTimeout(startChecking, 2000);
      
      return () => {
        clearTimeout(delayTimer);
        if (checkInterval) clearInterval(checkInterval);
      };
    }
  }, [restartCountdown]);
  
  // Listen for controller menu item activation
  useEffect(() => {
    const handleMenuItemActivate = (e) => {
      const { section, item } = e.detail;
      console.log('🎯 EVENT RECEIVED: Menu item activated:', { section, item });
      
      // Section 0 = Object Placer
      if (section === 0) {
        if (item === 0) {
          // Toggle "Enable editing" checkbox - trigger click on the checkbox
          console.log('🎯 Toggling cubeEditMode checkbox');
          const checkbox = document.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.click();
          }
        }
        else if (item === 1) {
          // Cube button - trigger click on the actual button
          console.log('🎯 Clicking Cube button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Cube') || btn.onclick?.toString().includes('box')) {
              btn.click();
              break;
            }
          }
        }
        else if (item === 2) {
          // Sphere button - trigger click on the actual button
          console.log('🎯 Clicking Sphere button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Sphere') || btn.onclick?.toString().includes('sphere')) {
              btn.click();
              break;
            }
          }
        }
        else if (item === 3) {
          // Cylinder button - trigger click on the actual button
          console.log('🎯 Clicking Cylinder button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Cylinder') || btn.onclick?.toString().includes('cylinder')) {
              btn.click();
              break;
            }
          }
        }
        else if (item >= 4) {
          // Placed objects - items 4+ select the object (excluding terrain)
          const objIndex = item - 4; // Convert to placed objects array index
          const placedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain);
          if (objIndex < placedObjects.length) {
            const cube = placedObjects[objIndex];
            console.log('🎯 Selecting placed object:', cube.id);
            setSelectedCubeId(cube.id);
          }
        }
      }
      // Section 1 = Collision Shapes - buttons at indices 0-4 (Box, Sphere, Cylinder, Capsule, AI Box)
      else if (section === 1) {
        const avatar = window.__CF_LOCAL_AVATAR__ || {};
        const playerX = avatar.x || 0;
        const playerZ = avatar.z || 0;
        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
        const playerYaw = avatar.yaw || 0;
        const spawnDistance = 15;
        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
        
        const shapes = ['box', 'sphere', 'cylinder', 'capsule', 'aibox'];
        const colors = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#22d3ee'];
        
        if (item >= 0 && item < shapes.length) {
          const isAIBox = shapes[item] === 'aibox';
          const newCollision = {
            id: Date.now() + Math.random(),
            shape: isAIBox ? 'box' : shapes[item], // AI Box uses box shape for rendering
            isAIBox: isAIBox, // Flag to identify AI boxes
            aiBoxLabel: isAIBox ? `AI Box #${Math.floor(Math.random() * 9999)}` : undefined,
            position: { x: spawnX, y: playerY, z: spawnZ },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 10, y: 10, z: 10 },
            hasCollision: false, // AI boxes don't need collision by default
            walkableTop: false,
            color: colors[item],
            opacity: isAIBox ? 0.15 : 0.3, // AI boxes are more transparent
            wireframe: isAIBox, // AI boxes show as wireframe
            aiContentData: null // Structured data describing the AI content (not JSX)
          };
          setPlacedCubes(prevCubes => [...prevCubes, newCollision]);
          setSelectedCubeId(newCollision.id);
          
          if (isAIBox) {
            console.log(`🤖 Created AI Box with ID: ${newCollision.id}, Label: ${newCollision.aiBoxLabel}`);
            console.log(`📋 To generate content, tell Copilot: "Create a [object] in AI Box #${newCollision.id}"`);
          }
        }
      }
    };
    
    console.log('🎯 Setting up controllerMenuItemActivate event listener');
    window.addEventListener('controllerMenuItemActivate', handleMenuItemActivate);
    return () => {
      console.log('🎯 Removing controllerMenuItemActivate event listener');
      window.removeEventListener('controllerMenuItemActivate', handleMenuItemActivate);
    };
  }, []);  // Empty dependencies - we only use setState functions which are stable
  
  // Hide chat UI when in edit mode or fullscreen mode, or when manually toggled off
  useEffect(() => {
    // Set global flag that chat component can read
    window.__CF_HIDE_CHAT__ = !showChatUI || cubeEditMode || fullCamera;
    console.log('Chat UI hide flag updated:', {
      showChatUI,
      cubeEditMode,
      fullCamera,
      hideFlag: window.__CF_HIDE_CHAT__
    });
  }, [showChatUI, cubeEditMode, fullCamera]);
  
  // Helper to send cube updates to opponent (called on discrete operations only)
  const sendCubeUpdate = useCallback((cubes) => {
    console.log('[SEND CUBES] 📤 Sending cubes_sync to server:', cubes.map(c => ({ 
      id: c.id, 
      isTerrain: c.isTerrain, 
      texture: c.texture,
      shape: c.shape 
    })));
    if (onAvatarMove) {
      // Mark that we sent this update so we don't apply our own echo
      window.__CF_LAST_CUBE_SEND_TIME__ = Date.now();
      
      onAvatarMove({
        type: 'cubes_sync',
        cubes: cubes,
        timestamp: Date.now()
      });
      console.log('[SEND CUBES] ✅ Called onAvatarMove with cubes_sync');
    } else {
      console.warn('[SEND CUBES] ❌ onAvatarMove is not defined!');
    }
  }, [onAvatarMove]);
  
  // Initialize collision cache on mount and whenever placedCubes changes
  React.useEffect(() => {
    updatePlacedCubesCache(placedCubes);
    console.log('[COLLISION] Cache initialized/updated with', placedCubes.length, 'cubes');
  }, [placedCubes]);
  
  // Debug: Log when placedCubes state changes (specifically for terrain textures)
  React.useEffect(() => {
    const terrainCubes = placedCubes.filter(c => c.isTerrain);
    if (terrainCubes.length > 0) {
      console.log('[STATE DEBUG] 🔄 placedCubes state updated. Terrain cubes:', terrainCubes.map(c => ({
        id: c.id,
        texture: c.texture
      })));
    }
  }, [placedCubes]);
  
  // Save cubes — update collision cache and broadcast (no localStorage)
  const lastCubesJSONRef = React.useRef(null);
  
  React.useEffect(() => {
    const cubesJSON = JSON.stringify(placedCubes);
    
    // Skip if cubes content hasn't actually changed (prevents unnecessary collision rebuilds on re-renders)
    if (lastCubesJSONRef.current === cubesJSON) {
      console.log('[COLLISION] Skipped cache update - no changes');
      return;
    }
    lastCubesJSONRef.current = cubesJSON;
    
    console.log('[COLLISION] Updating cache - cubes changed!');
    
    try {
      // Broadcast to other windows/tabs
      window.dispatchEvent(new CustomEvent('cf:cubes_update', { 
        detail: { cubes: placedCubes, sourceWindow: window } 
      }));
      
      // Update collision cache for physics
      updatePlacedCubesCache(placedCubes);
      
      // Note: Server sync is now handled immediately in add/delete/update functions
      // to provide real-time transform updates during dragging
    } catch (e) {
      console.error('Failed to save cubes:', e);
    }
  }, [placedCubes]);
  
  // Update child collision objects when their parent model moves/scales
  React.useEffect(() => {
    let hasChanges = false;
    const updatedCubes = placedCubes.map(cube => {
      if (cube.parentId) {
        const parent = placedCubes.find(p => p.id === cube.parentId);
        if (parent) {
          // Check if position or scale needs updating
          const positionChanged = 
            cube.position.x !== parent.position.x ||
            cube.position.y !== parent.position.y ||
            cube.position.z !== parent.position.z;
          
          let newScale = cube.scale;
          if (cube.followParentScale && parent.modelBounds) {
            // Recalculate scale based on parent's current scale and bounds
            const bounds = parent.modelBounds;
            const worldWidth = bounds.width * parent.scale.x;
            const worldHeight = bounds.height * parent.scale.y;
            const worldDepth = bounds.depth * parent.scale.z;
            
            newScale = {
              x: worldWidth,
              y: worldHeight,
              z: worldDepth
            };
          }
          
          const scaleChanged = 
            newScale.x !== cube.scale.x ||
            newScale.y !== cube.scale.y ||
            newScale.z !== cube.scale.z;
          
          if (positionChanged || scaleChanged) {
            hasChanges = true;
            
            const updated = {
              ...cube,
              position: { ...parent.position },
              scale: newScale
            };
            
            console.log('[Parent-Child useEffect] Updating child:', {
              childId: cube.id,
              preservedShape: updated.shape,
              preservedWalkableTop: updated.walkableTop,
              preservedHasCollision: updated.hasCollision
            });
            
            // Preserve ALL cube properties, only update position and scale
            return updated;
          }
        }
      }
      return cube;
    });
    
    if (hasChanges) {
      setPlacedCubes(updatedCubes);
    }
  }, [placedCubes]);
  
  // Listen for cube updates from opponent or other tabs
  React.useEffect(() => {
    const handleCubeUpdate = (e) => {
      try {
        // Ignore events from this same window to prevent loops
        if (e.detail.sourceWindow === window) return;
        
        if (e.detail && Array.isArray(e.detail.cubes)) {
          // Always accept all updates for real-time collaborative editing
          // Both players can edit the same cube and see each other's changes immediately
          setPlacedCubes(e.detail.cubes);
        }
      } catch (err) {
        console.warn('Failed to handle cube update:', err);
      }
    };
    
    const handleCubesLoaded = (e) => {
      try {
        // Load cubes from server on game start
        if (e.detail && Array.isArray(e.detail.cubes)) {
          setPlacedCubes(e.detail.cubes);
          updatePlacedCubesCache(e.detail.cubes);
          console.log('[c4-3d] Loaded', e.detail.cubes.length, 'cubes from server');
        }
      } catch (err) {
        console.warn('Failed to load cubes from server:', err);
      }
    };
    
    window.addEventListener('cf:cubes_update', handleCubeUpdate);
    window.addEventListener('cf:cubes_loaded', handleCubesLoaded);
    return () => {
      window.removeEventListener('cf:cubes_update', handleCubeUpdate);
      window.removeEventListener('cf:cubes_loaded', handleCubesLoaded);
    };
  }, [cubeEditMode, selectedCubeId]);
  
  // Listen for visualizer updates from opponent or other tabs
  React.useEffect(() => {
    const handleVisualizerUpdate = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          // Always accept all updates for real-time collaborative editing
          setAudioVisualizers(e.detail.visualizers);
        }
      } catch (err) {
        console.warn('Failed to handle visualizer update:', err);
      }
    };
    
    const handleVisualizersLoaded = (e) => {
      try {
        // Load visualizers from server on game start
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          setAudioVisualizers(e.detail.visualizers);
          console.log('[c4-3d] Loaded', e.detail.visualizers.length, 'audio visualizers from server');
        }
      } catch (err) {
        console.warn('Failed to load visualizers from server:', err);
      }
    };
    
    window.addEventListener('cf:visualizers_update', handleVisualizerUpdate);
    window.addEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    return () => {
      window.removeEventListener('cf:visualizers_update', handleVisualizerUpdate);
      window.removeEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    };
  }, [cubeEditMode]);
  
  // Track the last timestamp we applied remote cubes to prevent duplicate applications
  const lastAppliedRemoteCubesTimestamp = React.useRef(0);
  
  // Poll for remote cube updates from server (similar to remote avatar polling)
  React.useEffect(() => {
    const interval = setInterval(() => {
      try {
        // Check if opponent has sent cube data (would be set by parent component receiving server messages)
        if (window.__CF_REMOTE_CUBES__ && !cubeEditMode) {
          // Ignore echoes of our own updates for 1 second after sending
          const lastSendTime = window.__CF_LAST_CUBE_SEND_TIME__ || 0;
          const timeSinceSend = Date.now() - lastSendTime;
          
          if (timeSinceSend < 1000) {
            console.log('[REMOTE CUBES] ⏭️ Ignoring echo of our own update (sent', timeSinceSend, 'ms ago)');
            return;
          }
          
          const remoteCubes = window.__CF_REMOTE_CUBES__;
          const remoteCubesTimestamp = window.__CF_REMOTE_CUBES_TIMESTAMP__ || 0;
          
          // Only apply if this is new data (different timestamp than last applied)
          if (Array.isArray(remoteCubes) && remoteCubes.length >= 0 && remoteCubesTimestamp > lastAppliedRemoteCubesTimestamp.current) {
            console.log('[REMOTE CUBES] 📥 Received NEW data from window global (ts:', remoteCubesTimestamp, ')');
            setPlacedCubes(remoteCubes);
            lastAppliedRemoteCubesTimestamp.current = remoteCubesTimestamp;
            console.log('[REMOTE CUBES] ✅ Applied to local state');
            // Update module-level cache for real-time collision
            updatePlacedCubesCache(remoteCubes);
          }
        }
      } catch (e) {
        console.warn('Failed to sync remote cubes:', e);
      }
    }, 500); // Check every 500ms
    
    return () => clearInterval(interval);
  }, [cubeEditMode]);
  
  // Add a new cube or sphere in front of player at their position and height with immediate sync
  const addCube = React.useCallback((shape = 'box', modelType = 'none') => {
    // Get player's current position and facing direction from global state
    const avatar = window.__CF_LOCAL_AVATAR__ || {};
    const playerX = avatar.x || 0;
    const playerZ = avatar.z || 0;
    const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0); // Current height (includes jumps/stairs)
    const playerYaw = avatar.yaw || 0; // Facing direction in radians
    
    // Spawn distance in front of player (adjust as needed)
    const spawnDistance = 15;
    
    // Calculate spawn position in front of player using their yaw
    const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
    const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
    const spawnY = playerY; // Spawn at player's current height
    
    // Default scale based on type
    let defaultScale = { x: 5, y: 5, z: 5 };
    if (modelType === 'asteroid') {
      defaultScale = { x: 0.06, y: 0.06, z: 0.06 }; // Asteroid default scale
    } else if (modelType === 'rover') {
      defaultScale = { x: 0.08, y: 0.08, z: 0.08 }; // Rover default scale
    } else if (modelType === 'table') {
      defaultScale = { x: 0.15, y: 0.15, z: 0.15 }; // Table default scale
    } else if (modelType === 'stairs2') {
      defaultScale = { x: 1.0, y: 1.0, z: 1.0 }; // Stairs2 at natural scale
    }
    
    const newCube = {
      id: Date.now() + Math.random(), // unique ID
      shape: shape, // 'box', 'sphere', or 'cylinder'
      modelType: modelType, // 'none', 'asteroid', 'table', 'stairs2'
      position: { x: spawnX, y: spawnY, z: spawnZ },
      rotation: { x: 0, y: 0, z: 0 },
      scale: defaultScale,
      hasCollision: true,
      walkableTop: (modelType === 'stairs2' || shape === 'cylinder'), // Stairs and cylinders are walkable
      color: '#3b82f6' // default blue
    };
    const newCubes = [...placedCubes, newCube];
    setPlacedCubes(newCubes);
    setSelectedCubeId(newCube.id);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, sendCubeUpdate]);
  
  // Delete selected cube with immediate sync (also removes children like collision boxes)
  const deleteCube = React.useCallback((id) => {
    // Remove the cube AND any children (collision boxes, etc.) that have this cube as parent
    const newCubes = placedCubes.filter(c => c.id !== id && c.parentId !== id);
    setPlacedCubes(newCubes);
    if (selectedCubeId === id) setSelectedCubeId(null);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, selectedCubeId, sendCubeUpdate]);
  
  // Cleanup orphaned collision objects (children whose parents no longer exist)
  const cleanupOrphanedCollisions = React.useCallback(() => {
    const parentIds = new Set(placedCubes.map(c => c.id));
    const newCubes = placedCubes.filter(c => {
      // Keep if it has no parent, or if its parent still exists
      return !c.parentId || parentIds.has(c.parentId);
    });
    
    if (newCubes.length !== placedCubes.length) {
      setPlacedCubes(newCubes);
      sendCubeUpdate(newCubes);
      console.log(`[Cleanup] Removed ${placedCubes.length - newCubes.length} orphaned collision objects`);
    }
  }, [placedCubes, sendCubeUpdate]);
  
  // Update cube and send to network (used when transform is finished)
  const updateCubeAndSync = React.useCallback((id, updates) => {
    console.log('[updateCubeAndSync] 🔄 START - Updating cube:', id, 'with updates:', updates);
    
    setPlacedCubes(prevCubes => {
      const newCubes = prevCubes.map(c => {
        if (c.id === id) {
          const updated = { ...c, ...updates };
          console.log('[updateCubeAndSync] ✏️ Updated cube:', {
            id,
            oldTexture: c.texture,
            newTexture: updated.texture,
            isTerrain: updated.isTerrain,
            allUpdates: updates
          });
          return updated;
        }
        // If this cube is parented to the updated cube, update its position/scale too
        if (c.parentId === id && (updates.position || updates.scale)) {
          const parent = { ...prevCubes.find(p => p.id === id), ...updates };
          if (parent) {
            let newChildScale = c.scale;
            
            // Recalculate child collision scale based on new parent scale and bounds
            if (c.followParentScale && updates.scale && parent.modelBounds) {
              const bounds = parent.modelBounds;
              newChildScale = {
                x: bounds.width * updates.scale.x,
                y: bounds.height * updates.scale.y,
                z: bounds.depth * updates.scale.z
              };
            }
            
            const updated = {
              ...c,
              position: updates.position ? { ...updates.position } : c.position,
              scale: newChildScale
            };
            
            console.log('[updateCubeAndSync] Updating child collision:', {
              childId: c.id,
              preservedShape: updated.shape,
              preservedHasCollision: updated.hasCollision,
              preservedColor: updated.color
            });
            
            // Preserve ALL child properties (shape, hasCollision, color, etc.)
            return updated;
          }
        }
        return c;
      });
      
      console.log('[updateCubeAndSync] 💾 New state:', newCubes.length, 'cubes');
      console.log('[updateCubeAndSync] 🔍 Updated cube in new state:', newCubes.find(c => c.id === id));
      
      // Send update to opponent (transform completed - no throttle needed)
      console.log('[updateCubeAndSync] 📡 Calling sendCubeUpdate');
      sendCubeUpdate(newCubes);
      
      return newCubes;
    });
  }, [sendCubeUpdate]);
  
  // Expose updateCubeAndSync globally for vehicle system
  useEffect(() => {
    window.__CF_UPDATE_CUBE__ = updateCubeAndSync;
    return () => {
      delete window.__CF_UPDATE_CUBE__;
    };
  }, [updateCubeAndSync]);
  
  // Helper: Add AI content to a specific AI Box by ID or label
  const addAIContent = React.useCallback((boxIdentifier, contentData) => {
    // Find box by ID or label
    const box = placedCubes.find(c => 
      c.isAIBox && (
        c.id.toString().includes(boxIdentifier) || 
        c.aiBoxLabel?.includes(boxIdentifier)
      )
    );
    
    if (!box) {
      console.error(`❌ AI Box not found: ${boxIdentifier}`);
      return false;
    }
    
    console.log(`🤖 Adding AI content to ${box.aiBoxLabel || `Box ${box.id}`}`);
    updateCubeAndSync(box.id, { aiContentData: contentData });
    return true;
  }, [placedCubes, updateCubeAndSync]);
  
  // Expose to window for easy testing/usage
  React.useEffect(() => {
    window.__CF_ADD_AI_CONTENT__ = addAIContent;
    return () => delete window.__CF_ADD_AI_CONTENT__;
  }, [addAIContent]);
  
  // Handler: Save AI Box title
  const handleSaveAIBoxTitle = React.useCallback(() => {
    if (!selectedCubeId) return;
    
    const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
    if (!selectedCube || !selectedCube.isAIBox) return;
    
    // Extract AI Box ID from current label
    const currentLabel = selectedCube.aiBoxLabel || '';
    const match = currentLabel.match(/AI Box #(\d+)/);
    const boxId = match ? match[1] : selectedCube.id;
    
    // Build new label: "AI Box #<id> - <customTitle>" or just "AI Box #<id>" if no title
    const newLabel = aiBoxEditTitle.trim() 
      ? `AI Box #${boxId} - ${aiBoxEditTitle.trim()}`
      : `AI Box #${boxId}`;
    
    console.log('💾 Saving AI Box title:', { oldLabel: currentLabel, newLabel });
    console.log('💾 Saving AI Box prompt:', aiBoxEditPrompt);
    
    // Update the cube with new label and prompt
    updateCubeAndSync(selectedCube.id, { 
      aiBoxLabel: newLabel,
      aiPrompt: aiBoxEditPrompt.trim()
    });
    
    // Close editor
    setAIBoxEditorOpen(false);
    setSelectedCubeId(null);
    
    // Broadcast restart countdown to all players via onAvatarMove callback
    // The server will broadcast this back to ALL players (including us) to keep everyone in sync
    if (onAvatarMove) {
      console.log('🔄 [RESTART] Broadcasting countdown to server...');
      // Mark this player as the initiator so they trigger the actual restart
      window.__CF_RESTART_INITIATOR__ = true;
      const message = {
        type: 'server-restart-countdown',
        countdown: 5
      };
      console.log('🔄 [RESTART] Calling onAvatarMove with:', message);
      onAvatarMove(message);
      console.log('🔄 [RESTART] onAvatarMove called successfully');
      
      // ALSO trigger locally immediately so the initiating player sees feedback
      // The broadcast will come back and sync both players
      console.log('🔄 [RESTART] Also triggering local countdown for immediate feedback');
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown: 5 } 
      }));
    } else {
      console.error('🔄 [RESTART] ERROR: onAvatarMove is not available!');
      // Fallback: trigger locally even if no network
      console.log('🔄 [RESTART] Fallback: triggering local countdown only');
      window.__CF_RESTART_INITIATOR__ = true;
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown: 5 } 
      }));
    }
    
    // NOTE: We don't start the countdown locally anymore
    // We wait for the server broadcast to come back to ensure both players are perfectly synchronized
  }, [selectedCubeId, placedCubes, aiBoxEditTitle, aiBoxEditPrompt, updateCubeAndSync, onAvatarMove]);
  
  // ===== TERRAIN SCULPTING =====
  const handleSculpt = useCallback((terrainId, worldPosition, brushSize, delta) => {
    console.log('[SCULPT] At X:', worldPosition.x.toFixed(2), 'Z:', worldPosition.z.toFixed(2), 'delta:', delta.toFixed(2));
    
    // Save current state to history before modifying
    setPlacedCubes(prevCubes => {
      const currentTerrain = prevCubes.find(c => c.id === terrainId);
      if (!currentTerrain || !currentTerrain.isTerrain) {
        return prevCubes;
      }
      
      // Save the current state to history
      setSculptHistory(prevHistory => [...prevHistory, {
        terrainId,
        previousModifications: currentTerrain.heightModifications ? [...currentTerrain.heightModifications] : []
      }]);
      
      // Apply the new modification
      return prevCubes.map(cube => {
        if (cube.id !== terrainId || !cube.isTerrain) return cube;
        
        // Initialize height modifications array if it doesn't exist
        const modifications = cube.heightModifications || [];
        
        // Convert world position to local position relative to terrain
        const cosY = Math.cos(cube.rotation.y);
        const sinY = Math.sin(cube.rotation.y);
        
        // Transform world position to local space
        const dx = worldPosition.x - cube.position.x;
        const dz = worldPosition.z - cube.position.z;
        const localX = dx * cosY + dz * sinY;
        const localZ = -dx * sinY + dz * cosY;
        
        // Add new modification in local coordinates
        modifications.push({
          x: localX,
          z: localZ,
          radius: brushSize,
          delta: delta
        });
        
        return { ...cube, heightModifications: modifications };
      });
    });
  }, []);
  
  // Undo last sculpt operation
  const undoSculpt = useCallback(() => {
    if (sculptHistory.length === 0) return;
    
    setSculptHistory(prevHistory => {
      const newHistory = [...prevHistory];
      const lastAction = newHistory.pop();
      
      // Restore previous state
      setPlacedCubes(prevCubes => {
        return prevCubes.map(cube => {
          if (cube.id === lastAction.terrainId) {
            return { ...cube, heightModifications: lastAction.previousModifications };
          }
          return cube;
        });
      });
      
      return newHistory;
    });
  }, [sculptHistory]);
  
  // Clear all sculpts from selected terrain
  const clearAllSculpts = useCallback(() => {
    if (!selectedCubeId) return;
    
    setPlacedCubes(prevCubes => {
      return prevCubes.map(cube => {
        if (cube.id === selectedCubeId && cube.isTerrain) {
          return { ...cube, heightModifications: [] };
        }
        return cube;
      });
    });
    
    // Clear history too
    setSculptHistory([]);
  }, [selectedCubeId]);
  
  // Listen for Ctrl+Z when in sculpt mode
  useEffect(() => {
    if (!sculptMode) return;
    
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoSculpt();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sculptMode, undoSculpt]);

  // Toggle inventory menu with 'I' key
  useEffect(() => {
    const handleInventoryKey = (e) => {
      if (e.key === 'i' || e.key === 'I') {
        // Don't toggle if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        setInventoryOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleInventoryKey);
    return () => window.removeEventListener('keydown', handleInventoryKey);
  }, []);
  
  // Arrow key controls for moving selected terrain
  useEffect(() => {
    if (!cubeEditMode || !selectedCubeId) return;
    
    const handleKeyDown = (e) => {
      const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
      if (!selectedCube) return;
      
      // Check if arrow keys are pressed
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        
        // Movement step size (can be modified based on snap settings)
        const moveStep = cubeSnap ? cubeTranslateSnap : 1.0;
        
        // Calculate new position based on arrow key
        let newPosition = { ...selectedCube.position };
        
        switch (e.key) {
          case 'ArrowUp':
            newPosition.z -= moveStep; // Move forward (negative Z)
            break;
          case 'ArrowDown':
            newPosition.z += moveStep; // Move backward (positive Z)
            break;
          case 'ArrowLeft':
            newPosition.x -= moveStep; // Move left (negative X)
            break;
          case 'ArrowRight':
            newPosition.x += moveStep; // Move right (positive X)
            break;
        }
        
        // Update the cube position
        updateCubeAndSync(selectedCubeId, { position: newPosition });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cubeEditMode, selectedCubeId, placedCubes, cubeSnap, cubeTranslateSnap, updateCubeAndSync]);
  
  // ===== AUDIO VISUALIZER SYNC FUNCTIONS =====
  const sendVisualizerUpdate = useCallback((visualizers) => {
    if (onAvatarMove) {
      onAvatarMove({
        type: 'visualizers_sync',
        visualizers: visualizers,
        timestamp: Date.now()
      });
    }
  }, [onAvatarMove]);
  
  // Notify other player when a new sound is uploaded
  const sendSoundUploadNotification = useCallback((filename) => {
    if (onAvatarMove) {
      onAvatarMove({
        type: 'sound_uploaded',
        filename: filename,
        timestamp: Date.now()
      });
    }
  }, [onAvatarMove]);
  
  // Save visualizers and sync (no localStorage)
  React.useEffect(() => {
    try {
      // Broadcast to other windows/tabs
      window.dispatchEvent(new CustomEvent('cf:visualizers_update', { 
        detail: { visualizers: audioVisualizers } 
      }));
    } catch (err) {
      console.warn('Failed to save visualizers:', err);
    }
  }, [audioVisualizers]);
  
  // Listen for visualizer updates from other instances
  React.useEffect(() => {
    const handleVisualizerUpdate = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers) && !cubeEditMode) {
          setAudioVisualizers(e.detail.visualizers);
        }
      } catch (err) {
        console.warn('Failed to handle visualizer update:', err);
      }
    };
    
    const handleVisualizersLoaded = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          setAudioVisualizers(e.detail.visualizers);
          console.log('[c4-3d] Loaded', e.detail.visualizers.length, 'audio visualizers from server');
        }
      } catch (err) {
        console.warn('Failed to load visualizers from server:', err);
      }
    };
    
    window.addEventListener('cf:visualizers_update', handleVisualizerUpdate);
    window.addEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    return () => {
      window.removeEventListener('cf:visualizers_update', handleVisualizerUpdate);
      window.removeEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    };
  }, [cubeEditMode]);
  
  // Expose sound upload notification function globally and listen for incoming notifications
  React.useEffect(() => {
    window.__SEND_SOUND_UPLOAD__ = sendSoundUploadNotification;
    
    const handleSoundUploaded = (e) => {
      try {
        if (e.detail && e.detail.filename && !availableSounds.includes(e.detail.filename)) {
          setAvailableSounds(prev => [...prev, e.detail.filename]);
          console.log('[c4-3d] Other player uploaded sound:', e.detail.filename);
        }
      } catch (err) {
        console.warn('Failed to handle sound upload notification:', err);
      }
    };
    
    window.addEventListener('cf:sound_uploaded', handleSoundUploaded);
    return () => {
      window.removeEventListener('cf:sound_uploaded', handleSoundUploaded);
      delete window.__SEND_SOUND_UPLOAD__;
    };
  }, [sendSoundUploadNotification, availableSounds]);
  
  // Poll for remote visualizer updates from server
  React.useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (window.__CF_REMOTE_VISUALIZERS__ && !cubeEditMode) {
          const remoteVisualizers = window.__CF_REMOTE_VISUALIZERS__;
          if (Array.isArray(remoteVisualizers) && remoteVisualizers.length > 0) {
            setAudioVisualizers(remoteVisualizers);
          }
        }
      } catch (err) {
        console.warn('Failed to poll remote visualizers:', err);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [cubeEditMode]);
  
  const updateVisualizerAndSync = React.useCallback((id, updates) => {
    const newVisualizers = audioVisualizers.map(v => v.id === id ? { ...v, ...updates } : v);
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  const addVisualizerAndSync = React.useCallback((visualizer) => {
    const newVisualizers = [...audioVisualizers, visualizer];
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  const deleteVisualizerAndSync = React.useCallback((id) => {
    const newVisualizers = audioVisualizers.filter(v => v.id !== id);
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  // Duplicate selected cube with immediate sync
  const duplicateCube = React.useCallback((id) => {
    const cube = placedCubes.find(c => c.id === id);
    if (!cube) return;
    
    // For terrain floors, keep the same position; for other objects, offset slightly
    const positionOffset = cube.isTerrain ? { ...cube.position } : { ...cube.position, x: cube.position.x + 2 };
    
    const newCube = {
      ...cube,
      id: Date.now() + Math.random(),
      position: positionOffset,
      // Clear ALL snap-related data for duplicated terrain (it should not be pre-snapped)
      snappedEdges: {}, // Support multiple edge snaps
      savedEdgeHeights: undefined, // Clear old edge height data (prevents ghost blending)
      // Deep copy all terrain-specific properties
      scale: cube.scale ? { ...cube.scale } : undefined,
      rotation: cube.rotation ? { ...cube.rotation } : undefined,
      terrainScale: cube.terrainScale,
      terrainHeightMultiplier: cube.terrainHeightMultiplier,
      terrainMoundScale: cube.terrainMoundScale,
      terrainMoundMultiplier: cube.terrainMoundMultiplier,
      terrainOctaves: cube.terrainOctaves,
      terrainEdgeBlend: cube.terrainEdgeBlend,
      terrainSegments: cube.terrainSegments,
      hasTerrainNoise: cube.hasTerrainNoise,
      hasWireframe: cube.hasWireframe,
      textureType: cube.textureType,
      customTexturePath: cube.customTexturePath
    };
    const newCubes = [...placedCubes, newCube];
    setPlacedCubes(newCubes);
    setSelectedCubeId(newCube.id);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, sendCubeUpdate]);
  
  // Event handler for controller sub-menu item activation (buttons/toggles inside placed objects)
  useEffect(() => {
    const handleSubMenuItemActivate = (e) => {
      const { objectIndex, subItem } = e.detail;
      console.log('🎮 Sub-menu item activated:', { objectIndex, subItem });
      
      // Get the placed object (items 4+ map to placedCubes array, excluding terrain)
      const objIndex = objectIndex - 4;
      const placedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain);
      if (objIndex < 0 || objIndex >= placedObjects.length) {
        console.error('Invalid object index:', objectIndex);
        return;
      }
      
      const cube = placedObjects[objIndex];
      console.log('🎮 Operating on cube:', cube.id);
      
      // Sub-item mapping:
      // 0 = Duplicate button
      // 1 = Delete button
      // 2 = Collision checkbox
      // 3 = Walkable checkbox
      // 4 = Box collision shape
      // 5 = Sphere collision shape
      // 6 = Cylinder collision shape
      
      if (subItem === 0) {
        // Duplicate
        console.log('🎮 Duplicating cube:', cube.id);
        duplicateCube(cube.id);
      } else if (subItem === 1) {
        // Delete
        console.log('🎮 Deleting cube:', cube.id);
        deleteCube(cube.id);
      } else if (subItem === 2) {
        // Toggle Collision checkbox
        console.log('🎮 Toggling collision for cube:', cube.id, 'current:', cube.hasCollision);
        updateCubeAndSync(cube.id, { hasCollision: !cube.hasCollision });
      } else if (subItem === 3) {
        // Toggle Walkable checkbox
        console.log('🎮 Toggling walkable for cube:', cube.id, 'current:', cube.walkableTop);
        updateCubeAndSync(cube.id, { walkableTop: !cube.walkableTop });
      } else if (subItem >= 4 && subItem <= 6) {
        // Collision shape buttons (Box, Sphere, Cylinder)
        const shapes = ['box', 'sphere', 'cylinder'];
        const shape = shapes[subItem - 4];
        console.log('🎮 Setting collision shape:', shape);
        
        // Find existing collision layer
        const existingCollision = placedCubes.find(c => c.parentId === cube.id);
        
        // Use actual model bounds if available, otherwise estimate
        const bounds = cube.modelBounds || { width: 100, height: 100, depth: 100 };
        const scaleX = cube.scale.x || 0.1;
        const scaleY = cube.scale.y || 0.1;
        const scaleZ = cube.scale.z || 0.1;
        
        const worldWidth = bounds.width * scaleX;
        const worldHeight = bounds.height * scaleY;
        const worldDepth = bounds.depth * scaleZ;
        
        if (existingCollision) {
          // Update existing collision
          updateCubeAndSync(existingCollision.id, { 
            shape,
            scale: { x: worldWidth, y: worldHeight, z: worldDepth }
          });
        } else {
          // Create new collision layer
          const newId = `collision-${cube.id}-${Date.now()}`;
          const newCube = {
            id: newId,
            shape,
            modelType: 'none',
            position: { ...cube.position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: worldWidth, y: worldHeight, z: worldDepth },
            color: '#a855f7',
            hasCollision: true,
            walkableTop: false,
            parentId: cube.id,
            followParentScale: true
          };
          
          const newCubes = [...placedCubes, newCube];
          setPlacedCubes(newCubes);
          sendCubeUpdate(newCubes);
        }
      }
    };
    
    console.log('🎯 Setting up controllerSubMenuItemActivate event listener');
    window.addEventListener('controllerSubMenuItemActivate', handleSubMenuItemActivate);
    return () => {
      console.log('🎯 Removing controllerSubMenuItemActivate event listener');
      window.removeEventListener('controllerSubMenuItemActivate', handleSubMenuItemActivate);
    };
  }, [placedCubes, duplicateCube, deleteCube, updateCubeAndSync, sendCubeUpdate]);
  
  const [extraAlign, setExtraAlign] = useState(true);
  const [extraSide, setExtraSide] = useState('left'); // matches current scene usage
  const [extraGap, setExtraGap] = useState(1.4);
  const [extraX, setExtraX] = useState(STAIR2_POS_X + 0);
  const [extraZ, setExtraZ] = useState(STAIR2_POS_Z + 0);
  const [extraYawDeg, setExtraYawDeg] = useState(0); // face forward by default
  const [extraScale, setExtraScale] = useState(0.16);
  // Per-axis scale states for stairs (edited via gizmo); keep uniform slider bound to X for legacy control
  const [extraScaleX, setExtraScaleX] = useState(0.16);
  const [extraScaleY, setExtraScaleY] = useState(0.16);
  const [extraScaleZ, setExtraScaleZ] = useState(0.16);
  const [extraWalkable, setExtraWalkable] = useState(false);
  // Table scale is fixed now; no user control
  const [extraReverse, setExtraReverse] = useState(false);
  const [extraY, setExtraY] = useState(0);
  const [lockYToGround, setLockYToGround] = useState(true);
  useEffect(() => { try { setExtraStairsWalkable(extraWalkable); } catch {} }, [extraWalkable]);

  // Walkable mask tuning (lets you adjust the collision mask independent of the visible model)
  const [maskEdit, setMaskEdit] = useState(false);
  const [maskScale, setMaskScale] = useState(1);       // multiplies width/depth/height/run/rise
  const [maskYawDeg, setMaskYawDeg] = useState(0);     // added to model yaw
  const [maskDX, setMaskDX] = useState(0);             // offset from model X
  const [maskDY, setMaskDY] = useState(0);             // offset from model Y (posY)
  const [maskDZ, setMaskDZ] = useState(0);             // offset from model Z
  const maskObjRef = useRef();                          // visible mask handle for click-to-edit

  // Transform (drag/move/rotate/scale) controls for decorative stairs
  const SHOW_DECOR_STAIRS = false; // hide FBX decorative stairs for now
  const extraRef = useRef();
  const [extraEdit, setExtraEdit] = useState(false);
  const [extraMode, setExtraMode] = useState('translate'); // 'translate' | 'rotate' | 'scale'
  const [extraSnap, setExtraSnap] = useState(true);
  const [extraTranslateSnap, setExtraTranslateSnap] = useState(0.5);
  const [extraRotateSnapDeg, setExtraRotateSnapDeg] = useState(15);
  const [extraScaleSnap, setExtraScaleSnap] = useState(0.01);
  const extraLastDefRef = useRef(null);
  const prevCamStateRef = useRef({ fullCamera: null, followCam: null });

  // When decorative stairs are hidden, ensure their walkable/collision state is cleared
  useEffect(() => {
    if (!SHOW_DECOR_STAIRS) {
      try { setExtraStairsWalkable(false); } catch {}
      try { setExtraStairsDef(null); } catch {}
    }
  }, [SHOW_DECOR_STAIRS]);

  // Ensure free camera while editing; restore when done
  useEffect(() => {
    try {
      if (extraEdit) {
        // save
        prevCamStateRef.current = { fullCamera, followCam };
        // force free camera; disable follower
        setFullCamera(true);
        setFollowCam(false);
        // also block any auto-resume timers
        try { window.__CF_USER_ORBIT__ = true; window.__CF_RESUME_FOLLOW_AT__ = 0; } catch {}
      } else {
        // restore prior camera state if available
        const prev = prevCamStateRef.current || {};
        if (typeof prev.fullCamera === 'boolean') setFullCamera(prev.fullCamera);
        if (typeof prev.followCam === 'boolean') setFollowCam(prev.followCam);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraEdit]);

  // Helpers to export/import current decorative stairs settings
  const buildExtraStairsJSX = useCallback(() => {
    const yawRad = (extraYawDeg * Math.PI) / 180;
    const y = extraY.toFixed(2);
    const lockY = lockYToGround;
    return `<ExtraStairsFBX alignToStair2={false} yaw={${yawRad.toFixed(4)}} scaleMul={${extraScale.toFixed(3)}} posX={${extraX.toFixed(2)}} posZ={${extraZ.toFixed(2)}} posY={${y}} /> // lockY=${lockY}`;
  }, [extraYawDeg, extraScale, extraX, extraZ, extraY, lockYToGround]);
  const buildExtraStairsJSON = useCallback(() => {
    return JSON.stringify({
      alignToStair2: extraAlign,
      side: extraSide,
      gap: extraGap,
      posX: extraX,
      posZ: extraZ,
      posY: extraY,
      yawDeg: extraYawDeg,
      scaleMul: extraScale,
      scaleMulX: extraScaleX,
      scaleMulY: extraScaleY,
      scaleMulZ: extraScaleZ,
      walkable: extraWalkable,
      reverse: extraReverse,
      lockYToGround,
      mask:{ scale: maskScale, yawDeg: maskYawDeg, dx: maskDX, dy: maskDY, dz: maskDZ }
    }, null, 2);
  }, [extraAlign, extraSide, extraGap, extraX, extraZ, extraY, extraYawDeg, extraScale, extraScaleX, extraScaleY, extraScaleZ, extraWalkable, extraReverse, lockYToGround, maskScale, maskYawDeg, maskDX, maskDY, maskDZ]);
  const copyText = useCallback(async (txt) => { try { await navigator.clipboard.writeText(txt); } catch {} }, []);
  const applyFromJSON = useCallback((txt) => {
    try {
      const o = typeof txt === 'string' ? JSON.parse(txt) : (txt||{});
      if (typeof o.posX === 'number') setExtraX(o.posX);
      if (typeof o.posZ === 'number') setExtraZ(o.posZ);
      if (typeof o.posY === 'number') setExtraY(o.posY);
      if (typeof o.yawDeg === 'number') setExtraYawDeg(((o.yawDeg % 360)+360)%360);
      if (typeof o.scaleMul === 'number') setExtraScale(o.scaleMul);
      if (typeof o.scaleMulX === 'number') setExtraScaleX(o.scaleMulX);
      if (typeof o.scaleMulY === 'number') setExtraScaleY(o.scaleMulY);
      if (typeof o.scaleMulZ === 'number') setExtraScaleZ(o.scaleMulZ);
      if (typeof o.alignToStair2 === 'boolean') setExtraAlign(o.alignToStair2);
      if (typeof o.side === 'string') setExtraSide(o.side);
      if (typeof o.gap === 'number') setExtraGap(o.gap);
      if (typeof o.walkable === 'boolean') setExtraWalkable(o.walkable);
      if (typeof o.reverse === 'boolean') setExtraReverse(o.reverse);
      if (typeof o.lockYToGround === 'boolean') setLockYToGround(o.lockYToGround);
  // tableScaleMul is no longer used; ignore if present
      if (o.mask && typeof o.mask === 'object'){
        if (typeof o.mask.scale === 'number') setMaskScale(o.mask.scale);
        if (typeof o.mask.yawDeg === 'number') setMaskYawDeg(((o.mask.yawDeg % 360)+360)%360);
        if (typeof o.mask.dx === 'number') setMaskDX(o.mask.dx);
        if (typeof o.mask.dy === 'number') setMaskDY(o.mask.dy);
        if (typeof o.mask.dz === 'number') setMaskDZ(o.mask.dz);
      }
    } catch {}
  }, []);
  const controlsRef = useRef();
  const lastLocalPosRef = useRef({ x: null, z: null });
  const smoothEnableTimerRef = useRef(null);
  // Gate: skip the very next smooth-enable after pressing Leave (user request)
  const suppressNextSmoothRef = useRef(false);

  // Clean up global state on mount/unmount to prevent stale values from hot reload
  const [hotReloadDetected, setHotReloadDetected] = React.useState(false);
  
  useEffect(() => {
    // Reset global flags on mount
    try {
      console.log('[ConnectFour3D] Component mounted, clearing global state');
      
      // Detect hot reload - if window has our marker, it's a hot reload
      // Disabled: Model loading was triggering false hot reload detection
      /*
      if (window.__CF_COMPONENT_MOUNTED__) {
        console.warn('[ConnectFour3D] HOT RELOAD DETECTED - Incrementing reload counter');
        window.__CF_HOT_RELOAD_COUNT__ = (window.__CF_HOT_RELOAD_COUNT__ || 0) + 1;
        setHotReloadDetected(true);
        // Auto-dismiss after 3 seconds
        setTimeout(() => setHotReloadDetected(false), 3000);
      }
      */
      window.__CF_COMPONENT_MOUNTED__ = true;
      
      window.__CF_USER_ORBIT__ = false;
      window.__CF_RESUME_FOLLOW_AT__ = 0;
      window.__CF_FORCE_SNAP__ = 0;
      window.__CF_POV_HEIGHT_OFFSET__ = undefined;
    } catch {}
    
    // Clean up on unmount
    return () => {
      try {
        console.log('[ConnectFour3D] Component unmounting, cleaning up');
        if (smoothEnableTimerRef.current) {
          clearTimeout(smoothEnableTimerRef.current);
          smoothEnableTimerRef.current = null;
        }
        window.__CF_USER_ORBIT__ = false;
        window.__CF_RESUME_FOLLOW_AT__ = 0;
        window.__CF_FORCE_SNAP__ = 0;
        window.__CF_LOCAL_AVATAR__ = undefined;
        window.__CF_POV_HEIGHT_OFFSET__ = undefined;
        // Don't clear __CF_COMPONENT_MOUNTED__ so we can detect hot reload
      } catch {}
    };
  }, []);

  // When Full Camera controls are enabled, turn OFF 3rd-person follow and clear any follow timers
  useEffect(() => {
    if (fullCamera) {
      try {
        setFollowCam(false);
        if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; }
        window.__CF_USER_ORBIT__ = false;
        window.__CF_RESUME_FOLLOW_AT__ = 0;
        window.__CF_FORCE_SNAP__ = 0;
        
        // Don't change the camera target - let it stay wherever it currently is
        // This preserves the current view when toggling to full camera mode
      } catch {}
    }
  }, [fullCamera]);
  // Helper: ensure 3rd-person follow is ON and centered behind the avatar
  const centerThirdPerson = useCallback(() => {
    try {
      const msg = window.__CF_LOCAL_AVATAR__;
      if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
      
      setFollowSeed((s) => s + 1);
      setFollowCam(true);
    } catch {}
  }, []);

  // Clear any pending smooth-enable timer on unmount
  useEffect(() => {
    return () => { try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {} };
  }, []);

  // Helper: after the user walks a bit, auto-enable smooth follow with a short delay
  const autoEnableSmoothIfWalking = useCallback((x, z) => {
    // Smooth follow is always on, nothing to do
    try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
    try { suppressNextSmoothRef.current = false; } catch {}
    return;
  }, [followCam]);

  // When followCam is turned on elsewhere, auto-center it once
  useEffect(() => {
    if (followCam && !fullCamera) {
      centerThirdPerson();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCam, fullCamera]);

  
  // Zoom ranges (more zoom out by default; very long when fullCamera)
  const minDist = fullCamera ? 0.0001 : (isNarrow ? 10 : 9);
  const maxDist = fullCamera ? 100000 : (isNarrow ? 60 : 40);
  // Position the HUD below the navbar
  const hudTop = isNarrow ? 76 : 64;

  // No on-screen animation speed sliders; values can still be overridden via window.__CF_ANIM_SPEEDS__ if needed.

  // Compute avatar facing toward current camera position using baked per-side X offsets
  // Opponent should always be on the far side of the table from the camera
  const zSign = camPos[2] >= 0 ? -1 : 1; // camera z>0 means near side is +Z; opponent goes to -Z (and vice versa)
  const pxFixed = AVATAR_BAKED_POS[0] + ((zSign < 0) ? AVATAR_X_FRONT : AVATAR_X_BACK);
  const pzFixed = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  // Face the camera: our models/groups default to looking toward -Z, so add π to align toward the camera direction
  const yaw = Math.atan2(camPos[0] - pxFixed, camPos[2] - pzFixed) + Math.PI;
  const rotationOverride = [0, yaw, 0];
  const positionOverride = null; // position is computed inside avatar components now

  const GRID_H = ROWS * (CELL + GAP) - GAP;
  const groupY = (GRID_H + 0.6) / 2 + 0.15;
  
  // Camera target - focus on selected object when editing, otherwise board center (or player in full camera mode)
  const cameraTarget = useMemo(() => {
    // When a cube/object is selected, center camera on that object (even in fullCamera mode)
    if (selectedCubeId) {
      // Use CURRENT_PLACED_CUBES cache instead of state to avoid unnecessary recalculations
      const selectedCube = CURRENT_PLACED_CUBES.find(c => c.id === selectedCubeId);
      if (selectedCube && selectedCube.position) {
        return [selectedCube.position.x, selectedCube.position.y, selectedCube.position.z];
      }
    }
    // When editing an audio visualizer, center camera on that visualizer
    if (selectedVisualizer && audioVisualizers.length > 0) {
      const selectedViz = audioVisualizers.find(v => v.id === selectedVisualizer);
      if (selectedViz && selectedViz.position) {
        return [selectedViz.position[0], selectedViz.position[1], selectedViz.position[2]];
      }
    }
    // In full camera mode, target the player
    if (fullCamera) {
      const avatar = window.__CF_LOCAL_AVATAR__;
      if (avatar && Number.isFinite(avatar.x) && Number.isFinite(avatar.z)) {
        const playerY = (typeof avatar.lift === 'number' && avatar.lift > 0) ? avatar.lift : 5;
        return [avatar.x, playerY, avatar.z];
      }
    }
    // Default to board center
    return [0, groupY, 0];
  }, [groupY, selectedCubeId, selectedVisualizer, audioVisualizers, fullCamera]);
  
  // Compute a local Y offset so the board (base at -fh/2) rests on the table top (published by WoodenTable)
  const fhBoard = GRID_H + 0.6; // same as fh in FrontPlate/SideSupports
  const [tableTopY, setTableTopY] = useState(() => {
    const top = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(top) ? top : null;
  });
  // Use a layout effect so the listener is attached before TableFBX dispatches in its own layout effect
  useLayoutEffect(() => {
    const onReady = (e) => {
      try {
        const ty = Number(e?.detail?.topY);
        if (Number.isFinite(ty)) setTableTopY(ty);
      } catch {}
    };
    try { window.addEventListener('cf:table-ready', onReady); } catch {}
    return () => { try { window.removeEventListener('cf:table-ready', onReady); } catch {} };
  }, []);
  const boardOnTableYOffset = (() => {
    try {
      const top = (tableTopY != null) ? tableTopY : (typeof window !== 'undefined' ? Number(window.__CF_TABLE_TOP_Y__) : NaN);
      if (!Number.isFinite(top)) return 0; // fallback: leave as-is
      const epsilon = 0.02; // tiny lift to avoid z-fighting
      // Parent group is at groupY (world Y). The board subgroup's origin is centered; base is at -fh/2.
      // Solve for childY so the board base rests exactly on the tabletop: groupY + childY - fh/2 = top + epsilon
      // => childY = top + epsilon + fh/2 - groupY
      return (top + epsilon + fhBoard / 2 - groupY);
    } catch { return 0; }
  })();
  // Ensure the board starts visibly above the floor even if tabletop detection lags slightly on first paint
  const BOARD_EXTRA_LIFT = -4.0;
  const tableTopKnown = useMemo(() => {
    if (tableTopY != null && Number.isFinite(tableTopY)) return true;
    const g = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(g);
  }, [tableTopY]);

  // Player-specific avatar URLs (Player 2 shark kept for now)
  const player2Url = '/models/avatars/shark/scene.gltf';
  
  // Constant array references to prevent unnecessary re-renders
  const ZERO_POSITION = useMemo(() => [0, 0, 0], []);

  // Precompute positions for both player avatars (consistent regardless of camera side)
  const avatarZ = Math.abs(AVATAR_BAKED_POS[2]);
  const player1Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_FRONT,
    y: AVATAR_BAKED_POS[1],
    z: avatarZ, // Player 1 on +Z side facing center
    zSign: 1
  }), [avatarZ]);
  const player2Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_BACK,
    y: AVATAR_BAKED_POS[1],
    z: -avatarZ, // Player 2 on -Z side facing center
    zSign: -1
  }), [avatarZ]);
  // Determine which player is "you" based on flip180 (if flipped, Player 2 viewpoint)
  const youArePlayer2 = !!flip180;
  
  // Update ref for position broadcast (used in reconnect handler)
  useEffect(() => {
    positionBroadcastRef.current = { onAvatarMove, flip180 };
  }, [onAvatarMove, flip180]);
  
  // Listen for game loaded event (when turn toast appears) and broadcast initial position
  useEffect(() => {
    const handleGameLoaded = () => {
      // Game has fully loaded - broadcast our position so opponent sees our character
      setTimeout(() => {
        try {
          const { onAvatarMove, flip180 } = positionBroadcastRef.current;
          if (!onAvatarMove) return;
          
          const youAreP2 = !!flip180;
          const playerNum = youAreP2 ? 2 : 1;
          
          // Check if we have an actual position already (from movement/reconnect)
          const la = window.__CF_LOCAL_AVATAR__ || {};
          
          const dist = 75;
          const baseX = youAreP2 ? -dist : dist;
          const baseZ = youAreP2 ? dist : -dist;
          const baseYaw = youAreP2 ? Math.PI : 0;
          
          // Use actual position if available, otherwise use base spawn position
          const x = (typeof la.x === 'number' && la.x !== 0) ? la.x : baseX;
          const z = (typeof la.z === 'number' && la.z !== 0) ? la.z : baseZ;
          const yaw = (typeof la.yaw === 'number') ? la.yaw : baseYaw;
          const run = !!la.isRunning;
          const isJumping = !!la.isJumping;
          const lift = (typeof la.lift === 'number') ? la.lift : 0;
          
          // Update local avatar cache
          window.__CF_LOCAL_AVATAR__ = {
            x, z, yaw,
            isRunning: run,
            isJumping: isJumping,
            lift: lift,
          };
          
          // Broadcast position multiple times for reliability
          const broadcast = () => {
            onAvatarMove({ 
              player: playerNum, 
              x, 
              z, 
              yaw, 
              run, 
              isJumping, 
              lift 
            });
          };
          
          broadcast(); // Immediate
          setTimeout(broadcast, 100);
          setTimeout(broadcast, 300);
          setTimeout(broadcast, 600);
          setTimeout(broadcast, 1000);
          setTimeout(broadcast, 1500);
        } catch (err) {
          console.warn('Failed to broadcast position on game load:', err);
        }
      }, 200); // Small delay to ensure everything is ready
    };
    
    window.addEventListener('cf:gameLoaded', handleGameLoaded);
    return () => window.removeEventListener('cf:gameLoaded', handleGameLoaded);
  }, []);
  
  // State for the local player's label position (XZ), so Billboards update via React props
  const [youLabelPos, setYouLabelPos] = useState({ x: youArePlayer2 ? player2Pos.x : player1Pos.x, z: youArePlayer2 ? player2Pos.z : player1Pos.z });
  // Remote avatar position (world XZ). Start at the base position of the opponent side.
  const remoteBase = youArePlayer2 ? player1Pos : player2Pos;
  const remoteSide = youArePlayer2 ? 'Player 1' : 'Player 2';
  const [remoteLabelPos, setRemoteLabelPos] = useState({ x: remoteBase.x, z: remoteBase.z });
  const remoteRef = useRef({ x: remoteBase.x, z: remoteBase.z });

  // When the user returns to third-person (showSelf=true), seed a local pose and re-center the camera
  useEffect(() => {
    if (!showSelf) return;
    // If user enabled Full Camera, do not auto-enable follow/centering
    if (fullCamera) return;
    // If user is in edit mode (placing/moving objects), don't auto-center camera
    if (cubeEditMode) return;
    // Seed a synthetic local pose so follower/camera has a target immediately
    try {
      const base = youArePlayer2 ? { x: player2Pos.x, z: player2Pos.z } : { x: player1Pos.x, z: player1Pos.z };
      window.__CF_LOCAL_AVATAR__ = {
        x: base.x,
        z: base.z,
        yaw: youArePlayer2 ? Math.PI : 0,
        isRunning: false,
        isJumping: false,
        lift: 0,
      };
    } catch {}
    // Defer a bit so PlayerMover mounts and publishes its live position, then center
    // Skip auto-centering in free camera mode to preserve user's view
    const id = setTimeout(() => { try { if (!fullCamera && !cubeEditMode) centerThirdPerson(); } catch {} }, 160);
    return () => { try { clearTimeout(id); } catch {} };
  }, [showSelf, fullCamera, centerThirdPerson, youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z]);

  // Click-to-move target for the local player (world XZ). Separate state for P1/P2 for clarity.
  const [p1Target, setP1Target] = useState(null);
  const [p2Target, setP2Target] = useState(null);

  // Floor Y for click-plane
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fhForGround / 2 - GROUND_CLEAR;

  // Handle floor click -> set target for the current local player
  const handleFloorClick = useCallback((e) => {
    // r3f pointer event gives world point
    const pt = e?.point;
    if (!pt) return;
    try { e.stopPropagation && e.stopPropagation(); } catch {}
    try { e.preventDefault && e.preventDefault(); } catch {}
    const tx = pt.x;
    const tz = pt.z;
    // Clamp to mover radius around origin (0,0) in world XZ — PlayerMover enforces too, but we pre-clamp target
  const maxR = PLAY_AREA_RADIUS;
    const rr = Math.hypot(tx, tz);
    let cx = tx, cz = tz;
    if (rr > maxR) {
      const ang = Math.atan2(tz, tx);
      cx = Math.cos(ang) * maxR;
      cz = Math.sin(ang) * maxR;
    }
    if (youArePlayer2) setP2Target({ x: cx, z: cz }); else setP1Target({ x: cx, z: cz });
  }, [youArePlayer2]);

  const resetCamera = useCallback(() => {
    // Don't reset camera when in full camera mode - user has full control
    if (fullCamera) return;
    try {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = ctrl.object;
      cam.position.set(camPos[0], camPos[1], camPos[2]);
      ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
      ctrl.update();
    } catch {}
  }, [camPos, fullCamera]);

  // Jump helper: move local avatar to a side's base position and reset camera
  const gotoTableSide = useCallback((sideKey) => {
    try {
      const dest = sideKey === 'Player 1' ? { x: player1Pos.x, z: player1Pos.z } : { x: player2Pos.x, z: player2Pos.z };
      if (youArePlayer2) setP2Target(dest); else setP1Target(dest);
      // Disable 3rd-person follow when switching to board view
      setFollowCam(false);
      // Ensure pending timers are cleared while in board view
      try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
      lastLocalPosRef.current = { x: null, z: null };
      // Reset camera to the chosen side's initial board view (skip if in full camera mode)
      if (!fullCamera) {
        const ctrl = controlsRef.current;
        if (ctrl) {
          const cam = ctrl.object;
          const useCam = (sideKey === 'Player 1') ? camPosFront : camPosBack;
          cam.position.set(useCam[0], useCam[1], useCam[2]);
          ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
          ctrl.update();
        }
      }
    } catch {}
  }, [youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z, fullCamera]);

  // Cinematic post-processing effects for space environment
  /*
  const SpaceEffects = React.memo(function SpaceEffects() {
    return (
      <EffectComposer>
        <Bloom
          intensity={1.2}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
          radius={0.9}
        />
        
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={[0.0015, 0.0015]}
        />
        
        <Vignette
          offset={0.3}
          darkness={0.6}
          eskil={false}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    );
  });
  */

  // Canvas-aware controls wrapper to avoid constructing OrbitControls before camera exists
  // Memoized to prevent unnecessary re-renders that could reset camera position
  const Controls = React.memo(function Controls({ target, isNarrow, flip180, fullCamera, minDist, maxDist, selectedCubeId, selectedVisualizer }){
    const { camera } = useThree();
    
    useEffect(() => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const onStart = () => { try{ window.__CF_USER_ORBIT__ = true; }catch{} };
      const onEnd = () => { 
        try{ 
          // Keep __CF_USER_ORBIT__ true for a bit longer to allow final target updates
          setTimeout(() => {
            window.__CF_USER_ORBIT__ = false;
          }, 100);
          window.__CF_RESUME_FOLLOW_AT__ = Infinity;
        }catch{} 
      };
      try { 
        ctrl.addEventListener('start', onStart);
        ctrl.addEventListener('end', onEnd);
      } catch {}
      return () => { 
        try { 
          ctrl.removeEventListener('start', onStart);
          ctrl.removeEventListener('end', onEnd);
        } catch {} 
      };
    }, [fullCamera, camera]);
    
    // Prevent target AND camera orientation from being reset when in fullCamera mode
    useEffect(() => {
      if (!fullCamera || !controlsRef.current || !camera) return;
      
      const ctrl = controlsRef.current;
      // DON'T save initial state - let user freely move camera first
      let savedTarget = null;
      let savedQuaternion = null;
      let savedPosition = null;
      let hasUserMovedCamera = false;
      
      // Update saved state whenever user moves camera
      const saveState = () => {
        hasUserMovedCamera = true;
        savedTarget = ctrl.target.clone();
        savedQuaternion = camera.quaternion.clone();
        savedPosition = camera.position.clone();
      };
      
      // Override the target setter to prevent external changes
      const originalSet = ctrl.target.set.bind(ctrl.target);
      const originalCopy = ctrl.target.copy.bind(ctrl.target);
      const originalUpdate = ctrl.update.bind(ctrl);
      
      ctrl.target.set = function(...args) {
        // During sculpting, BLOCK ALL target changes except user orbit
        if (window.__CF_SCULPT_MODE__ && !window.__CF_USER_ORBIT__) {
          return this;
        }
        // Allow changes during user interaction, when explicitly allowed, or when editing an object/visualizer
        if (window.__CF_USER_ORBIT__ || window.__CF_ALLOW_TARGET_CHANGE__ || selectedCubeId || selectedVisualizer) {
          const result = originalSet(...args);
          if (window.__CF_USER_ORBIT__) saveState();
          return result;
        }
        // Block external attempts to set the target
        return this;
      };
      
      ctrl.target.copy = function(v) {
        // During sculpting, BLOCK ALL target changes except user orbit
        if (window.__CF_SCULPT_MODE__ && !window.__CF_USER_ORBIT__) {
          return this;
        }
        // Allow changes during user interaction, when explicitly allowed, or when editing an object/visualizer
        if (window.__CF_USER_ORBIT__ || window.__CF_ALLOW_TARGET_CHANGE__ || selectedCubeId || selectedVisualizer) {
          const result = originalCopy(v);
          if (window.__CF_USER_ORBIT__) saveState();
          return result;
        }
        // Block external attempts to copy to the target
        return this;
      };
      
      // Intercept update to save/restore camera state
      ctrl.update = function(...args) {
        if (window.__CF_USER_ORBIT__) {
          const result = originalUpdate(...args);
          saveState();
          return result;
        }
        // During sculpting, allow update but don't restore anything
        if (window.__CF_SCULPT_MODE__) {
          return originalUpdate(...args);
        }
        // Allow internal updates but restore camera orientation ONLY if user has moved camera
        const result = originalUpdate(...args);
        if (hasUserMovedCamera && savedTarget && savedQuaternion && savedPosition) {
          // Restore camera angle if it changed
          camera.quaternion.copy(savedQuaternion);
          camera.position.copy(savedPosition);
          originalCopy.call(ctrl.target, savedTarget); // Use original method to bypass our intercept
        }
        return result;
      };
      
      return () => {
        // Restore original methods
        ctrl.target.set = originalSet;
        ctrl.target.copy = originalCopy;
        ctrl.update = originalUpdate;
      };
    }, [fullCamera, camera, sculptMode, selectedCubeId, selectedVisualizer]);
    
    if (!camera) return null;
    
    // Build props conditionally to avoid passing target when in fullCamera mode
    const controlsProps = {
      ref: controlsRef,
      makeDefault: true,
      enablePan: fullCamera,
      panSpeed: fullCamera ? 2.0 : 1.0,
      enableKeys: false,
      enableDamping: true,
      dampingFactor: 0.12,
      minDistance: minDist,
      maxDistance: maxDist,
      enableRotate: true,
      enableZoom: true,
      zoomToCursor: fullCamera,
      zoomSpeed: fullCamera ? 0.5 : 1.0,
      // Remove ALL limits in full camera mode
      ...(fullCamera ? {
        minPolarAngle: 0,
        maxPolarAngle: Math.PI,
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: Infinity
      } : {}),
      // Add target when in edit mode (cube or visualizer) OR not in fullCamera mode
      ...((fullCamera && !selectedCubeId && !selectedVisualizer) ? {} : { target }),
      // Only add angle constraints when NOT in fullCamera or followCam mode (non-fullCamera modes)
      ...(!fullCamera && !followCam ? { 
        minPolarAngle: (isNarrow ? 0.06 : 0.08), 
        maxPolarAngle: Math.PI * 0.5,
        minAzimuthAngle: (flip180 ? Math.PI - Math.PI*0.25 : -Math.PI*0.25), 
        maxAzimuthAngle: (flip180 ? Math.PI + Math.PI*0.25 : Math.PI*0.25)
      } : {})
    };
    
    return (
      <OrbitControls key="orbit-controls-singleton" {...controlsProps} />
    );
  }, (prevProps, nextProps) => {
    // Custom comparison: when in fullCamera mode, ignore target changes to prevent re-renders
    // UNLESS selectedCubeId or selectedVisualizer changed (need to re-render to update camera target)
    if (nextProps.fullCamera) {
      return (
        prevProps.isNarrow === nextProps.isNarrow &&
        prevProps.flip180 === nextProps.flip180 &&
        prevProps.fullCamera === nextProps.fullCamera &&
        prevProps.minDist === nextProps.minDist &&
        prevProps.maxDist === nextProps.maxDist &&
        prevProps.selectedCubeId === nextProps.selectedCubeId &&
        prevProps.selectedVisualizer === nextProps.selectedVisualizer
        // Intentionally skip target comparison in fullCamera mode (unless selectedCubeId/selectedVisualizer changed)
      );
    }
    // In normal mode, compare all props including target
    return (
      prevProps.target === nextProps.target &&
      prevProps.isNarrow === nextProps.isNarrow &&
      prevProps.flip180 === nextProps.flip180 &&
      prevProps.fullCamera === nextProps.fullCamera &&
      prevProps.minDist === nextProps.minDist &&
      prevProps.maxDist === nextProps.maxDist &&
      prevProps.selectedCubeId === nextProps.selectedCubeId &&
      prevProps.selectedVisualizer === nextProps.selectedVisualizer
    );
  });

  // ── Rifle TransformControls Gizmo (attaches to LOCAL player's rifle) ──
  function RifleGizmo({ mode, enabled, setPos, setRot, setScale }) {
    const [rifleObj, setRifleObj] = useState(null);
    const tcRef = useRef(null);
    const wasDragging = useRef(false);

    // Poll for the local player's rifle ref
    useEffect(() => {
      const id = setInterval(() => {
        const obj = window.__CF_MY_RIFLE_REF__;
        if (obj && obj.isObject3D) { setRifleObj(obj); clearInterval(id); }
      }, 200);
      return () => clearInterval(id);
    }, []);

    // Block ALL shooting while the gizmo is mounted & enabled.
    // PlayerMover checks __CF_RIFLE_DRAGGING__ before firing.
    useEffect(() => {
      if (!rifleObj || !enabled) return;
      window.__CF_RIFLE_DRAGGING__ = true;
      return () => { window.__CF_RIFLE_DRAGGING__ = false; };
    }, [rifleObj, enabled]);

    // Use useFrame to reliably detect drag end and sync transform to state.
    // drei's onDraggingChanged prop is unreliable across versions, so we
    // poll THREE.TransformControls.dragging directly every frame.
    useFrame(() => {
      const tc = tcRef.current;
      if (!tc || !rifleObj) return;
      const dragging = tc.dragging;
      // On drag-end transition: push the object's real transform into React state
      if (wasDragging.current && !dragging) {
        const p = rifleObj.position;
        const r = rifleObj.rotation;
        const s = Math.max(0.001, rifleObj.scale.x);
        setPos([p.x, p.y, p.z]);
        setRot([r.x, r.y, r.z]);
        setScale(s);
        // Also sync the global immediately so avatarComponents useFrame stays current
        window.__CF_RIFLE_TUNER__ = {
          ...window.__CF_RIFLE_TUNER__,
          pos: [p.x, p.y, p.z],
          rot: [r.x, r.y, r.z],
          scale: s,
        };
      }
      wasDragging.current = dragging;
    });

    if (!rifleObj || !enabled) return null;
    return (
      <TransformControls
        ref={tcRef}
        object={rifleObj}
        mode={mode}
        enabled={true}
        showX showY showZ
        size={0.7}
      />
    );
  }

  // ── Jetpack TransformControls Gizmo (attaches to LOCAL player's jetpack) ──
  function JetpackGizmo({ mode, enabled, setPos, setRot, setScale }) {
    const [jetpackObj, setJetpackObj] = useState(null);
    const tcRef = useRef(null);
    const wasDragging = useRef(false);

    // Poll for the local player's jetpack ref
    useEffect(() => {
      const id = setInterval(() => {
        const obj = window.__CF_MY_JETPACK_REF__;
        if (obj && obj.isObject3D) { setJetpackObj(obj); clearInterval(id); }
      }, 200);
      return () => clearInterval(id);
    }, []);

    // Block tuner override while gizmo is actively mounted & enabled
    useEffect(() => {
      if (!jetpackObj || !enabled) return;
      window.__CF_JETPACK_DRAGGING__ = true;
      return () => { window.__CF_JETPACK_DRAGGING__ = false; };
    }, [jetpackObj, enabled]);

    // Detect drag end and sync transform back to React state
    useFrame(() => {
      const tc = tcRef.current;
      if (!tc || !jetpackObj) return;
      const dragging = tc.dragging;
      if (wasDragging.current && !dragging) {
        const p = jetpackObj.position;
        const r = jetpackObj.rotation;
        const s = Math.max(0.001, jetpackObj.scale.x);
        setPos([p.x, p.y, p.z]);
        setRot([r.x, r.y, r.z]);
        setScale(s);
        window.__CF_JETPACK_TUNER__ = {
          ...window.__CF_JETPACK_TUNER__,
          pos: [p.x, p.y, p.z],
          rot: [r.x, r.y, r.z],
          scale: s,
        };
      }
      wasDragging.current = dragging;
    });

    if (!jetpackObj || !enabled) return null;
    return (
      <TransformControls
        ref={tcRef}
        object={jetpackObj}
        mode={mode}
        enabled={true}
        showX showY showZ
        size={0.7}
      />
    );
  }

  // ── Reusable Weapon Transform Editor (minimizable, works for any gun) ──
  function GunTunerGUI({ gunName = 'Rifle', pos, setPos, rot, setRot, scale, setScale, forceVisible, setForceVisible, forceAim, setForceAim, mode, setMode, gizmoEnabled, setGizmoEnabled, onClose, panelLeft = 10, accentColor = '#0ff' }) {
    const panelRef = useRef(null);
    const [minimized, setMinimized] = useState(false);
    const unlockPointer = () => { if (document.pointerLockElement) document.exitPointerLock(); };

    const panelBase = {
      position:'absolute', top:70, left: panelLeft,
      background:'rgba(0,0,0,0.92)', color: accentColor,
      borderRadius:10, zIndex:99999,
      fontSize:13, fontFamily:'monospace',
      pointerEvents:'auto', userSelect:'none',
      border:`1px solid ${accentColor}33`,
      boxShadow:`0 0 20px ${accentColor}26`,
    };

    // ── Collapsed state ──
    if (minimized) {
      return (
        <div
          style={{ ...panelBase, padding:'8px 14px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}
          onClick={e => { e.stopPropagation(); unlockPointer(); setMinimized(false); }}
          onMouseDown={e => e.stopPropagation()}
        >
          <span style={{ color:'#0ff', fontSize:14 }}>&#9881;</span>
          <span style={{ color:'#fff', fontWeight:'bold', fontSize:13, flex:1 }}>{gunName} Editor</span>
          <span style={{ color:'#555', fontSize:11 }}>&#9660;</span>
          {onClose && <button onClick={e => { e.stopPropagation(); onClose(); }} style={{ background:'transparent', border:'1px solid #555', color:'#f55', borderRadius:4, padding:'0 6px', cursor:'pointer', fontSize:13, fontFamily:'monospace', marginLeft:6 }} title="Close">&times;</button>}
        </div>
      );
    }

    // ── Expanded state ──
    const sectionStyle = { marginBottom:10 };
    const headerStyle = { fontWeight:'bold', color:'#fff', fontSize:13, marginBottom:3, borderBottom:'1px solid #333', paddingBottom:3 };
    const rowStyle = { display:'flex', alignItems:'center', gap:4, marginBottom:4 };
    const labelStyle = { width:32, textAlign:'right', color:'#888', fontSize:11 };
    const inputStyle = {
      width:68, background:'#111', border:'1px solid #444', color:'#0ff',
      borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace',
      textAlign:'center', outline:'none'
    };
    const btnStyle = (color) => ({
      background:'transparent', border:`1px solid ${color || '#555'}`, color: color || '#aaa',
      borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace'
    });

    const axisRow = (label, value, onChange) => (
      <div style={rowStyle}>
        <span style={labelStyle}>{label}</span>
        <button style={btnStyle('#f55')} onClick={() => onChange(value - 0.1)} title="-0.1">--</button>
        <button style={btnStyle('#f99')} onClick={() => onChange(value - 0.01)} title="-0.01">-</button>
        <input
          type="number" step="0.01"
          value={parseFloat(value.toFixed(4))}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
          style={inputStyle}
          onFocus={unlockPointer}
        />
        <button style={btnStyle('#9f9')} onClick={() => onChange(value + 0.01)} title="+0.01">+</button>
        <button style={btnStyle('#5f5')} onClick={() => onChange(value + 0.1)} title="+0.1">++</button>
      </div>
    );

    const copyValues = () => {
      const text = `position={[${pos.map(v=>v.toFixed(3)).join(', ')}]} rotation={[${rot.map(v=>v.toFixed(3)).join(', ')}]} scale={${scale.toFixed(3)}}`;
      navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
    };

    return (
      <div
        ref={panelRef}
        style={{ ...panelBase, padding:14, minWidth:310 }}
        onMouseDown={e => { e.stopPropagation(); unlockPointer(); }}
        onClick={e => e.stopPropagation()}
        onMouseEnter={unlockPointer}
        onWheel={e => e.stopPropagation()}
      >
        {/* TITLE BAR */}
        <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
          <span style={{ color:'#0ff', fontSize:14, marginRight:6 }}>&#9881;</span>
          <span style={{ fontWeight:'bold', color:'#fff', fontSize:14, flex:1 }}>{gunName} Editor</span>
          <button
            onClick={() => setMinimized(true)}
            style={{ background:'transparent', border:'1px solid #555', color:'#888', borderRadius:4, padding:'1px 8px', cursor:'pointer', fontSize:12, fontFamily:'monospace' }}
            title="Minimize"
          >&#9650;</button>
          {onClose && <button
            onClick={onClose}
            style={{ background:'transparent', border:'1px solid #555', color:'#f55', borderRadius:4, padding:'1px 8px', cursor:'pointer', fontSize:12, fontFamily:'monospace', marginLeft:4 }}
            title="Close"
          >&times;</button>}
        </div>

        {/* MODE SWITCHER */}
        <div style={{ display:'flex', gap:3, marginBottom:8, justifyContent:'center' }}>
          {['translate','rotate','scale'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, padding:'5px 0', background: mode===m ? '#0ff' : '#111', color: mode===m ? '#000' : '#888',
              border: mode===m ? '1px solid #0ff' : '1px solid #444', borderRadius:4, cursor:'pointer',
              fontSize:11, fontFamily:'monospace', fontWeight: mode===m ? 'bold' : 'normal'
            }}>{m[0].toUpperCase()+m.slice(1)}</button>
          ))}
        </div>

        {/* TOGGLES */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, justifyContent:'center', flexWrap:'wrap' }}>
          {[
            { label:'Show', val: forceVisible, set: setForceVisible },
            { label:'Aim Pose', val: forceAim, set: setForceAim },
            { label:'Gizmo', val: gizmoEnabled, set: setGizmoEnabled },
          ].map(t => (
            <label key={t.label} style={{ cursor:'pointer', color: t.val ? '#0f0' : '#f55', fontSize:11 }}>
              <input type="checkbox" checked={t.val} onChange={e => t.set(e.target.checked)} style={{ marginRight:2, cursor:'pointer' }} />
              {t.label}
            </label>
          ))}
        </div>

        {/* POSITION */}
        <div style={sectionStyle}>
          <div style={headerStyle}>Position</div>
          {axisRow('X', pos[0], v => setPos([v, pos[1], pos[2]]))}
          {axisRow('Y', pos[1], v => setPos([pos[0], v, pos[2]]))}
          {axisRow('Z', pos[2], v => setPos([pos[0], pos[1], v]))}
        </div>

        {/* ROTATION */}
        <div style={sectionStyle}>
          <div style={headerStyle}>Rotation <span style={{color:'#666',fontWeight:'normal',fontSize:10}}>(radians)</span></div>
          {axisRow('X', rot[0], v => setRot([v, rot[1], rot[2]]))}
          {axisRow('Y', rot[1], v => setRot([rot[0], v, rot[2]]))}
          {axisRow('Z', rot[2], v => setRot([rot[0], rot[1], v]))}
        </div>

        {/* SCALE */}
        <div style={sectionStyle}>
          <div style={headerStyle}>Scale</div>
          {axisRow('S', scale, v => setScale(Math.max(0.001, v)))}
        </div>

        {/* LIVE VALUES */}
        <div style={{ background:'#0a0a0a', border:'1px solid #333', borderRadius:5, padding:6, marginBottom:6 }}>
          <div style={{ color:'#ff0', fontSize:10, wordBreak:'break-all', lineHeight:'1.5' }}>
            pos=[{pos.map(v=>v.toFixed(3)).join(', ')}] rot=[{rot.map(v=>v.toFixed(3)).join(', ')}] s={scale.toFixed(3)}
          </div>
        </div>

        {/* COPY */}
        <button onClick={copyValues} style={{
          width:'100%', padding:'6px 0', background:'#0a3a3a', border:'1px solid #0ff',
          color:'#0ff', borderRadius:5, cursor:'pointer', fontSize:12, fontFamily:'monospace', fontWeight:'bold'
        }}>COPY VALUES</button>
      </div>
    );
  }

  // First-person viewmodel gun — follows camera with walk bob, sway, and ADS zoom
  function FirstPersonArms({ fpvRef }) {
    const { camera } = useThree();
    const groupRef = useRef();
    const matFixedRef = useRef(false);
    // Bob/sway accumulators
    const bobTime = useRef(0);
    const swayX = useRef(0);
    const swayY = useRef(0);
    // Strafe sway — smooth translational slide
    const strafeSway = useRef(0);
    // ADS lerp (0 = hip, 1 = fully scoped)
    const adsLerp = useRef(0);
    // Recoil
    const recoilKick = useRef(0);
    // Previous camera rotation for sway detection
    const prevCamRot = useRef({ x: 0, y: 0 });
    // Pre-allocated Three.js objects (avoid per-frame GC pressure)
    const _offset = useMemo(() => new THREE.Vector3(), []);
    const _extraQuat = useMemo(() => new THREE.Quaternion(), []);
    const _extraEuler = useMemo(() => new THREE.Euler(), []);

    // ADS gun position: gun slides to center-screen, forward toward scope
    const ADS_POS = [0.0, -0.16, -0.35];
    const ADS_ROT = [0, 4.712, 0];

    // Reset FOV when component unmounts (e.g. switching out of FPV)
    useEffect(() => {
      return () => {
        if (camera) {
          camera.fov = 40;
          camera.updateProjectionMatrix();
        }
      };
    }, [camera]);

    useFrame((_, dt) => {
      if (!groupRef.current || !camera) return;
      const t = fpvRef.current || { pos: [0.090, -0.230, -0.600], rot: [0, 4.712, 0], scale: 0.006 };
      const la = window.__CF_LOCAL_AVATAR__ || {};
      const moving = !!(la.isWalking || la.isRunning);
      const running = !!la.isRunning;
      const scoping = !!la.isScoping;
      const shooting = !!la.isShooting;
      const strafeL = !!la.isStrafeLeft;
      const strafeR = !!la.isStrafeRight;

      // ── ADS interpolation ──
      const adsTarget = scoping ? 1 : 0;
      const adsSpeed = scoping ? 8 : 12;
      adsLerp.current += (adsTarget - adsLerp.current) * Math.min(1, adsSpeed * dt);
      if (Math.abs(adsLerp.current - adsTarget) < 0.001) adsLerp.current = adsTarget;
      const ads = adsLerp.current;

      // ── Scope zoom (FOV) ──
      const defaultFov = 40;
      const scopedFov = 20;
      const targetFov = defaultFov + (scopedFov - defaultFov) * ads;
      camera.fov += (targetFov - camera.fov) * Math.min(1, 10 * dt);
      camera.updateProjectionMatrix();

      // ── Hide gun early so fake scope geometry is never visible up close ──
      groupRef.current.visible = ads < 0.35;

      // ── Walk bob (U-shape pendulum — swings side-to-side with dip at each end) ──
      const isStrafing = strafeL || strafeR;
      const bobFreq = running ? 9 : 8;
      const bobAmpX = running ? 0.012 : 0.007; // side-to-side swing
      const bobAmpY = running ? 0.010 : 0.005; // vertical dip at each extreme
      if (moving && ads < 0.3) {
        bobTime.current += dt * bobFreq;
      } else {
        bobTime.current += dt * 2;
      }
      const bobActive = (moving && !isStrafing && ads < 0.3) ? 1 : 0;
      // X = side-to-side pendulum swing (sin wave)
      const bobX = Math.sin(bobTime.current) * bobAmpX * bobActive;
      // Y = dips down at BOTH ends of the swing (cos at 2x freq = U shape each half-cycle)
      const bobY = -(1 - Math.cos(bobTime.current * 2)) * 0.5 * bobAmpY * bobActive;

      // ── Strafe sway (pure horizontal slide — gun drifts opposite to strafe) ──
      const strafeTarget = strafeL ? 0.03 : strafeR ? -0.03 : 0;
      const strafeLerpSpeed = 5;
      strafeSway.current += (strafeTarget - strafeSway.current) * Math.min(1, strafeLerpSpeed * dt);

      // ── Camera sway (subtle follow lag from mouse/stick movement) ──
      const camRotX = camera.rotation.x;
      const camRotY = camera.rotation.y;
      const deltaRotX = camRotX - prevCamRot.current.x;
      const deltaRotY = camRotY - prevCamRot.current.y;
      prevCamRot.current.x = camRotX;
      prevCamRot.current.y = camRotY;
      const swayFactor = ads > 0.5 ? 0.002 : 0.008;
      const swayDecay = 8;
      swayX.current += deltaRotY * swayFactor;
      swayY.current += deltaRotX * swayFactor;
      swayX.current += (0 - swayX.current) * Math.min(1, swayDecay * dt);
      swayY.current += (0 - swayY.current) * Math.min(1, swayDecay * dt);

      // ── Recoil kick (force-zero while scoped so gun never pops back visible) ──
      if (ads > 0.3) {
        recoilKick.current = 0;
      } else {
        if (shooting) recoilKick.current = Math.min(recoilKick.current + dt * 15, 0.04);
        recoilKick.current *= Math.max(0, 1 - dt * 12);
      }

      // ── Compose final position — lerp from hip to ADS center ──
      const hipPos = t.pos;
      // ADS shift up to 0.35 (gun hides at 0.35, scope overlay takes over)
      const adsClamp = Math.min(ads / 0.35, 1);
      const posX = hipPos[0] + (ADS_POS[0] - hipPos[0]) * adsClamp + bobX + strafeSway.current + swayX.current;
      const posY = hipPos[1] + (ADS_POS[1] - hipPos[1]) * adsClamp + bobY + swayY.current;
      const posZ = hipPos[2] + (ADS_POS[2] - hipPos[2]) * adsClamp - recoilKick.current;

      _offset.set(posX, posY, posZ);
      _offset.applyQuaternion(camera.quaternion);
      groupRef.current.position.copy(camera.position).add(_offset);

      // Rotation: camera base + local gun rotation, lerped toward ADS rotation
      groupRef.current.quaternion.copy(camera.quaternion);
      const rotX = t.rot[0] + (ADS_ROT[0] - t.rot[0]) * adsClamp;
      const rotY = t.rot[1] + (ADS_ROT[1] - t.rot[1]) * adsClamp;
      const rotZ = t.rot[2] + (ADS_ROT[2] - t.rot[2]) * adsClamp;
      _extraEuler.set(rotX, rotY, rotZ);
      _extraQuat.setFromEuler(_extraEuler);
      groupRef.current.quaternion.multiply(_extraQuat);

      // Scale — pull tighter during ADS
      const sc = t.scale || 0.006;
      const adsSc = sc * (1 - adsClamp * 0.12);
      groupRef.current.scale.set(adsSc, adsSc, adsSc);

      // One-time material fix: renderOrder + depthTest=false so gun renders on top
      if (!matFixedRef.current) {
        groupRef.current.traverse(child => {
          if (child.isMesh) {
            child.renderOrder = 999;
            if (child.material) {
              child.material.depthTest = false;
              child.material.depthWrite = false;
              child.material.side = THREE.FrontSide;
            }
          }
        });
        matFixedRef.current = true;
      }
    });

    return (
      <group ref={groupRef} renderOrder={999}>
        <Suspense fallback={null}>
          <LazerRifleModel scale={1} />
        </Suspense>
      </group>
    );
  }

  // CameraFollower is now imported from ./CameraFollower.jsx (module-level stable identity)
  // This prevents camera jitter caused by component remounting when weapon state changes
  const __CameraFollower_imported = true; // marker for code navigation

  // Glowing clickable portal pad for local side
  function PortalPad({ position = [0,0,0], color = '#7dd3fc', onClick }) {
    const groupRef = useRef();
    const ringRef = useRef();
    const coreRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state, dt) => {
      const t = state.clock.getElapsedTime();
      // gentle rotation and pulse
      if (ringRef.current) {
        ringRef.current.rotation.z = t * 0.6;
        const s = 1.0 + Math.sin(t * 2.2) * 0.06;
        ringRef.current.scale.setScalar(s);
      }
      if (coreRef.current) {
        const o = 0.35 + (hover ? 0.25 : 0.0) + Math.max(0, Math.sin(t * 3.0)) * 0.18;
        coreRef.current.material.opacity = Math.min(0.95, o);
        const s2 = 1.0 + Math.sin(t * 2.0 + 0.7) * 0.04;
        coreRef.current.scale.setScalar(s2);
      }
    });
    return (
      <group ref={groupRef} position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Outer neon ring */}
        <mesh ref={ringRef} rotation={[-Math.PI/2, 0, 0]}
          castShadow receiveShadow>
          <ringGeometry args={[1.8, 2.2, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 1.2 : 0.85} metalness={0.35} roughness={0.4} transparent opacity={0.9} />
        </mesh>
        {/* Soft inner glow (additive) */}
        <mesh ref={coreRef} rotation={[-Math.PI/2, 0, 0]} renderOrder={1}>
          <circleGeometry args={[1.55, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Subtle vertical shimmer */}
        <mesh position={[0, 0.02, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.6, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 2.0 : 1.3} metalness={0.0} roughness={0.2} transparent opacity={0.85} />
        </mesh>
      </group>
    );
  }

  // Leave Game button (on-table, user side only when in board view)
  function LeaveButton({ position = [0,0,0], color = '#f43f5e', label = 'Leave Game', onClick }) {
    const baseRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state) => {
      const t = state.clock.getElapsedTime();
      if (baseRef.current) {
        const pulse = 0.04 + Math.max(0, Math.sin(t * 2.3)) * 0.06 + (hover ? 0.08 : 0);
        baseRef.current.material.emissiveIntensity = 0.6 + pulse;
      }
    });
    return (
      <group position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Thin pill button */}
        <mesh ref={baseRef} rotation={[-Math.PI/2, 0, 0]} castShadow receiveShadow>
          <ringGeometry args={[0.0, 1.35, 48]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} metalness={0.1} roughness={0.35} transparent opacity={0.95} />
        </mesh>
        {/* Text label above */}
        <Billboard follow={true} position={[0, 0.9, 0]}>
          <Text fontSize={1.6} color={'#fee2e2'} anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
            {label}
          </Text>
        </Billboard>
      </group>
    );
  }

  /* ── Jetpack Fuel HUD ──────────────────────────────────────────────── */
  function JetpackFuelHUD() {
    const [info, setInfo] = React.useState({ active: false, fuel: 1 });
    React.useEffect(() => {
      let raf;
      const tick = () => {
        const la = window.__CF_LOCAL_AVATAR__ || {};
        const active = !!la.isJetpacking;
        const fuel = typeof la.jetpackFuel === 'number'
          ? Math.min(1, la.jetpackFuel / 6.0) : 1;
        setInfo(prev => {
          if (prev.active !== active || Math.abs(prev.fuel - fuel) > 0.005)
            return { active, fuel };
          return prev;
        });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, []);

    const { active, fuel } = info;
    const pct = Math.round(fuel * 100);
    const barColor = fuel > 0.5 ? '#22d3ee' : fuel > 0.2 ? '#f59e0b' : '#ef4444';

    return (
      <div style={{
        position: 'fixed',
        bottom: 200,
        right: 24,
        zIndex: 9990,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
        opacity: active ? 1 : 0.45,
        transition: 'opacity 0.35s ease',
      }}>
        {/* Label */}
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: active ? '#22d3ee' : '#94a3b8',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          textShadow: active ? '0 0 8px rgba(34,211,238,0.6)' : 'none',
          transition: 'color 0.3s, text-shadow 0.3s',
        }}>
          Jetpack
        </div>

        {/* Vertical fuel bar container */}
        <div style={{
          width: 18,
          height: 120,
          borderRadius: 9,
          border: `2px solid ${active ? '#22d3ee' : '#475569'}`,
          background: 'rgba(15,23,42,0.85)',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: active
            ? '0 0 12px rgba(34,211,238,0.4), inset 0 0 8px rgba(34,211,238,0.15)'
            : '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}>
          {/* Fill */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${pct}%`,
            background: `linear-gradient(to top, ${barColor}, ${barColor}dd)`,
            borderRadius: '0 0 7px 7px',
            transition: 'height 0.15s ease-out',
            boxShadow: active ? `0 0 10px ${barColor}88` : 'none',
          }} />

          {/* Animated scanline when active */}
          {active && (
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 3,
              background: 'rgba(255,255,255,0.35)',
              animation: 'jetpackScanline 1.2s linear infinite',
              borderRadius: 2,
            }} />
          )}
        </div>

        {/* Percentage */}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          color: active ? '#e2e8f0' : '#64748b',
          transition: 'color 0.3s',
        }}>
          {pct}%
        </div>

        {/* Keyframes for scanline animation */}
        <style>{`
          @keyframes jetpackScanline {
            0%   { top: 100%; opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { top: -3px; opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', minHeight: 520, zIndex: 1 }}>
      {/* Jetpack Fuel HUD */}
      <JetpackFuelHUD />

      {/* Inventory Button (top-right) */}
      <button
        onClick={() => setInventoryOpen(prev => !prev)}
        title="Inventory (I)"
        style={{
          position: 'fixed',
          top: 70,
          right: 16,
          zIndex: 9990,
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: inventoryOpen ? '2px solid #a855f7' : '2px solid rgba(168, 85, 247, 0.4)',
          background: inventoryOpen ? 'rgba(168, 85, 247, 0.35)' : 'rgba(0, 0, 0, 0.55)',
          color: '#a855f7',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: inventoryOpen ? '0 0 16px rgba(168, 85, 247, 0.5)' : '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(6px)',
          fontFamily: 'monospace',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.3)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(168, 85, 247, 0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = inventoryOpen ? 'rgba(168, 85, 247, 0.35)' : 'rgba(0, 0, 0, 0.55)'; e.currentTarget.style.boxShadow = inventoryOpen ? '0 0 16px rgba(168, 85, 247, 0.5)' : '0 2px 8px rgba(0,0,0,0.4)'; }}
      >
        🎒
      </button>

      {/* Hot reload notification banner */}
      {hotReloadDetected && (
        <div style={{
          position: 'fixed',
          top: 'var(--nav-height, 56px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(90deg, #0891b2, #06b6d4)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: '0 0 8px 8px',
          fontWeight: 600,
          fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          animation: 'slideDown 0.3s ease-out'
        }}>
          ✓ Code updated - Models reloaded
        </div>
      )}
      
      {/* First-person camera adjustment panel */}
      {firstPersonMode && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--nav-height, 56px) + 10px)',
          left: '10px',
          zIndex: 9998,
          background: 'rgba(15,23,42,0.95)',
          color: '#e2e8f0',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid rgba(100,116,139,0.3)',
          minWidth: '220px',
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ marginBottom: '12px', fontSize: 14, fontWeight: 'bold', borderBottom: '1px solid rgba(100,116,139,0.3)', paddingBottom: '8px' }}>
            📷 First-Person Camera
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Height: {fpCamHeight.toFixed(1)}
              </label>
              <input
                type="range"
                min="5"
                max="15"
                step="0.5"
                value={fpCamHeight}
                onChange={(e) => setFpCamHeight(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Forward: {fpCamForward.toFixed(1)}
              </label>
              <input
                type="range"
                min="-5"
                max="10"
                step="0.5"
                value={fpCamForward}
                onChange={(e) => setFpCamForward(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ 
              padding: '8px', 
              background: 'rgba(59,130,246,0.1)', 
              borderRadius: '4px', 
              fontSize: 11, 
              color: '#93c5fd',
              fontFamily: 'monospace'
            }}>
              Height: {fpCamHeight} | Forward: {fpCamForward}
            </div>
          </div>
        </div>
      )}
      
      {/* Disconnect notification */}
      {disconnectNotification && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--nav-height, 56px) + 60px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #f43f5e, #dc2626)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontWeight: 600,
          fontSize: 15,
          boxShadow: '0 6px 20px rgba(244, 63, 94, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'slideDown 0.3s ease-out'
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          {disconnectNotification}
        </div>
      )}

      {/* Reconnect notification banner */}
      {reconnectNotification && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--nav-height, 56px) + 60px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #10b981, #059669)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontWeight: 600,
          fontSize: 15,
          boxShadow: '0 6px 20px rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'slideDown 0.3s ease-out'
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          {reconnectNotification}
        </div>
      )}
      
      
      {/* No tweak panel; avatars share identical placement */}
      <div style={{ position:'absolute', inset:0, zIndex: 1000 }}>
        {/* View button icon for Tools - centered above button */}
        <svg viewBox="0 0 24 24" fill="none" style={{
          position: 'fixed',
          bottom: 'calc(var(--footer-h, 52px) + 56px)',
          left: 'calc(50% - 177px + 55px - 16px)',
          width: '32px', height: '32px',
          zIndex: 2147483648, pointerEvents: 'none',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
        }}>
          <rect x="3" y="7" width="18" height="10" rx="2" stroke="white" strokeWidth="2" />
          <rect x="9" y="10" width="6" height="4" rx="1" fill="white" />
        </svg>
        
        {/* D-Pad Right icon for Chat - centered above button */}
        <svg viewBox="0 0 24 24" fill="none" style={{
          position: 'fixed',
          bottom: 'calc(var(--footer-h, 52px) + 56px)',
          left: 'calc(50% - 59px + 55px - 16px)',
          width: '32px', height: '32px',
          zIndex: 2147483648, pointerEvents: 'none',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
        }}>
          <path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4z" fill="#555" stroke="white" strokeWidth="1" />
          <path d="M15 9l4 3-4 3V9z" fill="white" />
        </svg>
        
        {/* D-Pad Up icon for Camera - centered above button */}
        <svg viewBox="0 0 24 24" fill="none" style={{
          position: 'fixed',
          bottom: 'calc(var(--footer-h, 52px) + 56px)',
          left: 'calc(50% + 59px + 55px - 16px)',
          width: '32px', height: '32px',
          zIndex: 2147483648, pointerEvents: 'none',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
        }}>
          <path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4z" fill="#555" stroke="white" strokeWidth="1" />
          <path d="M9 9l3-4 3 4H9z" fill="white" />
        </svg>
        
        {/* Toggle button for edit menu - centered at bottom */}
        <button 
          onClick={() => setShowEditMenu(!showEditMenu)}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% - 177px)', // Centered: 50% minus half of total width (110+8+110+8+110)/2
            zIndex: 2147483648,
            background: showEditMenu ? 'rgba(59,130,246,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (showEditMenu ? '#3b82f6' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {showEditMenu ? '⚙️ Tools On' : '⚙️ Tools Off'}
        </button>
        
        {/* Server Status Toggle - top center */}
        <button 
          onClick={() => setShowServerStatus(!showServerStatus)}
          style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            background: restartCountdown !== null && restartCountdown !== 'reconnected' 
              ? 'rgba(251,191,36,0.9)' 
              : serverStatus === 'online' ? 'rgba(34,197,94,0.9)' : serverStatus === 'offline' ? 'rgba(239,68,68,0.9)' : 'rgba(251,191,36,0.9)',
            padding: '4px 10px',
            borderRadius: 5,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span style={{ fontSize: 12 }}>
            {restartCountdown !== null && restartCountdown !== 'reconnected' 
              ? (typeof restartCountdown === 'number' ? '🔄' : restartCountdown === 'disconnected' ? '⚠️' : '🔌')
              : serverStatus === 'online' ? '🟢' : serverStatus === 'offline' ? '🔴' : '🟡'}
          </span>
          {restartCountdown !== null && restartCountdown !== 'reconnected'
            ? (typeof restartCountdown === 'number' ? `Restarting ${restartCountdown}` : restartCountdown === 'disconnected' ? 'Disconnected' : 'Reconnecting')
            : serverStatus === 'online' ? 'Online' : serverStatus === 'offline' ? 'Offline' : 'Checking'}
        </button>
        
        {/* Server Status Details Panel */}
        {showServerStatus && (
          <div style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 42px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483646,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid rgba(100, 116, 139, 0.5)',
            borderRadius: '8px',
            padding: '16px',
            minWidth: '280px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)',
            fontFamily: 'monospace',
            fontSize: 13,
            color: '#e2e8f0'
          }}>
            <div style={{ marginBottom: '12px', fontSize: 16, fontWeight: 'bold', borderBottom: '1px solid rgba(100,116,139,0.3)', paddingBottom: '8px' }}>
              🖥️ Server Status
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Status:</span>
                <span style={{ 
                  color: serverStatus === 'online' ? '#22c55e' : serverStatus === 'offline' ? '#ef4444' : '#fbbf24',
                  fontWeight: 'bold' 
                }}>
                  {serverStatus === 'online' ? '● ONLINE' : serverStatus === 'offline' ? '● OFFLINE' : '● CHECKING'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Endpoint:</span>
                <span style={{ color: '#94a3b8' }}>:3002</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Type:</span>
                <span style={{ color: '#94a3b8' }}>API + WebSocket</span>
              </div>
            </div>
            {serverStatus === 'offline' && (
              <div style={{
                marginTop: 12,
                padding: 8,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 4,
                fontSize: 11,
                color: '#fca5a5'
              }}>
                ⚠️ Server is offline. Run: npm run serve:api
              </div>
            )}
          </div>
        )}
        
        {/* Toggle button for chat UI - centered at bottom */}
        <button 
          onClick={() => setShowChatUI(!showChatUI)}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% - 59px)', // Centered
            zIndex: 2147483648,
            background: showChatUI ? 'rgba(34,197,94,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (showChatUI ? '#22c55e' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {showChatUI ? '💬 Chat On' : '💬 Chat Off'}
        </button>
        
        {/* Toggle button for camera mode - centered at bottom */}
        <button 
          onClick={() => {
            setFullCamera(prev => {
              const newFullCamera = !prev;
              // If turning ON full camera, turn OFF 3rd person
              if (newFullCamera) {
                setFollowCam(false);
              } else {
                // If turning OFF full camera, turn ON 3rd person
                setFollowCam(true);
              }
              return newFullCamera;
            });
          }}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% + 59px)', // Centered
            zIndex: 2147483648,
            background: fullCamera ? 'rgba(168,85,247,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (fullCamera ? '#a855f7' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {fullCamera ? '📷 Full Cam' : '👤 3rd Person'}
        </button>
        
        {/* Professional Tabbed Editor Panel */}
        {showEditMenu && (
  <div style={{
            position:'fixed',
            top:'calc(var(--nav-height, 56px) + 16px)',
            left:16,
            zIndex: 2147483647,
            background:'rgba(15,23,42,0.98)',
            borderRadius:16,
            color:'#e2e8f0',
            boxShadow:'0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(148, 163, 184, 0.15)',
            backdropFilter:'blur(12px)',
            border:'1px solid rgba(148, 163, 184, 0.2)',
            width:380,
            bottom: 0,
            maxHeight: 'calc(100dvh - var(--nav-height, 56px))',
            display:'flex',
            flexDirection:'column',
            overflow:'hidden'
          }}>
          {/* Header with Tab Navigation */}
          <div style={{ 
            padding:'16px 20px 0 20px', 
            background:'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(147, 51, 234, 0.12))',
            borderBottom:'1px solid rgba(148, 163, 184, 0.15)'
          }}>
            <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', marginBottom:12 }}>
              <button 
                onClick={() => setShowEditMenu(false)}
                style={{
                  padding:'6px 10px',
                  borderRadius:6,
                  border:'1px solid rgba(148, 163, 184, 0.2)',
                  background:'rgba(30, 41, 59, 0.6)',
                  color:'#cbd5e1',
                  cursor:'pointer',
                  fontSize:11,
                  fontWeight:600
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Tab navigation - LB and RB */}
            <div style={{ 
              display:'flex', 
              justifyContent:'space-between', 
              alignItems:'center',
              marginBottom:8
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <img 
                  src="/controller icons/Buttons Solid/White/SVG/Left Bumper.svg" 
                  alt="LB"
                  style={{ 
                    width: '24px', 
                    height: '24px',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                  }}
                />
                <span style={{ fontSize:10, color:'#94a3b8', fontWeight:500 }}>Previous Tab</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:10, color:'#94a3b8', fontWeight:500 }}>Next Tab</span>
                <img 
                  src="/controller icons/Buttons Solid/White/SVG/Right Bumper.svg" 
                  alt="RB"
                  style={{ 
                    width: '24px', 
                    height: '24px',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                  }}
                />
              </div>
            </div>
            
            {/* Tab Navigation */}
            <div style={{ display:'flex', gap:4, marginBottom:-1 }}>
              {[
                { id: 'objects', label: '📦 Objects', icon: '📦' },
                { id: 'models', label: '🎨 Models', icon: '🎨' },
                { id: 'transform', label: '🔧 Transform', icon: '🔧' },
                { id: 'audio', label: '🔊 Audio', icon: '🔊' },
                { id: 'settings', label: '⚙️ Settings', icon: '⚙️' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveEditorTab(tab.id)}
                  style={{
                    flex:1,
                    padding:'12px 8px',
                    borderRadius:'8px 8px 0 0',
                    border:'none',
                    borderBottom: activeEditorTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
                    background: activeEditorTab === tab.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: activeEditorTab === tab.id ? '#60a5fa' : '#94a3b8',
                    cursor:'pointer',
                    fontSize:20,
                    fontWeight:600,
                    transition:'all 0.2s',
                    textAlign:'center'
                  }}
                  onMouseEnter={e => {
                    if (activeEditorTab !== tab.id) {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                      e.currentTarget.style.color = '#cbd5e1';
                    }
                  }}
                  onMouseLeave={e => {
                    if (activeEditorTab !== tab.id) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#94a3b8';
                    }
                  }}
                >
                  {tab.icon}
                </button>
              ))}
            </div>
          </div>
          
          {/* Scrollable Tab Content */}
          <div style={{ 
            flex:1,
            overflowY:'auto',
            overscrollBehavior:'contain',
            padding:'16px 20px',
            display:'flex',
            flexDirection:'column',
            gap:14,
            direction: 'rtl' // Right-to-left to put scrollbar on left
          }}>
            <div style={{ direction: 'ltr' }}> {/* Reset direction for content */}
            
            {/* OBJECTS TAB */}
            {activeEditorTab === 'objects' && (
              <>
                {/* Object Placer Section - ALWAYS AT TOP */}
                <div 
                  data-section-index="0"
                  style={{ 
                    background: selectedSectionIndex === 0
                      ? (isInSection ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)')
                      : 'rgba(5, 150, 105, 0.08)', 
                    padding:'10px', 
                    borderRadius:8,
                    border: selectedSectionIndex === 0
                      ? (isInSection ? '2px solid #22c55e' : '2px solid #3b82f6')
                      : '1px solid rgba(16, 185, 129, 0.2)',
                    boxShadow: selectedSectionIndex === 0
                      ? (isInSection ? '0 0 20px rgba(34, 197, 94, 0.5)' : '0 0 20px rgba(59, 130, 246, 0.4)')
                      : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
            <div style={{ fontWeight:600, fontSize:11, color:'#6ee7b7', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>📦 Object Placer</div>
            <label 
              style={{ 
                display:'flex', 
                alignItems:'center', 
                gap:8, 
                fontSize:11, 
                cursor:'pointer', 
                marginBottom:8,
                padding: '6px 8px',
                borderRadius: 6,
                background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 0) 
                  ? 'rgba(34, 197, 94, 0.3)' 
                  : 'transparent',
                border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 0)
                  ? '2px solid #22c55e'
                  : '2px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              <input type="checkbox" checked={cubeEditMode} onChange={e=>setCubeEditMode(e.target.checked)} style={{ cursor:'pointer' }} /> 
              <span style={{ fontWeight:500 }}>Enable editing</span>
            </label>
            
            {/* Terrain Sculpting Toggle */}
            <label
              style={{ 
                display:'flex', 
                alignItems:'center', 
                gap:8, 
                fontSize:11, 
                cursor:'pointer', 
                marginBottom:8,
                padding: '6px 8px',
                borderRadius: 6,
                background: sculptMode ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                border: sculptMode ? '2px solid #3b82f6' : '2px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              <input type="checkbox" checked={sculptMode} onChange={e=>{ 
                const newMode = e.target.checked;
                setSculptMode(newMode); 
                if(newMode) {
                  setSelectedCubeId(null);
                  window.__CF_SCULPT_MODE__ = true; // Global flag to block camera changes
                } else {
                  window.__CF_SCULPT_MODE__ = false;
                }
              }} style={{ cursor:'pointer' }} /> 
              <span style={{ fontWeight:500 }}>🎨 Terrain Sculpting</span>
            </label>
            
            {/* Sculpting Controls */}
            {sculptMode && (
              <div style={{ marginBottom:12, padding:'10px', borderRadius:8, background:'rgba(59, 130, 246, 0.1)', border:'1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ marginBottom:8 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4, fontWeight:600 }}>BRUSH SIZE: {sculptBrushSize.toFixed(1)}</div>
                  <input 
                    type="range" 
                    min="1" 
                    max="200" 
                    step="0.5" 
                    value={sculptBrushSize} 
                    onChange={e=>setSculptBrushSize(parseFloat(e.target.value))}
                    style={{ width:'100%', cursor:'pointer' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4, fontWeight:600 }}>STRENGTH: {sculptStrength.toFixed(2)}</div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="2" 
                    step="0.1" 
                    value={sculptStrength} 
                    onChange={e=>setSculptStrength(parseFloat(e.target.value))}
                    style={{ width:'100%', cursor:'pointer' }}
                  />
                </div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:8, fontStyle:'italic' }}>
                  Hover over terrain • ] Raise • [ Lower
                </div>
                <div style={{ 
                  marginTop:10, 
                  paddingTop:10, 
                  borderTop:'1px solid rgba(148, 163, 184, 0.2)',
                  display:'flex',
                  justifyContent:'space-between',
                  alignItems:'center'
                }}>
                  <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>
                    UNDO AVAILABLE: {sculptHistory.length}
                  </div>
                  <button
                    onClick={undoSculpt}
                    disabled={sculptHistory.length === 0}
                    style={{
                      padding:'4px 10px',
                      borderRadius:4,
                      border:'1px solid rgba(59, 130, 246, 0.5)',
                      background: sculptHistory.length > 0 ? 'rgba(59, 130, 246, 0.3)' : 'rgba(100, 100, 100, 0.2)',
                      color: sculptHistory.length > 0 ? '#ffffff' : '#64748b',
                      fontSize:10,
                      fontWeight:600,
                      cursor: sculptHistory.length > 0 ? 'pointer' : 'not-allowed',
                      transition:'all 0.2s'
                    }}
                  >
                    ↶ UNDO (Ctrl+Z)
                  </button>
                </div>
                <button
                  onClick={clearAllSculpts}
                  disabled={!selectedCubeId || !placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)}
                  style={{
                    marginTop:8,
                    width:'100%',
                    padding:'6px 10px',
                    borderRadius:4,
                    border:'1px solid rgba(239, 68, 68, 0.5)',
                    background: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0) 
                      ? 'rgba(239, 68, 68, 0.3)' 
                      : 'rgba(100, 100, 100, 0.2)',
                    color: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)
                      ? '#ffffff' 
                      : '#64748b',
                    fontSize:10,
                    fontWeight:600,
                    cursor: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)
                      ? 'pointer' 
                      : 'not-allowed',
                    transition:'all 0.2s'
                  }}
                >
                  🗑️ CLEAR ALL SCULPTS ON SELECTED
                </button>
              </div>
            )}
            
            {cubeEditMode && (
              <>
                {/* Collision Shapes */}
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6, fontWeight:600 }}>COLLISION SHAPES</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4 }}>
                    <button 
                      onClick={() => addCube('box', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      📦 Cube
                    </button>
                    <button 
                      onClick={() => addCube('sphere', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      🔮 Sphere
                    </button>
                    <button 
                      onClick={() => addCube('cylinder', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      🛢️ Cylinder
                    </button>
                  </div>
                  
                  {/* AI Box Button - Separate row for emphasis */}
                  <div style={{ marginTop:8 }}>
                    <button 
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        
                        const newAIBox = {
                          id: Date.now() + Math.random(),
                          shape: 'box',
                          isAIBox: true,
                          aiBoxLabel: `AI Box #${Math.floor(Math.random() * 9999)}`,
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: false,
                          walkableTop: false,
                          color: '#22d3ee',
                          opacity: 0.15,
                          wireframe: true,
                          aiContent: null
                        };
                        setPlacedCubes(prevCubes => [...prevCubes, newAIBox]);
                        setSelectedCubeId(newAIBox.id);
                        console.log(`🤖 Created AI Box with ID: ${newAIBox.id}, Label: ${newAIBox.aiBoxLabel}`);
                      }}
                      style={{ 
                        width: '100%',
                        padding:'10px 8px', 
                        borderRadius:6, 
                        border: '2px solid rgba(34, 211, 238, 0.5)',
                        background: 'rgba(6, 182, 212, 0.2)',
                        color:'#22d3ee', 
                        cursor:'pointer',
                        fontSize: 11,
                        fontWeight: 700,
                        transition:'all 0.2s',
                        boxShadow: '0 0 15px rgba(34, 211, 238, 0.3)'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(6, 182, 212, 0.4)';
                        e.currentTarget.style.boxShadow = '0 0 20px rgba(34, 211, 238, 0.5)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)';
                        e.currentTarget.style.boxShadow = '0 0 15px rgba(34, 211, 238, 0.3)';
                      }}
                    >
                      🤖 AI Box (Copilot)
                    </button>
                  </div>
                </div>

                {/* Placed Objects List */}
                <div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>PLACED OBJECTS ({placedCubes.filter(c => !c.isTerrain).length})</div>
                    <button
                      onClick={cleanupOrphanedCollisions}
                      style={{
                        padding:'3px 6px',
                        background:'rgba(239, 68, 68, 0.2)',
                        border:'1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius:4,
                        color:'#fca5a5',
                        cursor:'pointer',
                        fontSize:8,
                        fontWeight:600,
                        transition:'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                      title="Remove orphaned collision objects whose parents were deleted"
                    >
                      🧹 Cleanup
                    </button>
                  </div>
                  <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid rgba(148, 163, 184, 0.1)', borderRadius:6, padding:4, background:'rgba(15, 23, 42, 0.3)' }}>
                    {placedCubes.filter(c => !c.isTerrain).length === 0 ? (
                      <div style={{ padding:12, color:'#64748b', fontSize:10, textAlign:'center' }}>No objects placed</div>
                    ) : (
                      placedCubes.filter(cube => !cube.parentId && !cube.isTerrain).map((cube, idx) => {
                        const childCollision = placedCubes.find(c => c.parentId === cube.id);
                        const itemIndex = 4 + idx; // Items 4+ are placed objects
                        const isSelected = selectedSectionIndex === 0 && isInSection && selectedItemIndex === itemIndex;
                        const isInThisSubMenu = isInSubMenu && isSelected; // Are we navigating inside THIS object's sub-menu?
                        
                        return (
                          <div key={cube.id} style={{ marginBottom:4 }} data-placed-object-index={itemIndex}>
                            <div 
                              onClick={() => setSelectedCubeId(cube.id)}
                              style={{
                                padding:'8px',
                                borderRadius:6,
                                border: isSelected 
                                  ? '2px solid #22c55e'
                                  : selectedCubeId === cube.id ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.15)',
                                background: isSelected
                                  ? 'rgba(34, 197, 94, 0.3)'
                                  : selectedCubeId === cube.id ? 'rgba(6, 78, 59, 0.4)' : 'rgba(15, 23, 42, 0.4)',
                                boxShadow: isSelected ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none',
                                cursor:'pointer',
                                fontSize:10,
                                transition:'all 0.2s'
                              }}
                            >
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                            <span style={{ fontWeight:600, color: cube.isAIBox ? '#22d3ee' : '#e2e8f0' }}>
                              {cube.isAIBox ? `🤖 ${cube.aiBoxLabel || 'AI Box'}` :
                               cube.modelType === 'custom' ? `📦 ${cube.customModelName || 'Custom Model'}` :
                               cube.modelType === 'asteroid' ? '🪨 Asteroid' : 
                               cube.modelType === 'table' ? '🪑 Table' :
                               cube.modelType === 'rover' ? '🚗 Rover' :
                               cube.modelType === 'stairs2' ? '🪜 Stairs2' :
                               cube.shape === 'sphere' ? '🔮 Sphere' :
                               cube.shape === 'cylinder' ? '🛢️ Cylinder' : '📦 Cube'} #{idx + 1}
                            </span>
                            <div style={{ display:'flex', gap:4 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); duplicateCube(cube.id); }}
                                style={{ 
                                  padding:'2px 6px', 
                                  borderRadius:4, 
                                  border: (isInThisSubMenu && selectedSubItemIndex === 0) ? '2px solid #22c55e' : '1px solid rgba(148, 163, 184, 0.2)', 
                                  background: (isInThisSubMenu && selectedSubItemIndex === 0) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(30, 41, 59, 0.6)', 
                                  color:'#cbd5e1', 
                                  fontSize:9,
                                  boxShadow: (isInThisSubMenu && selectedSubItemIndex === 0) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                  transition:'all 0.2s'
                                }}
                                title="Duplicate"
                              >
                                📋
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteCube(cube.id); }}
                                style={{ 
                                  padding:'2px 6px', 
                                  borderRadius:4, 
                                  border: (isInThisSubMenu && selectedSubItemIndex === 1) ? '2px solid #22c55e' : '1px solid rgba(220, 38, 38, 0.3)', 
                                  background: (isInThisSubMenu && selectedSubItemIndex === 1) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(127, 29, 29, 0.6)', 
                                  color:'#fecaca', 
                                  fontSize:9,
                                  boxShadow: (isInThisSubMenu && selectedSubItemIndex === 1) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                  transition:'all 0.2s'
                                }}
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize:9, color:'#94a3b8', marginBottom:4 }}>
                            {cube.modelType && cube.modelType !== 'none' ? `Model: ${cube.modelType}` : 
                             cube.shape === 'sphere' ? 'Spherical' :
                             cube.shape === 'cylinder' ? 'Cylindrical' : 'Box'} • Pos: {
                               Array.isArray(cube.position) 
                                 ? `(${cube.position[0]?.toFixed(1) || 0}, ${cube.position[1]?.toFixed(1) || 0}, ${cube.position[2]?.toFixed(1) || 0})` 
                                 : `(${cube.position?.x?.toFixed(1) || 0}, ${cube.position?.y?.toFixed(1) || 0}, ${cube.position?.z?.toFixed(1) || 0})`
                             }
                          </div>
                          <div style={{ display:'flex', gap:8 }}>
                            <label 
                              style={{ 
                                display:'flex', 
                                alignItems:'center', 
                                gap:4, 
                                fontSize:9,
                                padding:'2px 4px',
                                borderRadius:3,
                                border: (isInThisSubMenu && selectedSubItemIndex === 2) ? '2px solid #22c55e' : 'none',
                                background: (isInThisSubMenu && selectedSubItemIndex === 2) ? 'rgba(34, 197, 94, 0.3)' : 'transparent',
                                boxShadow: (isInThisSubMenu && selectedSubItemIndex === 2) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                transition:'all 0.2s'
                              }} 
                              onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox" 
                                checked={cube.hasCollision} 
                                onChange={(e) => { e.stopPropagation(); updateCubeAndSync(cube.id, { hasCollision: e.target.checked }); }} 
                                style={{ cursor:'pointer' }}
                              /> 
                              Collision
                            </label>
                            <label 
                              style={{ 
                                display:'flex', 
                                alignItems:'center', 
                                gap:4, 
                                fontSize:9, 
                                opacity:!cube.hasCollision?0.5:1,
                                padding:'2px 4px',
                                borderRadius:3,
                                border: (isInThisSubMenu && selectedSubItemIndex === 3) ? '2px solid #22c55e' : 'none',
                                background: (isInThisSubMenu && selectedSubItemIndex === 3) ? 'rgba(34, 197, 94, 0.3)' : 'transparent',
                                boxShadow: (isInThisSubMenu && selectedSubItemIndex === 3) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                transition:'all 0.2s'
                              }} 
                              onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox" 
                                checked={cube.walkableTop || false} 
                                onChange={(e) => { e.stopPropagation(); updateCubeAndSync(cube.id, { walkableTop: e.target.checked }); }} 
                                disabled={!cube.hasCollision}
                                style={{ cursor:'pointer' }}
                              /> 
                              Walkable
                            </label>
                          </div>
                          
                          {/* Collision Layer - for custom models */}
                          {cube.modelType === 'custom' && (() => {
                            // Find existing collision layer for this model
                            const existingCollision = placedCubes.find(c => c.parentId === cube.id);
                            
                            // Debug: log collision properties
                            if (existingCollision) {
                              console.log('[Collision Debug]', {
                                parentId: cube.id,
                                shape: existingCollision.shape,
                                hasCollision: existingCollision.hasCollision,
                                walkableTop: existingCollision.walkableTop
                              });
                            }
                            
                            return (
                              <div style={{ marginTop:6, padding:4, background:'rgba(147, 51, 234, 0.08)', borderRadius:4, borderLeft:'2px solid rgba(147, 51, 234, 0.4)' }} onClick={(e) => e.stopPropagation()}>
                                <div style={{ fontSize:8, color:'#c084fc', fontWeight:600, marginBottom:3 }}>
                                  {existingCollision ? '🛡️ Collision' : '➕ Add Collision'}
                                </div>
                                
                                {/* Shape Toggle Buttons */}
                                <div style={{ display:'flex', gap:2, marginBottom: existingCollision ? 3 : 0 }}>
                                  {[
                                    { shape: 'box', icon: '📦', subIndex: 4 },
                                    { shape: 'sphere', icon: '⚽', subIndex: 5 },
                                    { shape: 'cylinder', icon: '🥫', subIndex: 6 }
                                  ].map(({ shape, icon, subIndex }) => {
                                    const isSubItemSelected = isInThisSubMenu && selectedSubItemIndex === subIndex;
                                    return (
                                      <button
                                        key={shape}
                                        onClick={(e) => { 
                                          e.stopPropagation(); 
                                          
                                          // Use actual model bounds if available, otherwise estimate
                                          const bounds = cube.modelBounds || { width: 100, height: 100, depth: 100 };
                                          const scaleX = cube.scale.x || 0.1;
                                          const scaleY = cube.scale.y || 0.1;
                                          const scaleZ = cube.scale.z || 0.1;
                                          
                                          // Actual world size = modelBounds * scale
                                          const worldWidth = bounds.width * scaleX;
                                          const worldHeight = bounds.height * scaleY;
                                          const worldDepth = bounds.depth * scaleZ;
                                          
                                          if (existingCollision) {
                                            // Update existing collision to new shape
                                            updateCubeAndSync(existingCollision.id, { 
                                              shape,
                                              scale: { 
                                                x: worldWidth, 
                                                y: worldHeight, 
                                                z: worldDepth 
                                              }
                                            });
                                            // Keep parent selected, don't switch to collision
                                          } else {
                                            // Create new collision layer
                                            const newId = `collision-${cube.id}-${Date.now()}`;
                                            const newCube = {
                                              id: newId,
                                              shape,
                                              modelType: 'none',
                                              position: { ...cube.position },
                                              rotation: { x: 0, y: 0, z: 0 },
                                              scale: { 
                                                x: worldWidth, 
                                                y: worldHeight, 
                                                z: worldDepth 
                                              },
                                              color: '#a855f7',
                                              hasCollision: true,
                                              walkableTop: false,
                                              parentId: cube.id,
                                              followParentScale: true
                                            };
                                            
                                            const newCubes = [...placedCubes, newCube];
                                            setPlacedCubes(newCubes);
                                            // Keep parent selected, don't switch to collision
                                            sendCubeUpdate(newCubes);
                                          }
                                        }}
                                      style={{
                                        flex:1,
                                        padding:'4px 2px',
                                        borderRadius:3,
                                        border: isSubItemSelected ? '2px solid #22c55e' : existingCollision?.shape === shape ? '1px solid #a855f7' : '1px solid rgba(147, 51, 234, 0.3)',
                                        background: isSubItemSelected ? 'rgba(34, 197, 94, 0.4)' : existingCollision?.shape === shape ? 'rgba(147, 51, 234, 0.4)' : 'rgba(147, 51, 234, 0.15)',
                                        color: '#e9d5ff',
                                        fontSize:8,
                                        fontWeight:600,
                                        cursor:'pointer',
                                        transition:'all 0.2s',
                                        boxShadow: isSubItemSelected ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none'
                                      }}
                                      onMouseEnter={e => {
                                        if (!isSubItemSelected) {
                                          e.currentTarget.style.background = 'rgba(147, 51, 234, 0.5)';
                                        }
                                      }}
                                      onMouseLeave={e => {
                                        if (!isSubItemSelected) {
                                          e.currentTarget.style.background = existingCollision?.shape === shape ? 'rgba(147, 51, 234, 0.4)' : 'rgba(147, 51, 234, 0.15)';
                                        }
                                      }}
                                    >
                                      {icon}
                                    </button>
                                  );
                                })}
                                {existingCollision && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteCube(existingCollision.id);
                                    }}
                                    style={{
                                      flex:0.5,
                                      padding:'4px 2px',
                                      borderRadius:3,
                                      border: '1px solid rgba(220, 38, 38, 0.3)',
                                      background: 'rgba(127, 29, 29, 0.5)',
                                      color: '#fca5a5',
                                      fontSize:8,
                                      cursor:'pointer',
                                      transition:'all 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)'}
                                    title="Remove Collision"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                              
                              {existingCollision && (
                                <div 
                                  onClick={(e) => { e.stopPropagation(); setSelectedCubeId(existingCollision.id); }}
                                  style={{
                                    marginTop:2,
                                    marginLeft:8,
                                    padding:'4px 6px',
                                    borderRadius:4,
                                    border: selectedCubeId === existingCollision.id ? '1px solid #a855f7' : '1px solid rgba(147, 51, 234, 0.2)',
                                    background: selectedCubeId === existingCollision.id ? 'rgba(147, 51, 234, 0.2)' : 'rgba(147, 51, 234, 0.08)',
                                    cursor:'pointer',
                                    fontSize:8,
                                    color:'#c084fc',
                                    transition:'all 0.2s'
                                  }}
                                >
                                  ↳ {existingCollision.shape === 'box' ? '📦 Box' : existingCollision.shape === 'sphere' ? '⚽ Sphere' : '🥫 Cylinder'} Collision
                                  <label style={{ display:'inline', marginLeft:6 }} onClick={(e) => e.stopPropagation()}>
                                    <input 
                                      type="checkbox" 
                                      checked={existingCollision.walkableTop || false} 
                                      onChange={(e) => { e.stopPropagation(); updateCubeAndSync(existingCollision.id, { walkableTop: e.target.checked }); }} 
                                      style={{ cursor:'pointer' }}
                                    /> 
                                    <span style={{ fontSize:7 }}>Walkable</span>
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                          })()}
                        </div>
                      </div>
                    );
                  })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          
                {/* Collision Shapes Section */}
                <div 
                  data-section-index="1"
                  style={{ 
                    background: selectedSectionIndex === 1
                      ? (isInSection ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)')
                      : 'rgba(239, 68, 68, 0.08)', 
                    padding:'14px', 
                    borderRadius:10,
                    border: selectedSectionIndex === 1
                      ? (isInSection ? '2px solid #22c55e' : '2px solid #3b82f6')
                      : '1px solid rgba(239, 68, 68, 0.2)',
                    boxShadow: selectedSectionIndex === 1
                      ? (isInSection ? '0 0 20px rgba(34, 197, 94, 0.5)' : '0 0 20px rgba(59, 130, 246, 0.4)')
                      : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:12, color:'#fca5a5', marginBottom:10 }}>🛡️ Collision Shapes</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'box',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#ef4444',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(239, 68, 68, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(127, 29, 29, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)) {
                          e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)) {
                          e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)';
                        }
                      }}
                    >
                      📦 Box
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'sphere',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#f59e0b',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(245, 158, 11, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(120, 53, 15, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(120, 53, 15, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(120, 53, 15, 0.5)';
                        }
                      }}
                    >
                      ⚫ Sphere
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'cylinder',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#8b5cf6',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(139, 92, 246, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(76, 29, 149, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(76, 29, 149, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(76, 29, 149, 0.5)';
                        }
                      }}
                    >
                      🔵 Cylinder
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'capsule',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#06b6d4',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(6, 182, 212, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(8, 51, 68, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(8, 51, 68, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(8, 51, 68, 0.5)';
                        }
                      }}
                    >
                      💊 Capsule
                    </button>
                  </div>
                </div>

                {/* Terrain Builder Section */}
                <div 
                  style={{ 
                    background: 'rgba(34, 197, 94, 0.08)', 
                    padding:'14px', 
                    borderRadius:10,
                    border:'1px solid rgba(34, 197, 94, 0.2)',
                    marginTop: 8
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:12, color:'#6ee7b7', marginBottom:10 }}>🏔️ Terrain Builder</div>
                  
                  {/* Create New Terrain Button */}
                  <button
                    onClick={() => {
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                      
                      // Create terrain 10 units below player's feet
                      const terrainY = playerY - 10;
                      
                      const newTerrain = {
                        id: Date.now() + Math.random(),
                        shape: 'box',
                        isTerrain: true,
                        position: { x: playerX, y: terrainY, z: playerZ },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 50, y: 2.0, z: 50 }, // 2.0 height like platforms
                        hasCollision: true,
                        walkableTop: true,
                        color: '#22c55e',
                        opacity: 1,
                        texture: null, // Start with no texture (green) - user can select one
                        terrainHeight: 2.0,
                        textureRepeat: 10, // Texture tiling ratio (higher = more tiles)
                        // Terrain generation settings
                        hasTerrainNoise: false, // Start flat, user can enable
                        terrainSegments: 100, // Resolution of terrain mesh
                        terrainScale: 0.015, // Noise scale for hills
                        terrainHeightMultiplier: 8, // Height of small hills
                        terrainMoundScale: 0.008, // Scale for larger mounds
                        terrainMoundMultiplier: 15, // Height of large mounds
                        terrainOctaves: 4, // Fractal noise octaves
                        terrainEdgeBlend: 0.25 // How much of the edge to blend (0.1 = 10%, 0.5 = 50%)
                      };
                      const newCubes = [...placedCubes, newTerrain];
                      setPlacedCubes(newCubes);
                      setSelectedCubeId(newTerrain.id);
                      sendCubeUpdate(newCubes);
                    }}
                    style={{
                      width: '100%',
                      padding:'12px',
                      borderRadius:8,
                      border:'1px solid rgba(34, 197, 94, 0.3)',
                      background:'rgba(22, 163, 74, 0.3)',
                      color:'#ffffff',
                      cursor:'pointer',
                      fontSize:11,
                      fontWeight:600,
                      transition:'all 0.2s',
                      marginBottom: 10
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(22, 163, 74, 0.5)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(22, 163, 74, 0.3)'}
                  >
                    ➕ Create New Terrain
                  </button>

                  {/* Terrain Editor - Only show if a terrain is selected */}
                  {selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain) && (() => {
                    const selectedTerrain = placedCubes.find(c => c.id === selectedCubeId);
                    return (
                      <div style={{ 
                        padding: '10px', 
                        background: 'rgba(22, 163, 74, 0.15)', 
                        borderRadius: 8,
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        marginBottom: 10
                      }}>
                        <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 8, fontWeight: 600 }}>
                          🎨 Editing: Terrain #{selectedCubeId.toString().slice(-4)}
                        </div>

                        {/* Height Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Height: {selectedTerrain.scale?.y || 1}
                          </label>
                          <input 
                            type="range"
                            min="0.1"
                            max="20"
                            step="0.1"
                            value={selectedTerrain.scale?.y || 1}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newHeight = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  y: newHeight 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Width Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Width: {selectedTerrain.scale?.x || 50}
                          </label>
                          <input 
                            type="range"
                            min="5"
                            max="200"
                            step="5"
                            value={selectedTerrain.scale?.x || 50}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newWidth = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  x: newWidth 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Depth Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Depth: {selectedTerrain.scale?.z || 50}
                          </label>
                          <input 
                            type="range"
                            min="5"
                            max="200"
                            step="5"
                            value={selectedTerrain.scale?.z || 50}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newDepth = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  z: newDepth 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Texture Selector */}
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Terrain Texture
                          </label>
                          <select
                            value={selectedTerrain.texture || ''}
                            onChange={(e) => {
                              const newTexture = e.target.value === '' ? null : e.target.value;
                              console.log('[TEXTURE SELECTOR] 🎨 User changed texture to:', newTexture, 'for cube:', selectedCubeId);
                              console.log('[TEXTURE SELECTOR] 🔍 Current cube before update:', placedCubes.find(c => c.id === selectedCubeId));
                              updateCubeAndSync(selectedCubeId, { texture: newTexture });
                              // Check state after a tick
                              setTimeout(() => {
                                const updated = placedCubes.find(c => c.id === selectedCubeId);
                                console.log('[TEXTURE SELECTOR] 🔍 Cube after update (1 tick):', updated);
                                console.log('[TEXTURE SELECTOR] 🔍 Texture in state:', updated?.texture);
                              }, 100);
                            }}
                            style={{
                              width: '100%',
                              padding: '6px',
                              borderRadius: 6,
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              background: '#1e293b',
                              color: '#ffffff',
                              fontSize: 10,
                              cursor: 'pointer'
                            }}
                          >
                            <option value="">🟢 No Texture (Green)</option>
                            <option value="/textures/lunar_surface.png">🌙 Lunar Surface</option>
                            <option value="/textures/metal_floor.png">🔩 Metal Floor</option>
                            <option value="/textures/metal_stairs.png">🪜 Metal Stairs</option>
                          </select>
                        </div>

                        {/* Texture Tiling Control */}
                        {selectedTerrain.texture && (
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                              Texture Tiling: {selectedTerrain.textureRepeat || 10}x
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="50"
                              step="1"
                              value={selectedTerrain.textureRepeat || 10}
                              onChange={(e) => {
                                updateCubeAndSync(selectedCubeId, { textureRepeat: parseInt(e.target.value) });
                              }}
                              style={{
                                width: '100%',
                                height: '6px',
                                borderRadius: '3px',
                                background: 'rgba(148, 163, 184, 0.2)',
                                cursor: 'pointer'
                              }}
                            />
                          </div>
                        )}

                        {/* Terrain Generation Toggle */}
                        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(34, 197, 94, 0.1)', borderRadius: 6 }}>
                          <label style={{ fontSize: 10, color: '#22c55e', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selectedTerrain.hasTerrainNoise || false}
                              onChange={(e) => {
                                // When enabling terrain generation, also enable collision and walkability
                                updateCubeAndSync(selectedCubeId, { 
                                  hasTerrainNoise: e.target.checked,
                                  hasCollision: e.target.checked ? true : selectedTerrain.hasCollision,
                                  walkableTop: e.target.checked ? true : selectedTerrain.walkableTop
                                });
                              }}
                              style={{ marginRight: 6, cursor: 'pointer' }}
                            />
                            🏔️ Enable Terrain Generation
                          </label>
                        </div>

                        {/* Terrain Generation Controls - Only show if enabled */}
                        {selectedTerrain.hasTerrainNoise && (
                          <div style={{ padding: 8, background: 'rgba(34, 197, 94, 0.05)', borderRadius: 6, marginBottom: 8 }}>
                            <div style={{ fontSize: 9, color: '#22c55e', marginBottom: 8, fontWeight: 'bold' }}>
                              Terrain Generation
                            </div>

                            {/* Terrain Resolution */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Resolution: {selectedTerrain.terrainSegments || 100}
                              </label>
                              <input
                                type="range"
                                min="50"
                                max="200"
                                step="10"
                                value={selectedTerrain.terrainSegments || 100}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainSegments: parseInt(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Hill Height */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Hill Height: {selectedTerrain.terrainHeightMultiplier || 8}
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="20"
                                step="1"
                                value={selectedTerrain.terrainHeightMultiplier || 8}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainHeightMultiplier: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Hill Scale (Frequency) */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Hill Frequency: {(selectedTerrain.terrainScale || 0.015).toFixed(3)}
                              </label>
                              <input
                                type="range"
                                min="0.005"
                                max="0.05"
                                step="0.001"
                                value={selectedTerrain.terrainScale || 0.015}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainScale: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Mound Height */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Mound Height: {selectedTerrain.terrainMoundMultiplier || 15}
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="30"
                                step="1"
                                value={selectedTerrain.terrainMoundMultiplier || 15}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainMoundMultiplier: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Mound Scale */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Mound Frequency: {(selectedTerrain.terrainMoundScale || 0.008).toFixed(3)}
                              </label>
                              <input
                                type="range"
                                min="0.002"
                                max="0.02"
                                step="0.001"
                                value={selectedTerrain.terrainMoundScale || 0.008}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainMoundScale: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Octaves (Detail) */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Detail (Octaves): {selectedTerrain.terrainOctaves || 4}
                              </label>
                              <input
                                type="range"
                                min="1"
                                max="8"
                                step="1"
                                value={selectedTerrain.terrainOctaves || 4}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainOctaves: parseInt(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Edge Blend */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Edge Smoothness: {((selectedTerrain.terrainEdgeBlend || 0.25) * 100).toFixed(0)}%
                              </label>
                              <input
                                type="range"
                                min="0.05"
                                max="0.5"
                                step="0.05"
                                value={selectedTerrain.terrainEdgeBlend || 0.25}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainEdgeBlend: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Walkable Checkbox */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#cbd5e1', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedTerrain.walkableTop || false} 
                            onChange={(e) => updateCubeAndSync(selectedCubeId, { walkableTop: e.target.checked })}
                            style={{ cursor: 'pointer' }}
                          /> 
                          <span>Walkable Surface</span>
                        </label>
                      </div>
                    );
                  })()}

                  {/* Terrain List */}
                  <div style={{ 
                    padding: '8px', 
                    background: 'rgba(22, 163, 74, 0.08)', 
                    borderRadius: 8,
                    border: '1px solid rgba(34, 197, 94, 0.2)'
                  }}>
                    <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 6, fontWeight: 600 }}>
                      🗺️ Terrain Pieces ({placedCubes.filter(c => c.isTerrain).length})
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                      {placedCubes.filter(c => c.isTerrain).length === 0 ? (
                        <div style={{ padding: 8, color: '#64748b', fontSize: 9, textAlign: 'center' }}>
                          No terrain created yet
                        </div>
                      ) : (
                        placedCubes.filter(c => c.isTerrain).map((terrain, idx) => (
                          <div
                            key={terrain.id}
                            onClick={() => setSelectedCubeId(terrain.id)}
                            style={{
                              padding: '6px 8px',
                              marginBottom: 4,
                              borderRadius: 6,
                              border: selectedCubeId === terrain.id ? '2px solid #22c55e' : '1px solid rgba(34, 197, 94, 0.2)',
                              background: selectedCubeId === terrain.id ? 'rgba(34, 197, 94, 0.25)' : 'rgba(22, 163, 74, 0.1)',
                              cursor: 'pointer',
                              fontSize: 9,
                              color: '#e2e8f0',
                              transition: 'all 0.2s',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <span>
                              🏔️ Terrain #{idx + 1}
                              <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 8 }}>
                                {terrain.scale?.x || 50}×{terrain.scale?.z || 50}
                              </span>
                            </span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); duplicateCube(terrain.id); }}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(148, 163, 184, 0.2)',
                                  background: 'rgba(30, 41, 59, 0.6)',
                                  color: '#cbd5e1',
                                  fontSize: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)'}
                                title="Duplicate Terrain"
                              >
                                📋
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteCube(terrain.id); }}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  background: 'rgba(127, 29, 29, 0.5)',
                                  color: '#fca5a5',
                                  fontSize: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)'}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
          
              </>
            )}
            
            {/* MODELS TAB */}
            {activeEditorTab === 'models' && (
              <>
                <div style={{ 
                  background:'rgba(168, 85, 247, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(168, 85, 247, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#c084fc', marginBottom:10 }}>🎨 Model Library</div>
                  
                  {/* Model Selector Dropdown */}
                  <select 
                    value={selectedModelToLoad || ''} 
                    onChange={(e) => setSelectedModelToLoad(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      background: '#1e293b',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginBottom: 10,
                      appearance: 'none',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 12px center',
                      paddingRight: '32px'
                    }}
                  >
                    <option value="" disabled>Select a model...</option>
                    {availableModels.map((model, idx) => {
                      const displayName = model.name.split(/[-_]/).map(w => 
                        w.charAt(0).toUpperCase() + w.slice(1)
                      ).join(' ');
                      const label = model.path ? displayName : `${displayName} (no model file)`;
                      return (
                        <option 
                          key={idx} 
                          value={idx}
                          style={{ 
                            background: '#1e293b', 
                            color: '#ffffff',
                            padding: '8px'
                          }}
                        >
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  
                  {/* Load Model Button */}
                  <button
                    onClick={() => {
                      if (selectedModelToLoad === null || selectedModelToLoad === '') {
                        console.log('Please select a model first');
                        return;
                      }
                      
                      const model = availableModels[parseInt(selectedModelToLoad)];
                      if (!model || !model.path) {
                        console.log('Selected model has no file');
                        return;
                      }
                      
                      // Create a cube with this custom model
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                      const playerYaw = avatar.yaw || 0;
                      const spawnDistance = 15;
                      const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                      const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                      
                      const newCube = {
                        id: Date.now() + Math.random(),
                        shape: 'box',
                        modelType: 'custom',
                        customModelPath: model.path,
                        customModelName: model.name,
                        position: { x: spawnX, y: playerY, z: spawnZ },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 0.1, y: 0.1, z: 0.1 },
                        hasCollision: false,
                        walkableTop: false,
                        color: '#3b82f6'
                      };
                      
                      const newCubes = [...placedCubes, newCube];
                      setPlacedCubes(newCubes);
                      setSelectedCubeId(newCube.id);
                      sendCubeUpdate(newCubes);
                      
                      console.log(`✅ Loaded model: ${model.name}`);
                    }}
                    style={{ 
                      width: '100%',
                      padding:'12px', 
                      borderRadius:8, 
                      border:'1px solid rgba(168, 85, 247, 0.3)', 
                      background:'rgba(88, 28, 135, 0.5)', 
                      color:'#ffffff', 
                      cursor:'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.8)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.5)'}
                  >
                    📦 Load Model
                  </button>
                </div>
                
                {/* Upload New Model Section */}
                <div style={{ 
                  background:'rgba(168, 85, 247, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(168, 85, 247, 0.2)',
                  marginTop: 10
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#c084fc', marginBottom:10 }}>📁 Upload Model</div>
                  
                  <label style={{ cursor: 'pointer' }}>
                    <div
                      style={{
                        padding:'12px',
                        borderRadius:8,
                        border:'1px solid rgba(168, 85, 247, 0.3)',
                        background:'rgba(88, 28, 135, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:11,
                        fontWeight:600,
                        textAlign:'center',
                        transition:'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.8)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.5)'}
                    >
                      📁 Click to Select Model Folder
                      <div style={{ fontSize: '9px', marginTop: '6px', opacity: 0.8, lineHeight: '1.4' }}>
                        Select a folder containing your model (.fbx, .glb, etc)<br/>
                        and its textures
                      </div>
                      <input
                        type="file"
                        webkitdirectory=""
                        directory=""
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files);
                          if (files.length === 0) {
                            alert('No files selected. Please select a folder.');
                            return;
                          }
                          
                          // Check if there's a model file
                          const modelExtensions = ['.fbx', '.glb', '.gltf', '.obj', '.dae', '.stl'];
                          const hasModel = files.some(f => {
                            const fileName = f.name.toLowerCase();
                            return modelExtensions.some(ext => fileName.endsWith(ext));
                          });
                          
                          if (!hasModel) {
                            const fileList = files.map(f => f.name).slice(0, 10).join(', ');
                            alert(`No model file found.\\n\\nFiles found (first 10): ${fileList}\\n\\nPlease select a folder containing a .fbx, .glb, .gltf, .obj, .dae, or .stl file.`);
                            return;
                          }
                          
                          // Prompt user for model name
                          const modelName = prompt('Enter a name for this model:');
                          if (!modelName || modelName.trim() === '') {
                            alert('Model name is required. Upload cancelled.');
                            return;
                          }
                          
                          const formData = new FormData();
                          files.forEach(file => {
                            formData.append('models', file);
                          });
                          formData.append('modelName', modelName);
                          
                          fetch('/api/upload-model', {
                            method: 'POST',
                            body: formData
                          })
                          .then(res => res.json())
                          .then(data => {
                            if (data.success && data.path) {
                              // Refresh the available models list
                              fetch('/api/models')
                                .then(res => res.json())
                                .then(data => {
                                  if (data.models) {
                                    setAvailableModels(data.models);
                                    alert(`✅ Model uploaded successfully! (${data.filesUploaded || 'multiple'} files)\\n\\nYou can now find it in the Model Library dropdown above.`);
                                  }
                                })
                                .catch(() => {
                                  alert(`✅ Model uploaded! Refresh the page to see it in the library.`);
                                });
                              
                              // Reset file input
                              e.target.value = '';
                            } else {
                              console.error('Upload failed:', data);
                              alert('Upload failed. Check console for details.');
                            }
                          })
                          .catch(err => {
                            console.error('Upload failed:', err);
                            alert('Upload failed. Check console for details.');
                            // Reset file input
                            e.target.value = '';
                          });
                        }}
                      />
                    </div>
                  </label>
                </div>
              </>
            )}
            
            {/* TRANSFORM TAB */}
            {activeEditorTab === 'transform' && (
              <>
                {((selectedCubeId && placedCubes.find(c => c.id === selectedCubeId)) || (selectedVisualizer && audioVisualizers.find(v => v.id === selectedVisualizer))) ? (
                  <div style={{ 
                    background:'rgba(16, 185, 129, 0.12)', 
                    padding:'14px', 
                    borderRadius:10,
                    border:'2px solid rgba(16, 185, 129, 0.3)'
                  }}>
                    <div style={{ fontWeight:600, fontSize:13, color:'#6ee7b7', marginBottom:10 }}>
                      ✨ {selectedCubeId ? 
                        `Editing Object #${placedCubes.findIndex(c => c.id === selectedCubeId) + 1}` :
                        `Editing ${audioVisualizers.find(v => v.id === selectedVisualizer)?.label || 'Audio Zone'}`
                      }
                    </div>
                    
                    {/* Drag mode toggle - only for cubes */}
                    {selectedCubeId && (
                      <label style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, fontSize:11, cursor:'pointer', background:'rgba(15, 23, 42, 0.3)', padding:'10px', borderRadius:8 }}>
                        <input type="checkbox" checked={cubeDragMode} onChange={e=>setCubeDragMode(e.target.checked)} style={{ cursor:'pointer' }} />
                        <span style={{ fontWeight:500 }}>�️ Free Drag (follows terrain)</span>
                      </label>
                    )}
                    
                    {/* Transform mode buttons */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6, fontWeight:600 }}>TRANSFORM MODE</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                        <button 
                          onClick={()=>setCubeTransformMode('translate')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='translate' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='translate' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Move
                        </button>
                        <button 
                          onClick={()=>setCubeTransformMode('rotate')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='rotate' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='rotate' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Rotate
                        </button>
                        <button 
                          onClick={()=>setCubeTransformMode('scale')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='scale' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='scale' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Scale
                        </button>
                      </div>
                    </div>
                    
                    {/* Snap controls */}
                    <div style={{ background:'rgba(15, 23, 42, 0.3)', padding:'10px', borderRadius:8, marginBottom:10 }}>
                      <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', marginBottom:cubeSnap?8:0 }}>
                        <input type="checkbox" checked={cubeSnap} onChange={e=>setCubeSnap(e.target.checked)} style={{ cursor:'pointer' }} /> 
                        <span style={{ fontWeight:600 }}>Enable Snapping</span>
                      </label>
                      
                      {cubeSnap && (
                        <div>
                          {cubeTransformMode==='translate' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Position Snap: {cubeTranslateSnap.toFixed(2)}u</div>
                              <input 
                                type="range" 
                                min={0.1} 
                                max={5} 
                                step={0.1} 
                                value={cubeTranslateSnap} 
                                onChange={e=>setCubeTranslateSnap(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                          {cubeTransformMode==='rotate' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Rotation Snap: {cubeRotateSnapDeg.toFixed(0)}°</div>
                              <input 
                                type="range" 
                                min={1} 
                                max={45} 
                                step={1} 
                                value={cubeRotateSnapDeg} 
                                onChange={e=>setCubeRotateSnapDeg(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                          {cubeTransformMode==='scale' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Scale Snap: {cubeScaleSnap.toFixed(2)}</div>
                              <input 
                                type="range" 
                                min={0.1} 
                                max={1} 
                                step={0.1} 
                                value={cubeScaleSnap} 
                                onChange={e=>setCubeScaleSnap(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Action buttons */}
                    <button 
                      onClick={() => {
                        setSelectedCubeId(null);
                        setSelectedVisualizer(null);
                      }}
                      style={{ 
                        padding:'10px 14px', 
                        borderRadius:8, 
                        border:'1px solid rgba(148, 163, 184, 0.2)', 
                        background:'rgba(15, 23, 42, 0.6)', 
                        color:'#cbd5e1', 
                        cursor:'pointer',
                        fontSize: 11,
                        width: '100%',
                        fontWeight:600,
                        marginBottom:6,
                        transition:'all 0.2s'
                      }}
                    >
                      Deselect
                    </button>
                    
                    {/* Delete button - only for visualizers */}
                    {selectedVisualizer && (
                      <button 
                        onClick={() => {
                          if (window.confirm('Delete this audio visualizer?')) {
                            deleteVisualizerAndSync(selectedVisualizer);
                            setSelectedVisualizer(null);
                          }
                        }}
                        style={{ 
                          padding:'10px 14px', 
                          borderRadius:8, 
                          border:'1px solid rgba(220, 38, 38, 0.3)', 
                          background:'rgba(127, 29, 29, 0.6)', 
                          color:'#fca5a5', 
                          cursor:'pointer',
                          fontSize: 11,
                          width: '100%',
                          fontWeight:600,
                          transition:'all 0.2s'
                        }}
                      >
                        🗑️ Delete Audio Zone
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ 
                    background:'rgba(59, 130, 246, 0.08)', 
                    padding:'20px', 
                    borderRadius:10,
                    border:'1px solid rgba(59, 130, 246, 0.2)',
                    textAlign:'center'
                  }}>
                    <div style={{ fontSize:40, marginBottom:10 }}>🔧</div>
                    <div style={{ fontWeight:600, fontSize:12, color:'#60a5fa', marginBottom:6 }}>No Object Selected</div>
                    <p style={{ fontSize:10, color:'#94a3b8', lineHeight:1.5 }}>
                      Select an object from the Objects tab to transform it
                    </p>
                  </div>
                )}
              </>
            )}
            
            {/* AUDIO TAB */}
            {activeEditorTab === 'audio' && (
              <>
                <div style={{ 
                  background:'rgba(245, 158, 11, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(245, 158, 11, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#fbbf24', marginBottom:10 }}>🔊 Audio Visualizers</div>
                  <button 
                    onClick={() => {
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' && avatar.lift > 0) ? avatar.lift : 5;
                      const playerYaw = avatar.yaw || 0;
                      const spawnDistance = 15;
                      const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                      const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                      const spawnY = Math.max(5, playerY);
                      const newId = Date.now();
                      const newVisualizer = {
                        id: newId,
                        position: [spawnX, spawnY, spawnZ],
                        refDistance: 10,
                        maxDistance: 25,
                        volume: 1.5,
                        label: `Audio Zone ${audioVisualizers.length + 1}`,
                        soundFile: 'rocket_ambience.mp3'
                      };
                      addVisualizerAndSync(newVisualizer);
                      setSelectedVisualizer(newId);
                    }}
                    style={{ 
                      padding:'12px', 
                      borderRadius:8, 
                      border:'1px solid rgba(245, 158, 11, 0.3)', 
                      background:'rgba(146, 64, 14, 0.5)', 
                      color:'#ffffff', 
                      cursor:'pointer',
                      fontSize: 12,
                      width: '100%',
                      fontWeight: 600,
                      marginBottom:12,
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(146, 64, 14, 0.8)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(146, 64, 14, 0.5)'}
                  >
                    + Add Audio Visualizer
                  </button>
                  
                  {/* List of audio visualizers */}
                  <div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginBottom:8, fontWeight:600 }}>PLACED ZONES ({audioVisualizers.length})</div>
                    <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid rgba(148, 163, 184, 0.1)', borderRadius:8, padding:6, background:'rgba(15, 23, 42, 0.3)' }}>
                      {audioVisualizers.length === 0 ? (
                        <div style={{ padding:16, color:'#64748b', fontSize:11, textAlign:'center' }}>No visualizers placed</div>
                      ) : (
                        audioVisualizers.map((viz, idx) => (
                          <div 
                            key={viz.id}
                            onClick={() => setSelectedVisualizer(viz.id)}
                            style={{
                              padding:'10px',
                              marginBottom:6,
                              borderRadius:8,
                              border: selectedVisualizer === viz.id ? '2px solid #f59e0b' : '1px solid rgba(148, 163, 184, 0.15)',
                              background: selectedVisualizer === viz.id ? 'rgba(120, 53, 15, 0.4)' : 'rgba(15, 23, 42, 0.4)',
                              cursor:'pointer',
                              fontSize:11,
                              transition:'all 0.2s'
                            }}
                          >
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                              <span style={{ fontWeight:600, color:'#fbbf24' }}>{viz.label}</span>
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setAudioVisualizers(prev => prev.filter(v => v.id !== viz.id));
                                  if (selectedVisualizer === viz.id) setSelectedVisualizer(null);
                                }}
                                style={{ padding:'4px 8px', borderRadius:6, border:'1px solid rgba(220, 38, 38, 0.3)', background:'rgba(127, 29, 29, 0.6)', color:'#fecaca', fontSize:10 }}
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                            <div style={{ fontSize:10, color:'#94a3b8' }}>
                              Full: {viz.refDistance}u • Max: {viz.maxDistance}u • Vol: {viz.volume.toFixed(1)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            
            {/* SETTINGS TAB */}
            {activeEditorTab === 'settings' && (
              <>
                <div style={{ 
                  background:'rgba(100, 116, 139, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(100, 116, 139, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#cbd5e1', marginBottom:10 }}>⚙️ Camera & Controls</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={showSelf} onChange={e=>setShowSelf(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Show my character</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6, opacity:!showSelf?0.5:1 }}>
                      <input type="checkbox" checked={moveEnabled} onChange={e=>setMoveEnabled(e.target.checked)} disabled={!showSelf} style={{ cursor:'pointer' }} />
                      <span>Movement (arrows)</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6, opacity:(!showSelf || !moveEnabled)?0.5:1 }}>
                      <input type="checkbox" checked={clickMove} onChange={e=>setClickMove(e.target.checked)} disabled={!showSelf || !moveEnabled} style={{ cursor:'pointer' }} />
                      <span>Click-to-move</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={fullCamera} onChange={e=>setFullCamera(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Full camera controls</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={followCam} onChange={e=>setFollowCam(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>3rd-person follow</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={showCollisionMeshes} onChange={e=>setShowCollisionMeshes(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Show collision boxes</span>
                    </label>
                    <button onClick={resetCamera} style={{ 
                      marginTop:8, 
                      padding:'10px 14px', 
                      borderRadius:8, 
                      border:'1px solid rgba(148, 163, 184, 0.3)', 
                      background:'rgba(30, 41, 59, 0.6)', 
                      color:'#e2e8f0', 
                      cursor:'pointer',
                      fontSize:11,
                      fontWeight:600,
                      transition:'all 0.2s'
                    }}>
                      🔄 Reset Camera
                    </button>
                  </div>
                </div>
                
                {/* Danger Zone */}
                <div style={{ 
                  background:'rgba(220, 38, 38, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(220, 38, 38, 0.2)',
                  marginTop:14
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#ef4444', marginBottom:10 }}>⚠️ Danger Zone</div>
                  <button 
                    onClick={leaveGame}
                    style={{ 
                      padding:'10px 14px', 
                      borderRadius:8, 
                      border:'1px solid rgba(220, 38, 38, 0.3)', 
                      background:'rgba(153, 27, 27, 0.6)', 
                      color:'#fff', 
                      cursor:'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      width: '100%',
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(153, 27, 27, 0.9)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(153, 27, 27, 0.6)'}
                  >
                    Leave Game & Disconnect
                  </button>
                </div>
              </>
            )}
          
          </div> {/* Close inner ltr div */}
          </div> {/* Close scrollable container */}
        </div>
        )}
        <Canvas
          key={`${flip180 ? 'cam-back' : 'cam-front'}-${window.__CF_HOT_RELOAD_COUNT__ || 0}`}
          frameloop={charMenuOpen ? 'demand' : 'always'}
          dpr={isNarrow ? 1 : 1}
          camera={{ position: camPos, fov: camFov, near:0.08, far: 50000 }}
          style={{ width: '100%', height: '100%' }}
          shadows
          gl={{ powerPreference:'high-performance', antialias: isNarrow ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
          onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); st.gl.shadowMap.enabled = true; st.gl.shadowMap.type = THREE.PCFSoftShadowMap; }catch{} }}
        >
          <hemisphereLight intensity={0.55} groundColor={'#1b1b1b'} />
          <ambientLight intensity={0.5} />
          {/* Main soft angled light: widen frustum to avoid cut-off; subtle + fuzzy */}
          <directionalLight
            position={[22, 24, -18]}
            intensity={0.7}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={1}
            shadow-camera-far={60}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-bias={-0.0004}
            shadow-normalBias={0.03}
            shadow-radius={6}
          />
          {/* Gentle fills without shadows so the scene stays readable */}
          <pointLight position={[0,10,0]} intensity={0.5} distance={60} decay={2} />
          <pointLight position={[10,8,6]} intensity={0.35} distance={60} decay={2} />
          <pointLight position={[-10,8,-6]} intensity={0.35} distance={60} decay={2} />

          <Controls target={cameraTarget} isNarrow={isNarrow} flip180={flip180} fullCamera={fullCamera} minDist={minDist} maxDist={maxDist} selectedCubeId={selectedCubeId} selectedVisualizer={selectedVisualizer} />
          {(followCam || firstPersonMode) && (
            <CameraFollower firstPersonMode={firstPersonMode} fpCamHeight={fpCamHeight} fpCamForward={fpCamForward} seedToken={followSeed} isPlayer2={youArePlayer2} followRocket={followRocket} rocketPositionRef={rocketPositionRef} cameraDistance={liveSettings.cameraDistance} cameraHeight={liveSettings.cameraHeight} />
          )}
          {/* First-person arms visible only in first-person mode */}
          {firstPersonMode && <FirstPersonArms fpvRef={fpvGunRef} />}
          {/* Rifle gizmo: TransformControls on opponent rifle */}
          <RifleGizmo mode={gunTunerMode} enabled={gunTunerEnabled} setPos={setGunTunerPos} setRot={setGunTunerRot} setScale={setGunTunerScale} />
          <JetpackGizmo mode={jetpackTunerMode} enabled={jetpackTunerEnabled} setPos={setJetpackTunerPos} setRot={setJetpackTunerRot} setScale={setJetpackTunerScale} />

          {/* Keep the board unrotated; use camera side for Player 2 */}
          <group position={[0, groupY, 0]} rotation={[0, 0, 0]}>
            {/* Space background: stars, dust, planets, nebula, milky way */}
            <SpaceBackdrop speed={0.22} dir={[1.0, 0.25]} starIntensity={3.2} clusterStrength={5.0} />
            <DenseGalaxyField totalPoints={1200} clusters={8} radius={22000} clusterSpread={0.02} speed={0.05} dir={[1.0, 0.25]} sizeRange={[2.0, 5.0]} />
            <GalaxyClusters clusterCount={5} pointsPerCluster={100} radius={20000} spread={0.02} speed={0.06} dir={[1.0, 0.25]} />
            <FlybyAsteroids count={15} speed={0.18} dir={[1.0, 0.25]} />
            <StarSwarms maxSwarms={3} basePoints={120} speed={0.55} dir={[1.0, 0.25]} />
            <ShootingStars maxActive={2} minInterval={3} maxInterval={8} />
            {/* Lunar terrain with hills and mounds - characters walk on the surface */}
            <LunarTerrain radius={TERRAIN_RADIUS} flatRadius={50} showCollisionBox={showCollisionMeshes} />
            {/* Resource nodes scattered across terrain */}
            <ResourceSpawner groundY={groundY} wsSend={onAvatarMove || null} />
            {/* Equipment pickups (jetpack, etc.) near spawn */}
            <EquipmentPickups groundY={groundY} wsSend={onAvatarMove || null} />
            {/* Mineable asteroid deposits */}}
            <MineableAsteroidSpawner groundY={groundY} roomSeed={42} wsSend={onAvatarMove || null} />
            {/* Base building system — placed pieces + ghost preview */}
            <Suspense fallback={null}>
              <BuildingSystem groundY={groundY} wsSend={onAvatarMove || null} />
            </Suspense>
            {/* PvE enemy wave defense system */}
            <Suspense fallback={null}>
              <EnemyWaveManager groundY={groundY} wsSend={onAvatarMove || null} />
            </Suspense>
            {/* Giant moon sphere hovering off to the side */}
            <GiantMoonSphere position={[12000, 5000, -15000]} radius={4000} />
            {/* Simple staircase you can walk up */}
            <Staircase rocketPositionRef={rocketPositionRef} setFollowRocket={setFollowRocket} showCollisionMeshes={showCollisionMeshes} />
            {/* Extra placed props */}
            {/* Decorative FBX stairs (hidden for now) */}
            {SHOW_DECOR_STAIRS && (
              extraEdit ? (
                <>
                  <ExtraStairsFBX
                    ref={extraRef}
                    alignToStair2={false}
                    yaw={(extraYawDeg * Math.PI) / 180}
                    scaleMul={extraScale}
                    scaleMulX={extraRef?.current?.scale?.x ?? extraScale}
                    scaleMulY={extraRef?.current?.scale?.y ?? extraScale}
                    scaleMulZ={extraRef?.current?.scale?.z ?? extraScale}
                    posX={extraX}
                    posZ={extraZ}
                    posY={extraY}
                    onDefChange={(def)=>{
                      try {
                        const yawAdj = ((maskYawDeg||0) * Math.PI/180);
                        setExtraStairsDef({
                          ...def,
                          posX: def.posX + (maskDX||0),
                          posZ: def.posZ + (maskDZ||0),
                          posY: (def.posY||0) + (maskDY||0),
                          yaw: (def.yaw||0) + yawAdj,
                          width: def.width * (maskScale||1),
                          depth: def.depth * (maskScale||1),
                          height: def.height * (maskScale||1),
                          run: def.run * (maskScale||1),
                          rise: def.rise * (maskScale||1),
                          reverse: !!extraReverse
                        });
                      } catch {}
                    }}
                  />
                  {extraRef?.current && (
                    <TransformControls
                      object={extraRef.current}
                      mode={extraMode}
                      enabled={true}
                      showX showY showZ
                      onMouseDown={()=>{ try { setFullCamera(true); setFollowCam(false); } catch {} }}
                      onDraggingChanged={(drag)=>{ try { if (controlsRef.current) controlsRef.current.enabled = !drag; if (drag) { setFullCamera(true); setFollowCam(false); } } catch {} }}
                      translationSnap={extraSnap && extraMode==='translate' ? extraTranslateSnap : undefined}
                      rotationSnap={extraSnap && extraMode==='rotate' ? (extraRotateSnapDeg * Math.PI/180) : undefined}
                      scaleSnap={extraSnap && extraMode==='scale' ? extraScaleSnap : undefined}
                      onObjectChange={()=>{
                        try {
                          const g = extraRef.current; if (!g) return;
                          const fh = ROWS * (CELL + GAP) - GAP + 0.6;
                          const groundY = -fh / 2 - GROUND_CLEAR;
                          const nextY = g.position.y;
                          if (lockYToGround && extraMode==='translate') {
                            g.position.y = groundY;
                            setExtraY(0);
                          } else {
                            setExtraY(nextY - groundY);
                          }
                          setExtraX(g.position.x);
                          setExtraZ(g.position.z);
                          setExtraYawDeg((g.rotation.y * 180/Math.PI + 360) % 360);
                          const sx = Math.max(0.01, Math.min(1.0, g.scale.x));
                          const sy = Math.max(0.01, Math.min(1.0, g.scale.y));
                          const sz = Math.max(0.01, Math.min(1.0, g.scale.z));
                          if (g.scale.x !== sx || g.scale.y !== sy || g.scale.z !== sz) g.scale.set(sx, sy, sz);
                          setExtraScale(sx);
                          setExtraScaleX(sx); setExtraScaleY(sy); setExtraScaleZ(sz);
                        } catch {}
                      }}
                    />
                  )}
                </>
              ) : (
                <ExtraStairsFBX
                  alignToStair2={extraAlign}
                  side={extraSide}
                  gap={extraGap}
                  yaw={(extraYawDeg * Math.PI) / 180}
                  scaleMul={extraScale}
                  scaleMulX={extraScaleX}
                  scaleMulY={extraScaleY}
                  scaleMulZ={extraScaleZ}
                  posX={extraX}
                  posZ={extraZ}
                  posY={extraY}
                  onDefChange={(def)=>{
                    try {
                      const yawAdj = ((maskYawDeg||0) * Math.PI/180);
                      setExtraStairsDef({
                        ...def,
                        posX: def.posX + (maskDX||0),
                        posZ: def.posZ + (maskDZ||0),
                        posY: (def.posY||0) + (maskDY||0),
                        yaw: (def.yaw||0) + yawAdj,
                        width: def.width * (maskScale||1),
                        depth: def.depth * (maskScale||1),
                        height: def.height * (maskScale||1),
                        run: def.run * (maskScale||1),
                        rise: def.rise * (maskScale||1),
                        reverse: !!extraReverse
                      });
                    } catch {}
                  }}
                />
              )
            )}
            {/* Visualize stair collision boxes */}
            <StairCollisionDebug show={showCollisionMeshes} />
            {/* Optional Transform gizmo for mask itself (edit center using current mask offsets) */}
            {extraWalkable && maskEdit && EXTRA_STAIRS_DEF && (()=>{
              const d = EXTRA_STAIRS_DEF;
              const fh = ROWS * (CELL + GAP) - GAP + 0.6;
              const gY = -fh / 2 - GROUND_CLEAR;
              const maskPos = [(d.posX||0) + maskDX, gY + (d.posY||0) + maskDY, (d.posZ||0) + maskDZ];
              const maskYaw = (d.yaw||0) + ((maskYawDeg||0) * Math.PI/180);
              const ms = (maskScale||1);
              // Render a visible, clickable mask handle (wireframe box of the unscaled dimensions; group carries uniform scale)
              return (
                <>
                  <group ref={maskObjRef} position={maskPos} rotation={[0, maskYaw, 0]} scale={[ms, ms, ms]}>
                    <mesh>
                      <boxGeometry args={[Math.max(0.001, d.width||1), Math.max(0.001, d.height||1), Math.max(0.001, d.depth||1)]} />
                      <meshBasicMaterial color={'#67e8f9'} wireframe transparent opacity={0.35} depthWrite={false} />
                    </mesh>
                  </group>
                  {maskObjRef?.current && (
                    <TransformControls
                      object={maskObjRef.current}
                      mode={extraMode}
                      enabled={true}
                      showX showY showZ
                      onMouseDown={()=>{ try { setFullCamera(true); setFollowCam(false); } catch {} }}
                      onDraggingChanged={(drag)=>{ try { if (controlsRef.current) controlsRef.current.enabled = !drag; if (drag) { setFullCamera(true); setFollowCam(false); } } catch {} }}
                      translationSnap={extraSnap && extraMode==='translate' ? extraTranslateSnap : undefined}
                      rotationSnap={extraSnap && extraMode==='rotate' ? (extraRotateSnapDeg * Math.PI/180) : undefined}
                      scaleSnap={extraSnap && extraMode==='scale' ? extraScaleSnap : undefined}
                      onObjectChange={()=>{
                        try {
                          const g = maskObjRef.current; if (!g) return;
                          const p = g.position; const r = g.rotation; const s = g.scale.x;
                          // enforce uniform scale on mask handle
                          g.scale.setScalar(Math.max(0.01, s));
                          setMaskDX(p.x - (d.posX||0));
                          setMaskDY((p.y - gY) - (d.posY||0));
                          setMaskDZ(p.z - (d.posZ||0));
                          setMaskYawDeg((((r.y - (d.yaw||0)) * 180/Math.PI) % 360 + 360) % 360);
                          setMaskScale(Math.max(0.01, s));
                        } catch {}
                      }}
                    />
                  )}
                </>
              );
            })()}
            {/* Floor click-to-move disabled: only side pads are clickable */}
            <mesh position={[0, groundY + 0.002, 0]} rotation={[-Math.PI/2, 0, 0]} renderOrder={-1} raycast={() => null}>
              <planeGeometry args={[TERRAIN_RADIUS*3, TERRAIN_RADIUS*3, 1, 1]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            
            {/* Board assembly: render only after the table reports top Y (state or global) to avoid initial snap */}
            {tableTopKnown && (
              <group key="board-group-stable" position={[0, boardOnTableYOffset + BOARD_EXTRA_LIFT, 0]}>
                <FrontPlate />
                <SideSupports />
                {/* Classic board without neon accents */}
                {/* Disable shadow catcher on very small screens to avoid any perceived haze */}
                {(!isNarrow) && <BackShadowCatcher opacity={0.14} />}

                {/* Pieces from board state */}
                {Array.from({ length: ROWS }).map((_, r) => (
                  Array.from({ length: COLS }).map((_, c) => {
                    const v = board?.[r]?.[c];
                    if (!v) return null;
                    const col = colors?.[v] || (v === 1 ? '#ff3b5c' : '#ffd166');
                    // Always drop pieces top-down regardless of camera side
                    return <Piece key={`p-${r}-${c}`} color={col} c={c} r={r} flip180={false} />;
                  })
                ))}

                {/* Input hotspots */}
                {Array.from({ length: COLS }, (_, c) => {
                  const x = (c - (COLS - 1) / 2) * (CELL + GAP);
                  const H = ROWS * (CELL + GAP) - GAP;
                  return (
                    <mesh key={`hs-${c}`} position={[x, 0, 0]} onPointerDown={() => onSelectColumn && onSelectColumn(c)}>
                      <boxGeometry args={[CELL, H + 0.5, 1.2]} />
                      <meshBasicMaterial transparent opacity={0} />
                    </mesh>
                  );
                })}
              </group>
            )}
            <ClassicTableFBX />

            {/* Connect Four Table collision wireframe removed */}

              {/* Local-only clickable portal (require Click-to-move to be ON) */}
              {showSelf && !charMenuOpen && moveEnabled && clickMove && (
                youArePlayer2 ? (
                  <PortalPad position={[player2Pos.x, groundY + 0.012, player2Pos.z]} color={'#a78bfa'} onClick={() => gotoTableSide('Player 2')} />
                ) : (
                  <PortalPad position={[player1Pos.x, groundY + 0.012, player1Pos.z]} color={'#22d3ee'} onClick={() => gotoTableSide('Player 1')} />
                )
              )}

              {/* Leave Game button: on the tabletop, centered in front of the board on your side when hidden */}
              {!showSelf && !charMenuOpen && (
                (() => {
                  // Center X with tiny nudge toward your avatar's X offset; move Z further onto the table (away from the edge)
                  const forward = 5.3; // distance from board center toward the local side
                  const z = (youArePlayer2 ? -1 : 1) * forward;
                  const x = 0; // centered horizontally
                  return (
                    <LeaveButton
                      position={[x, -2.1, z]}
                      color={'#f43f5e'}
                      label={'Leave Game'}
                      onClick={() => {
                        try {
                          // Return to third-person and enable click-to-move when leaving
                          setShowSelf(true);
                          centerThirdPerson();
                          setClickMove(true);
                          setP1Target(null);
                          setP2Target(null);
                          // After leaving board view, keep smooth off even on the first walk
                          try { suppressNextSmoothRef.current = true; } catch {}
                        } catch {}
                      }}
                    />
                  );
                })()
              )}

            {/* Player 1 Avatar (Astronaut FBX) */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {youArePlayer2 ? (
                  // Remote P1 - only show if opponent is connected AND not in room mode
                  !remotePlayers && opponentConnected && (
                    <RemoteAvatarGroup side={remoteSide} base={player1Pos}>
                      {/* Remote P1: show opponent's chosen character (default alien) */}
                      {oppCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key="opp-p1-astronaut" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : oppCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key="opp-p1-guy1" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : oppCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key="opp-p1-robot4" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : (
                        <Alien2FBXOpponent key="opp-p1-alien" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      )}
                      <CameraFacingBillboard position={[0, oppCharacterId === 'astronaut' || oppCharacterId === 'guy1' || oppCharacterId === 'alien' || oppCharacterId === 'robot4' ? 11 : 7, 0]}>
                        <Text fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {oppName || 'Opponent'}
                        </Text>
                    </CameraFacingBillboard>
                    </RemoteAvatarGroup>
                  )
                ) : (
                  showSelf && !charMenuOpen && (
                    <PlayerMover firstPersonMode={firstPersonMode} setFirstPersonMode={setFirstPersonMode} followCam={followCam} enabled={moveEnabled} settingsMenuOpen={settingsMenuOpen} setShowEditMenu={setShowEditMenu} setShowChatUI={setShowChatUI} setFullCamera={setFullCamera} setFollowCam={setFollowCam} showEditMenu={showEditMenu} activeEditorTab={activeEditorTab} setActiveEditorTab={setActiveEditorTab} selectedSectionIndex={selectedSectionIndex} setSelectedSectionIndex={setSelectedSectionIndex} isInSection={isInSection} setIsInSection={setIsInSection} selectedItemIndex={selectedItemIndex} setSelectedItemIndex={setSelectedItemIndex} isInSubMenu={isInSubMenu} setIsInSubMenu={setIsInSubMenu} selectedSubItemIndex={selectedSubItemIndex} setSelectedSubItemIndex={setSelectedSubItemIndex} cubeEditMode={cubeEditMode} placedCubes={placedCubes} maxRadius={PLAY_AREA_RADIUS} speed={22} turnSensitivity={liveSettings.turnSensitivity} invertForward={false} baseOffset={[player1Pos.x, player1Pos.z]} initialYaw={0} obstacles={[]} collisionRadius={myCharacterId === 'robot4' ? 4.2 : myCharacterId === 'astronaut' || myCharacterId === 'guy1' ? 3.7 : myCharacterId === 'alien' ? 3.75 : 1.8} collisionForwardOffset={myCharacterId === 'robot4' ? 0 : -1.35} groundSamplePush={(myCharacterId === 'robot4' || myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : 2.3} backProbeMag={(myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : undefined} stairMagMul={1.0} labelSide={'Player 1'} labelName={myName} characterId={myCharacterId} showCollisionBoxes={showCollisionMeshes} onWeaponSystemUpdate={setWeaponSystemData} onAvatarMove={onAvatarMove} moveTarget={clickMove ? p1Target : null} onArrive={() => {
                      try {
                        // final resend after arrival to guarantee opponent sees yaw=0
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); const isJetpacking=!!la.isJetpacking; const tiltX=la.jetpackTiltX||0; const tiltZ=la.jetpackTiltZ||0; onAvatarMove && onAvatarMove({ player: 1, x, z, yaw: 0, run, isJumping, lift, isJetpacking, tiltX, tiltZ }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP1Target(null); setFullCamera(false); setShowSelf(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ 
                      // Don't broadcast position if user is dragging an object
                      if (window.__CF_IS_DRAGGING_CUBE__) return;
                      const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); const isJetpacking = !!la.isJetpacking; const tiltX = la.jetpackTiltX || 0; const tiltZ = la.jetpackTiltZ || 0; const isShooting = !!la.isShooting; const isAiming = !!la.isAiming; const isWalkingBackward = !!la.isWalkingBackward; const isStrafeLeft = !!la.isStrafeLeft; const isStrafeRight = !!la.isStrafeRight; const isDead = !!la.isDead; const pitch = la.pitch || 0; onAvatarMove && onAvatarMove({ player: 1, x, z, yaw, run, isJumping, lift, isJetpacking, tiltX, tiltZ, isShooting, isAiming, isWalkingBackward, isStrafeLeft, isStrafeRight, isDead, pitch }); }catch{} }}>
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p1-astronaut-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} isLocalPlayer xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : myCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key={`local-p1-guy1-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p1-robot4-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p1-alien-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      )}
                      <CameraFacingBillboard position={[0, 11, 0]}>
                        <Text fontSize={2.5} color={'#22c55e'} anchorX="center" anchorY="bottom" outlineWidth={0.06} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {myName || 'Player 1'}
                        </Text>
                      </CameraFacingBillboard>
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>
            {/* Player 2 Avatar */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {!youArePlayer2 ? (
                  // Remote P2 - only show if opponent is connected AND not in room mode
                  !remotePlayers && opponentConnected && (
                    <RemoteAvatarGroup side={remoteSide} base={player2Pos}>
                      {/* Remote P2: show opponent's chosen character */}
                      {oppCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key="opp-p2-astronaut" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : oppCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key="opp-p2-guy1" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : oppCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key="opp-p2-robot4" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : (
                        <Alien2FBXOpponent key="opp-p2-alien" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      )}
                      <CameraFacingBillboard position={[0, oppCharacterId === 'astronaut' || oppCharacterId === 'guy1' || oppCharacterId === 'alien' || oppCharacterId === 'robot4' ? 11 : 7, 0]}>
                          <Text fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                            {oppName || 'Opponent'}
                          </Text>
                      </CameraFacingBillboard>
                    </RemoteAvatarGroup>
                  )
                ) : (
                  showSelf && !charMenuOpen && (
                    <PlayerMover enabled={moveEnabled} settingsMenuOpen={settingsMenuOpen} setShowEditMenu={setShowEditMenu} setShowChatUI={setShowChatUI} setFullCamera={setFullCamera} setFollowCam={setFollowCam} showEditMenu={showEditMenu} activeEditorTab={activeEditorTab} setActiveEditorTab={setActiveEditorTab} selectedSectionIndex={selectedSectionIndex} setSelectedSectionIndex={setSelectedSectionIndex} isInSection={isInSection} setIsInSection={setIsInSection} selectedItemIndex={selectedItemIndex} setSelectedItemIndex={setSelectedItemIndex} isInSubMenu={isInSubMenu} setIsInSubMenu={setIsInSubMenu} selectedSubItemIndex={selectedSubItemIndex} setSelectedSubItemIndex={setSelectedSubItemIndex} cubeEditMode={cubeEditMode} placedCubes={placedCubes} maxRadius={PLAY_AREA_RADIUS} speed={22} turnSensitivity={liveSettings.turnSensitivity} invertForward={true} baseOffset={[player2Pos.x, player2Pos.z]} initialYaw={0} clickYawOffset={Math.PI} obstacles={[]} collisionRadius={myCharacterId === 'robot4' ? 4.2 : myCharacterId === 'astronaut' || myCharacterId === 'guy1' ? 3.7 : myCharacterId === 'alien' ? 3.75 : 1.8} collisionForwardOffset={myCharacterId === 'robot4' ? 0 : -1.35} groundSamplePush={(myCharacterId === 'robot4' || myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : 2.3} backProbeMag={(myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : undefined} stairMagMul={1.0} labelSide={'Player 2'} labelName={myName} characterId={myCharacterId} showCollisionBoxes={showCollisionMeshes} onAvatarMove={onAvatarMove} moveTarget={clickMove ? p2Target : null} onArrive={() => {
                      try {
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); const isJetpacking=!!la.isJetpacking; const tiltX=la.jetpackTiltX||0; const tiltZ=la.jetpackTiltZ||0; onAvatarMove && onAvatarMove({ player: 2, x, z, yaw: 0, run, isJumping, lift, isJetpacking, tiltX, tiltZ }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP2Target(null); setFullCamera(false); setShowSelf(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ 
                      // Don't broadcast position if user is dragging an object
                      if (window.__CF_IS_DRAGGING_CUBE__) return;
                      const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); const isJetpacking = !!la.isJetpacking; const tiltX = la.jetpackTiltX || 0; const tiltZ = la.jetpackTiltZ || 0; const isShooting = !!la.isShooting; const isAiming = !!la.isAiming; const isWalkingBackward = !!la.isWalkingBackward; const isStrafeLeft = !!la.isStrafeLeft; const isStrafeRight = !!la.isStrafeRight; const isDead = !!la.isDead; const pitch = la.pitch || 0; onAvatarMove && onAvatarMove({ player: 2, x, z, yaw, run, isJumping, lift, isJetpacking, tiltX, tiltZ, isShooting, isAiming, isWalkingBackward, isStrafeLeft, isStrafeRight, isDead, pitch }); }catch{} }}>}
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p2-astronaut-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} isLocalPlayer xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : myCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key={`local-p2-guy1-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p2-robot4-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p2-alien-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      )}
                      <CameraFacingBillboard position={[0, 11, 0]}>
                        <Text fontSize={2.5} color={'#3b82f6'} anchorX="center" anchorY="bottom" outlineWidth={0.06} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {myName || 'Player 2'}
                        </Text>
                      </CameraFacingBillboard>
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>

            {/* Multi-player remote avatars (room mode — N players) */}
            {remotePlayers && remotePlayers.length > 0 && remotePlayers.map((rp) => (
              <Suspense key={rp.socketId} fallback={null}>
                <ModelErrorBoundary fallback={null}>
                  <RemoteAvatarGroup avatarKey={rp.socketId} base={player1Pos}>
                    {rp.characterId === 'astronaut' ? (
                      <AstronautFBXOpponent key={`mp-${rp.socketId}-astro`} xFront={xFront} xBack={xBack} zSign={1} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                    ) : rp.characterId === 'guy1' ? (
                      <Guy1FBXOpponent key={`mp-${rp.socketId}-guy1`} xFront={xFront} xBack={xBack} zSign={1} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                    ) : rp.characterId === 'robot4' ? (
                      <Robot4FBXOpponent key={`mp-${rp.socketId}-robot4`} xFront={xFront} xBack={xBack} zSign={1} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                    ) : (
                      <Alien2FBXOpponent key={`mp-${rp.socketId}-alien`} xFront={xFront} xBack={xBack} zSign={1} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                    )}
                    <CameraFacingBillboard position={[0, 11, 0]}>
                      <Text fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                        {rp.name || 'Player'}
                      </Text>
                    </CameraFacingBillboard>
                  </RemoteAvatarGroup>
                </ModelErrorBoundary>
              </Suspense>
            ))}

            {/* Labels are now attached and follow avatars (Billboard faces camera) */}

            {/* Placed Collision Cubes */}
            {console.log('[DEBUG] Rendering', placedCubes.length, 'cubes. AI Boxes:', placedCubes.filter(c => c.isAIBox).map(c => ({ id: c.id, label: c.aiBoxLabel, hasContent: !!(c.aiContent || c.aiContentData) })))}
            {placedCubes.map((cube) => (
              <PlacedCube
                key={cube.id}
                cube={cube}
                isSelected={selectedCubeId === cube.id}
                onSelect={() => !sculptMode && setSelectedCubeId(cube.id)}
                editMode={cubeEditMode}
                dragMode={cubeDragMode}
                transformMode={cubeTransformMode}
                snap={cubeSnap}
                translateSnap={cubeTranslateSnap}
                rotateSnapDeg={cubeRotateSnapDeg}
                scaleSnap={cubeScaleSnap}
                onTransformEnd={(updates) => updateCubeAndSync(cube.id, updates)}
                showCollisionMeshes={showCollisionMeshes}
                snapConfirmDialog={snapConfirmDialog}
                setSnapConfirmDialog={setSnapConfirmDialog}
                pendingSnapCubeId={pendingSnapCubeId}
                setPendingSnapCubeId={setPendingSnapCubeId}
                placedCubes={placedCubes}
              />
            ))}
            
            {/* Terrain Labels - ID and Edge Names */}
            {placedCubes.filter(c => c.isTerrain).map((cube, index) => (
              <TerrainLabels key={`label-${cube.id}`} cube={cube} terrainIndex={index + 1} />
            ))}
            
            {/* Terrain Sculpting Tool */}
            <TerrainSculptor
              enabled={sculptMode}
              brushSize={sculptBrushSize}
              strength={sculptStrength}
              placedCubes={placedCubes}
              onSculpt={handleSculpt}
            />
            
            {/* Audio Visualizers - with transform controls like cubes */}
            {audioVisualizers.map((viz) => (
              <EditableAudioVisualizer
                key={viz.id}
                visualizer={viz}
                isSelected={selectedVisualizer === viz.id}
                onSelect={(id) => setSelectedVisualizer(id)}
                editMode={cubeEditMode}
                dragMode={cubeDragMode}
                transformMode={cubeTransformMode}
                snap={cubeSnap}
                translateSnap={cubeTranslateSnap}
                rotateSnapDeg={cubeRotateSnapDeg}
                scaleSnap={cubeScaleSnap}
                availableSounds={availableSounds}
                setAvailableSounds={setAvailableSounds}
                onTransformEnd={(updates) => updateVisualizerAndSync(viz.id, updates)}
                showMeshes={showCollisionMeshes}
              />
            ))}

          </group>
          
          {/* Bullets + impacts rendered by decoupled BulletRenderer (reads from window global) */}
          <BulletRenderer remoteBullets={remoteBullets} removeRemoteBullet={removeRemoteBullet} />
          
          {/* Muzzle flash at gun barrel */}
          {weaponSystemData?.showMuzzleFlash && firstPersonMode && (
            <MuzzleFlash position={[0,0,0]} active={true} />
          )}
          
          {/* Vehicle Physics Controller - only active when in vehicle */}
          <VehiclePhysicsController placedCubes={placedCubes} />
          
          {/* Cinematic post-processing for stunning space visuals */}
          {/* <SpaceEffects /> */}
          
          {/* Loading gate — tracks asset loading progress */}
          <LoadingGate onReady={handleAssetsReady} />
        </Canvas>
      </div>
      
      {/* Loading Screen Overlay — shown while assets load */}
      <LoadingScreen progress={loadProgress} visible={showLoading} />
      
      {/* Combat UI - rendered outside Canvas for 2D overlay */}
      {moveEnabled && weaponSystemData && showSelf && (
        <>
          {/* Show crosshair always (scope overlay renders on top when fully scoped) */}
          <Crosshair 
            isAiming={weaponSystemData.isAiming}
            spread={0.01}
          />
          {firstPersonMode && <ScopeOverlay active={!!weaponSystemData.isAiming} />}
          <CombatUI
            health={weaponSystemData.health}
            maxHealth={weaponSystemData.maxHealth}
            ammo={weaponSystemData.ammo}
            maxAmmo={weaponSystemData.maxAmmo}
            weaponName={weaponSystemData.currentWeapon}
            isReloading={weaponSystemData.isReloading}
            killFeed={weaponSystemData.killFeed || []}
          />
          {weaponSystemData.hitMarkers && weaponSystemData.hitMarkers.length > 0 && (
            <HitMarker hits={weaponSystemData.hitMarkers} />
          )}
        </>
      )}
      
      {/* Damage flash & Death screen overlays */}
      {weaponSystemData && <DamageFlash active={weaponSystemData.damageFlash} />}
      {weaponSystemData && <DeathScreen active={weaponSystemData.isDead} />}

      {/* Resource gathering overlays (HTML outside Canvas) */}
      <ResourceOverlays />

      {/* Equipment pickup overlays (HTML outside Canvas) */}
      <EquipmentPickupOverlays />

      {/* Mining progress overlays (HTML outside Canvas) */}
      <MiningOverlays />

      {/* Building system overlays (HTML outside Canvas) */}
      <BuildingOverlays />

      {/* Wave defense overlays (HTML outside Canvas) */}
      <WaveOverlays />

      {/* Gamepad button hints HUD (HTML outside Canvas) */}
      <GamepadHUD />

      {/* ── Weapon Transform Editor (toggle button + panel) ── */}
      {!gunEditorOpen && (
        <button
          onClick={() => setGunEditorOpen(true)}
          style={{
            position:'absolute', top:70, left:10, zIndex:99999,
            background:'rgba(0,0,0,0.85)', border:'1px solid rgba(0,255,255,0.3)',
            color:'#0ff', borderRadius:8, padding:'6px 14px', cursor:'pointer',
            fontSize:12, fontFamily:'monospace', pointerEvents:'auto',
            boxShadow:'0 0 10px rgba(0,255,255,0.1)'
          }}
        >&#9881; Gun Editor</button>
      )}
      {gunEditorOpen && (
        firstPersonMode ? (
          <GunTunerGUI gunName="Lazer Rifle (FPV)" pos={fpvGunPos} setPos={setFpvGunPos} rot={fpvGunRot} setRot={setFpvGunRot} scale={fpvGunScale} setScale={setFpvGunScale} forceVisible={gunTunerForceVisible} setForceVisible={setGunTunerForceVisible} forceAim={gunTunerForceAim} setForceAim={setGunTunerForceAim} mode={gunTunerMode} setMode={setGunTunerMode} gizmoEnabled={gunTunerEnabled} setGizmoEnabled={setGunTunerEnabled} onClose={() => setGunEditorOpen(false)} />
        ) : (
          <GunTunerGUI gunName="Lazer Rifle (3P)" pos={gunTunerPos} setPos={setGunTunerPos} rot={gunTunerRot} setRot={setGunTunerRot} scale={gunTunerScale} setScale={setGunTunerScale} forceVisible={gunTunerForceVisible} setForceVisible={setGunTunerForceVisible} forceAim={gunTunerForceAim} setForceAim={setGunTunerForceAim} mode={gunTunerMode} setMode={setGunTunerMode} gizmoEnabled={gunTunerEnabled} setGizmoEnabled={setGunTunerEnabled} onClose={() => setGunEditorOpen(false)} />
        )
      )}

      {/* ── Jetpack Transform Editor (toggle button + panel) ── */}
      {!jetpackEditorOpen && (
        <button
          onClick={() => setJetpackEditorOpen(true)}
          style={{
            position:'absolute', top:110, left:10, zIndex:99999,
            background:'rgba(0,0,0,0.85)', border:'1px solid rgba(255,120,0,0.3)',
            color:'#ff7700', borderRadius:8, padding:'6px 14px', cursor:'pointer',
            fontSize:12, fontFamily:'monospace', pointerEvents:'auto',
            boxShadow:'0 0 10px rgba(255,120,0,0.1)'
          }}
        >&#128640; Jetpack Editor</button>
      )}
      {jetpackEditorOpen && (<>
        <GunTunerGUI
          gunName="Jetpack"
          pos={jetpackTunerPos} setPos={setJetpackTunerPos}
          rot={jetpackTunerRot} setRot={setJetpackTunerRot}
          scale={jetpackTunerScale} setScale={setJetpackTunerScale}
          forceVisible={jetpackTunerForceVisible} setForceVisible={setJetpackTunerForceVisible}
          forceAim={false} setForceAim={() => {}}
          mode={jetpackTunerMode} setMode={setJetpackTunerMode}
          gizmoEnabled={jetpackTunerEnabled} setGizmoEnabled={setJetpackTunerEnabled}
          onClose={() => setJetpackEditorOpen(false)}
          panelLeft={340}
          accentColor="#ff7700"
        />
        {/* Flame offset mini-panel */}
        <div
          style={{
            position:'absolute', top:520, left:340, minWidth:310, padding:14,
            background:'rgba(0,0,0,0.92)', color:'#ff7700',
            borderRadius:10, zIndex:99999, fontSize:13, fontFamily:'monospace',
            pointerEvents:'auto', userSelect:'none',
            border:'1px solid rgba(255,120,0,0.3)',
            boxShadow:'0 0 20px rgba(255,120,0,0.15)',
          }}
          onMouseDown={e => { e.stopPropagation(); if (document.pointerLockElement) document.exitPointerLock(); }}
          onClick={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
        >
          <div style={{ fontWeight:'bold', color:'#fff', fontSize:13, marginBottom:6, borderBottom:'1px solid #333', paddingBottom:4 }}>
            \uD83D\uDD25 Flame Position <span style={{color:'#888',fontWeight:'normal',fontSize:10}}>(local to jetpack)</span>
          </div>
          {['X','Y','Z'].map((axis, ai) => (
            <div key={axis} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
              <span style={{ width:32, textAlign:'right', color:'#888', fontSize:11 }}>{axis}</span>
              <button style={{ background:'transparent', border:'1px solid #f55', color:'#f55', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...jetpackFlamePos]; n[ai] -= 1; setJetpackFlamePos(n); }}>--</button>
              <button style={{ background:'transparent', border:'1px solid #f99', color:'#f99', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...jetpackFlamePos]; n[ai] -= 0.5; setJetpackFlamePos(n); }}>-</button>
              <input type="number" step="0.5" value={parseFloat(jetpackFlamePos[ai].toFixed(2))}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const n = [...jetpackFlamePos]; n[ai] = v; setJetpackFlamePos(n); } }}
                onFocus={() => { if (document.pointerLockElement) document.exitPointerLock(); }}
                style={{ width:68, background:'#111', border:'1px solid #444', color:'#ff7700', borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace', textAlign:'center', outline:'none' }}
              />
              <button style={{ background:'transparent', border:'1px solid #9f9', color:'#9f9', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...jetpackFlamePos]; n[ai] += 0.5; setJetpackFlamePos(n); }}>+</button>
              <button style={{ background:'transparent', border:'1px solid #5f5', color:'#5f5', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...jetpackFlamePos]; n[ai] += 1; setJetpackFlamePos(n); }}>++</button>
            </div>
          ))}
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:6 }}>
            <span style={{ width:60, textAlign:'right', color:'#888', fontSize:11 }}>Spread</span>
            <button style={{ background:'transparent', border:'1px solid #f99', color:'#f99', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setJetpackFlameSpread(s => Math.max(0, s - 0.5))}>-</button>
            <input type="number" step="0.5" value={parseFloat(jetpackFlameSpread.toFixed(2))}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setJetpackFlameSpread(Math.max(0,v)); }}
              onFocus={() => { if (document.pointerLockElement) document.exitPointerLock(); }}
              style={{ width:68, background:'#111', border:'1px solid #444', color:'#ff7700', borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace', textAlign:'center', outline:'none' }}
            />
            <button style={{ background:'transparent', border:'1px solid #9f9', color:'#9f9', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setJetpackFlameSpread(s => s + 0.5)}>+</button>
          </div>
          <div style={{ background:'#0a0a0a', border:'1px solid #333', borderRadius:5, padding:5, marginTop:6 }}>
            <div style={{ color:'#ff0', fontSize:10, lineHeight:'1.4' }}>
              flamePos=[{jetpackFlamePos.map(v=>v.toFixed(1)).join(', ')}] spread={jetpackFlameSpread.toFixed(1)}
            </div>
          </div>
        </div>
      </>)}

      {/* ── Turret Top Offset Editor (toggle button + panel) ── */}
      {!turretEditorOpen && (
        <button
          onClick={() => setTurretEditorOpen(true)}
          style={{
            position:'absolute', top:150, left:10, zIndex:99999,
            background:'rgba(0,0,0,0.85)', border:'1px solid rgba(0,200,255,0.3)',
            color:'#00c8ff', borderRadius:8, padding:'6px 14px', cursor:'pointer',
            fontSize:12, fontFamily:'monospace', pointerEvents:'auto',
            boxShadow:'0 0 10px rgba(0,200,255,0.1)'
          }}
        >&#128299; Turret Editor</button>
      )}
      {turretEditorOpen && (
        <div
          style={{
            position:'absolute', top:70, left:680, minWidth:320, padding:14,
            background:'rgba(0,0,0,0.92)', color:'#00c8ff',
            borderRadius:10, zIndex:99999, fontSize:13, fontFamily:'monospace',
            pointerEvents:'auto', userSelect:'none',
            border:'1px solid rgba(0,200,255,0.3)',
            boxShadow:'0 0 20px rgba(0,200,255,0.15)',
          }}
          onMouseDown={e => { e.stopPropagation(); if (document.pointerLockElement) document.exitPointerLock(); }}
          onClick={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
        >
          {/* TITLE BAR */}
          <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
            <span style={{ color:'#00c8ff', fontSize:14, marginRight:6 }}>&#128299;</span>
            <span style={{ fontWeight:'bold', color:'#fff', fontSize:14, flex:1 }}>Turret Top Offset</span>
            <button
              onClick={() => setTurretEditorOpen(false)}
              style={{ background:'transparent', border:'1px solid #555', color:'#f55', borderRadius:4, padding:'1px 8px', cursor:'pointer', fontSize:12, fontFamily:'monospace' }}
              title="Close"
            >&times;</button>
          </div>

          {/* FREEZE TOGGLE */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, justifyContent:'center' }}>
            <label style={{ cursor:'pointer', color: turretFreezeRotation ? '#0f0' : '#f55', fontSize:12 }}>
              <input type="checkbox" checked={turretFreezeRotation} onChange={e => setTurretFreezeRotation(e.target.checked)} style={{ marginRight:4, cursor:'pointer' }} />
              Freeze Rotation
            </label>
          </div>

          {/* POSITION OFFSET */}
          <div style={{ fontWeight:'bold', color:'#fff', fontSize:13, marginBottom:4, borderBottom:'1px solid #333', paddingBottom:3 }}>
            Position Offset
          </div>
          {['X','Y','Z'].map((axis, ai) => (
            <div key={axis} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
              <span style={{ width:32, textAlign:'right', color:'#888', fontSize:11 }}>{axis}</span>
              <button style={{ background:'transparent', border:'1px solid #f55', color:'#f55', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetPos]; n[ai] -= 1; setTurretTopOffsetPos(n); }}>--</button>
              <button style={{ background:'transparent', border:'1px solid #f99', color:'#f99', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetPos]; n[ai] -= 0.1; setTurretTopOffsetPos(n); }}>-</button>
              <input type="number" step="0.1" value={parseFloat(turretTopOffsetPos[ai].toFixed(3))}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const n = [...turretTopOffsetPos]; n[ai] = v; setTurretTopOffsetPos(n); } }}
                onFocus={() => { if (document.pointerLockElement) document.exitPointerLock(); }}
                style={{ width:72, background:'#111', border:'1px solid #444', color:'#00c8ff', borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace', textAlign:'center', outline:'none' }}
              />
              <button style={{ background:'transparent', border:'1px solid #9f9', color:'#9f9', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetPos]; n[ai] += 0.1; setTurretTopOffsetPos(n); }}>+</button>
              <button style={{ background:'transparent', border:'1px solid #5f5', color:'#5f5', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetPos]; n[ai] += 1; setTurretTopOffsetPos(n); }}>++</button>
            </div>
          ))}

          {/* ROTATION OFFSET */}
          <div style={{ fontWeight:'bold', color:'#fff', fontSize:13, marginTop:8, marginBottom:4, borderBottom:'1px solid #333', paddingBottom:3 }}>
            Rotation Offset <span style={{color:'#888',fontWeight:'normal',fontSize:10}}>(radians)</span>
          </div>
          {['RX','RY','RZ'].map((axis, ai) => (
            <div key={axis} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
              <span style={{ width:32, textAlign:'right', color:'#888', fontSize:11 }}>{axis}</span>
              <button style={{ background:'transparent', border:'1px solid #f55', color:'#f55', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetRot]; n[ai] -= 0.1; setTurretTopOffsetRot(n); }}>--</button>
              <button style={{ background:'transparent', border:'1px solid #f99', color:'#f99', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetRot]; n[ai] -= 0.01; setTurretTopOffsetRot(n); }}>-</button>
              <input type="number" step="0.01" value={parseFloat(turretTopOffsetRot[ai].toFixed(4))}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const n = [...turretTopOffsetRot]; n[ai] = v; setTurretTopOffsetRot(n); } }}
                onFocus={() => { if (document.pointerLockElement) document.exitPointerLock(); }}
                style={{ width:72, background:'#111', border:'1px solid #444', color:'#00c8ff', borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace', textAlign:'center', outline:'none' }}
              />
              <button style={{ background:'transparent', border:'1px solid #9f9', color:'#9f9', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetRot]; n[ai] += 0.01; setTurretTopOffsetRot(n); }}>+</button>
              <button style={{ background:'transparent', border:'1px solid #5f5', color:'#5f5', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
                onClick={() => { const n = [...turretTopOffsetRot]; n[ai] += 0.1; setTurretTopOffsetRot(n); }}>++</button>
            </div>
          ))}

          {/* SCALE */}
          <div style={{ fontWeight:'bold', color:'#fff', fontSize:13, marginTop:8, marginBottom:4, borderBottom:'1px solid #333', paddingBottom:3 }}>
            Scale
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
            <span style={{ width:32, textAlign:'right', color:'#888', fontSize:11 }}>S</span>
            <button style={{ background:'transparent', border:'1px solid #f55', color:'#f55', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setTurretTopOffsetScale(s => Math.max(0.01, s - 0.1))}>--</button>
            <button style={{ background:'transparent', border:'1px solid #f99', color:'#f99', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setTurretTopOffsetScale(s => Math.max(0.01, s - 0.01))}>-</button>
            <input type="number" step="0.01" value={parseFloat(turretTopOffsetScale.toFixed(4))}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setTurretTopOffsetScale(v); }}
              onFocus={() => { if (document.pointerLockElement) document.exitPointerLock(); }}
              style={{ width:72, background:'#111', border:'1px solid #444', color:'#00c8ff', borderRadius:4, padding:'2px 5px', fontSize:12, fontFamily:'monospace', textAlign:'center', outline:'none' }}
            />
            <button style={{ background:'transparent', border:'1px solid #9f9', color:'#9f9', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setTurretTopOffsetScale(s => s + 0.01)}>+</button>
            <button style={{ background:'transparent', border:'1px solid #5f5', color:'#5f5', borderRadius:3, padding:'1px 5px', cursor:'pointer', fontSize:10, fontFamily:'monospace' }}
              onClick={() => setTurretTopOffsetScale(s => s + 0.1)}>++</button>
          </div>

          {/* RESET BUTTON */}
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <button
              onClick={() => { setTurretTopOffsetPos([0,0,0]); setTurretTopOffsetRot([0,0,0]); setTurretTopOffsetScale(1.0); }}
              style={{ flex:1, padding:'5px 0', background:'#111', color:'#f55', border:'1px solid #f55', borderRadius:4, cursor:'pointer', fontSize:11, fontFamily:'monospace' }}
            >Reset All</button>
          </div>

          {/* VALUES READOUT */}
          <div style={{ background:'#0a0a0a', border:'1px solid #333', borderRadius:5, padding:5, marginTop:8 }}>
            <div style={{ color:'#ff0', fontSize:10, lineHeight:'1.4' }}>
              pos=[{turretTopOffsetPos.map(v=>v.toFixed(2)).join(', ')}]
              {'\n'}rot=[{turretTopOffsetRot.map(v=>v.toFixed(3)).join(', ')}]
              {'\n'}scale={turretTopOffsetScale.toFixed(3)}
            </div>
          </div>
        </div>
      )}
      
      {/* Vehicle HUD and Interaction Prompts */}
      <VehicleHUD 
        speed={vehicleSystem.velocity.current.length()}
        altitude={vehicleSystem.vehiclePosition.current.y}
        throttle={vehicleSystem.velocity.current.length() / 150} // Normalized to max speed
        isInVehicle={vehicleSystem.isInVehicle}
      />
      <VehicleInteractionPrompt nearVehicle={vehicleSystem.nearVehicle} />
      
      {/* Settings Menu Overlay */}
      <SettingsMenu
        isOpen={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        settings={gameSettings}
        onSave={handleSettingsSave}
        onLiveUpdate={handleLiveSettingsUpdate}
      />

      {/* Character Select Menu Overlay */}
      <CharacterSelectMenu
        isOpen={charMenuOpen}
        onClose={onCharMenuClose || (() => {})}
        currentCharacter={myCharacterId}
        onSelect={onCharacterChange || (() => {})}
      />

      {/* Inventory Menu Overlay */}
      <InventoryMenu
        isOpen={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
      />
      
      {/* Edge Snap Confirmation Dialog */}
      {snapConfirmDialog && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.98)',
          border: '2px solid #0ea5e9',
          borderRadius: '16px',
          padding: '24px',
          zIndex: 10003,
          boxShadow: '0 20px 60px rgba(14, 165, 233, 0.4)',
          minWidth: '320px',
          maxWidth: '400px'
        }}>
          <div style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#0ea5e9',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            🔗 Edge Snapping Detected
          </div>
          
          <div style={{
            fontSize: '14px',
            color: '#cbd5e1',
            marginBottom: '20px',
            lineHeight: '1.6',
            whiteSpace: 'pre-line',
            textAlign: 'center'
          }}>
            {snapConfirmDialog.message}
          </div>
          
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={() => {
                // Apply the snap
                const cube = placedCubes.find(c => c.id === snapConfirmDialog.cubeId);
                if (cube) {
                  const snapInfo = snapConfirmDialog.snapInfo;
                  const newPosition = {
                    x: snapConfirmDialog.position.x + snapInfo.averageSnapOffset.x,
                    y: snapConfirmDialog.position.y + snapInfo.averageSnapOffset.y,
                    z: snapConfirmDialog.position.z + snapInfo.averageSnapOffset.z
                  };
                  
                  // Convert snapConnections to snappedEdges
                  const snappedEdges = {};
                  for (const [edgeName, connection] of Object.entries(snapInfo.snapConnections)) {
                    snappedEdges[edgeName] = connection.targetCubeId;
                  }
                  
                  // Update the snapping cube with new position AND clear old saved heights
                  // This forces geometry regeneration with new snap data
                  updateCubeAndSync(snapConfirmDialog.cubeId, {
                    position: newPosition,
                    snappedEdges: snappedEdges,
                    savedEdgeHeights: undefined // Clear old edge data, will regenerate with new snaps
                  });
                  
                  // Force re-render of neighbor terrains to ensure their edge heights are saved
                  // This ensures the snapped terrain can read the neighbor's edge data
                  for (const [edgeName, connection] of Object.entries(snapInfo.snapConnections)) {
                    const neighborCube = placedCubes.find(c => c.id === connection.targetCubeId);
                    if (neighborCube && neighborCube.isTerrain) {
                      // Trigger a tiny update to force geometry regeneration
                      updateCubeAndSync(connection.targetCubeId, {
                        terrainScale: neighborCube.terrainScale || 0.1
                      });
                    }
                  }
                }
                
                setSnapConfirmDialog(null);
                setPendingSnapCubeId(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: '#0ea5e9',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#0284c7'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#0ea5e9'}
            >
              ✓ Yes, Snap
            </button>
            
            <button
              onClick={() => {
                setSnapConfirmDialog(null);
                setPendingSnapCubeId(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(148, 163, 184, 0.2)',
                color: '#cbd5e1',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = 'rgba(148, 163, 184, 0.3)';
                e.target.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                e.target.style.color = '#cbd5e1';
              }}
            >
              ✗ No, Cancel
            </button>
          </div>
        </div>
      )}
      
      {/* AI Box Editor Panel */}
      {aiBoxEditorOpen && (() => {
        const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
        if (!selectedCube || !selectedCube.isAIBox) return null;
        
        const currentLabel = selectedCube.aiBoxLabel || '';
        const match = currentLabel.match(/AI Box #(\d+)/);
        const boxId = match ? match[1] : selectedCube.id;
        const hasContent = !!(selectedCube.aiContent || selectedCube.aiContentData);
        
        return (
          <div style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 20px)',
            right: '20px',
            backgroundColor: 'rgba(0, 20, 40, 0.95)',
            border: '2px solid rgba(0, 255, 255, 0.6)',
            borderRadius: '12px',
            padding: '16px',
            width: '320px',
            maxHeight: 'calc(100vh - var(--nav-height, 56px) - 40px)',
            overflowY: 'auto',
            zIndex: 10002,
            boxShadow: '0 8px 32px rgba(0, 255, 255, 0.3)',
            fontFamily: 'monospace',
            color: '#fff'
          }}>
            {/* Header */}
            <div style={{
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: '12px',
              color: '#00ffff',
              borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
              paddingBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>🤖 AI Box</span>
              <button
                onClick={() => {
                  setAIBoxEditorOpen(false);
                  setSelectedCubeId(null);
                }}
                style={{
                  background: 'rgba(255, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 0, 0, 0.5)',
                  color: '#ff6b6b',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Box ID (read-only) */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                AI Box ID
              </label>
              <div style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#00ffff',
                fontWeight: 'bold'
              }}>
                #{boxId}
              </div>
            </div>
            
            {/* Content Status */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                Content Status
              </label>
              <div style={{
                backgroundColor: hasContent ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 165, 0, 0.1)',
                border: hasContent ? '1px solid rgba(0, 255, 0, 0.4)' : '1px solid rgba(255, 165, 0, 0.4)',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '12px',
                color: hasContent ? '#00ff88' : '#ffaa00'
              }}>
                {hasContent ? '✓ Generated' : '⚠ Empty'}
              </div>
            </div>
            
            {/* Custom Title Input */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                Title (optional)
              </label>
              <input
                type="text"
                value={aiBoxEditTitle}
                onChange={(e) => setAIBoxEditTitle(e.target.value)}
                placeholder="e.g., Spaceship..."
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(0, 255, 255, 0.4)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0, 255, 255, 0.8)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(0, 255, 255, 0.4)'}
              />
              <div style={{
                fontSize: '10px',
                color: '#888',
                marginTop: '4px'
              }}>
                AI Box #{boxId}{aiBoxEditTitle.trim() ? ` - ${aiBoxEditTitle.trim()}` : ''}
              </div>
            </div>
            
            {/* AI Prompt Input */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                AI Prompt
              </label>
              <textarea
                value={aiBoxEditPrompt}
                onChange={(e) => setAIBoxEditPrompt(e.target.value)}
                placeholder="Describe what to generate..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 136, 0, 0.4)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  outline: 'none',
                  resize: 'vertical'
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(255, 136, 0, 0.8)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255, 136, 0, 0.4)'}
              />
              <div style={{
                fontSize: '10px',
                color: '#888',
                marginTop: '4px'
              }}>
                Use /ai{boxId} to generate
              </div>
            </div>
            
            {/* Save Button */}
            <button
              onClick={handleSaveAIBoxTitle}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'rgba(0, 255, 136, 0.2)',
                border: '2px solid rgba(0, 255, 136, 0.6)',
                borderRadius: '6px',
                color: '#00ff88',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontFamily: 'monospace',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = 'rgba(0, 255, 136, 0.3)';
                e.target.style.borderColor = 'rgba(0, 255, 136, 0.9)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = 'rgba(0, 255, 136, 0.2)';
                e.target.style.borderColor = 'rgba(0, 255, 136, 0.6)';
              }}
            >
              💾 Save
            </button>
            
            {/* Note */}
            <div style={{
              marginTop: '12px',
              padding: '8px',
              backgroundColor: 'rgba(0, 255, 136, 0.1)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              color: '#00ff88'
            }}>
              ℹ️ Server restarts after saving
            </div>
          </div>
        );
      })()}
      
      {/* Save Notification */}
      {saveNotification && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 255, 136, 0.95)',
          color: '#000',
          padding: '15px 30px',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          zIndex: 10001,
          boxShadow: '0 4px 20px rgba(0, 255, 136, 0.6)',
          animation: 'fadeInOut 2s ease-in-out',
          pointerEvents: 'none'
        }}>
          Settings Saved!
        </div>
      )}
      
      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes scaleIn {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders when parent updates
// This stops opponent avatars from resetting when unrelated UI elements (menus, chat, toggles) are clicked
export default React.memo(ConnectFour3DView);

