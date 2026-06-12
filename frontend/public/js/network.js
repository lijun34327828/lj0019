(function(global) {
  'use strict';

  const MESSAGE_TYPES = {
    CONNECT: 'CONNECT',
    RECONNECT: 'RECONNECT',
    GAME_START: 'GAME_START',
    GAME_STATE: 'GAME_STATE',
    PLAYER_ACTION: 'PLAYER_ACTION',
    WORLD_UPDATE: 'WORLD_UPDATE',
    PAUSE: 'PAUSE',
    RESUME: 'RESUME',
    GAME_OVER: 'GAME_OVER',
    SYNC_REQUEST: 'SYNC_REQUEST',
    SYNC_RESPONSE: 'SYNC_RESPONSE',
    PING: 'PING',
    PONG: 'PONG',
    ERROR: 'ERROR',
    GET_HISTORY: 'GET_HISTORY',
    HISTORY_RESPONSE: 'HISTORY_RESPONSE',
    GET_HIGH_SCORE: 'GET_HIGH_SCORE',
    HIGH_SCORE_RESPONSE: 'HIGH_SCORE_RESPONSE',
  };

  class GameNetwork {
    constructor() {
      this.ws = null;
      this.backendWs = 'ws://localhost:9684';
      this.sessionId = null;
      this.playerId = this._loadPlayerId();
      this.connected = false;
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;
      this.reconnectDelay = 1000;
      this.handlers = {};
      this.messageQueue = [];
      this.lastPing = 0;
      this.pingInterval = null;
    }

    _loadPlayerId() {
      try {
        return localStorage.getItem('parkour_player_id') || null;
      } catch (e) { return null; }
    }

    _savePlayerId(id) {
      try {
        localStorage.setItem('parkour_player_id', id);
      } catch (e) {}
    }

    _saveSessionId(id) {
      try {
        localStorage.setItem('parkour_session_id', id);
      } catch (e) {}
    }

    _loadSessionId() {
      try {
        return localStorage.getItem('parkour_session_id') || null;
      } catch (e) { return null; }
    }

    on(type, handler) {
      if (!this.handlers[type]) this.handlers[type] = [];
      this.handlers[type].push(handler);
      return () => {
        this.handlers[type] = this.handlers[type].filter(h => h !== handler);
      };
    }

    _emit(type, payload) {
      (this.handlers[type] || []).forEach(h => {
        try { h(payload); } catch (e) { console.error('[NET] Handler error:', e); }
      });
    }

    async init() {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const config = await res.json();
          this.backendWs = config.backendWs || this.backendWs;
        }
      } catch (e) {}
    }

    connect(nickname) {
      return new Promise((resolve, reject) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          resolve(true);
          return;
        }

        try {
          this.ws = new WebSocket(this.backendWs);
        } catch (e) {
          reject(e);
          return;
        }

        let resolved = false;

        this.ws.onopen = () => {
          console.log('[NET] WebSocket connected');
          this.connected = true;
          this.reconnectAttempts = 0;

          const existingSession = this._loadSessionId();
          if (existingSession && this.reconnecting) {
            this._send(MESSAGE_TYPES.RECONNECT, {
              sessionId: existingSession,
              playerId: this.playerId,
            });
          } else {
            this._send(MESSAGE_TYPES.CONNECT, {
              playerId: this.playerId,
              nickname: nickname || '玩家',
            });
          }

          this._flushQueue();

          this.pingInterval = setInterval(() => {
            this.lastPing = Date.now();
            this._send(MESSAGE_TYPES.PING, { t: this.lastPing });
          }, 10000);

          if (!resolved) { resolved = true; resolve(true); }
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this._handleMessage(data);
          } catch (e) {
            console.error('[NET] Parse error:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.error('[NET] WebSocket error:', err);
          if (!resolved) { resolved = true; reject(err); }
        };

        this.ws.onclose = (event) => {
          console.log('[NET] WebSocket closed, code:', event.code);
          this.connected = false;
          if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
          this._emit('disconnect', { code: event.code });
          this._scheduleReconnect(nickname);
        };

        setTimeout(() => {
          if (!resolved && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
            resolved = true;
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      });
    }

    _handleMessage(data) {
      const type = data.type;

      switch (type) {
        case MESSAGE_TYPES.CONNECT:
          this.sessionId = data.sessionId;
          this.playerId = data.playerId;
          this._savePlayerId(this.playerId);
          this._saveSessionId(this.sessionId);
          if (data.reconnected) {
            this._emit('reconnected', data);
            this.sendSyncRequest();
          }
          break;
        case MESSAGE_TYPES.GAME_START:
          this._emit('gameStart', data);
          break;
        case MESSAGE_TYPES.WORLD_UPDATE:
          this._emit('worldUpdate', data);
          break;
        case MESSAGE_TYPES.GAME_OVER:
          try { localStorage.removeItem('parkour_session_id'); } catch (e) {}
          this._emit('gameOver', data);
          break;
        case MESSAGE_TYPES.SYNC_RESPONSE:
          this._emit('syncResponse', data);
          break;
        case MESSAGE_TYPES.HISTORY_RESPONSE:
          this._emit('historyResponse', data);
          break;
        case MESSAGE_TYPES.HIGH_SCORE_RESPONSE:
          this._emit('highScoreResponse', data);
          break;
        case MESSAGE_TYPES.PONG:
          const latency = Date.now() - (data.timestamp || this.lastPing);
          this._emit('latency', latency);
          break;
        case MESSAGE_TYPES.ERROR:
          console.error('[NET] Server error:', data.message);
          this._emit('error', data);
          break;
      }

      this._emit('message', data);
    }

    _scheduleReconnect(nickname) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this._emit('reconnectFailed', { attempts: this.reconnectAttempts });
        return;
      }
      this.reconnecting = true;
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 10000);
      this._emit('reconnecting', { attempt: this.reconnectAttempts, delay });
      setTimeout(() => {
        console.log(`[NET] Reconnecting... attempt ${this.reconnectAttempts}`);
        this.connect(nickname || '玩家').catch(err => {
          console.error('[NET] Reconnect failed:', err);
        });
      }, delay);
    }

    _send(type, payload = {}) {
      const msg = JSON.stringify({ type, ...payload });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      } else {
        this.messageQueue.push(msg);
      }
    }

    _flushQueue() {
      while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.messageQueue.shift());
      }
    }

    sendAction(action) {
      this._send(MESSAGE_TYPES.PLAYER_ACTION, { action });
    }

    sendPause() { this._send(MESSAGE_TYPES.PAUSE, {}); }
    sendResume() { this._send(MESSAGE_TYPES.RESUME, {}); }
    sendSyncRequest() { this._send(MESSAGE_TYPES.SYNC_REQUEST, {}); }
    sendGetHistory() { this._send(MESSAGE_TYPES.GET_HISTORY, { playerId: this.playerId }); }
    sendGetHighScore() { this._send(MESSAGE_TYPES.GET_HIGH_SCORE, { playerId: this.playerId }); }

    disconnect() {
      this.reconnecting = false;
      if (this.pingInterval) { clearInterval(this.pingInterval); }
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
      }
      this.connected = false;
    }
  }

  global.GameNetwork = GameNetwork;
  global.NetworkMessageTypes = MESSAGE_TYPES;
})(window);
