// server/rooms/RoomManager.js
// Persistent room/lobby manager for Moon
// Owns: room lifecycle, player tracking, sandbox world state, in-room C4 mini-games, persistence.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/* ================================================================
   Connect Four game logic (same as original, duplicated to keep
   the room module self-contained)
   ================================================================ */
class ConnectFourGame {
  constructor(rows = 6, cols = 7) {
    this.rows = rows;
    this.cols = cols;
    this.board = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.currentPlayer = 'Player 1';
    this.winner = null;
  }
  makeMove(col) {
    if (this.winner) return false;
    if (col < 0 || col >= this.cols) return false;
    let row = this.rows - 1;
    while (row >= 0 && this.board[row][col] !== null) row--;
    if (row < 0) return false;
    this.board[row][col] = this.currentPlayer;
    if (this._checkWin(row, col)) this.winner = this.currentPlayer;
    else this.currentPlayer = this.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';
    return { row, col };
  }
  _checkWin(r, c) {
    const P = this.board[r][c];
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (const s of [-1, 1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < this.rows && cc >= 0 && cc < this.cols && this.board[rr][cc] === P) {
          count++; rr += dr * s; cc += dc * s;
        }
      }
      if (count >= 4) return true;
    }
    return false;
  }
}

/* ================================================================
   Helper constants
   ================================================================ */
const CHARACTER_IDS = new Set(['astronaut', 'alien', 'robot4', 'guy1']);
const AVATAR_IDS = new Set(['rocket', 'dragon', 'brain', 'fox', 'lion', 'panda', 'penguin', 'alien']);
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];

// Characters used for room code generation (no ambiguous chars 0/O, 1/l/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `MOON-${code}`;
}

function normalizeColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  return COLOR_RE.test(s) ? s : null;
}
function normalizeCharacter(ch) {
  if (typeof ch !== 'string') return null;
  const id = ch.trim().toLowerCase();
  return CHARACTER_IDS.has(id) ? id : null;
}
function normalizeAvatar(a) {
  if (typeof a !== 'string') return null;
  const id = a.trim().toLowerCase();
  return AVATAR_IDS.has(id) ? id : null;
}

/* ================================================================
   RoomManager
   ================================================================ */
class RoomManager {
  constructor(opts = {}) {
    /** @type {Map<string, Room>} code → Room */
    this.rooms = new Map();

    /** @type {WeakMap<WebSocket, SocketMeta>} */
    this.socketMeta = new WeakMap();

    this.saveFile = opts.saveFile || path.join(__dirname, 'rooms.save.json');
    this._saveTimer = null;

    // Restore persisted rooms on startup
    this._restore();
  }

  /* ---------- Room CRUD ---------- */

  /**
   * Create a new room.
   * @param {object} opts
   * @param {string}  opts.name       - Human-readable room name
   * @param {boolean} opts.isPublic   - Show in public browser (default true)
   * @param {number|null}  opts.hostId     - userId of the creator (nullable)
   * @param {string}  opts.hostUsername
   * @returns {Room}
   */
  createRoom({ name = 'Moon Room', isPublic = true, hostId = null, hostUsername = 'Host' } = {}) {
    // Generate a unique code
    let code;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
    } while (this.rooms.has(code) && attempts < 100);

    if (this.rooms.has(code)) throw new Error('Could not generate unique room code');

    const room = {
      code,
      name: String(name).slice(0, 60),
      isPublic: !!isPublic,
      hostId,
      hostUsername: String(hostUsername).slice(0, 40),
      createdAt: Date.now(),
      lastActivity: Date.now(),

      // Players: Map<string,PlayerMeta>  (keyed by a per-socket id we assign)
      // PlayerMeta: { socketId, ws, userId, username, character, avatar, color, joinedAt }
      players: new Map(),

      // Sandbox world state
      placedCubes: [],
      audioVisualizers: [],
      buildingPieces: [],    // persistent building system pieces
      avatarPositions: {},   // keyed by socketId

      // Active C4 games within this room
      // Map<string, MiniGame>
      // MiniGame: { id, game: ConnectFourGame, p1SocketId, p2SocketId,
      //             p1Username, p2Username, p1Color, p2Color, startedAt, tokens }
      games: new Map(),

      // Pending challenges: Map<string, Challenge>
      // Challenge: { id, fromSocketId, toSocketId, fromUsername, toUsername, createdAt }
      challenges: new Map(),
    };

