(function(global) {
  'use strict';

  const OBSTACLE_TYPES = {
    SPIKE: 'SPIKE',
    PIT: 'PIT',
    MOVING_V: 'MOVING_V',
    MOVING_H: 'MOVING_H',
    BLOCK: 'BLOCK',
    LOW_BAR: 'LOW_BAR',
  };
  const PLATFORM_TYPES = {
    NORMAL: 'NORMAL',
    MOVING: 'MOVING',
    BREAKABLE: 'BREAKABLE',
  };
  const ITEM_CONFIG = {
    SPEED_BOOST: { type: 'SPEED_BOOST', name: '加速', color: '#FFD700', icon: '⚡' },
    SHIELD: { type: 'SHIELD', name: '护盾', color: '#4FC3F7', icon: '🛡️' },
    MAGNET: { type: 'MAGNET', name: '磁铁', color: '#F06292', icon: '🧲' },
  };
  const PLAYER_STATES = {
    RUNNING: 'RUNNING', JUMPING: 'JUMPING', DOUBLE_JUMPING: 'DOUBLE_JUMPING',
    SLIDING: 'SLIDING', FALLING: 'FALLING', HURT: 'HURT', DEAD: 'DEAD',
  };

  class GameRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = canvas.width;
      this.H = canvas.height;
      this.dpr = window.devicePixelRatio || 1;
      this._setupHiDPI();
      this.bgTime = 0;
      this.frameCount = 0;
      this.lastWorld = null;
      this.particles = [];
      this.shakeTime = 0;
      this.shakeMagnitude = 0;
    }

    _setupHiDPI() {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = rect.height * this.dpr;
      this.ctx.scale(this.dpr, this.dpr);
      this.W = rect.width;
      this.H = rect.height;
    }

    resize() {
      this._setupHiDPI();
    }

    triggerShake(magnitude = 8, duration = 300) {
      this.shakeTime = duration;
      this.shakeMagnitude = magnitude;
    }

    _addParticles(x, y, color, count = 8, opts = {}) {
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x, y,
          vx: (Math.random() - 0.5) * (opts.speed || 5),
          vy: (Math.random() - 0.8) * (opts.speed || 5),
          size: Math.random() * 3 + 1,
          color,
          life: 500 + Math.random() * 300,
          maxLife: 800,
          gravity: opts.gravity !== undefined ? opts.gravity : 0.15,
        });
      }
    }

    _updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
    }

    render(world, dt) {
      this.frameCount++;
      this.bgTime += dt;
      if (this.shakeTime > 0) this.shakeTime -= dt;

      this._updateParticles(dt);

      const shakeX = this.shakeTime > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 2 : 0;
      const shakeY = this.shakeTime > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 2 : 0;

      this.ctx.save();
      this.ctx.translate(shakeX, shakeY);

      this._drawBackground(world);

      if (world) {
        const camX = world.cameraX || 0;
        this.ctx.save();
        this.ctx.translate(-camX * (this.W / 800), 0);
        this._drawTerrain(world, camX);
        this._drawItems(world, camX);
        this._drawObstacles(world, camX);
        this._drawPlayer(world, camX);
        this._drawParticles();
        this.ctx.restore();
      }

      this.ctx.restore();
      this.lastWorld = world;
    }

    _drawBackground(world) {
      const w = this.W, h = this.H;
      const t = this.bgTime * 0.0001;
      const grad = this.ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#1a1a3e');
      grad.addColorStop(0.4, '#2d1b4e');
      grad.addColorStop(0.75, '#5c3d6e');
      grad.addColorStop(1, '#9a6a7e');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, w, h);

      const sunX = w * 0.85;
      const sunY = h * 0.25;
      const sunGrad = this.ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 120);
      sunGrad.addColorStop(0, 'rgba(255, 220, 150, 0.9)');
      sunGrad.addColorStop(0.4, 'rgba(255, 160, 100, 0.3)');
      sunGrad.addColorStop(1, 'rgba(255, 100, 80, 0)');
      this.ctx.fillStyle = sunGrad;
      this.ctx.fillRect(sunX - 120, sunY - 120, 240, 240);
      this.ctx.beginPath();
      this.ctx.fillStyle = '#ffe2b5';
      this.ctx.arc(sunX, sunY, 32, 0, Math.PI * 2);
      this.ctx.fill();

      const camX = world ? world.cameraX || 0 : 0;
      this._drawMountains(camX * 0.15, w, h * 0.55, h * 0.12, '#2a1e4a', h * 0.3);
      this._drawMountains(camX * 0.3, w, h * 0.65, h * 0.09, '#3b275c', h * 0.25);
      this._drawMountains(camX * 0.5, w, h * 0.72, h * 0.06, '#4a3068', h * 0.2);

      const cloudOffset = (camX * 0.08) % 400;
      for (let i = -1; i < 4; i++) {
        const cx = i * 300 - cloudOffset + 50;
        const cy = 40 + (i % 3) * 25;
        this._drawCloud(cx, cy, 0.7 + (i % 2) * 0.4);
      }
    }

    _drawMountains(offset, w, baseY, amp, color, height) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, this.H);
      const step = 60;
      for (let x = -offset % step - step; x <= w + step; x += step) {
        const seed = Math.floor((x + offset) / step);
        const rand = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
        const peakY = baseY - rand * height;
        this.ctx.lineTo(x, peakY);
      }
      this.ctx.lineTo(w, this.H);
      this.ctx.closePath();
      this.ctx.fillStyle = color;
      this.ctx.fill();
    }

    _drawCloud(x, y, scale) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.arc(x, y, 18 * scale, 0, Math.PI * 2);
      ctx.arc(x + 18 * scale, y + 4, 22 * scale, 0, Math.PI * 2);
      ctx.arc(x + 40 * scale, y - 2, 16 * scale, 0, Math.PI * 2);
      ctx.arc(x + 55 * scale, y + 6, 14 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawTerrain(world, camX) {
      const terrain = world.terrain || {};
      const platforms = terrain.platforms || [];
      for (const plat of platforms) {
        this._drawPlatform(plat);
      }
    }

    _drawPlatform(plat) {
      const ctx = this.ctx;
      const x = plat.x, y = plat.y, w = plat.width, h = plat.height;
      const isGround = plat.isGround;
      const isMoving = plat.type === PLATFORM_TYPES.MOVING;

      if (isGround) {
        const groundGrad = ctx.createLinearGradient(x, y, x, y + h);
        groundGrad.addColorStop(0, '#6b8e4e');
        groundGrad.addColorStop(0.12, '#4a6b37');
        groundGrad.addColorStop(0.3, '#6e563f');
        groundGrad.addColorStop(1, '#3d2f23');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(x, y, w, h);

        ctx.fillStyle = '#7fa65a';
        for (let gx = x; gx < x + w; gx += 6) {
          const gh = 3 + ((gx * 7) % 5);
          ctx.fillRect(gx, y - gh + 1, 3, gh);
        }
      } else {
        const pGrad = ctx.createLinearGradient(x, y, x, y + h);
        if (isMoving) {
          pGrad.addColorStop(0, '#7b68ee');
          pGrad.addColorStop(1, '#4a3e99');
        } else {
          pGrad.addColorStop(0, '#8b7355');
          pGrad.addColorStop(0.5, '#6b5344');
          pGrad.addColorStop(1, '#4a3728');
        }
        ctx.fillStyle = pGrad;
        this._roundRect(ctx, x, y, w, h, 4, true, false);

        ctx.fillStyle = isMoving ? 'rgba(186, 156, 255, 0.6)' : 'rgba(160, 128, 90, 0.7)';
        ctx.fillRect(x + 4, y + 2, w - 8, 3);

        if (isMoving) {
          ctx.strokeStyle = 'rgba(200, 180, 255, 0.5)';
          ctx.lineWidth = 1.5;
          this._roundRect(ctx, x, y, w, h, 4, false, true);
        }
      }
    }

    _drawObstacles(world, camX) {
      const obstacles = (world.terrain && world.terrain.obstacles) || [];
      for (const obs of obstacles) {
        this._drawObstacle(obs);
      }
    }

    _drawObstacle(obs) {
      const ctx = this.ctx;
      switch (obs.type) {
        case OBSTACLE_TYPES.SPIKE:
          this._drawSpike(obs);
          break;
        case OBSTACLE_TYPES.PIT:
          this._drawPit(obs);
          break;
        case OBSTACLE_TYPES.BLOCK:
          this._drawBlock(obs);
          break;
        case OBSTACLE_TYPES.LOW_BAR:
          this._drawLowBar(obs);
          break;
        case OBSTACLE_TYPES.MOVING_V:
        case OBSTACLE_TYPES.MOVING_H:
          this._drawMovingObstacle(obs);
          break;
      }
    }

    _drawSpike(obs) {
      const ctx = this.ctx;
      const count = obs.spikeCount || 1;
      const spikeW = obs.width / count;
      const spikeH = obs.height;

      for (let i = 0; i < count; i++) {
        const sx = obs.x + i * spikeW;
        ctx.beginPath();
        const grad = ctx.createLinearGradient(sx, obs.y + spikeH, sx, obs.y);
        grad.addColorStop(0, '#666');
        grad.addColorStop(0.5, '#aaa');
        grad.addColorStop(1, '#e0e0e0');
        ctx.fillStyle = grad;
        ctx.moveTo(sx + spikeW * 0.1, obs.y + spikeH);
        ctx.lineTo(sx + spikeW / 2, obs.y);
        ctx.lineTo(sx + spikeW * 0.9, obs.y + spikeH);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    _drawPit(obs) {
      const ctx = this.ctx;
      const pitGrad = ctx.createLinearGradient(obs.x, obs.y, obs.x, obs.y + obs.height);
      pitGrad.addColorStop(0, '#1a0f0a');
      pitGrad.addColorStop(1, '#000');
      ctx.fillStyle = pitGrad;
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

      ctx.strokeStyle = '#4a3728';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(obs.x, obs.y);
      ctx.lineTo(obs.x + obs.width, obs.y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(100, 70, 50, 0.3)';
      for (let i = 0; i < obs.width; i += 12) {
        ctx.fillRect(obs.x + i, obs.y + 5, 2, 15 + (i % 3) * 10);
      }
    }

    _drawBlock(obs) {
      const ctx = this.ctx;
      const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x, obs.y + obs.height);
      grad.addColorStop(0, '#c0392b');
      grad.addColorStop(0.5, '#a32920');
      grad.addColorStop(1, '#7a1f18');
      ctx.fillStyle = grad;
      this._roundRect(ctx, obs.x, obs.y, obs.width, obs.height, 4, true, false);

      ctx.strokeStyle = 'rgba(255, 100, 80, 0.6)';
      ctx.lineWidth = 2;
      this._roundRect(ctx, obs.x + 2, obs.y + 2, obs.width - 4, obs.height - 4, 3, false, true);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(obs.x + 5, obs.y + 5, obs.width - 10, 3);

      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', obs.x + obs.width / 2, obs.y + obs.height / 2);
    }

    _drawLowBar(obs) {
      const ctx = this.ctx;
      const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x, obs.y + obs.height);
      grad.addColorStop(0, '#f39c12');
      grad.addColorStop(1, '#b8860b');
      ctx.fillStyle = grad;
      this._roundRect(ctx, obs.x, obs.y, obs.width, obs.height, 4, true, false);

      ctx.strokeStyle = 'rgba(255, 200, 100, 0.5)';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, obs.x, obs.y, obs.width, obs.height, 4, false, true);

      ctx.strokeStyle = 'rgba(139, 69, 19, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(obs.x + 5, obs.y + obs.height / 2);
      ctx.lineTo(obs.x + obs.width - 5, obs.y + obs.height / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    _drawMovingObstacle(obs) {
      const ctx = this.ctx;
      const isVertical = obs.type === OBSTACLE_TYPES.MOVING_V;

      const glowColor = isVertical ? 'rgba(255, 100, 200, 0.4)' : 'rgba(100, 200, 255, 0.4)';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 15;

      const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.width, obs.y + obs.height);
      if (isVertical) {
        grad.addColorStop(0, '#e91e63');
        grad.addColorStop(1, '#880e4f');
      } else {
        grad.addColorStop(0, '#00bcd4');
        grad.addColorStop(1, '#006064');
      }
      ctx.fillStyle = grad;
      this._roundRect(ctx, obs.x, obs.y, obs.width, obs.height, 6, true, false);

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, obs.x + 2, obs.y + 2, obs.width - 4, obs.height - 4, 4, false, true);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isVertical ? '↕' : '↔', obs.x + obs.width / 2, obs.y + obs.height / 2);
    }

    _drawItems(world, camX) {
      const items = (world.terrain && world.terrain.items) || [];
      for (const item of items) {
        this._drawItem(item);
      }
    }

    _drawItem(item) {
      const ctx = this.ctx;
      const cfg = ITEM_CONFIG[item.type];
      if (!cfg) return;

      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      const radius = Math.max(item.width, item.height) / 2 + 6;

      const glowGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius + 10);
      glowGrad.addColorStop(0, cfg.color + 'aa');
      glowGrad.addColorStop(0.5, cfg.color + '44');
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(cx - radius - 10, cy - radius - 10, (radius + 10) * 2, (radius + 10) * 2);

      ctx.beginPath();
      const itemGrad = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, radius);
      itemGrad.addColorStop(0, '#ffffff');
      itemGrad.addColorStop(0.3, cfg.color);
      itemGrad.addColorStop(1, cfg.color + 'cc');
      ctx.fillStyle = itemGrad;
      ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.icon, cx, cy + 1);
    }

    _drawPlayer(world, camX) {
      const p = world.player;
      if (!p) return;
      const ctx = this.ctx;
      const px = p.x, py = p.y, pw = p.width, ph = p.height;
      const cx = px + pw / 2;
      const cy = py + ph / 2;

      const isInvincible = Date.now() < (p.invincibleUntil || 0);
      if (isInvincible && Math.floor(this.frameCount / 4) % 2 === 0) {
        ctx.globalAlpha = 0.4;
      }

      if (world.activeEffects && world.activeEffects.some(e => e.type === 'SHIELD')) {
        const shieldCount = world.activeEffects.filter(e => e.type === 'SHIELD').length;
        for (let s = 0; s < shieldCount; s++) {
          const sR = Math.max(pw, ph) / 2 + 10 + s * 4;
          const sGrad = ctx.createRadialGradient(cx, cy, sR * 0.5, cx, cy, sR + 3);
          sGrad.addColorStop(0, 'rgba(100, 200, 255, 0)');
          sGrad.addColorStop(0.7, 'rgba(100, 200, 255, 0.3)');
          sGrad.addColorStop(1, 'rgba(100, 200, 255, 0.6)');
          ctx.fillStyle = sGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, sR + 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = `rgba(150, 220, 255, ${0.6 + Math.sin(this.bgTime * 0.005) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, sR, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const bodyGrad = ctx.createLinearGradient(px, py, px, py + ph);
      bodyGrad.addColorStop(0, '#5e81f7');
      bodyGrad.addColorStop(0.5, '#4361ee');
      bodyGrad.addColorStop(1, '#2e43c8');
      ctx.fillStyle = bodyGrad;
      this._roundRect(ctx, px + 2, py + 2, pw - 4, ph - 4, 6, true, false);

      ctx.fillStyle = '#ffe0bd';
      const headR = p.isSliding ? 7 : 10;
      const headY = py + (p.isSliding ? 6 : 10);
      ctx.beginPath();
      ctx.arc(cx, headY, headR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx - 3, headY - 1, 2.5, 0, Math.PI * 2);
      ctx.arc(cx + 4, headY - 1, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(cx - 2.5, headY - 1, 1.2, 0, Math.PI * 2);
      ctx.arc(cx + 4.5, headY - 1, 1.2, 0, Math.PI * 2);
      ctx.fill();

      if (p.state === PLAYER_STATES.RUNNING && p.onGround) {
        const legOffset = Math.sin(this.bgTime * 0.02) * 6;
        ctx.fillStyle = '#2a3a8a';
        ctx.fillRect(px + 6, py + ph - 14, 10, 14 + legOffset);
        ctx.fillRect(px + pw - 16, py + ph - 14, 10, 14 - legOffset);
      } else if (p.state === PLAYER_STATES.JUMPING || p.state === PLAYER_STATES.DOUBLE_JUMPING) {
        ctx.fillStyle = '#2a3a8a';
        ctx.fillRect(px + 6, py + ph - 12, 10, 10);
        ctx.fillRect(px + pw - 16, py + ph - 16, 10, 12);

        if (p.state === PLAYER_STATES.DOUBLE_JUMPING) {
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(cx, py + ph, 8 + i * 6 + Math.sin(this.bgTime * 0.02) * 3, 0, Math.PI, true);
            ctx.stroke();
          }
        }
      } else if (p.state === PLAYER_STATES.FALLING) {
        ctx.fillStyle = '#2a3a8a';
        ctx.fillRect(px + 4, py + ph - 12, 12, 12);
        ctx.fillRect(px + pw - 16, py + ph - 10, 12, 10);
      } else if (p.state === PLAYER_STATES.SLIDING) {
        ctx.fillStyle = '#2a3a8a';
        ctx.fillRect(px + 4, py + ph - 10, pw - 8, 8);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(px - 10 - i * 8, py + ph - 6 + i * 2, 8, 3);
        }
      }

      if (world.activeEffects && world.activeEffects.some(e => e.type === 'SPEED_BOOST')) {
        const boostCount = world.activeEffects.filter(e => e.type === 'SPEED_BOOST').length;
        ctx.strokeStyle = `rgba(255, 215, 0, ${0.5 + boostCount * 0.1})`;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3 + boostCount; i++) {
          const lineY = py + 15 + i * 12;
          ctx.beginPath();
          ctx.moveTo(px - 20 - Math.random() * 10, lineY);
          ctx.lineTo(px - 5, lineY + Math.sin(this.bgTime * 0.01 + i) * 3);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    }

    _drawParticles() {
      for (const p of this.particles) {
        const alpha = Math.max(0, p.life / p.maxLife);
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.globalAlpha = 1;
    }

    _roundRect(ctx, x, y, w, h, r, fill, stroke) {
      if (w < 2 * r) r = w / 2;
      if (h < 2 * r) r = h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }
  }

  global.GameRenderer = GameRenderer;
  global.RenderItemConfig = ITEM_CONFIG;
})(window);
