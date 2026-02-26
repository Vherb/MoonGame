/* src/components/rooms/RoomView.jsx
   In-room experience — full 3D world with overlay UI (sidebar, chat, challenges).
   Route: /room/:code
*/
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConnectFour3DView from '../games/ConnectFour3D/ConnectFour3DView';
import './RoomView.css';

/* ---- WS URL builder ---- */
function getRoomWsUrl() {
  try {
    const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
    const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : '');
    let lsHost = '';
    try { lsHost = (localStorage.getItem('serverHost') || '').trim(); } catch {}
    const host = envHost || winHost || lsHost || ((window.location && window.location.hostname) || 'localhost');
    const proto = (window.location && window.location.protocol === 'https:') ? 'wss' : 'ws';
    if (process.env.REACT_APP_UNIFIED_WS === '1') {
      const httpProto = (window.location && window.location.protocol) || 'http:';
      const apiBase = (process.env.REACT_APP_API_BASE && process.env.REACT_APP_API_BASE.trim()) || `${httpProto}//${host}:3002`;
      let u; try { u = new URL(apiBase); } catch { u = { host: `${host}:3002` }; }
      return `${proto}://${u.host}/ws/room`;
    }
    return `${proto}://${host}:3002/ws/room`;
  } catch { return 'ws://localhost:3002/ws/room'; }
}

/* Empty board for when no game is active */
const EMPTY_BOARD = Array.from({ length: 6 }, () => Array(7).fill(null));
const DEFAULT_COLORS = { 'Player 1': '#6366f1', 'Player 2': '#f43f5e' };

