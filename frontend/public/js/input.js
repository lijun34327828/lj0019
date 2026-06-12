(function(global) {
  'use strict';

  class InputManager {
    constructor(target) {
      this.target = target || document;
      this.handlers = {};
      this.isSliding = false;
      this.slideHoldTimer = null;
      this.lastJumpTime = 0;
      this.jumpBuffer = 0;
      this.touchStartY = 0;
      this.touchStartX = 0;
      this.touchStartTime = 0;
      this.longPressTimer = null;
      this.enabled = true;
      this._bindEvents();
    }

    on(event, handler) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(handler);
      return () => {
        this.handlers[event] = this.handlers[event].filter(h => h !== handler);
      };
    }

    _emit(event, data) {
      (this.handlers[event] || []).forEach(h => {
        try { h(data); } catch (e) { console.error('[INPUT] Handler error:', e); }
      });
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    _bindEvents() {
      window.addEventListener('keydown', (e) => this._onKeyDown(e));
      window.addEventListener('keyup', (e) => this._onKeyUp(e));

      const el = this.target instanceof HTMLElement ? this.target : document.getElementById('game-container') || document;

      el.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      el.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      el.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
      el.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });

      el.addEventListener('mousedown', (e) => this._onMouseDown(e));
      el.addEventListener('mouseup', (e) => this._onMouseUp(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _onKeyDown(e) {
      if (!this.enabled) return;
      const now = Date.now();
      switch (e.code) {
        case 'Space':
        case 'ArrowUp':
        case 'KeyW':
          e.preventDefault();
          if (now - this.lastJumpTime > 100) {
            this._emit('jump');
            this.lastJumpTime = now;
          }
          break;
        case 'ArrowDown':
        case 'KeyS':
          e.preventDefault();
          if (!this.isSliding) {
            this.isSliding = true;
            this._emit('slideStart');
          }
          break;
        case 'KeyP':
        case 'Escape':
          e.preventDefault();
          this._emit('pauseToggle');
          break;
        case 'KeyR':
          this._emit('restart');
          break;
      }
    }

    _onKeyUp(e) {
      switch (e.code) {
        case 'ArrowDown':
        case 'KeyS':
          if (this.isSliding) {
            this.isSliding = false;
            this._emit('slideEnd');
          }
          break;
      }
    }

    _getTouchPosition(e) {
      if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      if (e.changedTouches && e.changedTouches.length > 0) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      }
      return { x: 0, y: 0 };
    }

    _onTouchStart(e) {
      if (!this.enabled) return;
      e.preventDefault();
      const pos = this._getTouchPosition(e);
      this.touchStartX = pos.x;
      this.touchStartY = pos.y;
      this.touchStartTime = Date.now();

      const container = document.getElementById('game-container');
      const rect = container ? container.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const relativeY = pos.y - rect.top;
      const halfHeight = rect.height / 2;

      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      
      if (relativeY > halfHeight) {
        const self = this;
        this.longPressTimer = setTimeout(() => {
          if (self.enabled && !self.isSliding) {
            self.isSliding = true;
            self._emit('slideStart');
          }
        }, 120);
      }
    }

    _onTouchMove(e) {
      if (!this.enabled) return;
      e.preventDefault();
      const pos = this._getTouchPosition(e);
      const deltaY = pos.y - this.touchStartY;
      const deltaX = pos.x - this.touchStartX;

      if (deltaY < -50 && Math.abs(deltaY) > Math.abs(deltaX)) {
        if (Date.now() - this.lastJumpTime > 100) {
          this._emit('jump');
          this.lastJumpTime = Date.now();
          this.touchStartY = pos.y;
        }
      }
    }

    _onTouchEnd(e) {
      if (!this.enabled) return;
      e.preventDefault();
      const pos = this._getTouchPosition(e);
      const elapsed = Date.now() - this.touchStartTime;
      const deltaY = pos.y - this.touchStartY;
      const deltaX = pos.x - this.touchStartX;
      const absDeltaY = Math.abs(deltaY);
      const absDeltaX = Math.abs(deltaX);

      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }

      const container = document.getElementById('game-container');
      const rect = container ? container.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const relativeStartY = this.touchStartY - rect.top;
      const halfHeight = rect.height / 2;

      if (this.isSliding) {
        this.isSliding = false;
        this._emit('slideEnd');
      }

      const isTap = elapsed < 250 && absDeltaX < 20 && absDeltaY < 20;
      const isSwipeUp = deltaY < -40 && absDeltaY > absDeltaX;

      if (isTap && relativeStartY <= halfHeight) {
        if (Date.now() - this.lastJumpTime > 100) {
          this._emit('jump');
          this.lastJumpTime = Date.now();
        }
      } else if (isSwipeUp) {
        if (Date.now() - this.lastJumpTime > 100) {
          this._emit('jump');
          this.lastJumpTime = Date.now();
        }
      }
    }

    _onMouseDown(e) {
      if (!this.enabled) return;
      const container = document.getElementById('game-container');
      const rect = container ? container.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const relativeY = e.clientY - rect.top;
      const halfHeight = rect.height / 2;

      if (relativeY <= halfHeight) {
        if (Date.now() - this.lastJumpTime > 100) {
          this._emit('jump');
          this.lastJumpTime = Date.now();
        }
      } else {
        if (!this.isSliding) {
          this.isSliding = true;
          this._emit('slideStart');
        }
      }
    }

    _onMouseUp(e) {
      if (this.isSliding) {
        this.isSliding = false;
        this._emit('slideEnd');
      }
    }

    reset() {
      if (this.isSliding) {
        this.isSliding = false;
        this._emit('slideEnd');
      }
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }
  }

  global.InputManager = InputManager;
})(window);
