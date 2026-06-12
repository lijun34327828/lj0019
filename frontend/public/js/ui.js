(function(global) {
  'use strict';

  const ITEM_CONFIG = global.RenderItemConfig || {
    SPEED_BOOST: { type: 'SPEED_BOOST', name: '加速', color: '#FFD700', icon: '⚡' },
    SHIELD: { type: 'SHIELD', name: '护盾', color: '#4FC3F7', icon: '🛡️' },
    MAGNET: { type: 'MAGNET', name: '磁铁', color: '#F06292', icon: '🧲' },
  };

  class UIManager {
    constructor() {
      this.screens = {};
      this.elements = {};
      this._cacheElements();
      this._lastHp = 3;
      this._lastScore = 0;
    }

    _cacheElements() {
      this.screens = {
        menu: document.getElementById('menu-screen'),
        pause: document.getElementById('pause-screen'),
        gameover: document.getElementById('gameover-screen'),
        history: document.getElementById('history-screen'),
        rank: document.getElementById('rank-screen'),
      };
      this.elements = {
        hud: document.getElementById('hud'),
        hpHearts: document.getElementById('hp-hearts'),
        scoreValue: document.getElementById('score-value'),
        distValue: document.getElementById('dist-value'),
        effectsBar: document.getElementById('effects-bar'),
        pauseBtn: document.getElementById('pause-btn'),
        reconnecting: document.getElementById('reconnecting-toast'),
        loading: document.getElementById('loading-toast'),
        loadingText: document.getElementById('loading-text'),
        menuHighScore: document.getElementById('menu-high-score'),
        menuTotalGames: document.getElementById('menu-total-games'),
        nicknameInput: document.getElementById('nickname-input'),
        pauseScore: document.getElementById('pause-score'),
        pauseDist: document.getElementById('pause-dist'),
        gameoverTitle: document.getElementById('gameover-title'),
        newRecordBadge: document.getElementById('new-record-badge'),
        finalScore: document.getElementById('final-score'),
        finalDist: document.getElementById('final-dist'),
        finalObstacles: document.getElementById('final-obstacles'),
        finalItems: document.getElementById('final-items'),
        finalDuration: document.getElementById('final-duration'),
        finalHighscore: document.getElementById('final-highscore'),
        historyList: document.getElementById('history-list'),
        rankList: document.getElementById('rank-list'),
      };
    }

    showScreen(name) {
      for (const [n, el] of Object.entries(this.screens)) {
        if (el) {
          if (n === name) el.classList.remove('hidden');
          else el.classList.add('hidden');
        }
      }
    }

    hideAllScreens() {
      Object.values(this.screens).forEach(el => el && el.classList.add('hidden'));
    }

    showHUD(show) {
      if (this.elements.hud) {
        show ? this.elements.hud.classList.remove('hidden') : this.elements.hud.classList.add('hidden');
      }
    }

    showLoading(text) {
      if (this.elements.loading) {
        if (text && this.elements.loadingText) this.elements.loadingText.textContent = text;
        this.elements.loading.classList.remove('hidden');
      }
    }

    hideLoading() {
      if (this.elements.loading) {
        this.elements.loading.classList.add('hidden');
      }
    }

    showReconnecting(show) {
      if (this.elements.reconnecting) {
        show ? this.elements.reconnecting.classList.remove('hidden') : this.elements.reconnecting.classList.add('hidden');
      }
    }

    updateHP(current, max, damaged = false) {
      if (!this.elements.hpHearts) return;
      const container = this.elements.hpHearts;
      container.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart' + (i >= current ? ' empty' : '') + (damaged && i === current ? ' damage' : '');
        heart.textContent = i < current ? '❤️' : '🖤';
        container.appendChild(heart);
      }
      this._lastHp = current;
    }

    updateScore(score) {
      if (this.elements.scoreValue) {
        this.elements.scoreValue.textContent = score.toLocaleString();
      }
      this._lastScore = score;
    }

    updateDistance(dist) {
      if (this.elements.distValue) {
        this.elements.distValue.textContent = Math.floor(dist) + 'm';
      }
    }

    updateEffects(effects) {
      if (!this.elements.effectsBar) return;
      const bar = this.elements.effectsBar;
      bar.innerHTML = '';
      if (!effects || effects.length === 0) return;

      const grouped = {};
      for (const e of effects) {
        if (!grouped[e.type]) grouped[e.type] = [];
        grouped[e.type].push(e);
      }

      for (const [type, list] of Object.entries(grouped)) {
        const cfg = ITEM_CONFIG[type];
        if (!cfg) continue;
        const totalRemaining = Math.max(...list.map(e => e.remainingTime || 0));
        const stacks = list.length;

        const badge = document.createElement('div');
        badge.className = 'effect-badge';
        badge.style.color = cfg.color;
        badge.style.position = 'relative';
        badge.style.overflow = 'hidden';

        const icon = document.createElement('span');
        icon.className = 'effect-icon';
        icon.textContent = cfg.icon;

        const name = document.createElement('span');
        name.className = 'effect-name';
        name.textContent = cfg.name;

        let stacksEl = null;
        if (stacks > 1) {
          stacksEl = document.createElement('span');
          stacksEl.className = 'effect-stacks';
          stacksEl.textContent = '×' + stacks;
        }

        const timer = document.createElement('span');
        timer.className = 'effect-timer';
        timer.textContent = (totalRemaining / 1000).toFixed(1) + 's';

        const duration = (ITEM_CONFIG[type] && ITEM_CONFIG[type].duration) || 5000;
        const progress = document.createElement('div');
        progress.className = 'effect-progress';
        progress.style.width = Math.min(100, (totalRemaining / duration) * 100) + '%';
        progress.style.color = cfg.color;

        badge.appendChild(icon);
        badge.appendChild(name);
        if (stacksEl) badge.appendChild(stacksEl);
        badge.appendChild(timer);
        badge.appendChild(progress);
        bar.appendChild(badge);
      }
    }

    updateMenuInfo(highScore, totalGames) {
      if (this.elements.menuHighScore) {
        this.elements.menuHighScore.textContent = (highScore || 0).toLocaleString();
      }
      if (this.elements.menuTotalGames) {
        this.elements.menuTotalGames.textContent = totalGames || 0;
      }
    }

    getNickname() {
      return this.elements.nicknameInput ? this.elements.nicknameInput.value.trim() || '玩家' : '玩家';
    }

    updatePause(score, dist) {
      if (this.elements.pauseScore) this.elements.pauseScore.textContent = score.toLocaleString();
      if (this.elements.pauseDist) this.elements.pauseDist.textContent = Math.floor(dist) + 'm';
    }

    updateGameOver(data) {
      if (this.elements.gameoverTitle) {
        this.elements.gameoverTitle.textContent = (data.hpRemaining || 0) <= 0 ? '生命耗尽' : '对局结束';
      }
      if (this.elements.newRecordBadge) {
        data.isNewRecord ? this.elements.newRecordBadge.classList.remove('hidden') : this.elements.newRecordBadge.classList.add('hidden');
      }
      if (this.elements.finalScore) this.elements.finalScore.textContent = (data.score || 0).toLocaleString();
      if (this.elements.finalDist) this.elements.finalDist.textContent = Math.floor(data.distance || 0) + 'm';
      if (this.elements.finalObstacles) this.elements.finalObstacles.textContent = data.obstaclesPassed || 0;
      if (this.elements.finalItems) this.elements.finalItems.textContent = data.itemsCollected || 0;
      if (this.elements.finalDuration) this.elements.finalDuration.textContent = Math.floor((data.duration || 0) / 1000) + 's';
      if (this.elements.finalHighscore) this.elements.finalHighscore.textContent = (data.highScore || 0).toLocaleString();
    }

    renderHistory(history) {
      if (!this.elements.historyList) return;
      const list = this.elements.historyList;
      if (!history || history.length === 0) {
        list.innerHTML = '<div class="empty-list">暂无游戏记录，快去挑战吧！</div>';
        return;
      }
      list.innerHTML = history.map((r, idx) => {
        const date = new Date(r.ended_at || Date.now());
        const dateStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
        return `
          <div class="history-item">
            <div class="history-left">
              <span class="history-date">${dateStr}</span>
              <span class="history-detail">${Math.floor(r.distance)}m · ${Math.floor(r.duration/1000)}s</span>
            </div>
            <div class="history-score">${r.score.toLocaleString()}</div>
          </div>
        `;
      }).join('');
    }

    renderRank(scores) {
      if (!this.elements.rankList) return;
      const list = this.elements.rankList;
      if (!scores || scores.length === 0) {
        list.innerHTML = '<div class="empty-list">暂无排行数据</div>';
        return;
      }
      list.innerHTML = scores.map((r, idx) => {
        const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : 'rank-other';
        const displayName = (r.nickname || '玩家').slice(0, 8);
        return `
          <div class="rank-item">
            <div class="rank-left">
              <div class="rank-num ${rankClass}">${idx + 1}</div>
              <div>
                <div class="rank-name">${displayName}</div>
                <div class="rank-games">${r.total_games || 0} 场</div>
              </div>
            </div>
            <div class="rank-score">${(r.high_score || 0).toLocaleString()}</div>
          </div>
        `;
      }).join('');
    }

    bindButton(id, handler) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => { e.stopPropagation(); handler(e); });
    }
  }

  global.UIManager = UIManager;
})(window);