export default function RoomView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  /* ---- Auth gate: must be logged in ---- */
  const token = localStorage.getItem('token');
  const loggedInUser = localStorage.getItem('username');
  useEffect(() => {
    if (!token || !loggedInUser) {
      navigate('/registration', { replace: true });
    }
  }, [token, loggedInUser, navigate]);

  // State
  const [connected, setConnected] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState(code || '');
  const [mySocketId, setMySocketId] = useState('');
  const [players, setPlayers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [charMenuOpen, setCharMenuOpen] = useState(true); // opens on room entry

  // Challenge state
  const [pendingChallenge, setPendingChallenge] = useState(null);
  const [sentChallenge, setSentChallenge] = useState(null);

  // Game state
  const [activeGame, setActiveGame] = useState(null);
  const [myPlayerNumber, setMyPlayerNumber] = useState(null);

  const username = localStorage.getItem('username') || 'Player';
  const [myCharacter, setMyCharacter] = useState(localStorage.getItem('character') || 'astronaut');
  const chatEndRef = useRef(null);
  const mySocketIdRef = useRef('');

  // Keep ref in sync
  useEffect(() => { mySocketIdRef.current = mySocketId; }, [mySocketId]);

  // Initialize multi-player avatar store
  useEffect(() => {
    if (!window.__CF_REMOTE_AVATARS__) window.__CF_REMOTE_AVATARS__ = {};
    return () => {
      // Clean up on unmount
      window.__CF_REMOTE_AVATARS__ = {};
    };
  }, []);

  /* ---- WebSocket connection ---- */
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(getRoomWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError('');
      ws.send(JSON.stringify({
        type: 'joinRoom',
        code: code.toUpperCase(),
        username,
        userId: Number(localStorage.getItem('userId')) || null,
        character: myCharacter,
        avatar: localStorage.getItem('avatar') || 'rocket',
        color: localStorage.getItem('playerColor') || '#6366f1',
      }));
    };

    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }
      handleMessage(data);
    };

    ws.onerror = () => { setError('Connection error'); };

    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(() => connect(), 2000);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, username]);

  /* ---- Handle incoming messages ---- */
  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'roomJoined':
        setRoomName(data.name);
        setRoomCode(data.code);
        setMySocketId(data.yourSocketId);
        setPlayers(data.players || []);

        // Propagate placed cubes from room snapshot to 3D view
        if (Array.isArray(data.placedCubes) && data.placedCubes.length > 0) {
          window.__CF_REMOTE_CUBES__ = data.placedCubes;
          window.__CF_REMOTE_CUBES_TIMESTAMP__ = Date.now();
          window.dispatchEvent(new CustomEvent('cf:cubes_update', { detail: { cubes: data.placedCubes } }));
        }

        // Propagate audio visualizers from room snapshot
        if (Array.isArray(data.audioVisualizers) && data.audioVisualizers.length > 0) {
          window.__CF_REMOTE_VISUALIZERS__ = data.audioVisualizers;
          window.dispatchEvent(new CustomEvent('cf:visualizers_update', { detail: { visualizers: data.audioVisualizers } }));
        }

        // Seed remote avatar positions so they appear at their actual location, not origin
        if (data.avatarPositions && typeof data.avatarPositions === 'object') {
          if (!window.__CF_REMOTE_AVATARS__) window.__CF_REMOTE_AVATARS__ = {};
          for (const [sid, pos] of Object.entries(data.avatarPositions)) {
            if (sid === data.yourSocketId) continue;
            if (Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
              window.__CF_REMOTE_AVATARS__[sid] = {
                x: pos.x, z: pos.z, ts: Date.now(),
                yaw: pos.yaw ?? 0, run: !!pos.run,
                isJumping: !!pos.isJumping, isJetpacking: !!pos.isJetpacking,
                isShooting: !!pos.isShooting, isAiming: !!pos.isAiming,
                isWalkingBackward: !!pos.isWalkingBackward, isStrafeLeft: !!pos.isStrafeLeft,
                isStrafeRight: !!pos.isStrafeRight, isDead: !!pos.isDead,
                tiltX: pos.tiltX ?? 0, tiltZ: pos.tiltZ ?? 0,
                pitch: pos.pitch ?? 0,
                lift: pos.lift ?? 0,
              };
            }
          }
        }
        break;

      case 'joinDenied':
        setError(data.error || 'Could not join room');
        break;

      case 'playerJoined':
        setPlayers(data.players || []);
        setMessages(prev => [...prev, { system: true, text: `${data.player?.username || 'Someone'} joined` }]);
        break;

      case 'playerLeft': {
        setPlayers(data.players || []);
        setMessages(prev => [...prev, { system: true, text: 'A player left the room' }]);
        // Clean up avatar data for the player who left
        if (data.socketId && window.__CF_REMOTE_AVATARS__) {
          delete window.__CF_REMOTE_AVATARS__[data.socketId];
        }
        break;
      }

      case 'playerUpdated':
        setPlayers(data.players || []);
        break;

      case 'chat':
        setMessages(prev => [...prev, { username: data.username, text: data.text, socketId: data.socketId }]);
        break;

      /* ---- Avatar / sandbox sync ---- */
      case 'avatarUpdate': {
        if (!window.__CF_REMOTE_AVATARS__) window.__CF_REMOTE_AVATARS__ = {};
        const sid = data.socketId;
        if (!sid || sid === mySocketIdRef.current) break;
        window.__CF_REMOTE_AVATARS__[sid] = {
          x: data.x,
          z: data.z,
          ts: data.ts || Date.now(),
          yaw: data.yaw,
          run: !!data.run,
          isJumping: !!data.isJumping,
          isJetpacking: !!data.isJetpacking,
          isShooting: !!data.isShooting,
          isAiming: !!data.isAiming,
          isWalkingBackward: !!data.isWalkingBackward,
          isStrafeLeft: !!data.isStrafeLeft,
          isStrafeRight: !!data.isStrafeRight,
          isDead: !!data.isDead,
          tiltX: data.tiltX || 0,
          tiltZ: data.tiltZ || 0,
          pitch: data.pitch || 0,
          lift: data.lift,
        };
        break;
      }

      /* ---- Weapon / shooting sync ---- */
      case 'remoteShoot': {
        // Another player fired — store their bullet for 3D view to render
        if (!window.__CF_REMOTE_BULLETS__) window.__CF_REMOTE_BULLETS__ = [];
        window.__CF_REMOTE_BULLETS__.push({
          id: `remote_${data.shooterId}_${Date.now()}_${Math.random()}`,
          position: data.position,
          direction: data.direction,
          speed: data.speed || 100,
          damage: data.damage || 25,
          ownerId: data.shooterId,
          weaponType: data.weaponType,
        });
        // Dispatch event so 3D view can pick it up
        window.dispatchEvent(new CustomEvent('cf:remote_shoot', { detail: data }));
        break;
      }

      case 'playerDamaged': {
        // Someone got hit — if it's us, take damage
        const myId = mySocketIdRef.current;
        if (data.targetId === myId) {
          // Dispatch event for the weapon system to handle
          window.dispatchEvent(new CustomEvent('cf:take_damage', { detail: { damage: data.damage || 25 } }));
        }
        break;
      }

      case 'cubes_sync':
        if (Array.isArray(data.cubes)) {
          window.__CF_REMOTE_CUBES__ = data.cubes;
          window.__CF_REMOTE_CUBES_TIMESTAMP__ = data.timestamp || Date.now();
          window.dispatchEvent(new CustomEvent('cf:cubes_update', { detail: { cubes: data.cubes } }));
        }
        break;

      case 'resource_collected':
      case 'resource_respawn':
        window.dispatchEvent(new CustomEvent('ws_resource_msg', { detail: data }));
        break;

      case 'build_place':
      case 'build_destroy':
        window.dispatchEvent(new CustomEvent('ws_building_msg', { detail: data }));
        break;

      case 'visualizers_sync':
        if (Array.isArray(data.visualizers)) {
          window.__CF_REMOTE_VISUALIZERS__ = data.visualizers;
          window.dispatchEvent(new CustomEvent('cf:visualizers_update', { detail: { visualizers: data.visualizers } }));
        }
        break;

      case 'transform_live':
        if (data.cubeId) {
          window.dispatchEvent(new CustomEvent('cf:transform_live', { detail: data }));
        }
        break;

      /* ---- Challenges ---- */
      case 'challengeReceived':
        setPendingChallenge({
          challengeId: data.challengeId,
          fromSocketId: data.fromSocketId,
          fromUsername: data.fromUsername,
        });
        break;

      case 'challengeSent':
        setSentChallenge(data.challengeId);
        break;

      case 'challengeDeclined':
        setSentChallenge(null);
        setMessages(prev => [...prev, { system: true, text: `${data.byUsername} declined your challenge` }]);
        break;

      case 'challengeError':
        setSentChallenge(null);
        setMessages(prev => [...prev, { system: true, text: `Challenge error: ${data.error}` }]);
        break;

      /* ---- Game ---- */
      case 'gameStarted':
        setActiveGame({
          gameId: data.gameId,
          board: data.board,
          currentPlayer: data.currentPlayer,
          winner: null,
          p1Username: data.p1Username,
          p2Username: data.p2Username,
          p1Color: data.p1Color,
          p2Color: data.p2Color,
          p1SocketId: data.p1SocketId,
          p2SocketId: data.p2SocketId,
        });
        setMyPlayerNumber(data.yourPlayerNumber);
        setPendingChallenge(null);
        setSentChallenge(null);
        break;

      case 'gameUpdate':
        setActiveGame(prev => prev && prev.gameId === data.gameId ? {
          ...prev,
          board: data.board,
          currentPlayer: data.currentPlayer,
          winner: data.winner,
          lastMove: data.lastMove,
        } : prev);
        break;

      case 'rematchStart':
        setActiveGame(prev => prev && prev.gameId === data.gameId ? {
          ...prev,
          board: data.board,
          currentPlayer: data.currentPlayer,
          winner: null,
        } : prev);
        break;

      case 'rematchUpdate':
        break;

      case 'roomLeft':
        break;

      default:
        break;
    }
  }, []);

  /* ---- Mount / unmount ---- */
  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'leaveRoom' }));
          wsRef.current.close();
        } catch {}
      }
    };
  }, [connect]);

  /* ---- Auto-scroll chat ---- */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ---- Avatar movement callback (3D view → room WS) ---- */
  const handleAvatarMove = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Cube sync from 3D view
    if (msg && msg.type === 'cubes_sync' && Array.isArray(msg.cubes)) {
      try { ws.send(JSON.stringify({ type: 'cubes_sync', cubes: msg.cubes, timestamp: msg.timestamp || Date.now() })); } catch {}
      return;
    }

    // Visualizer sync from 3D view
    if (msg && msg.type === 'visualizers_sync' && Array.isArray(msg.visualizers)) {
      try { ws.send(JSON.stringify({ type: 'visualizers_sync', visualizers: msg.visualizers, timestamp: msg.timestamp || Date.now() })); } catch {}
      return;
    }

    // Sound upload notification
    if (msg && msg.type === 'sound_uploaded' && msg.filename) {
      try { ws.send(JSON.stringify({ type: 'sound_uploaded', filename: msg.filename, timestamp: msg.timestamp || Date.now() })); } catch {}
      return;
    }

    // Resource gathering sync
    if (msg && (msg.type === 'resource_collected' || msg.type === 'resource_respawn')) {
      try { ws.send(JSON.stringify({ type: msg.type, nodeId: msg.nodeId })); } catch {}
      return;
    }

    // Building system sync
    if (msg && msg.type === 'build_place') {
      try { ws.send(JSON.stringify({ type: 'build_place', piece: msg.piece })); } catch {}
      return;
    }
    if (msg && msg.type === 'build_destroy') {
      try { ws.send(JSON.stringify({ type: 'build_destroy', pieceId: msg.pieceId })); } catch {}
      return;
    }

    // Weapon shoot event from 3D view
    if (msg && msg.type === 'shoot') {
      try {
        ws.send(JSON.stringify({
          type: 'shoot',
          position: msg.position,
          direction: msg.direction,
          weaponType: msg.weaponType || 'pistol',
          speed: msg.speed,
          damage: msg.damage,
        }));
      } catch {}
      return;
    }

    // Player hit report from 3D view
    if (msg && msg.type === 'playerHit') {
      try {
        ws.send(JSON.stringify({
          type: 'playerHit',
          targetId: msg.targetId,
          damage: msg.damage,
          hitPosition: msg.hitPosition,
        }));
      } catch {}
      return;
    }

    // Regular avatar movement
    if (!msg || typeof msg.x !== 'number' || typeof msg.z !== 'number') return;
    try {
      const payload = { type: 'avatarMove', x: msg.x, z: msg.z };
      if (typeof msg.yaw === 'number') payload.yaw = msg.yaw;
      payload.run = !!msg.run;
      payload.isJumping = !!msg.isJumping;
      payload.isJetpacking = !!msg.isJetpacking;
      payload.isShooting = !!msg.isShooting;
      payload.isAiming = !!msg.isAiming;
      payload.isWalkingBackward = !!msg.isWalkingBackward;
      payload.isStrafeLeft = !!msg.isStrafeLeft;
      payload.isStrafeRight = !!msg.isStrafeRight;
      payload.isDead = !!msg.isDead;
      if (typeof msg.tiltX === 'number') payload.tiltX = msg.tiltX;
      if (typeof msg.tiltZ === 'number') payload.tiltZ = msg.tiltZ;
      if (typeof msg.pitch === 'number') payload.pitch = msg.pitch;
      if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) payload.lift = msg.lift;
      ws.send(JSON.stringify(payload));
    } catch {}
  }, []);

  /* ---- Actions ---- */
  const sendChat = () => {
    const text = chatText.trim();
    if (!text || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'chat', text }));
    setChatText('');
  };

  const challengePlayer = (targetSocketId) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'challengePlayer', targetSocketId }));
  };

  const acceptChallenge = () => {
    if (!wsRef.current || !pendingChallenge) return;
    wsRef.current.send(JSON.stringify({ type: 'acceptChallenge', challengeId: pendingChallenge.challengeId }));
    setPendingChallenge(null);
  };

  const declineChallenge = () => {
    if (!wsRef.current || !pendingChallenge) return;
    wsRef.current.send(JSON.stringify({ type: 'declineChallenge', challengeId: pendingChallenge.challengeId }));
    setPendingChallenge(null);
  };

  const makeMove = (col) => {
    if (!wsRef.current || !activeGame) return;
    wsRef.current.send(JSON.stringify({ type: 'makeMove', gameId: activeGame.gameId, col }));
  };

  const voteRematch = () => {
    if (!wsRef.current || !activeGame) return;
    wsRef.current.send(JSON.stringify({ type: 'rematchVote', gameId: activeGame.gameId }));
  };

  const leaveRoom = () => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'leaveRoom' })); } catch {}
    }
    navigate('/rooms');
  };

  const copyCode = () => {
    try {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  /* ---- Build remotePlayers array for 3D view (everyone except me) ---- */
  const remotePlayers = useMemo(() => {
    return players
      .filter(p => p.socketId !== mySocketId)
      .map(p => ({
        socketId: p.socketId,
        characterId: p.character || 'alien',
        name: p.username || 'Player',
      }));
  }, [players, mySocketId]);

  /* ---- Character change handler ---- */
  const handleCharacterChange = useCallback((charId) => {
    setMyCharacter(charId);
    localStorage.setItem('character', charId);
    // Notify server so other players see the update
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'updateProfile', character: charId }));
    }
  }, []);

  /* ---- 3D view props derived from game state ---- */
  const boardForView = activeGame ? activeGame.board : EMPTY_BOARD;
  const lastMoveForView = activeGame?.lastMove || null;
  const colorsForView = activeGame
    ? { 'Player 1': activeGame.p1Color, 'Player 2': activeGame.p2Color }
    : DEFAULT_COLORS;

  // Figure out opponent character for the 2-player game overlay in the 3D board
  const oppSocketId = activeGame
    ? (myPlayerNumber === 1 ? activeGame.p2SocketId : activeGame.p1SocketId)
    : null;
  const oppPlayer = oppSocketId ? players.find(p => p.socketId === oppSocketId) : null;
  const oppCharacterId = oppPlayer?.character || 'alien';
  const oppName = oppPlayer?.username || 'Opponent';

  /* ---- Render ---- */
  if (!connected && !error) {
    return <div className="rv-connecting">Connecting to {code}…</div>;
  }

  if (error && !connected) {
    return (
      <div className="rv-connecting">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
          <div>{error}</div>
          <button className="hub-btn hub-btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/rooms')}>
            ← Back to Rooms
          </button>
        </div>
      </div>
    );
  }

  // Don't render room if not logged in (will redirect via useEffect above)
  if (!token || !loggedInUser) return null;

  return (
    <div className="room-view room-view--3d">
      {/* ---- Full-screen 3D world ---- */}
      <div className="rv-3d-world">
        <ConnectFour3DView
          board={boardForView}
          lastMove={lastMoveForView}
          colors={colorsForView}
          myCharacterId={myCharacter}
          oppCharacterId={oppCharacterId}
          flip180={myPlayerNumber === 2}
          myName={username}
          oppName={oppName}
          onAvatarMove={handleAvatarMove}
          onSelectColumn={activeGame ? makeMove : undefined}
          remotePlayers={remotePlayers}
          charMenuOpen={charMenuOpen}
          onCharacterChange={handleCharacterChange}
          onCharMenuClose={() => setCharMenuOpen(false)}
        />
      </div>

      {/* ---- Overlay: top bar ---- */}
      <div className="rv-topbar rv-overlay">
        <div className="rv-topbar-left">
          <button className="rv-back-btn" onClick={leaveRoom} title="Leave room">←</button>
          <span className="rv-room-name">{roomName || 'Room'}</span>
          <span className="rv-room-code" onClick={copyCode} title="Click to copy">
            {copied ? '✓ Copied!' : roomCode}
          </span>
        </div>
        <div className="rv-topbar-right">
          <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
            {players.length} player{players.length !== 1 ? 's' : ''}
          </span>
          <button className="rv-icon-btn" onClick={() => setCharMenuOpen(v => !v)} title="Change Character">
            🎭
          </button>
          <button className="rv-icon-btn" onClick={() => setSidebarOpen(v => !v)} title="Players">
            👥
          </button>
          <button className="rv-icon-btn" onClick={() => setChatOpen(v => !v)} title="Chat">
            💬
          </button>
          <button className="rv-leave-btn" onClick={leaveRoom}>Leave</button>
        </div>
      </div>

      {/* ---- Overlay: player sidebar (togglable) ---- */}
      {sidebarOpen && (
        <div className="rv-sidebar rv-overlay">
          <div className="rv-sidebar-header">
            Players ({players.length})
            <button className="rv-close-panel" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
          {players.map(p => (
            <div key={p.socketId} className={`rv-player-card ${p.socketId === mySocketId ? 'is-you' : ''}`}>
              <div className="rv-player-info">
                <div className="rv-player-name">
                  {p.username} {p.socketId === mySocketId ? '(you)' : ''}
                </div>
                <div className="rv-player-role">{p.character}</div>
              </div>
              <div className={p.online ? 'rv-player-online' : 'rv-player-offline'} />
              {p.socketId !== mySocketId && !activeGame && (
                <button
                  className="rv-challenge-btn"
                  onClick={(e) => { e.stopPropagation(); challengePlayer(p.socketId); }}
                >
                  ⚔️
                </button>
              )}
            </div>
          ))}
          {sentChallenge && (
            <div style={{ color: '#a5b4fc', fontSize: '0.8rem', padding: '8px 12px' }}>
              Challenge sent… waiting ⏳
            </div>
          )}
        </div>
      )}

      {/* ---- Overlay: challenge toast ---- */}
      {pendingChallenge && (
        <div className="rv-challenge-toast rv-overlay">
          <div className="rv-challenge-toast-title">
            ⚔️ {pendingChallenge.fromUsername} challenges you!
          </div>
          <div className="rv-challenge-toast-actions">
            <button className="rv-accept-btn" onClick={acceptChallenge}>Accept</button>
            <button className="rv-decline-btn" onClick={declineChallenge}>Decline</button>
          </div>
        </div>
      )}

      {/* ---- Overlay: game HUD (when a C4 challenge game is active) ---- */}
      {activeGame && (
        <div className="rv-game-hud rv-overlay">
          <GameHUD
            game={activeGame}
            myPlayerNumber={myPlayerNumber}
            onRematch={voteRematch}
          />
        </div>
      )}

      {/* ---- Overlay: chat (togglable) ---- */}
      {chatOpen && (
        <div className="rv-chat rv-overlay">
          <div className="rv-chat-header">
            Chat
            <button className="rv-close-panel" onClick={() => setChatOpen(false)}>✕</button>
          </div>
          <div className="rv-chat-messages">
            {messages.map((m, i) => (
              <div key={i} className="rv-chat-msg" style={m.system ? { color: '#64748b', fontStyle: 'italic' } : {}}>
                {m.system ? m.text : (
                  <>
                    <span className="chat-name" style={{ color: m.socketId === mySocketId ? '#a5b4fc' : '#e2e8f0' }}>
                      {m.username}:
                    </span>
                    {' '}{m.text}
                  </>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="rv-chat-input-row">
            <input
              className="rv-chat-input"
              type="text"
              value={chatText}
              onChange={e => setChatText(e.target.value)}
              placeholder="Type a message…"
              onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
              maxLength={200}
            />
            <button className="rv-chat-send" onClick={sendChat}>↑</button>
          </div>
        </div>
      )}

    </div>
  );
}

/* ================================================================
   GameHUD — small overlay showing game status during a C4 challenge
   ================================================================ */
function GameHUD({ game, myPlayerNumber, onRematch }) {
  if (!game) return null;
  const { currentPlayer, winner, p1Username, p2Username, p1Color, p2Color } = game;
  const myRole = myPlayerNumber === 1 ? 'Player 1' : 'Player 2';
  const isMyTurn = !winner && currentPlayer === myRole;
  const iWon = winner === myRole;

  return (
    <div className="rv-game-hud-inner">
      <div className="rv-game-hud-players">
        <span style={{ color: p1Color, fontWeight: myPlayerNumber === 1 ? 700 : 400 }}>
          ● {p1Username}{myPlayerNumber === 1 ? ' (you)' : ''}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>vs</span>
        <span style={{ color: p2Color, fontWeight: myPlayerNumber === 2 ? 700 : 400 }}>
          ● {p2Username}{myPlayerNumber === 2 ? ' (you)' : ''}
        </span>
      </div>
      <div className="rv-game-hud-status">
        {winner ? (
          <span style={{ color: iWon ? '#22c55e' : '#ef4444' }}>
            {iWon ? '🎉 You win!' : `${winner === 'Player 1' ? p1Username : p2Username} wins!`}
          </span>
        ) : (
          <span style={{ color: isMyTurn ? '#22c55e' : '#f59e0b' }}>
            {isMyTurn ? 'Your turn — click a column' : `${currentPlayer === 'Player 1' ? p1Username : p2Username}'s turn`}
          </span>
        )}
      </div>
      {winner && (
        <button className="rv-rematch-btn" onClick={onRematch}>🔄 Rematch</button>
      )}
    </div>
  );
}
