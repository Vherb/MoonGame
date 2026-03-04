// LoadingScreen.jsx — HTML overlay that gates gameplay until assets are loaded.
// Uses drei's useProgress to track Three.js asset loading progress.
// Also pre-compiles all shaders after loading to eliminate first-move jank.

import React, { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useThree } from '@react-three/fiber';

/**
 * LoadingGate — renders inside the Canvas to track Three.js asset loading.
 * Waits for assets to stay at 100% for a sustained period, then pre-compiles
 * all shaders via gl.compile() before calling onReady().
 */
export function LoadingGate({ onReady }) {
  const { active, progress } = useProgress();
  const { gl, scene, camera } = useThree();
  const [done, setDone] = useState(false);
  const stableTimer = useRef(null);
  const readyFired = useRef(false);

  // Publish progress to window global so the HTML overlay can read it
  useEffect(() => {
    window.__CF_LOADING_PROGRESS__ = progress;
  }, [progress]);

  useEffect(() => {
    if (readyFired.current) return;

    const isComplete = !active && progress >= 100;

    if (isComplete) {
      // Require 100% to hold for 2 seconds — assets sometimes hit 100%
      // briefly then start loading more (nested Suspense boundaries).
      if (!stableTimer.current) {
        stableTimer.current = setTimeout(() => {
          if (readyFired.current) return;
          readyFired.current = true;

          // Pre-compile ALL shaders in the scene graph so the GPU doesn't
          // stutter when new materials come into view during gameplay.
          try {
            gl.compile(scene, camera);
          } catch (e) {
            console.warn('Shader pre-compilation skipped:', e);
          }

          setDone(true);
          onReady();
        }, 2000);
      }
    } else {
      // Progress dropped back below 100 — reset the timer
      if (stableTimer.current) {
        clearTimeout(stableTimer.current);
        stableTimer.current = null;
      }
    }

    return () => {
      // Cleanup only on unmount
    };
  }, [active, progress, gl, scene, camera, onReady]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (stableTimer.current) clearTimeout(stableTimer.current);
    };
  }, []);

  return null; // renders nothing in the 3D scene
}

/**
 * LoadingScreen — HTML overlay with animated progress bar.
 * Renders on top of the Canvas until loading completes.
 */
export default function LoadingScreen({ progress = 0, visible = true }) {
  const [opacity, setOpacity] = useState(1);
  const [display, setDisplay] = useState(true);

  useEffect(() => {
    if (!visible) {
      // Fade out
      setOpacity(0);
      const t = setTimeout(() => setDisplay(false), 600);
      return () => clearTimeout(t);
    } else {
      setDisplay(true);
      setOpacity(1);
    }
  }, [visible]);

  if (!display) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #0d1b2a 0%, #050a12 100%)',
      opacity,
      transition: 'opacity 0.6s ease',
      pointerEvents: visible ? 'all' : 'none',
    }}>
      {/* Logo / Title */}
      <div style={{
        fontSize: '2.5rem',
        fontWeight: 800,
        letterSpacing: '0.15em',
        color: '#e0e0e0',
        marginBottom: 8,
        textTransform: 'uppercase',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        textShadow: '0 0 30px rgba(99,102,241,0.4)',
      }}>
        MOON
      </div>

      {/* Subtitle */}
      <div style={{
        fontSize: '0.9rem',
        color: 'rgba(255,255,255,0.4)',
        marginBottom: 40,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
      }}>
        Loading World
      </div>

      {/* Progress bar container */}
      <div style={{
        width: 280,
        height: 4,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Filled portion */}
        <div style={{
          width: `${Math.min(progress, 100)}%`,
          height: '100%',
          borderRadius: 2,
          background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)',
          boxShadow: '0 0 12px rgba(99,102,241,0.5)',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Percentage */}
      <div style={{
        marginTop: 16,
        fontSize: '0.8rem',
        color: 'rgba(255,255,255,0.35)',
        fontFamily: 'monospace',
        letterSpacing: '0.1em',
      }}>
        {Math.round(progress)}%
      </div>

      {/* Animated dots */}
      <div style={{
        marginTop: 32,
        display: 'flex',
        gap: 8,
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#6366f1',
            opacity: 0.4,
            animation: `loadingDot 1.4s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes loadingDot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
