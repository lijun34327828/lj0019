const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

let dbCache = null;
let saveTimer = null;
const SAVE_DELAY = 500;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  if (dbCache) return dbCache;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      dbCache = JSON.parse(raw);
    } else {
      dbCache = createEmptyDB();
      saveDB(true);
    }
  } catch (e) {
    console.error('[DB] Load error, creating new DB:', e);
    dbCache = createEmptyDB();
    saveDB(true);
  }
  return dbCache;
}

function createEmptyDB() {
  return {
    players: {},
    gameRecords: [],
    gameSessions: {},
    meta: {
      version: 1,
      createdAt: Date.now(),
    },
  };
}

function saveDB(immediate = false) {
  if (!dbCache) return;
  const doSave = () => {
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(dbCache, null, 0));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[DB] Save error:', e);
    }
  };
  if (immediate) {
    doSave();
  } else {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, SAVE_DELAY);
  }
}

const dbOperations = {
  getOrCreatePlayer(playerId, nickname = '玩家') {
    const db = loadDB();
    const now = Date.now();
    let player = db.players[playerId];
    if (!player) {
      player = {
        id: playerId,
        nickname,
        high_score: 0,
        total_games: 0,
        total_distance: 0,
        created_at: now,
        last_login: now,
      };
      db.players[playerId] = player;
    } else {
      player.last_login = now;
      if (nickname && nickname !== player.nickname) {
        player.nickname = nickname;
      }
    }
    saveDB();
    return { ...player };
  },

  getPlayer(playerId) {
    const db = loadDB();
    const p = db.players[playerId];
    return p ? { ...p } : null;
  },

  updateHighScore(playerId, score) {
    const db = loadDB();
    const player = db.players[playerId];
    if (player && score > player.high_score) {
      player.high_score = score;
      saveDB();
      return true;
    }
    return false;
  },

  addGameRecord(record) {
    const db = loadDB();
    const now = Date.now();
    const fullRecord = {
      id: Date.now() + Math.random(),
      player_id: record.playerId,
      score: Math.floor(record.score),
      distance: Math.floor(record.distance),
      hp_remaining: record.hpRemaining,
      items_collected: record.itemsCollected,
      obstacles_passed: record.obstaclesPassed,
      duration: record.duration,
      ended_at: now,
    };
    db.gameRecords.push(fullRecord);
    if (db.gameRecords.length > 500) {
      db.gameRecords.splice(0, db.gameRecords.length - 500);
    }

    const player = db.players[record.playerId];
    if (player) {
      player.total_games = (player.total_games || 0) + 1;
      player.total_distance = (player.total_distance || 0) + Math.floor(record.distance);
    }
    this.updateHighScore(record.playerId, Math.floor(record.score));
    saveDB();
  },

  getGameHistory(playerId, limit = 20) {
    const db = loadDB();
    return db.gameRecords
      .filter(r => r.player_id === playerId)
      .sort((a, b) => b.ended_at - a.ended_at)
      .slice(0, limit);
  },

  getHighScore(playerId) {
    const player = this.getPlayer(playerId);
    return player ? player.high_score : 0;
  },

  getGlobalHighScores(limit = 10) {
    const db = loadDB();
    return Object.values(db.players)
      .filter(p => (p.high_score || 0) > 0)
      .sort((a, b) => (b.high_score || 0) - (a.high_score || 0))
      .slice(0, limit)
      .map(p => ({
        id: p.id,
        nickname: p.nickname,
        high_score: p.high_score,
        total_games: p.total_games,
      }));
  },

  saveSession(sessionId, playerId, state, snapshot) {
    const db = loadDB();
    const now = Date.now();
    const snapshotStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
    db.gameSessions[sessionId] = {
      session_id: sessionId,
      player_id: playerId,
      state,
      snapshot: snapshotStr,
      last_heartbeat: now,
      created_at: db.gameSessions[sessionId]?.created_at || now,
    };
    saveDB();
  },

  getSession(sessionId) {
    const db = loadDB();
    const session = db.gameSessions[sessionId];
    if (session) {
      try {
        return {
          ...session,
          snapshot: typeof session.snapshot === 'string' ? JSON.parse(session.snapshot) : session.snapshot,
          player_id: session.player_id,
        };
      } catch (e) {
        return { ...session, snapshot: null, player_id: session.player_id };
      }
    }
    return null;
  },

  deleteSession(sessionId) {
    const db = loadDB();
    delete db.gameSessions[sessionId];
    saveDB();
  },

  cleanupExpiredSessions(maxAge = 3600000) {
    const db = loadDB();
    const cutoff = Date.now() - maxAge;
    let count = 0;
    for (const sid of Object.keys(db.gameSessions)) {
      if (db.gameSessions[sid].last_heartbeat < cutoff) {
        delete db.gameSessions[sid];
        count++;
      }
    }
    if (count > 0) saveDB();
    return count;
  },

  heartbeatSession(sessionId) {
    const db = loadDB();
    if (db.gameSessions[sessionId]) {
      db.gameSessions[sessionId].last_heartbeat = Date.now();
      saveDB();
    }
  },
};

loadDB();
process.on('exit', () => saveDB(true));
process.on('SIGINT', () => { saveDB(true); process.exit(); });

module.exports = { dbOperations };
