// CameraFollower.jsx — Module-level camera component (stable identity, no remounts)
// Extracted from ConnectFour3DView to prevent camera jitter when weapon state changes
// trigger parent re-renders. Being at module level means React keeps the same component
// identity across renders, so state/refs/event-listeners persist properly.

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ROWS, CELL, GAP, GROUND_CLEAR } from './constants';

// ── Over-the-shoulder aim constants (LT only, no permanent offset) ──
const AIM_SHOULDER_RIGHT = 8;   // camera shifts right when aiming so character is on left of screen
const AIM_TARGET_RIGHT = 8;     // look-at target also shifts right so crosshair points PAST character
const AIM_DISTANCE = 25;        // closer zoom when aiming
const AIM_HEIGHT_OFFSET = 2;    // slightly higher when aiming
const SHOULDER_BLEND_SPEED = 6.0; // ~0.17s to fully blend

export default function CameraFollower({
  firstPersonMode = false,
  fpCamHeight = 11,
  fpCamForward = 2,
  seedToken = 0,
  isPlayer2 = false,
  followRocket = false,
  rocketPositionRef = null,
  cameraDistance = 50,
  cameraHeight = 15,
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef();
  // Persist critical camera state in window globals so they survive across sessions
  const smoothPos = useRef(window.__CF_CAM_SMOOTH_POS__ || new THREE.Vector3());
  const verticalAngle = useRef(window.__CF_CAM_V_ANGLE__ ?? 0);
  const horizontalAngle = useRef(window.__CF_CAM_H_ANGLE__ ?? 0);
  const isDragging = useRef(false);
  const lastMouseX = useRef(0);
  const lastMouseY = useRef(0);
  const lastPosition = useRef(window.__CF_CAM_LAST_POS__ || { x: 0, z: 0 });
  const isMoving = useRef(false);
  const wasFollowingRocket = useRef(false);
  const camUpBlend = useRef(0);
  const smoothTarget = useRef(null);
  const lastCameraDistance = useRef(cameraDistance);
  const lastCameraHeight = useRef(cameraHeight);
  const isFirstFrame = useRef(true);
  const lastManualControlTime = useRef(0);
  const shoulderBlend = useRef(0); // 0 = hip, 1 = full over-the-shoulder aim

  // Detect when camera settings change and skip lerp to avoid snap effect
  const settingsChanged = useRef(false);
  useEffect(() => {
    if (lastCameraDistance.current !== cameraDistance || lastCameraHeight.current !== cameraHeight) {
      settingsChanged.current = true;
      lastCameraDistance.current = cameraDistance;
      lastCameraHeight.current = cameraHeight;
    }
  }, [cameraDistance, cameraHeight]);

  // Find the OrbitControls
  useEffect(() => {
    const scene = camera.parent;
    if (scene) {
      scene.traverse((obj) => {
        if (obj.isOrbitControls || (obj.constructor && obj.constructor.name === 'OrbitControls')) {
          controlsRef.current = obj;
        }
      });
    }
  }, [camera]);

  // Pointer lock state for FPS mode
  const isPointerLocked = useRef(false);
  const FPS_SENSITIVITY = 0.002;

  // Mouse/pointer-lock handling
  useEffect(() => {
    const canvas = gl.domElement;

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        if (firstPersonMode && !isPointerLocked.current) {
          canvas.requestPointerLock();
        } else if (!firstPersonMode) {
          isDragging.current = true;
          lastMouseX.current = e.clientX;
          lastMouseY.current = e.clientY;
        }
      }
    };

    const handleMouseMove = (e) => {
      if (isPointerLocked.current && firstPersonMode) {
        const deltaX = e.movementX || 0;
        const deltaY = e.movementY || 0;
        lastManualControlTime.current = Date.now();
        horizontalAngle.current -= deltaX * FPS_SENSITIVITY;
        const newVertical = verticalAngle.current + deltaY * FPS_SENSITIVITY;
        verticalAngle.current = Math.max(-1.4, Math.min(1.4, newVertical));
        return;
      }

      if (isDragging.current) {
        const deltaX = e.clientX - lastMouseX.current;
        const deltaY = e.clientY - lastMouseY.current;
        lastMouseX.current = e.clientX;
        lastMouseY.current = e.clientY;
        lastManualControlTime.current = Date.now();
        horizontalAngle.current -= deltaX * 0.005;
        if (followRocket) {
          verticalAngle.current -= deltaY * 0.003;
        } else {
          const newVertical = verticalAngle.current - deltaY * 0.003;
          verticalAngle.current = Math.max(-0.5, Math.min(1.22, newVertical));
        }
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const handlePointerLockChange = () => {
      isPointerLocked.current = (document.pointerLockElement === canvas);
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    };
  }, [gl, firstPersonMode, followRocket]);

  // Release pointer lock when leaving FPS mode
  // AND snap the orbit angle back to 0 so 3rd-person camera doesn't spin
  const prevFPV = useRef(firstPersonMode);
  useEffect(() => {
    if (prevFPV.current && !firstPersonMode) {
      // Was FPV, now 3rd person — reset orbit so camera is behind character
      horizontalAngle.current = 0;
      verticalAngle.current = 0;
      lastManualControlTime.current = 0; // allow auto-reset immediately
      settingsChanged.current = true;    // force instant camera snap (skip lerp)
      smoothTarget.current = null;       // reset look-at target so it recalculates
      if (isPointerLocked.current) {
        document.exitPointerLock();
      }
    }
    if (!firstPersonMode && isPointerLocked.current) {
      document.exitPointerLock();
    }
    prevFPV.current = firstPersonMode;
  }, [firstPersonMode]);

  // Initialize smooth position
  useEffect(() => {
    smoothPos.current.copy(camera.position);
  }, [camera, seedToken]);

  useFrame((_, dt) => {
    try {
      // Poll gamepad for camera control (right stick)
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gamepad = gamepads[0];

      if (gamepad) {
        const deadzone = 0.15;
        const rightX = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
        const rightY = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;

        if (rightX !== 0 || rightY !== 0) {
          lastManualControlTime.current = Date.now();

          // Horizontal: right stick orbits camera in FPV only
          // In 3PP, right stick turns the character (handled by PlayerMover)
          if (firstPersonMode && rightX !== 0) {
            horizontalAngle.current -= rightX * 2.0 * dt;
          }

          // Vertical: right stick up/down
          if (followRocket) {
            verticalAngle.current -= rightY * 2.0 * dt;
          } else {
            const newVertical = verticalAngle.current - rightY * 2.0 * dt;
            verticalAngle.current = Math.max(-0.5, Math.min(1.22, newVertical));
          }
        }
      }

      // Rocket following mode
      if (followRocket && rocketPositionRef && rocketPositionRef.current) {
        const rocketPos = rocketPositionRef.current;

        if (!wasFollowingRocket.current) {
          horizontalAngle.current = Math.PI;
          verticalAngle.current = 0;
          wasFollowingRocket.current = true;
        }

        const DISTANCE = 250;
        const HEIGHT_OFFSET = 100;
        const yaw = horizontalAngle.current;
        const pitch = verticalAngle.current;

        const camX = rocketPos.x + Math.sin(yaw) * Math.cos(pitch) * DISTANCE;
        const camY = rocketPos.y + HEIGHT_OFFSET + Math.sin(pitch) * DISTANCE;
        const camZ = rocketPos.z + Math.cos(yaw) * Math.cos(pitch) * DISTANCE;

        const desiredPos = new THREE.Vector3(camX, camY, camZ);
        const alpha = Math.min(1, dt * 0.5);
        smoothPos.current.lerp(desiredPos, alpha);
        camera.position.copy(smoothPos.current);
        camera.lookAt(rocketPos);

        const ctrl = controlsRef.current;
        if (ctrl && ctrl.target) {
          ctrl.target.copy(rocketPos);
          ctrl.update();
        }
        return;
      }

      if (wasFollowingRocket.current) {
        wasFollowingRocket.current = false;
      }

      // Normal character following mode
      const msg = window.__CF_LOCAL_AVATAR__;
      if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;

      // Detect if character is moving
      const distanceMoved = Math.sqrt(
        Math.pow(msg.x - lastPosition.current.x, 2) +
        Math.pow(msg.z - lastPosition.current.z, 2)
      );
      isMoving.current = distanceMoved > 0.1;
      lastPosition.current = { x: msg.x, z: msg.z };

      // Auto-reset camera orbit when moving (5s cooldown)
      const timeSinceManualControl = Date.now() - lastManualControlTime.current;
      const allowAutoReset = timeSinceManualControl > 5000;

      if (isMoving.current && !isDragging.current && allowAutoReset && !firstPersonMode) {
        verticalAngle.current = THREE.MathUtils.lerp(verticalAngle.current, 0, dt * 0.8);
        horizontalAngle.current = THREE.MathUtils.lerp(horizontalAngle.current, 0, dt * 0.8);
      }

      // Camera settings
      const lookUpAmount = Math.max(0, verticalAngle.current);
      let CAMERA_DISTANCE = firstPersonMode ? 0 : cameraDistance;
      if (!firstPersonMode) {
        CAMERA_DISTANCE -= lookUpAmount * 25;
      }
      const CAMERA_HEIGHT = firstPersonMode ? fpCamHeight : cameraHeight;

      // ── Sphere mode camera (smooth blend) ──
      const isSphereGrounded = !!(msg.sphereMode && msg.sphereGrounded && msg.sphereUp);
      const CAM_UP_BLEND_IN = 0.6;
      const CAM_UP_BLEND_OUT = 0.8;
      if (isSphereGrounded) {
        camUpBlend.current = Math.min(1, camUpBlend.current + CAM_UP_BLEND_IN * dt);
      } else {
        camUpBlend.current = Math.max(0, camUpBlend.current - CAM_UP_BLEND_OUT * dt);
      }
      if (msg.sphereUp && camUpBlend.current > 0.001) {
        const sUp = new THREE.Vector3(msg.sphereUp[0], msg.sphereUp[1], msg.sphereUp[2]);
        const flatUp = new THREE.Vector3(0, 1, 0);
        const blendedUp = flatUp.lerp(sUp, camUpBlend.current).normalize();
        camera.up.copy(blendedUp);
      } else {
        camera.up.set(0, 1, 0);
      }

      const isSphereMode = !!(msg.sphereMode && msg.sphereUp && msg.spherePlayerPos);
      if (isSphereMode) {
        const sUp = new THREE.Vector3(msg.sphereUp[0], msg.sphereUp[1], msg.sphereUp[2]);
        const playerPos3D = new THREE.Vector3(msg.spherePlayerPos[0], msg.spherePlayerPos[1], msg.spherePlayerPos[2]);
        const BODY_HEIGHT = 4.0;
        const targetPos = playerPos3D.clone().addScaledVector(sUp, BODY_HEIGHT);

        const yaw = (typeof msg.yaw === 'number') ? msg.yaw : 0;
        const behindYaw = isPlayer2 ? (yaw + Math.PI) : yaw;
        const totalYaw = behindYaw + horizontalAngle.current;

        const q1 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sUp);
        const q2 = new THREE.Quaternion().setFromAxisAngle(sUp, totalYaw);
        const sphereQ = q2.multiply(q1);
        const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(sphereQ);

        const lookUpAmountSphere = Math.max(0, verticalAngle.current);
        const heightAdj = CAMERA_HEIGHT - (lookUpAmountSphere * 10);
        const desiredCameraPos = targetPos.clone()
          .addScaledVector(sUp, heightAdj)
          .addScaledVector(camForward, -CAMERA_DISTANCE);

        const camSettled = camUpBlend.current;
        const lerpSpeed = 0.6 + camSettled * 2.4;
        let alpha = Math.min(1, dt * lerpSpeed);
        if (settingsChanged.current || isFirstFrame.current || firstPersonMode) {
          smoothPos.current.copy(desiredCameraPos);
          settingsChanged.current = false;
          isFirstFrame.current = false;
          alpha = 1;
        } else {
          smoothPos.current.lerp(desiredCameraPos, alpha);
        }
        camera.position.copy(smoothPos.current);

        if (!smoothTarget.current) smoothTarget.current = targetPos.clone();
        else smoothTarget.current.lerp(targetPos, alpha);

        if (firstPersonMode) {
          camera.lookAt(smoothTarget.current);
          window.__CF_FPS_CAMERA_YAW__ = totalYaw;
          window.__CF_FPS_CAM_POS__ = [smoothPos.current.x, smoothPos.current.y, smoothPos.current.z];
        } else {
          camera.lookAt(smoothTarget.current);
        }

        const ctrl = controlsRef.current;
        if (ctrl && !firstPersonMode) {
          ctrl.target.lerp(smoothTarget.current, alpha);
          ctrl.update();
        }

        window.__CF_CAM_H_ANGLE__ = horizontalAngle.current;
        window.__CF_CAM_V_ANGLE__ = verticalAngle.current;
        window.__CF_CAM_SMOOTH_POS__ = smoothPos.current;
        window.__CF_CAM_LAST_POS__ = lastPosition.current;
        return;
      }

      // ── Flat-world camera ──

      const feetLift = Number(msg.lift || 0);
      const baseY = ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 - GROUND_CLEAR;
      const lookAtY = baseY + feetLift + 1.5;

      const tiltUpAmount = lookUpAmount * 15;
      const targetPos = new THREE.Vector3(msg.x, lookAtY + tiltUpAmount, msg.z);

      const yaw = (typeof msg.yaw === 'number') ? msg.yaw : 0;
      const behindYaw = isPlayer2 ? (yaw + Math.PI) : yaw;
      const totalYaw = behindYaw + horizontalAngle.current;

      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);

      // ── Over-the-shoulder aim blend ──
      const isAimingNow = !firstPersonMode && !!(msg.isScoping || msg.isAiming);
      if (isAimingNow) {
        shoulderBlend.current = Math.min(1, shoulderBlend.current + SHOULDER_BLEND_SPEED * dt);
      } else {
        shoulderBlend.current = Math.max(0, shoulderBlend.current - SHOULDER_BLEND_SPEED * dt);
      }
      const sb = shoulderBlend.current;

      // Height computation
      const heightAdjustment = CAMERA_HEIGHT - (lookUpAmount * 10);
      const cameraPosY = firstPersonMode
        ? (baseY + feetLift + CAMERA_HEIGHT)
        : (lookAtY + heightAdjustment + sb * AIM_HEIGHT_OFFSET);
      const baseDist = CAMERA_DISTANCE * Math.cos(verticalAngle.current);
      const aimDist = AIM_DISTANCE * Math.cos(verticalAngle.current);
      const forwardOffset = firstPersonMode ? fpCamForward : -(baseDist + sb * (aimDist - baseDist));
      const desiredCameraPos = new THREE.Vector3(msg.x, cameraPosY, msg.z)
        .addScaledVector(forward, forwardOffset);

      // ── Over-the-shoulder aim (LT only) ──
      // No permanent offset — camera stays centered behind character normally.
      // When aiming (LT), shift camera AND look-at target to the right so the
      // character appears on the left side and crosshair points past them.
      if (sb > 0.001 && !firstPersonMode) {
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);
        desiredCameraPos.addScaledVector(right, AIM_SHOULDER_RIGHT * sb);
        // Also shift the look-at target right so crosshair points PAST the character
        targetPos.addScaledVector(right, AIM_TARGET_RIGHT * sb);
      }

      // Smooth lerp — fast Y for airborne, smooth XZ
      const isAirborne = !!(msg.isJetpacking || msg.isJumping);
      const baseAlpha = dt * 3.0;
      const vertAlpha = isAirborne ? dt * 18.0 : dt * 8.0;
      let alpha = Math.min(1, baseAlpha);
      let alphaY = Math.min(1, vertAlpha);
      if (settingsChanged.current || isFirstFrame.current || firstPersonMode) {
        smoothPos.current.copy(desiredCameraPos);
        settingsChanged.current = false;
        isFirstFrame.current = false;
        alpha = 1;
        alphaY = 1;
      } else {
        smoothPos.current.x += (desiredCameraPos.x - smoothPos.current.x) * alpha;
        smoothPos.current.z += (desiredCameraPos.z - smoothPos.current.z) * alpha;
        smoothPos.current.y += (desiredCameraPos.y - smoothPos.current.y) * alphaY;
      }
      camera.position.copy(smoothPos.current);

      if (!smoothTarget.current) smoothTarget.current = targetPos.clone();
      else {
        smoothTarget.current.x += (targetPos.x - smoothTarget.current.x) * alpha;
        smoothTarget.current.z += (targetPos.z - smoothTarget.current.z) * alpha;
        smoothTarget.current.y += (targetPos.y - smoothTarget.current.y) * alphaY;
      }

      if (firstPersonMode) {
        camera.rotation.order = 'YXZ';
        camera.rotation.y = behindYaw + horizontalAngle.current;
        camera.rotation.x = verticalAngle.current;
        camera.rotation.z = 0;
        window.__CF_FPS_CAMERA_YAW__ = totalYaw;
        window.__CF_FPS_CAM_POS__ = [smoothPos.current.x, smoothPos.current.y, smoothPos.current.z];
      } else {
        camera.lookAt(smoothTarget.current);
        window.__CF_3RD_CAMERA_YAW__ = totalYaw;
        window.__CF_3RD_CAMERA_PITCH__ = verticalAngle.current;
        window.__CF_3RD_SHOULDER_BLEND__ = shoulderBlend.current;
        window.__CF_3RD_CAM_POS__ = [smoothPos.current.x, smoothPos.current.y, smoothPos.current.z];
        window.__CF_3RD_CAM_TARGET__ = [smoothTarget.current.x, smoothTarget.current.y, smoothTarget.current.z];
      }

      const ctrl = controlsRef.current;
      if (ctrl) {
        if (firstPersonMode) {
          // FPS mode: skip ctrl.update()
        } else {
          ctrl.target.x += (smoothTarget.current.x - ctrl.target.x) * alpha;
          ctrl.target.z += (smoothTarget.current.z - ctrl.target.z) * alpha;
          ctrl.target.y += (smoothTarget.current.y - ctrl.target.y) * alphaY;
          ctrl.update();
        }
      }

      window.__CF_CAM_H_ANGLE__ = horizontalAngle.current;
      window.__CF_CAM_V_ANGLE__ = verticalAngle.current;
      window.__CF_CAM_SMOOTH_POS__ = smoothPos.current;
      window.__CF_CAM_LAST_POS__ = lastPosition.current;
    } catch (e) {
      console.error('CameraFollower error:', e);
    }
  });

  return null;
}
