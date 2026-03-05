// GamepadHUD.jsx — Contextual gamepad button hints overlay
// Shows relevant controller button prompts based on game state.
// Only visible when a gamepad is connected.
// Renders as HTML outside the R3F <Canvas>.

import React, { useState, useEffect, useRef } from 'react';

/* ================================================================
   Xbox-style button badge components
   ================================================================ */
const BTN_COLORS = {
  A: '#22c55e', // green
  B: '#ef4444', // red
  X: '#3b82f6', // blue
  Y: '#eab308', // yellow
  LB: '#94a3b8',
  RB: '#94a3b8',
  LT: '#94a3b8',
  RT: '#94a3b8',
  R3: '#94a3b8',
  L3: '#94a3b8',
  DU: '#94a3b8', // D-pad up
  DD: '#94a3b8',
  DL: '#94a3b8',
  DR: '#94a3b8',
  LS: '#94a3b8', // Left Stick
  RS: '#94a3b8', // Right Stick
};

const btnStyle = (color) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: color,
  color: '#000',
  fontWeight: 'bold',
  fontSize: 10,
  borderRadius: 4,
  padding: '1px 5px',
  minWidth: 18,
  height: 18,
  lineHeight: '18px',
  marginRight: 3,
  textShadow: 'none',
  boxShadow: `0 0 4px ${color}66`,
});

function Btn({ name }) {
  const color = BTN_COLORS[name] || '#94a3b8';
  return <span style={btnStyle(color)}>{name}</span>;
}

/* ================================================================
   Control hint entry
   ================================================================ */
function Hint({ btn, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      whiteSpace: 'nowrap', marginRight: 14,
    }}>
      <Btn name={btn} />
      <span style={{ opacity: 0.85, fontSize: 11 }}>{label}</span>
    </div>
  );
}

function Separator() {
  return <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.2)', margin: '0 6px' }} />;
}

/* ================================================================
   Control sets for different game states
   ================================================================ */
const NORMAL_HINTS = [
  { btn: 'LS', label: 'Move' },
  { btn: 'RS', label: 'Look' },
  { btn: 'A', label: 'Jump / Fly' },
  { btn: 'L3', label: 'Sprint' },
  { btn: 'RT', label: 'Shoot' },
  { btn: 'LT', label: 'Aim' },
  { btn: 'R3', label: 'Build' },
];

const JETPACK_HINTS = [
  { btn: 'LS', label: 'Move' },
  { btn: 'RS', label: 'Look' },
  { btn: 'A', label: 'Thrust (hold)' },
  { btn: 'RT', label: 'Shoot' },
  { btn: 'LT', label: 'Aim' },
];

const BUILD_HINTS = [
  { btn: 'A', label: 'Place' },
  { btn: 'X', label: 'Destroy' },
  { btn: 'LB', label: 'Rot ←' },
  { btn: 'RB', label: 'Rot →' },
  { btn: 'DL', label: 'Prev' },
  { btn: 'DR', label: 'Next' },
  { btn: 'R3', label: 'Exit Build' },
];

const PICKUP_HINT = { btn: 'A', label: 'Pick Up' };
const INTERACT_HINT = { btn: 'X', label: 'Interact' };

/* ================================================================
   GamepadHUD component
   ================================================================ */
export default function GamepadHUD() {
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [hints, setHints] = useState(NORMAL_HINTS);
  const [extraHints, setExtraHints] = useState([]);
  const prevStateRef = useRef('normal');

  // Detect gamepad connection
  useEffect(() => {
    const check = () => {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const connected = Array.from(gps).some(g => g && g.connected);
      setGamepadConnected(connected);
    };
    const onConnect = () => setGamepadConnected(true);
    const onDisconnect = () => {
      // Re-check — another pad might still be connected
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const still = Array.from(gps).some(g => g && g.connected);
      setGamepadConnected(still);
    };
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    check();
    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }, []);

  // Poll game state to pick the right hint set
  useEffect(() => {
    if (!gamepadConnected) return;
    let raf;
    const poll = () => {
      const building = window.__CF_BUILDING_STATE__;
      const avatar = window.__CF_LOCAL_AVATAR__;
      const equipPickup = window.__CF_EQUIPMENT_PICKUP_STATE__;
      const resource = window.__CF_RESOURCE_STATE__;

      let newState = 'normal';
      if (building?.buildMode) {
        newState = 'build';
      } else if (avatar?.isJetpacking) {
        newState = 'jetpack';
      }

      if (newState !== prevStateRef.current) {
        prevStateRef.current = newState;
        switch (newState) {
          case 'build':    setHints(BUILD_HINTS);   break;
          case 'jetpack':  setHints(JETPACK_HINTS); break;
          default:         setHints(NORMAL_HINTS);  break;
        }
      }

      // Extra contextual hints (pickup prompts)
      const extras = [];
      if (equipPickup?.inRange && !equipPickup?.hasJetpack) {
        extras.push(PICKUP_HINT);
      }
      if (resource?.nearestDistSq < 64) { // 8^2 = PICKUP_RANGE
        extras.push(INTERACT_HINT);
      }
      setExtraHints(extras);

      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [gamepadConnected]);

  if (!gamepadConnected) return null;

  const allHints = extraHints.length > 0 ? [...hints, ...extraHints] : hints;

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      background: 'rgba(0,0,0,0.7)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8,
      padding: '6px 14px',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: 11,
      pointerEvents: 'none',
      zIndex: 8500,
      backdropFilter: 'blur(4px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    }}>
      {allHints.map((h, i) => (
        <React.Fragment key={h.btn + h.label}>
          {i > 0 && i === hints.length && extraHints.length > 0 && <Separator />}
          <Hint btn={h.btn} label={h.label} />
        </React.Fragment>
      ))}
    </div>
  );
}
