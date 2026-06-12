(function() {
  'use strict';

  const GAME_STATES = {
    MENU: 'MENU', LOADING: 'LOADING', PLAYING: 'PLAYING',
    PAUSED: 'PAUSED', GAME_OVER: 'GAME_OVER', RECONNECTING: 'RECONNECTING',
  };

  class ParkourGame {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      this.network = new GameNetwork();
      this.renderer = new GameRenderer(this.canvas);
      this.input = new InputManager(this.canvas);
      this.ui = new UIManager();

      this.state = GAME_STATES.MENU;
      this.latestWorld = null;
      this.prevHP = 3;
      this.maxHP = 3;
      this.lastFrameTime = performance.now();
      this.rafId = null;
      this.gameStartTime = 0;

      this._init();
    }

    async _init() {
      await this.network.init();
      this._bindUI();
      this._bindNetwork();
      this._bindInput();
      window.addEventListener('resize', () => this._onResize());
      this._startRenderLoop();
      this.ui.showScreen('menu');
      this.ui.showHUD(false);
    }

    _bindUI() {
      this.ui.bindButton('start-btn', () => this._startGame());
      this.ui.bindButton('history-btn', () => this._showHistory());
      this.ui.bindButton('rank-btn', () => this._showRank());
      this.ui.bindButton('history-back-btn', () => this.ui.showScreen('menu'));
      this.ui.bindButton('rank-back-btn', () => this.ui.showScreen('menu'));
      this.ui.bindButton('pause-btn', () => this._togglePause());
      this.ui.bindButton('resume-btn', () => this._resumeGame());
      this.ui.bindButton('restart-btn', () => { this._disconnectSession(); this._startGame(); });
      this.ui.bindButton('quit-btn', () => this._quitToMenu());
      this.ui.bindButton('retry-btn', () => this._startGame());
      this.ui.bindButton('menu-btn', () => this._quitToMenu());
    }

    _bindNetwork() {
      this.network.on('worldUpdate', (data) => this._onWorldUpdate(data));
      this.network.on('gameOver', (data) => this._onGameOver(data));
      this.network.on('gameStart', (data) => {
        console.log('[GAME] Game started:', data);
      });
      this.network.on('reconnected', () => {
        console.log('[GAME] Reconnected');
        this.ui.showReconnecting(false);
        if (this.state === GAME_STATES.RECONNECTING) {
          this.state = GAME_STATES.PLAYING;
          this.network.sendSyncRequest();
        }
      });
      this.network.on('reconnecting', (info) => {
        console.log(`[GAME] Reconnecting attempt ${info.attempt}`);
        this.state = GAME_STATES.RECONNECTING;
        this.ui.showReconnecting(true);
      });
      this.network.on('reconnectFailed', () => {
        this.ui.showReconnecting(false);
        alert('重连失败，请返回主菜单重新开始');
        this._quitToMenu();
      });
      this.network.on('historyResponse', (data) => {
        this.ui.renderHistory(data.history);
        this.ui.updateMenuInfo(data.highScore, 0);
      });
      this.network.on('highScoreResponse', (data) => {
        this.ui.renderRank(data.globalScores);
      });
      this.network.on('syncResponse', (data) => {
        if (data.session) {
          const s = data.session;
          this.maxHP = s.player && s.player.maxHp ? s.player.maxHp : 3;
          this.prevHP = s.player ? s.player.hp : this.prevHP;
          this.ui.updateHP(s.player ? s.player.hp : 3, this.maxHP);
          this.ui.updateScore(s.score || 0);
          this.ui.updateDistance(s.distance || 0);
          if (s.activeEffects) this.ui.updateEffects(this._formatEffects(s.activeEffects));
        }
      });
    }

    _bindInput() {
      this.input.on('jump', () => {
        if (this.state === GAME_STATES.PLAYING) {
          this.network.sendAction('JUMP');
        }
      });
      this.input.on('slideStart', () => {
        if (this.state === GAME_STATES.PLAYING) {
          this.network.sendAction('SLIDE_START');
        }
      });
      this.input.on('slideEnd', () => {
        if (this.state === GAME_STATES.PLAYING) {
          this.network.sendAction('SLIDE_END');
        }
      });
      this.input.on('pauseToggle', () => {
        if (this.state === GAME_STATES.PLAYING) this._togglePause();
        else if (this.state === GAME_STATES.PAUSED) this._resumeGame();
      });
      this.input.on('restart', () => {
        if (this.state === GAME_STATES.GAME_OVER) this._startGame();
      });
    }

    _formatEffects(effects) {
      if (!effects) return [];
      return effects.map(e => ({
        type: e.type,
        remainingTime: e.remainingTime !== undefined ? e.remainingTime : (e.endTime ? (e.endTime - Date.now()) : 0),
        stacks: e.stacks || 1,
      }));
    }

    async _startGame() {
      this.ui.showScreen(null);
      this.ui.hideAllScreens();
      this.ui.showLoading('连接服务器中...');
      const nickname = this.ui.getNickname();

      try {
        this._disconnectSession();
        this.state = GAME_STATES.LOADING;
        await this.network.connect(nickname);
        this.ui.hideLoading();
        this.ui.showHUD(true);
        this.state = GAME_STATES.PLAYING;
        this.gameStartTime = Date.now();
        this.input.setEnabled(true);
        this.input.reset();
        this.prevHP = 3;
        this.maxHP = 3;
        this.ui.updateHP(3, this.maxHP);
        this.ui.updateScore(0);
        this.ui.updateDistance(0);
        this.ui.updateEffects([]);
      } catch (e) {
        console.error('[GAME] Start failed:', e);
        this.ui.hideLoading();
        alert('连接服务器失败，请确认后端服务已启动 (端口 9684)');
        this.ui.showScreen('menu');
        this.state = GAME_STATES.MENU;
      }
    }

    _disconnectSession() {
      this.network.reconnecting = false;
      this.network.disconnect();
      try { localStorage.removeItem('parkour_session_id'); } catch (e) {}
    }

    _togglePause() {
      if (this.state === GAME_STATES.PLAYING) {
        this.state = GAME_STATES.PAUSED;
        this.network.sendPause();
        this.ui.updatePause(this.latestWorld ? this.latestWorld.score || 0 : 0, this.latestWorld ? this.latestWorld.distance || 0 : 0);
        this.ui.showScreen('pause');
        this.input.setEnabled(false);
      }
    }

    _resumeGame() {
      if (this.state === GAME_STATES.PAUSED) {
        this.state = GAME_STATES.PLAYING;
        this.network.sendResume();
        this.ui.hideAllScreens();
        this.input.setEnabled(true);
      }
    }

    _quitToMenu() {
      this._disconnectSession();
      this.state = GAME_STATES.MENU;
      this.input.setEnabled(false);
      this.input.reset();
      this.latestWorld = null;
      this.ui.showHUD(false);
      this.ui.hideAllScreens();
      this.ui.showScreen('menu');
      this._fetchMenuInfo();
    }

    _showHistory() {
      this.ui.showLoading('加载数据...');
      this.network.sendGetHistory();
      setTimeout(() => {
        this.ui.hideLoading();
        this.ui.showScreen('history');
      }, 300);
    }

    _showRank() {
      this.ui.showLoading('加载数据...');
      this.network.sendGetHighScore();
      setTimeout(() => {
        this.ui.hideLoading();
        this.ui.showScreen('rank');
      }, 300);
    }

    _fetchMenuInfo() {
      if (this.network.playerId) this.network.sendGetHistory();
    }

    _onWorldUpdate(data) {
      if (!data || this.state === GAME_STATES.MENU) return;

      if (data.player && data.player.worldX !== undefined) {
        data.player.x = data.player.worldX - (data.cameraX || 0) - data.player.worldX + data.player.x;
        data.player.x = 100;
      }

      this.latestWorld = data;

      if (data.gameState === 'PAUSED' && this.state === GAME_STATES.PLAYING) {
        this.state = GAME_STATES.PAUSED;
        this.ui.updatePause(data.score || 0, data.distance || 0);
        this.ui.showScreen('pause');
      } else if (data.gameState === 'PLAYING' && this.state === GAME_STATES.PAUSED) {
        this.state = GAME_STATES.PLAYING;
        this.ui.hideAllScreens();
      }

      if (data.player) {
        const hp = data.player.hp;
        if (hp !== undefined && hp !== this.prevHP) {
          const damaged = hp < this.prevHP;
          if (damaged) {
            this.renderer.triggerShake(8, 250);
          }
          this.ui.updateHP(hp, this.maxHP, damaged);
          this.prevHP = hp;
        }
      }

      this.ui.updateScore(data.score || 0);
      this.ui.updateDistance(data.distance || 0);
      this.ui.updateEffects(this._formatEffects(data.activeEffects));
    }

    _onGameOver(data) {
      console.log('[GAME] Game over:', data);
      this.state = GAME_STATES.GAME_OVER;
      this.input.setEnabled(false);
      this.input.reset();
      this.ui.showHUD(false);
      this.ui.updateGameOver(data);
      setTimeout(() => {
        this.ui.showScreen('gameover');
      }, 400);
    }

    _onResize() {
      this.renderer.resize();
    }

    _startRenderLoop() {
      const loop = () => {
        const now = performance.now();
        const dt = Math.min(50, now - this.lastFrameTime);
        this.lastFrameTime = now;

        this.renderer.render(this.latestWorld, dt);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  window.addEventListener('load', () => {
    window.__parkourGame = new ParkourGame();
  });
})();
