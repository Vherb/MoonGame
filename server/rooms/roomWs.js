// server/rooms/roomWs.js
// WebSocket handler for the room/lobby system — mounted at /ws/room
// Uses RoomManager for all state; this file only handles message parsing,
// broadcasting, and heartbeat.

const WebSocket = require('ws');
const { RoomManager } = require('./RoomManager');

const mgr = new RoomManager();
let wss = null;

const isOpen = (ws) => ws && ws.readyState === WebSocket.OPEN;

const send = (ws, payload) => {
  if (!isOpen(ws)) return;
  try { ws.send(JSON.stringify(payload)); } catch {}
};

/**
 * Broadcast a message to every player in a room.
 */
function broadcastRoom(room, payload) {
  for (const pm of room.players.values()) {
    if (pm.ws) send(pm.ws, payload);
  }
}

/**
 * Broadcast to everyone in a room EXCEPT the sender.
 */
function broadcastRoomExcept(room, exceptWs, payload) {
  for (const pm of room.players.values()) {
    if (pm.ws && pm.ws !== exceptWs) send(pm.ws, payload);
  }
}

/**
 * Build a player-list snapshot for a room (sent on join/leave/update).
 */
function playersSnapshot(room) {
  return mgr.getRoomPlayers(room.code);
}

/**
 * Build a room-state snapshot for a newly joined player.
 */
function roomSnapshot(room, socketId) {
  return {
    type: 'roomJoined',
    code: room.code,
    name: room.name,
    isPublic: room.isPublic,
    hostUsername: room.hostUsername,
    yourSocketId: socketId,
    players: playersSnapshot(room),
    placedCubes: room.placedCubes || [],
    audioVisualizers: room.audioVisualizers || [],
    buildingPieces: room.buildingPieces || [],
    avatarPositions: room.avatarPositions || {},
    games: mgr.getRoomGames(room.code),
  };
}

/* ================================================================
   Heartbeat — every 2.5 min, terminate after 2 missed pongs
   ================================================================ */
const PING_INTERVAL = 30000;   // 30 seconds — detect stale sockets faster
const MAX_MISSED = 2;
const _wsMeta = new WeakMap(); // ws → { missedPongs }

setInterval(() => {
  if (!wss) return;
  for (const ws of wss.clients) {
    const m = _wsMeta.get(ws) || { missedPongs: 0 };
    if (m.missedPongs >= MAX_MISSED) {
      try { ws.terminate(); } catch {}
      handleDisconnect(ws);
      continue;
    }
    m.missedPongs++;
    _wsMeta.set(ws, m);
    try { ws.ping(); } catch {}
  }
}, PING_INTERVAL);

/* ================================================================
   Connection handler
   ================================================================ */
function handleDisconnect(ws) {
  const result = mgr.disconnectPlayer(ws);
  if (result) {
    const room = mgr.getRoom(result.code);
    if (room) {
      broadcastRoom(room, {
        type: 'playerLeft',
        socketId: result.socketId,
        players: playersSnapshot(room),
      });
    }
  }
}

