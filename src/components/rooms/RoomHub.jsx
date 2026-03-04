/* src/components/rooms/RoomHub.jsx
   Room browser / create / join-by-code hub.
   Route: /rooms
*/
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import NavBar from '../NavBar';
import './RoomHub.css';

/* ---- Auth gate: must be logged in ---- */
function useRequireAuth() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const username = localStorage.getItem('username');
  useEffect(() => {
    if (!token || !username) {
      navigate('/registration', { replace: true });
    }
  }, [token, username, navigate]);
  return { isLoggedIn: !!(token && username), username: username || '' };
}

/* ---- WS URL builder (matches pattern from GameBoard.js) ---- */
function getRoomWsUrl() {
  try {
    const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
    const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : '');
    let lsHost = '';
    try { lsHost = (localStorage.getItem('serverHost') || '').trim(); } catch {}
    const host = envHost || winHost || lsHost || ((window.location && window.location.hostname) || 'localhost');
    const proto = (window.location && window.location.protocol === 'https:') ? 'wss' : 'ws';
    const port = (window.location && window.location.port) || '';

    // Production: standard ports, no explicit port needed
    if (!port || port === '443' || port === '80') return `${proto}://${host}/ws/room`;

    // Dev: CRA on 3000 talks to backend on 3002
    const targetPort = port === '3000' ? '3002' : port;
    return `${proto}://${host}:${targetPort}/ws/room`;
  } catch {
    return 'ws://localhost:3002/ws/room';
  }
}

function getApiBase() {
  try {
    const envBase = (process.env.REACT_APP_API_BASE || '').trim();
    if (envBase) return envBase;
    const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
    const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : '');
    let lsHost = '';
    try { lsHost = (localStorage.getItem('serverHost') || '').trim(); } catch {}
    const host = envHost || winHost || lsHost || ((window.location && window.location.hostname) || 'localhost');
    const { protocol, port } = window.location || {};
    if (!port || port === '443' || port === '80') return '/api';
    const targetPort = port === '3000' ? '3002' : port;
    return `${protocol}//${host}:${targetPort}`;
  } catch {
    return 'http://localhost:3002';
  }
}

export default function RoomHub() {
  const navigate = useNavigate();
  const { isLoggedIn } = useRequireAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const fetchTimer = useRef(null);

  /* ---- Fetch public rooms ---- */
  const fetchRooms = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiBase()}/rooms`);
      const json = await res.json();
      setRooms(json.rooms || []);
      setError('');
    } catch (err) {
      setError('Could not load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    // Auto-refresh every 8s
    fetchTimer.current = setInterval(fetchRooms, 8000);
    return () => clearInterval(fetchTimer.current);
  }, [fetchRooms]);

  // Don't render until auth check passes
  if (!isLoggedIn) return null;

  /* ---- Join by code ---- */
  const handleJoinByCode = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    navigate(`/room/${code}`);
  };

  /* ---- Join from list click ---- */
  const handleClickRoom = (code) => {
    navigate(`/room/${code}`);
  };

  return (
    <div className="room-hub">
      <NavBar />
      <div className="room-hub-inner">
        <h1>🌙 Rooms</h1>
        <p className="hub-subtitle">Create your own sandbox moon or join one to build & play with others.</p>

        {error && <div className="error-banner">{error}</div>}

        {/* Actions bar */}
        <div className="hub-actions">
          <button className="hub-btn hub-btn-primary" onClick={() => setShowCreate(true)}>
            ＋ Create Room
          </button>

          <div className="join-code-row">
            <input
              className="join-code-input"
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 9))}
              placeholder="MOON-XXXX"
              onKeyDown={e => { if (e.key === 'Enter') handleJoinByCode(); }}
            />
            <button className="hub-btn hub-btn-secondary" onClick={handleJoinByCode}>
              Join
            </button>
          </div>
        </div>

        {/* Public rooms list */}
        <div className="room-list-section">
          <div className="room-list-header">
            <h2>Public Rooms</h2>
            <button className="refresh-btn" onClick={fetchRooms} disabled={loading}>
              {loading ? '⟳ Loading…' : '⟳ Refresh'}
            </button>
          </div>

          {rooms.length === 0 && !loading ? (
            <div className="room-empty-msg">
              <span>🏗️</span>
              No public rooms yet — create the first one!
            </div>
          ) : (
            rooms.map(r => (
              <div key={r.code} className="room-card" onClick={() => handleClickRoom(r.code)}>
                <div className="room-card-left">
                  <div className="room-card-name">{r.name}</div>
                  <div className="room-card-meta">
                    <span className="room-card-code">{r.code}</span>
                    <span>Host: {r.hostUsername}</span>
                  </div>
                </div>
                <div className="room-card-right">
                  <span className="player-count-pill">👥 {r.playerCount}</span>
                  {r.activeGames > 0 && (
                    <span className="player-count-pill" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
                      🎮 {r.activeGames} game{r.activeGames > 1 ? 's' : ''}
                    </span>
                  )}
                  <button className="hub-btn hub-btn-secondary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                    Enter →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create Room Modal */}
      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(code) => navigate(`/room/${code}`)}
        />
      )}
    </div>
  );
}

/* ================================================================
   CreateRoomModal — lightweight modal to set room name + public/private
   ================================================================ */
function CreateRoomModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef(null);

  const username = localStorage.getItem('username') || 'Player';

  const handleCreate = () => {
    if (creating) return;
    setCreating(true);
    setError('');

    try {
      const ws = new WebSocket(getRoomWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'createRoom',
          name: name.trim() || 'Moon Room',
          isPublic,
          username,
          userId: Number(localStorage.getItem('userId')) || null,
          character: localStorage.getItem('character') || 'astronaut',
          avatar: localStorage.getItem('avatar') || 'rocket',
          color: localStorage.getItem('playerColor') || '#6366f1',
        }));
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'roomJoined') {
            // Store the room session info so RoomView can reconnect
            sessionStorage.setItem('room_ws_url', getRoomWsUrl());
            sessionStorage.setItem('room_code', data.code);
            sessionStorage.setItem('room_socketId', data.yourSocketId);
            ws.close();
            onCreated(data.code);
          } else if (data.type === 'error') {
            setError(data.message || 'Failed to create room');
            setCreating(false);
            ws.close();
          }
        } catch {}
      };

      ws.onerror = () => {
        setError('Connection failed — is the server running?');
        setCreating(false);
      };
      ws.onclose = () => { setCreating(false); };
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  };

  useEffect(() => {
    return () => { try { wsRef.current?.close(); } catch {} };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2>Create a Room</h2>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-field">
          <label>Room Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 60))}
            placeholder="My Moon Room"
            autoFocus
          />
        </div>

        <div className="modal-field">
          <div className="modal-toggle-row">
            <label style={{ margin: 0 }}>Public (visible in room browser)</label>
            <div
              className={`toggle-switch ${isPublic ? 'active' : ''}`}
              onClick={() => setIsPublic(!isPublic)}
              role="switch"
              aria-checked={isPublic}
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setIsPublic(!isPublic); }}
            />
          </div>
        </div>

        <div className="modal-actions">
          <button className="hub-btn hub-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="hub-btn hub-btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : 'Create & Enter'}
          </button>
        </div>
      </div>
    </div>
  );
}