    this.rooms.set(code, room);
    this._scheduleSave();
    return room;
  }

  /**
   * Get a room by code. Returns null if not found.
   */
  getRoom(code) {
    return this.rooms.get(String(code).toUpperCase()) || null;
  }

  /**
   * List public rooms (for the room browser).
   * Returns lightweight descriptors (no socket refs).
   */
  listPublicRooms() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic) continue;
      out.push({
        code: room.code,
        name: room.name,
        hostUsername: room.hostUsername,
        playerCount: room.players.size,
        activeGames: room.games.size,
        createdAt: room.createdAt,
      });
    }
    // Sort: most players first, then most recent
    out.sort((a, b) => b.playerCount - a.playerCount || b.createdAt - a.createdAt);
    return out;
  }

  /**
   * Delete a room. Broadcasts roomClosed to all players.
   */
  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;

    // Clean up all mini-games
    for (const game of room.games.values()) {
      // game timers etc. would be cleared here
    }

    // Mark all sockets as not in this room
    for (const [sid, pm] of room.players) {
      if (pm.ws) {
        const meta = this.socketMeta.get(pm.ws);
        if (meta) { delete meta.roomCode; delete meta.socketId; }
      }
    }

    this.rooms.delete(code);
    this._scheduleSave();
  }

  /* ---------- Player join / leave ---------- */

  /**
   * A player joins a room.
   * @param {string} code     - Room code
   * @param {WebSocket} ws
   * @param {object} meta     - { userId, username, character, avatar, color }
   * @returns {{ ok:boolean, error?:string, socketId?:string, room?:Room }}
   */
  joinRoom(code, ws, meta = {}) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'Room not found' };

    // Check if this socket is already in this room
    const existing = this.socketMeta.get(ws);
    if (existing?.roomCode === room.code) {
      return { ok: false, error: 'Already in this room' };
    }

    // If socket is in another room, leave it first
    if (existing?.roomCode) {
      this.leaveRoom(existing.roomCode, ws);
    }

    const socketId = uuidv4().slice(0, 8);
    const username = String(meta.username || 'Player').slice(0, 40);
    const character = normalizeCharacter(meta.character) || 'astronaut';
    const avatar = normalizeAvatar(meta.avatar) || 'rocket';
    const color = normalizeColor(meta.color) || this._pickColor(room);
    const userId = Number.isFinite(meta.userId) ? meta.userId : null;

    // ── Evict stale entries for the same userId (handles reconnects/refreshes) ──
    const evictedSocketIds = [];
    if (userId != null) {
      for (const [sid, pm] of room.players) {
        if (pm.userId === userId) {
          evictedSocketIds.push(sid);
          // Clean up avatar position
          delete room.avatarPositions[sid];
          // Cancel challenges involving this stale player
          for (const [cid, ch] of room.challenges) {
            if (ch.fromSocketId === sid || ch.toSocketId === sid) {
              room.challenges.delete(cid);
            }
          }
          // Forfeit active games
          for (const [gid, game] of room.games) {
            if (game.p1SocketId === sid || game.p2SocketId === sid) {
              const winningSide = game.p1SocketId === sid ? 'Player 2' : 'Player 1';
              game.game.winner = winningSide;
            }
          }
          // Clear socketMeta for the old ws if it exists
          if (pm.ws) {
            const oldMeta = this.socketMeta.get(pm.ws);
            if (oldMeta) { delete oldMeta.roomCode; delete oldMeta.socketId; }
          }
          room.players.delete(sid);
        }
      }
    }

    // Also evict any entries with ws === null (from persistence restore)
    for (const [sid, pm] of room.players) {
      if (!pm.ws) {
        evictedSocketIds.push(sid);
        delete room.avatarPositions[sid];
        room.players.delete(sid);
      }
    }

    const playerMeta = {
      socketId,
      ws,         // live socket ref (NOT persisted)
      userId,
      username,
      character,
      avatar,
      color,
      joinedAt: Date.now(),
    };

    room.players.set(socketId, playerMeta);
    room.lastActivity = Date.now();

    // Track on the socket itself
    this.socketMeta.set(ws, { roomCode: room.code, socketId });

    this._scheduleSave();
    return { ok: true, socketId, room, evictedSocketIds };
  }

  /**
   * A player leaves a room (voluntary or disconnect).
   */
  leaveRoom(code, ws) {
    const room = this.rooms.get(code);
    if (!room) return;

    const meta = this.socketMeta.get(ws);
    if (!meta || meta.roomCode !== code) return;

    const socketId = meta.socketId;

    // Remove from player map
    room.players.delete(socketId);

    // Remove avatar position
    delete room.avatarPositions[socketId];

    // Cancel any pending challenges involving this player
    for (const [cid, ch] of room.challenges) {
      if (ch.fromSocketId === socketId || ch.toSocketId === socketId) {
        room.challenges.delete(cid);
      }
    }

    // Forfeit any active games involving this player
    for (const [gid, game] of room.games) {
      if (game.p1SocketId === socketId || game.p2SocketId === socketId) {
        const winningSide = game.p1SocketId === socketId ? 'Player 2' : 'Player 1';
        game.game.winner = winningSide;
        // We'll let the WS handler broadcast the forfeit
      }
    }

    // Clear socket meta
    delete meta.roomCode;
    delete meta.socketId;

    room.lastActivity = Date.now();

    // Auto-destroy empty rooms after a grace period
    if (room.players.size === 0) {
      // Rooms with placed content (cubes/visualizers) get 24h; empty rooms get 30min
      const hasContent = (room.placedCubes && room.placedCubes.length > 0) ||
                         (room.audioVisualizers && room.audioVisualizers.length > 0) ||
                         (room.buildingPieces && room.buildingPieces.length > 0);
      const grace = hasContent ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
      room._destroyTimeout = setTimeout(() => {
        if (room.players.size === 0) {
          this.destroyRoom(code);
        }
      }, grace);
    }

    this._scheduleSave();
  }

  /**
   * Handle socket disconnect — find which room they're in and leave.
   */
  disconnectPlayer(ws) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const code = meta.roomCode;
    const socketId = meta.socketId;
    this.leaveRoom(code, ws);
    return { code, socketId };
  }

  /* ---------- Player profile updates ---------- */

  updatePlayer(ws, updates = {}) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;

    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;

    const pm = room.players.get(meta.socketId);
    if (!pm) return null;

    if (updates.username !== undefined) pm.username = String(updates.username).slice(0, 40);
    if (updates.character !== undefined) pm.character = normalizeCharacter(updates.character) || pm.character;
    if (updates.avatar !== undefined) pm.avatar = normalizeAvatar(updates.avatar) || pm.avatar;
    if (updates.color !== undefined) pm.color = normalizeColor(updates.color) || pm.color;

    room.lastActivity = Date.now();
    this._scheduleSave();
    return pm;
  }

  /* ---------- Avatar positions ---------- */

  updateAvatarPosition(ws, { x, z, yaw, run, isJumping, isJetpacking, isShooting, isAiming, isWalkingBackward, isStrafeLeft, isStrafeRight, isDead, tiltX, tiltZ, pitch, lift }) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;

    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;

    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

    room.avatarPositions[meta.socketId] = {
      x, z,
      yaw: Number.isFinite(yaw) ? yaw : undefined,
      run: !!run,
      isJumping: !!isJumping,
      isJetpacking: !!isJetpacking,
      isShooting: !!isShooting,
      isAiming: !!isAiming,
      isWalkingBackward: !!isWalkingBackward,
      isStrafeLeft: !!isStrafeLeft,
      isStrafeRight: !!isStrafeRight,
      isDead: !!isDead,
      tiltX: typeof tiltX === 'number' ? tiltX : 0,
      tiltZ: typeof tiltZ === 'number' ? tiltZ : 0,
      pitch: typeof pitch === 'number' ? pitch : 0,
      lift: Number.isFinite(lift) ? lift : undefined,
    };

    return { socketId: meta.socketId, room };
  }

  /* ---------- Weapon sync helpers ---------- */

  /** Get the room object for a given WebSocket connection */
  getRoomByWs(ws) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    return this.rooms.get(meta.roomCode) || null;
  }

  /** Get the socketId for a given WebSocket connection */
  getSocketId(ws) {
    const meta = this.socketMeta.get(ws);
    return meta?.socketId || null;
  }

  /* ---------- Sandbox state (cubes & visualizers) ---------- */

  syncCubes(ws, cubes) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    if (!Array.isArray(cubes)) return null;

    room.placedCubes = cubes;
    room.lastActivity = Date.now();
    this._scheduleSave();
    return room;
  }

  syncVisualizers(ws, visualizers) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    if (!Array.isArray(visualizers)) return null;

    room.audioVisualizers = visualizers;
    room.lastActivity = Date.now();
    this._scheduleSave();
    return room;
  }

  /* ---------- Building pieces persistence ---------- */

  addBuildingPiece(ws, piece) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    if (!piece || typeof piece !== 'object') return null;

    if (!room.buildingPieces) room.buildingPieces = [];
    // Avoid duplicate ids
    if (room.buildingPieces.find(p => p.id === piece.id)) return room;
    room.buildingPieces.push(piece);
    room.lastActivity = Date.now();
    this._scheduleSave();
    return room;
  }

  removeBuildingPiece(ws, pieceId) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    if (pieceId == null) return null;

    if (!room.buildingPieces) room.buildingPieces = [];
    room.buildingPieces = room.buildingPieces.filter(p => p.id !== pieceId);
    room.lastActivity = Date.now();
    this._scheduleSave();
    return room;
  }

  /* ---------- Challenges ---------- */

  /**
   * One player challenges another to a C4 game.
   * @returns {{ ok:boolean, challengeId?:string, error?:string }}
   */
  challengePlayer(ws, targetSocketId) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return { ok: false, error: 'Not in a room' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { ok: false, error: 'Room not found' };

    const fromPlayer = room.players.get(meta.socketId);
    const toPlayer = room.players.get(targetSocketId);
    if (!fromPlayer || !toPlayer) return { ok: false, error: 'Player not found' };
    if (meta.socketId === targetSocketId) return { ok: false, error: 'Cannot challenge yourself' };

    // Check if there's already a pending challenge between these two
    for (const ch of room.challenges.values()) {
      if (ch.fromSocketId === meta.socketId && ch.toSocketId === targetSocketId) {
        return { ok: false, error: 'Challenge already pending' };
      }
    }

    const challengeId = uuidv4().slice(0, 8);
    room.challenges.set(challengeId, {
      id: challengeId,
      fromSocketId: meta.socketId,
      toSocketId: targetSocketId,
      fromUsername: fromPlayer.username,
      toUsername: toPlayer.username,
      createdAt: Date.now(),
    });

    // Auto-expire challenge after 60 seconds
    setTimeout(() => {
      const r = this.rooms.get(meta.roomCode);
      if (r) r.challenges.delete(challengeId);
    }, 60000);

    return { ok: true, challengeId, challenge: room.challenges.get(challengeId) };
  }

  /**
   * Accept a challenge → creates a mini-game.
   * @returns {{ ok:boolean, game?:MiniGame, error?:string }}
   */
  acceptChallenge(ws, challengeId) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return { ok: false, error: 'Not in a room' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { ok: false, error: 'Room not found' };

    const challenge = room.challenges.get(challengeId);
    if (!challenge) return { ok: false, error: 'Challenge expired or not found' };
    if (challenge.toSocketId !== meta.socketId) return { ok: false, error: 'This challenge is not for you' };

    // Remove the challenge
    room.challenges.delete(challengeId);

    // Check both players are still in the room
    const p1 = room.players.get(challenge.fromSocketId);
    const p2 = room.players.get(challenge.toSocketId);
    if (!p1 || !p2) return { ok: false, error: 'Player left the room' };

    // Create mini-game
    const gameId = uuidv4().slice(0, 8);
    const miniGame = {
      id: gameId,
      game: new ConnectFourGame(),
      p1SocketId: challenge.fromSocketId,
      p2SocketId: challenge.toSocketId,
      p1Username: p1.username,
      p2Username: p2.username,
      p1Color: p1.color,
      p2Color: p2.color,
      tokens: { 1: uuidv4(), 2: uuidv4() },
      startedAt: Date.now(),
      rematchVotes: new Set(),
    };

    room.games.set(gameId, miniGame);
    room.lastActivity = Date.now();
    this._scheduleSave();

    return { ok: true, game: miniGame };
  }

  /**
   * Decline a challenge.
   */
  declineChallenge(ws, challengeId) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return { ok: false, error: 'Not in a room' };
    const room = this.rooms.get(meta.roomCode);
    if (!room) return { ok: false, error: 'Room not found' };

    const challenge = room.challenges.get(challengeId);
    if (!challenge) return { ok: false, error: 'Challenge not found' };
    if (challenge.toSocketId !== meta.socketId) return { ok: false, error: 'Not your challenge' };

    room.challenges.delete(challengeId);
    return { ok: true, challenge };
  }

  /* ---------- Mini-game moves ---------- */

  /**
   * Make a C4 move in a mini-game.
   * @returns {{ ok:boolean, result?:object, game?:MiniGame, error?:string }}
   */
  makeMove(ws, gameId, col) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return { ok: false, error: 'Not in a room' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { ok: false, error: 'Room not found' };

    const miniGame = room.games.get(gameId);
    if (!miniGame) return { ok: false, error: 'Game not found' };

    // Determine which side the player is
    let side;
    if (meta.socketId === miniGame.p1SocketId) side = 'Player 1';
    else if (meta.socketId === miniGame.p2SocketId) side = 'Player 2';
    else return { ok: false, error: 'Not a participant in this game' };

    if (miniGame.game.currentPlayer !== side) return { ok: false, error: 'Not your turn' };

    const result = miniGame.game.makeMove(col);
    if (!result) return { ok: false, error: 'Invalid move' };

    room.lastActivity = Date.now();
    this._scheduleSave();

    return { ok: true, result, game: miniGame };
  }

  /**
   * Vote for rematch in a mini-game.
   */
  rematchVote(ws, gameId) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return { ok: false, error: 'Not in a room' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { ok: false, error: 'Room not found' };

    const miniGame = room.games.get(gameId);
    if (!miniGame) return { ok: false, error: 'Game not found' };

    let playerNum;
    if (meta.socketId === miniGame.p1SocketId) playerNum = 1;
    else if (meta.socketId === miniGame.p2SocketId) playerNum = 2;
    else return { ok: false, error: 'Not a participant' };

    miniGame.rematchVotes.add(playerNum);

    if (miniGame.rematchVotes.size >= 2) {
      // Reset the game
      miniGame.game = new ConnectFourGame();
      miniGame.rematchVotes = new Set();
      return { ok: true, rematch: true, game: miniGame };
    }

    return { ok: true, rematch: false, voteCount: miniGame.rematchVotes.size };
  }

  /**
   * End/destroy a mini-game within a room.
   */
  endGame(code, gameId) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.games.delete(gameId);
    this._scheduleSave();
  }

  /* ---------- Queries ---------- */

  /**
   * Get info about a socket's current room/player state.
   */
  getSocketInfo(ws) {
    const meta = this.socketMeta.get(ws);
    if (!meta?.roomCode) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    const player = room.players.get(meta.socketId);
    return { room, player, socketId: meta.socketId };
  }

  /**
   * Get all player descriptors for a room (no socket refs).
   */
  getRoomPlayers(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    const out = [];
    for (const [sid, pm] of room.players) {
      out.push({
        socketId: sid,
        userId: pm.userId,
        username: pm.username,
        character: pm.character,
        avatar: pm.avatar,
        color: pm.color,
        online: !!(pm.ws && pm.ws.readyState === 1), // WebSocket.OPEN = 1
      });
    }
    return out;
  }

  /**
   * Get all active games for a room.
   */
  getRoomGames(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    const out = [];
    for (const [gid, g] of room.games) {
      out.push({
        gameId: gid,
        p1Username: g.p1Username,
        p2Username: g.p2Username,
        p1Color: g.p1Color,
        p2Color: g.p2Color,
        currentPlayer: g.game.currentPlayer,
        winner: g.game.winner,
        board: g.game.board,
      });
    }
    return out;
  }

  /* ---------- Internal helpers ---------- */

  _pickColor(room) {
    const taken = new Set();
    for (const pm of room.players.values()) taken.add((pm.color || '').toLowerCase());
    return DEFAULT_COLORS.find(c => !taken.has(c.toLowerCase())) || DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
  }

  /* ---------- Persistence ---------- */

  _scheduleSave() {
    if (this._saveTimer) return; // already scheduled
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 500); // debounce 500ms
  }

  _save() {
    try {
      const payload = {
        savedAt: Date.now(),
        rooms: [],
      };
      for (const room of this.rooms.values()) {
        payload.rooms.push(this._serializeRoom(room));
      }
      fs.writeFileSync(this.saveFile, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error('[RoomManager] save error:', err.message);
    }
  }

  _serializeRoom(room) {
    // Serialize players without socket refs
    const players = [];
    for (const [sid, pm] of room.players) {
      players.push({
        socketId: sid,
        userId: pm.userId,
        username: pm.username,
        character: pm.character,
        avatar: pm.avatar,
        color: pm.color,
        joinedAt: pm.joinedAt,
      });
    }

    // Serialize mini-games
    const games = [];
    for (const [gid, g] of room.games) {
      games.push({
        id: gid,
        board: g.game.board,
        currentPlayer: g.game.currentPlayer,
        winner: g.game.winner || null,
        p1SocketId: g.p1SocketId,
        p2SocketId: g.p2SocketId,
        p1Username: g.p1Username,
        p2Username: g.p2Username,
        p1Color: g.p1Color,
        p2Color: g.p2Color,
        tokens: g.tokens,
        startedAt: g.startedAt,
      });
    }

    return {
      code: room.code,
      name: room.name,
      isPublic: room.isPublic,
      hostId: room.hostId,
      hostUsername: room.hostUsername,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      players,
      placedCubes: room.placedCubes || [],
      audioVisualizers: room.audioVisualizers || [],
      buildingPieces: room.buildingPieces || [],
      avatarPositions: room.avatarPositions || {},
      games,
    };
  }

  _restore() {
    try {
      if (!fs.existsSync(this.saveFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.saveFile, 'utf8'));
      const list = Array.isArray(raw.rooms) ? raw.rooms : [];
      for (const s of list) {
        try {
          // Do NOT restore players — they have no live WebSocket connection
          // and would appear as ghosts. Players rejoin on connect.
          const players = new Map();

          // Rebuild games map
          const games = new Map();
          if (Array.isArray(s.games)) {
            for (const g of s.games) {
              const game = new ConnectFourGame();
              if (Array.isArray(g.board)) game.board = g.board;
              if (g.currentPlayer === 'Player 1' || g.currentPlayer === 'Player 2') game.currentPlayer = g.currentPlayer;
              if (g.winner === 'Player 1' || g.winner === 'Player 2') game.winner = g.winner;

              games.set(g.id, {
                id: g.id,
                game,
                p1SocketId: g.p1SocketId,
                p2SocketId: g.p2SocketId,
                p1Username: g.p1Username || 'Player 1',
                p2Username: g.p2Username || 'Player 2',
                p1Color: g.p1Color || '#ef4444',
                p2Color: g.p2Color || '#3b82f6',
                tokens: g.tokens || { 1: uuidv4(), 2: uuidv4() },
                startedAt: g.startedAt || Date.now(),
                rematchVotes: new Set(),
              });
            }
          }

          const room = {
            code: s.code,
            name: s.name || 'Moon Room',
            isPublic: s.isPublic !== false,
            hostId: s.hostId ?? null,
            hostUsername: s.hostUsername || 'Host',
            createdAt: s.createdAt || Date.now(),
            lastActivity: s.lastActivity || Date.now(),
            players,
            placedCubes: Array.isArray(s.placedCubes) ? s.placedCubes : [],
            audioVisualizers: Array.isArray(s.audioVisualizers) ? s.audioVisualizers : [],
            buildingPieces: Array.isArray(s.buildingPieces) ? s.buildingPieces : [],
            avatarPositions: s.avatarPositions || {},
            games,
            challenges: new Map(),
          };

          this.rooms.set(room.code, room);

          // Start destroy timer for restored empty rooms (no live players)
          const hasContent = (room.placedCubes && room.placedCubes.length > 0) ||
                             (room.audioVisualizers && room.audioVisualizers.length > 0) ||
                             (room.buildingPieces && room.buildingPieces.length > 0);
          const grace = hasContent ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
          room._destroyTimeout = setTimeout(() => {
            if (room.players.size === 0) {
              this.destroyRoom(room.code);
            }
          }, grace);
        } catch (e) {
          console.warn('[RoomManager] skipping corrupt room:', e.message);
        }
      }
      console.log(`[RoomManager] restored ${this.rooms.size} room(s)`);
    } catch (err) {
      console.warn('[RoomManager] restore error:', err.message);
    }
  }

  /* ---------- Stats ---------- */

  stats() {
    let totalPlayers = 0;
    let totalGames = 0;
    for (const room of this.rooms.values()) {
      totalPlayers += room.players.size;
      totalGames += room.games.size;
    }
    return {
      roomCount: this.rooms.size,
      totalPlayers,
      totalGames,
    };
  }
}

module.exports = { RoomManager, ConnectFourGame };
