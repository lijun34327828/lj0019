const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const { GAME_CONFIG, GAME_STATES, MESSAGE_TYPES } = require('../shared/constants');
const { dbOperations } = require('./database');
const { TerrainGenerator } = require('./terrainGenerator');
const { GameEngine } = require('./gameEngine');

const PORT = 9684;
const TICK_RATE = 1000 / 60;
const SNAPSHOT_INTERVAL = 2000;
const SESSION_CLEANUP_INTERVAL = 60000;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const gameEngine = new GameEngine();
const terrainGenerators = new Map();
const clientConnections = new Map();
const heartbeatTimers = new Map();

function getOrCreateTerrain(sessionId) {
  if (!terrainGenerators.has(sessionId)) {
    terrainGenerators.set(sessionId, new TerrainGenerator());
  }
  return terrainGenerators.get(sessionId);
}

function sendMessage(ws, type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function handleConnect(ws, data) {
  const playerId = data.playerId || uuidv4();
  const nickname = data.nickname || '玩家';
  const sessionId = uuidv4();

  const player = dbOperations.getOrCreatePlayer(playerId, nickname);
  const terrain = getOrCreateTerrain(sessionId);
  const session = gameEngine.createSession(sessionId, playerId);

  clientConnections.set(sessionId, {
    ws,
    playerId,
    sessionId,
  });
  ws._sessionId = sessionId;
  ws._playerId = playerId;

  heartbeatTimers.set(sessionId, setInterval(() => {
    dbOperations.heartbeatSession(sessionId);
  }, 30000));

  sendMessage(ws, MESSAGE_TYPES.CONNECT, {
    sessionId,
    playerId,
    player: {
      nickname: player.nickname,
      highScore: player.high_score,
      totalGames: player.total_games,
    },
    gameConfig: GAME_CONFIG,
  });

  sendMessage(ws, MESSAGE_TYPES.GAME_START, {
    sessionId,
    state: GAME_STATES.PLAYING,
  });
}

function handleReconnect(ws, data) {
  const { sessionId, playerId } = data;
  if (!sessionId) {
    handleConnect(ws, { playerId });
    return;
  }

  const savedSession = dbOperations.getSession(sessionId);
  if (savedSession && savedSession.player_id === playerId && savedSession.snapshot) {
    const terrain = getOrCreateTerrain(sessionId);
    const session = gameEngine.restoreFromSnapshot(sessionId, savedSession.snapshot);

    const oldClient = clientConnections.get(sessionId);
    if (oldClient && heartbeatTimers.has(sessionId)) {
      clearInterval(heartbeatTimers.get(sessionId));
    }

    clientConnections.set(sessionId, { ws, playerId, sessionId });
    ws._sessionId = sessionId;
    ws._playerId = playerId;

    heartbeatTimers.set(sessionId, setInterval(() => {
      dbOperations.heartbeatSession(sessionId);
    }, 30000));

    sendMessage(ws, MESSAGE_TYPES.CONNECT, {
      sessionId,
      playerId,
      reconnected: true,
    });
  } else {
    handleConnect(ws, { playerId });
  }
}

function handlePlayerAction(sessionId, data) {
  const session = gameEngine.getSession(sessionId);
  if (!session) return;

  if (data.action === 'PAUSE') {
    session.state = GAME_STATES.PAUSED;
    broadcastState(session);
  } else if (data.action === 'RESUME') {
    session.state = GAME_STATES.PLAYING;
    session.lastUpdate = Date.now();
    broadcastState(session);
  } else {
    gameEngine.processPlayerAction(session, { type: data.action });
  }
}

function handleSyncRequest(ws, sessionId) {
  const session = gameEngine.getSession(sessionId);
  if (!session) return;
  const terrain = getOrCreateTerrain(sessionId);
  const startX = session.cameraX - GAME_CONFIG.CHUNK_SIZE;
  const endX = session.cameraX + GAME_CONFIG.CANVAS_WIDTH + GAME_CONFIG.CHUNK_SIZE * 2;
  const terrainData = terrain.getTerrainRange(startX, endX);
  terrain.updateMovingObjects(terrainData, Date.now());

  sendMessage(ws, MESSAGE_TYPES.SYNC_RESPONSE, {
    session: gameEngine.createSnapshot(session),
    terrain: terrainData,
  });
}

function handleGetHistory(ws, playerId) {
  const history = dbOperations.getGameHistory(playerId, 20);
  const highScore = dbOperations.getHighScore(playerId);
  sendMessage(ws, MESSAGE_TYPES.HISTORY_RESPONSE, {
    history,
    highScore,
  });
}

function handleGetHighScore(ws, playerId) {
  const highScore = dbOperations.getHighScore(playerId);
  const globalScores = dbOperations.getGlobalHighScores(10);
  sendMessage(ws, MESSAGE_TYPES.HIGH_SCORE_RESPONSE, {
    highScore,
    globalScores,
  });
}

function broadcastState(session) {
  const client = clientConnections.get(session.sessionId);
  if (!client) return;
  const ws = client.ws;
  const terrain = getOrCreateTerrain(session.sessionId);
  const startX = session.cameraX - GAME_CONFIG.CHUNK_SIZE;
  const endX = session.cameraX + GAME_CONFIG.CANVAS_WIDTH + GAME_CONFIG.CHUNK_SIZE * 2;
  const terrainData = terrain.getTerrainRange(startX, endX);
  terrain.updateMovingObjects(terrainData, Date.now());

  const update = gameEngine.getWorldUpdate(session, terrainData);
  sendMessage(ws, MESSAGE_TYPES.WORLD_UPDATE, update);
}

function handleGameOver(session) {
  const score = Math.floor(session.score);
  const playerBefore = dbOperations.getPlayer(session.playerId);
  const prevHighScore = playerBefore ? (playerBefore.high_score || 0) : 0;
  const isNewRecord = score > prevHighScore;

  dbOperations.addGameRecord({
    playerId: session.playerId,
    score: Math.floor(session.score),
    distance: Math.floor(session.distance),
    hpRemaining: Math.max(0, session.player.hp),
    itemsCollected: session.itemsCollected,
    obstaclesPassed: session.obstaclesPassed,
    duration: session.duration,
  });

  const player = dbOperations.getPlayer(session.playerId);

  const client = clientConnections.get(session.sessionId);
  if (client) {
    sendMessage(client.ws, MESSAGE_TYPES.GAME_OVER, {
      score: Math.floor(session.score),
      distance: Math.floor(session.distance),
      obstaclesPassed: session.obstaclesPassed,
      itemsCollected: session.itemsCollected,
      duration: session.duration,
      hpRemaining: Math.max(0, session.player.hp),
      isNewRecord,
      highScore: player ? player.high_score : 0,
      maxCombo: session.maxCombo,
    });
  }

  dbOperations.deleteSession(session.sessionId);
  terrainGenerators.delete(session.sessionId);
}

function gameTick() {
  const now = Date.now();

  for (const [sessionId, session] of gameEngine.sessions) {
    if (session.state === GAME_STATES.PLAYING) {
      const delta = now - session.lastUpdate;
      session.lastUpdate = now;

      const terrain = getOrCreateTerrain(sessionId);
      const startX = session.cameraX - GAME_CONFIG.CHUNK_SIZE;
      const endX = session.cameraX + GAME_CONFIG.CANVAS_WIDTH + GAME_CONFIG.CHUNK_SIZE * 2;
      const terrainData = terrain.getTerrainRange(startX, endX);
      terrain.updateMovingObjects(terrainData, now);

      gameEngine.update(session, delta, terrainData);
      broadcastState(session);

      if (session.state === GAME_STATES.GAME_OVER) {
        handleGameOver(session);
      }
    }
  }
}

function snapshotTick() {
  for (const [sessionId, session] of gameEngine.sessions) {
    if (session.state === GAME_STATES.PLAYING || session.state === GAME_STATES.PAUSED) {
      const snapshot = gameEngine.createSnapshot(session);
      dbOperations.saveSession(sessionId, session.playerId, session.state, snapshot);
    }
  }
}

function cleanupTick() {
  dbOperations.cleanupExpiredSessions(7200000);
  for (const [sessionId, client] of clientConnections) {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
      clientConnections.delete(sessionId);
    }
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] New client connected');

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const sessionId = ws._sessionId;

      switch (data.type) {
        case MESSAGE_TYPES.CONNECT:
          handleConnect(ws, data);
          break;
        case MESSAGE_TYPES.RECONNECT:
          handleReconnect(ws, data);
          break;
        case MESSAGE_TYPES.PLAYER_ACTION:
          if (sessionId) handlePlayerAction(sessionId, data);
          break;
        case MESSAGE_TYPES.PAUSE:
          if (sessionId) handlePlayerAction(sessionId, { action: 'PAUSE' });
          break;
        case MESSAGE_TYPES.RESUME:
          if (sessionId) handlePlayerAction(sessionId, { action: 'RESUME' });
          break;
        case MESSAGE_TYPES.SYNC_REQUEST:
          if (sessionId) handleSyncRequest(ws, sessionId);
          break;
        case MESSAGE_TYPES.GET_HISTORY:
          handleGetHistory(ws, data.playerId || ws._playerId);
          break;
        case MESSAGE_TYPES.GET_HIGH_SCORE:
          handleGetHighScore(ws, data.playerId || ws._playerId);
          break;
        case MESSAGE_TYPES.PING:
          sendMessage(ws, MESSAGE_TYPES.PONG, { timestamp: Date.now() });
          break;
      }
    } catch (e) {
      console.error('[WS] Message parse error:', e);
      sendMessage(ws, MESSAGE_TYPES.ERROR, { message: e.message });
    }
  });

  ws.on('close', () => {
    const sessionId = ws._sessionId;
    console.log('[WS] Client disconnected, session:', sessionId);
    if (sessionId) {
      if (heartbeatTimers.has(sessionId)) {
        clearInterval(heartbeatTimers.get(sessionId));
        heartbeatTimers.delete(sessionId);
      }
      const session = gameEngine.getSession(sessionId);
      if (session && session.state === GAME_STATES.PLAYING) {
        const snapshot = gameEngine.createSnapshot(session);
        dbOperations.saveSession(sessionId, session.playerId, GAME_STATES.PAUSED, snapshot);
      }
      setTimeout(() => {
        const stillConnected = clientConnections.get(sessionId);
        if (!stillConnected || stillConnected.ws !== ws) {
          gameEngine.removeSession(sessionId);
          clientConnections.delete(sessionId);
        }
      }, 60000);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, uptime: process.uptime() });
});

app.get('/api/sessions', (req, res) => {
  res.json({
    activeSessions: gameEngine.sessions.size,
    terrainCache: terrainGenerators.size,
    connections: clientConnections.size,
  });
});

app.get('/api/player/:id', (req, res) => {
  const player = dbOperations.getPlayer(req.params.id);
  if (player) {
    res.json(player);
  } else {
    res.status(404).json({ error: 'not found' });
  }
});

setInterval(gameTick, TICK_RATE);
setInterval(snapshotTick, SNAPSHOT_INTERVAL);
setInterval(cleanupTick, SESSION_CLEANUP_INTERVAL);

server.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════════
  跑酷游戏后端服务启动成功
  HTTP 端口: ${PORT}
  WebSocket: ws://localhost:${PORT}
  地形生成: 基于种子的块级动态生成
  碰撞判定: 后端权威AABB检测
═══════════════════════════════════════════
  `);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});