function attachHandlers() {
  if (!wss) return;

  wss.on('connection', (ws) => {
    _wsMeta.set(ws, { missedPongs: 0 });
    ws.on('pong', () => {
      const m = _wsMeta.get(ws);
      if (m) m.missedPongs = 0;
    });

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }

      switch (data.type) {

        /* ---- Room lifecycle ---- */

        case 'createRoom': {
          try {
            const room = mgr.createRoom({
              name: data.name,
              isPublic: data.isPublic !== false,
              hostId: Number(data.userId) || null,
              hostUsername: data.username || 'Host',
            });

            // Auto-join the creator
            const join = mgr.joinRoom(room.code, ws, {
              userId: data.userId,
              username: data.username,
              character: data.character,
              avatar: data.avatar,
              color: data.color,
            });

            if (join.ok) {
              send(ws, roomSnapshot(room, join.socketId));
            } else {
              send(ws, { type: 'error', message: join.error });
            }
          } catch (err) {
            send(ws, { type: 'error', message: err.message });
          }
          break;
        }

        case 'joinRoom': {
          const code = String(data.code || '').toUpperCase();
          const join = mgr.joinRoom(code, ws, {
            userId: data.userId,
            username: data.username,
            character: data.character,
            avatar: data.avatar,
            color: data.color,
          });

          if (!join.ok) {
            send(ws, { type: 'joinDenied', error: join.error });
            break;
          }

          // Notify everyone about evicted stale entries (same user reconnecting)
          if (join.evictedSocketIds && join.evictedSocketIds.length > 0) {
            for (const evictedId of join.evictedSocketIds) {
              broadcastRoom(join.room, {
                type: 'playerLeft',
                socketId: evictedId,
                players: playersSnapshot(join.room),
              });
            }
          }

          // Send full state to the joiner
          send(ws, roomSnapshot(join.room, join.socketId));

          // Tell everyone else a new player arrived
          broadcastRoomExcept(join.room, ws, {
            type: 'playerJoined',
            player: mgr.getRoomPlayers(join.room.code).find(p => p.socketId === join.socketId),
            players: playersSnapshot(join.room),
          });
          break;
        }

        case 'leaveRoom': {
          const info = mgr.getSocketInfo(ws);
          if (!info) break;
          const { room, socketId } = info;
          mgr.leaveRoom(room.code, ws);
          send(ws, { type: 'roomLeft' });
          broadcastRoom(room, {
            type: 'playerLeft',
            socketId,
            players: playersSnapshot(room),
          });
          break;
        }

        case 'listRooms': {
          send(ws, { type: 'roomList', rooms: mgr.listPublicRooms() });
          break;
        }

        /* ---- Profile updates inside a room ---- */

        case 'updateProfile': {
          const pm = mgr.updatePlayer(ws, {
            username: data.username,
            character: data.character,
            avatar: data.avatar,
            color: data.color,
          });
          if (!pm) break;
          const info = mgr.getSocketInfo(ws);
          if (info) {
            broadcastRoom(info.room, {
              type: 'playerUpdated',
              socketId: info.socketId,
              player: {
                socketId: info.socketId,
                userId: pm.userId,
                username: pm.username,
                character: pm.character,
                avatar: pm.avatar,
                color: pm.color,
                online: true,
              },
              players: playersSnapshot(info.room),
            });
          }
          break;
        }

        /* ---- Avatar movement ---- */

        case 'avatarMove': {
          const result = mgr.updateAvatarPosition(ws, {
            x: Number(data.x),
            z: Number(data.z),
            yaw: data.yaw,
            run: data.run,
            isJumping: data.isJumping,
            isJetpacking: data.isJetpacking,
            isShooting: data.isShooting,
            isAiming: data.isAiming,
            isWalkingBackward: data.isWalkingBackward,
            isStrafeLeft: data.isStrafeLeft,
            isStrafeRight: data.isStrafeRight,
            isDead: data.isDead,
            tiltX: data.tiltX,
            tiltZ: data.tiltZ,
            pitch: data.pitch,
            lift: data.lift,
          });
          if (!result) break;

          const pos = result.room.avatarPositions[result.socketId];
          const payload = {
            type: 'avatarUpdate',
            socketId: result.socketId,
            x: pos.x,
            z: pos.z,
            ts: Date.now(),
          };
          if (Number.isFinite(pos.yaw)) payload.yaw = pos.yaw;
          payload.run = !!pos.run;
          payload.isJumping = !!pos.isJumping;
          payload.isJetpacking = !!pos.isJetpacking;
          payload.isShooting = !!pos.isShooting;
          payload.isAiming = !!pos.isAiming;
          payload.isWalkingBackward = !!pos.isWalkingBackward;
          payload.isStrafeLeft = !!pos.isStrafeLeft;
          payload.isStrafeRight = !!pos.isStrafeRight;
          payload.isDead = !!pos.isDead;
          if (typeof pos.tiltX === 'number') payload.tiltX = pos.tiltX;
          if (typeof pos.tiltZ === 'number') payload.tiltZ = pos.tiltZ;
          if (typeof pos.pitch === 'number') payload.pitch = pos.pitch;
          if (typeof pos.lift === 'number') payload.lift = pos.lift;

          broadcastRoomExcept(result.room, ws, payload);
          break;
        }

        /* ---- Weapon / shooting sync ---- */

        case 'shoot': {
          // Relay shoot event to all other players in the room
          const room = mgr.getRoomByWs(ws);
          if (!room) break;
          const shooterSid = mgr.getSocketId(ws);
          if (!shooterSid) break;
          broadcastRoomExcept(room, ws, {
            type: 'remoteShoot',
            shooterId: shooterSid,
            position: data.position,
            direction: data.direction,
            weaponType: data.weaponType || 'pistol',
            speed: data.speed,
            damage: data.damage,
          });
          break;
        }

        case 'playerHit': {
          // A shooter reports hitting another player — relay damage to the target
          const room = mgr.getRoomByWs(ws);
          if (!room) break;
          const attackerSid = mgr.getSocketId(ws);
          if (!attackerSid) break;

          const targetSid = data.targetId;
          if (!targetSid) break;

          // Broadcast to all so everyone can update health displays
          broadcastRoom(room, {
            type: 'playerDamaged',
            attackerId: attackerSid,
            targetId: targetSid,
            damage: data.damage || 25,
            hitPosition: data.hitPosition,
          });
          break;
        }

        /* ---- Sandbox sync ---- */

        /* ---- Resource gathering sync ---- */
        case 'resource_collected': {
          const room = mgr.getRoomByWs(ws);
          if (!room) break;
          broadcastRoomExcept(room, ws, {
            type: 'resource_collected',
            nodeId: data.nodeId,
          });
          break;
        }

        case 'resource_respawn': {
          const room = mgr.getRoomByWs(ws);
          if (!room) break;
          broadcastRoomExcept(room, ws, {
            type: 'resource_respawn',
            nodeId: data.nodeId,
          });
          break;
        }

        /* ---- Building system sync ---- */
        case 'build_place': {
          const room = mgr.addBuildingPiece(ws, data.piece);
          if (!room) break;
          // Broadcast individual event + full sync to all others
          broadcastRoomExcept(room, ws, {
            type: 'build_place',
            piece: data.piece,
          });
          broadcastRoomExcept(room, ws, {
            type: 'building_sync',
            pieces: room.buildingPieces || [],
            timestamp: Date.now(),
          });
          break;
        }

        case 'build_destroy': {
          const room = mgr.removeBuildingPiece(ws, data.pieceId);
          if (!room) break;
          // Broadcast individual event + full sync to all others
          broadcastRoomExcept(room, ws, {
            type: 'build_destroy',
            pieceId: data.pieceId,
          });
          broadcastRoomExcept(room, ws, {
            type: 'building_sync',
            pieces: room.buildingPieces || [],
            timestamp: Date.now(),
          });
          break;
        }

        case 'build_transform': {
          // Update a building piece's transform (position/rotation/scale for model props)
          const meta_bt = mgr.socketMeta.get(ws);
          if (!meta_bt?.roomCode) break;
          const room_bt = mgr.rooms.get(meta_bt.roomCode);
          if (!room_bt) break;
          // Update the piece in the room's building data
          if (room_bt.buildingPieces && data.pieceId != null) {
            const idx = room_bt.buildingPieces.findIndex(p => p.id === data.pieceId);
            if (idx >= 0) {
              const p = room_bt.buildingPieces[idx];
              if (data.position) { p.x = data.position.x; p.y = data.position.y; p.z = data.position.z; }
              if (data.rotation !== undefined) p.rotation = data.rotation;
              if (data.modelScale) p.modelScale = data.modelScale;
            }
          }
          broadcastRoomExcept(room_bt, ws, {
            type: 'build_transform',
            pieceId: data.pieceId,
            position: data.position,
            rotation: data.rotation,
            modelScale: data.modelScale,
          });
          break;
        }

        case 'building_sync': {
          // Full building state sync (like cubes_sync)
          const meta2 = mgr.socketMeta.get(ws);
          if (!meta2?.roomCode) break;
          const room2 = mgr.rooms.get(meta2.roomCode);
          if (!room2) break;
          if (!Array.isArray(data.pieces)) break;
          room2.buildingPieces = data.pieces;
          room2.lastActivity = Date.now();
          mgr._scheduleSave();
          broadcastRoom(room2, {
            type: 'building_sync',
            pieces: data.pieces,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        case 'door_toggle': {
          // Broadcast door open/close state to all other players in room
          const metaDoor = mgr.socketMeta.get(ws);
          if (!metaDoor?.roomCode) break;
          const roomDoor = mgr.rooms.get(metaDoor.roomCode);
          if (!roomDoor) break;
          broadcastRoomExcept(roomDoor, ws, {
            type: 'door_toggle',
            pieceId: data.pieceId,
            isOpen: data.isOpen,
          });
          break;
        }

        case 'cubes_sync': {
          const room = mgr.syncCubes(ws, data.cubes);
          if (!room) break;
          broadcastRoom(room, {
            type: 'cubes_sync',
            cubes: data.cubes,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        case 'visualizers_sync': {
          const room = mgr.syncVisualizers(ws, data.visualizers);
          if (!room) break;
          broadcastRoom(room, {
            type: 'visualizers_sync',
            visualizers: data.visualizers,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        case 'transform_live': {
          const info = mgr.getSocketInfo(ws);
          if (!info) break;
          broadcastRoomExcept(info.room, ws, {
            type: 'transform_live',
            cubeId: data.cubeId,
            position: data.position,
            rotation: data.rotation,
            scale: data.scale,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        /* ---- Challenges ---- */

        case 'challengePlayer': {
          const result = mgr.challengePlayer(ws, data.targetSocketId);
          if (!result.ok) {
            send(ws, { type: 'challengeError', error: result.error });
            break;
          }
          // Notify the challenger
          send(ws, { type: 'challengeSent', challengeId: result.challengeId });

          // Notify the target
          const info = mgr.getSocketInfo(ws);
          if (info) {
            const target = info.room.players.get(data.targetSocketId);
            if (target?.ws) {
              send(target.ws, {
                type: 'challengeReceived',
                challengeId: result.challengeId,
                fromSocketId: info.socketId,
                fromUsername: result.challenge.fromUsername,
              });
            }
          }
          break;
        }

        case 'acceptChallenge': {
          const result = mgr.acceptChallenge(ws, data.challengeId);
          if (!result.ok) {
            send(ws, { type: 'challengeError', error: result.error });
            break;
          }

          const info = mgr.getSocketInfo(ws);
          if (!info) break;

          const game = result.game;
          const p1 = info.room.players.get(game.p1SocketId);
          const p2 = info.room.players.get(game.p2SocketId);

          const gamePayload = {
            type: 'gameStarted',
            gameId: game.id,
            p1SocketId: game.p1SocketId,
            p2SocketId: game.p2SocketId,
            p1Username: game.p1Username,
            p2Username: game.p2Username,
            p1Color: game.p1Color,
            p2Color: game.p2Color,
            currentPlayer: game.game.currentPlayer,
            board: game.game.board,
          };

          // Notify both players with their player number
          if (p1?.ws) send(p1.ws, { ...gamePayload, yourPlayerNumber: 1, token: game.tokens[1] });
          if (p2?.ws) send(p2.ws, { ...gamePayload, yourPlayerNumber: 2, token: game.tokens[2] });

          // Notify spectators
          broadcastRoomExcept(info.room, null, {
            type: 'gameStartedSpectate',
            gameId: game.id,
            p1Username: game.p1Username,
            p2Username: game.p2Username,
            currentPlayer: game.game.currentPlayer,
          });
          break;
        }

        case 'declineChallenge': {
          const result = mgr.declineChallenge(ws, data.challengeId);
          if (!result.ok) break;

          const info = mgr.getSocketInfo(ws);
          if (info) {
            const from = info.room.players.get(result.challenge.fromSocketId);
            if (from?.ws) {
              send(from.ws, {
                type: 'challengeDeclined',
                challengeId: data.challengeId,
                byUsername: result.challenge.toUsername,
              });
            }
          }
          break;
        }

        /* ---- In-room mini-game moves ---- */

        case 'makeMove': {
          const result = mgr.makeMove(ws, data.gameId, data.col);
          if (!result.ok) break;

          const info = mgr.getSocketInfo(ws);
          if (!info) break;

          const game = result.game;

          // Broadcast game update to all room players (players + spectators)
          broadcastRoom(info.room, {
            type: 'gameUpdate',
            gameId: game.id,
            board: game.game.board,
            currentPlayer: game.game.currentPlayer,
            winner: game.game.winner || null,
            lastMove: result.result,
          });
          break;
        }

        case 'rematchVote': {
          const result = mgr.rematchVote(ws, data.gameId);
          if (!result.ok) break;

          const info = mgr.getSocketInfo(ws);
          if (!info) break;

          if (result.rematch) {
            const game = result.game;
            broadcastRoom(info.room, {
              type: 'rematchStart',
              gameId: game.id,
              currentPlayer: game.game.currentPlayer,
              board: game.game.board,
            });
          } else {
            broadcastRoom(info.room, {
              type: 'rematchUpdate',
              gameId: data.gameId,
              count: result.voteCount,
            });
          }
          break;
        }

        /* ---- Chat ---- */

        case 'chat': {
          const info = mgr.getSocketInfo(ws);
          if (!info) break;
          const text = String(data.text || '').slice(0, 200);
          if (!text) break;

          broadcastRoom(info.room, {
            type: 'chat',
            socketId: info.socketId,
            username: info.player.username,
            text,
            ts: Date.now(),
          });
          break;
        }

        /* ---- Sound / Model upload notifications ---- */

        case 'sound_uploaded': {
          const info = mgr.getSocketInfo(ws);
          if (!info) break;
          if (!data.filename || typeof data.filename !== 'string') break;
          broadcastRoom(info.room, {
            type: 'sound_uploaded',
            filename: data.filename,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        case 'model_uploaded': {
          const info = mgr.getSocketInfo(ws);
          if (!info) break;
          if (!data.model || typeof data.model !== 'object') break;
          broadcastRoom(info.room, {
            type: 'model_uploaded',
            model: data.model,
            timestamp: data.timestamp || Date.now(),
          });
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', () => handleDisconnect(ws));
  });
}

/* ================================================================
   Mount API
   ================================================================ */

/**
 * Attach to an existing HTTP server at the given path (unified mode).
 */
function attachUnified(server, wsPath = '/ws/room') {
  if (wss) return wss;
  wss = new WebSocket.Server({ noServer: true });
  attachHandlers();

  server.on('upgrade', (req, socket, head) => {
    try {
      if (!req || typeof req.url !== 'string') return;
      const u = req.url.split('?')[0];
      if (u !== wsPath) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      try { socket.destroy(); } catch {}
    }
  });

  return wss;
}

/**
 * REST endpoints for room info (optional — can be mounted on the Express app).
 */
function attachRest(app) {
  app.get('/rooms', (_req, res) => {
    res.json({ rooms: mgr.listPublicRooms() });
  });

  app.get('/rooms/:code', (req, res) => {
    const room = mgr.getRoom(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({
      code: room.code,
      name: room.name,
      isPublic: room.isPublic,
      hostUsername: room.hostUsername,
      playerCount: room.players.size,
      players: mgr.getRoomPlayers(room.code),
      games: mgr.getRoomGames(room.code),
    });
  });

  app.get('/rooms-stats', (_req, res) => {
    res.json(mgr.stats());
  });
}

module.exports = { attachUnified, attachRest, manager: mgr };
