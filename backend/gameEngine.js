const { GAME_CONFIG, ITEM_CONFIG, GAME_STATES, PLAYER_STATES, MESSAGE_TYPES, OBSTACLE_TYPES, PLATFORM_TYPES } = require('../shared/constants');

class GameEngine {
  constructor() {
    this.sessions = new Map();
  }

  createSession(sessionId, playerId) {
    const groundY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT;
    const session = {
      sessionId,
      playerId,
      state: GAME_STATES.PLAYING,
      createdAt: Date.now(),
      lastUpdate: Date.now(),
      lastSnapshot: null,
      player: {
        id: playerId,
        x: 100,
        y: groundY - GAME_CONFIG.PLAYER_HEIGHT,
        worldX: 100,
        vx: 0,
        vy: 0,
        width: GAME_CONFIG.PLAYER_WIDTH,
        height: GAME_CONFIG.PLAYER_HEIGHT,
        state: PLAYER_STATES.RUNNING,
        hp: GAME_CONFIG.INITIAL_HP,
        maxHp: GAME_CONFIG.INITIAL_HP,
        onGround: true,
        canDoubleJump: true,
        isSliding: false,
        invincibleUntil: 0,
        jumpCount: 0,
        facingRight: true,
        lastHurt: 0,
      },
      score: 0,
      distance: 0,
      speed: GAME_CONFIG.BASE_SPEED,
      obstaclesPassed: 0,
      itemsCollected: 0,
      collectedItemIds: new Set(),
      passedObstacleIds: new Set(),
      activeEffects: [],
      cameraX: 0,
      gameStartTime: Date.now(),
      duration: 0,
      isNewRecord: false,
      pendingActions: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  restoreFromSnapshot(sessionId, snapshot) {
    const session = this.createSession(sessionId, snapshot.playerId);
    Object.assign(session, snapshot);
    session.collectedItemIds = new Set(snapshot.collectedItemIds || []);
    session.passedObstacleIds = new Set(snapshot.passedObstacleIds || []);
    session.state = GAME_STATES.PLAYING;
    session.lastUpdate = Date.now();
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  createSnapshot(session) {
    return {
      sessionId: session.sessionId,
      playerId: session.playerId,
      state: session.state,
      player: { ...session.player },
      score: session.score,
      distance: session.distance,
      speed: session.speed,
      obstaclesPassed: session.obstaclesPassed,
      itemsCollected: session.itemsCollected,
      collectedItemIds: Array.from(session.collectedItemIds),
      passedObstacleIds: Array.from(session.passedObstacleIds),
      activeEffects: session.activeEffects.map(e => ({ ...e })),
      cameraX: session.cameraX,
      gameStartTime: session.gameStartTime,
      duration: session.duration,
      isNewRecord: session.isNewRecord,
    };
  }

  processPlayerAction(session, action) {
    if (session.state !== GAME_STATES.PLAYING) return;
    const player = session.player;
    const now = Date.now();

    switch (action.type) {
      case 'JUMP': {
        if (player.onGround) {
          player.vy = GAME_CONFIG.JUMP_FORCE;
          player.onGround = false;
          player.state = PLAYER_STATES.JUMPING;
          player.jumpCount = 1;
          player.canDoubleJump = true;
        } else if (player.canDoubleJump && player.jumpCount < 2) {
          player.vy = GAME_CONFIG.DOUBLE_JUMP_FORCE;
          player.state = PLAYER_STATES.DOUBLE_JUMPING;
          player.jumpCount = 2;
          player.canDoubleJump = false;
        }
        break;
      }
      case 'SLIDE_START': {
        if (player.onGround && !player.isSliding) {
          player.isSliding = true;
          player.state = PLAYER_STATES.SLIDING;
          const prevBottom = player.y + player.height;
          player.height = GAME_CONFIG.SLIDE_HEIGHT;
          player.y = prevBottom - player.height;
        }
        break;
      }
      case 'SLIDE_END': {
        if (player.isSliding) {
          player.isSliding = false;
          const prevBottom = player.y + player.height;
          player.height = GAME_CONFIG.PLAYER_HEIGHT;
          player.y = prevBottom - player.height;
          if (player.onGround) {
            player.state = PLAYER_STATES.RUNNING;
          }
        }
        break;
      }
      case 'PAUSE': {
        session.state = GAME_STATES.PAUSED;
        break;
      }
      case 'RESUME': {
        session.state = GAME_STATES.PLAYING;
        session.lastUpdate = now;
        break;
      }
    }
  }

  update(session, deltaTime, terrain) {
    if (session.state !== GAME_STATES.PLAYING) return;
    const now = Date.now();
    const player = session.player;
    const groundY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT;

    session.duration = now - session.gameStartTime;
    this.updateEffects(session, now);

    const baseSpeed = Math.min(
      GAME_CONFIG.MAX_SPEED,
      GAME_CONFIG.BASE_SPEED + session.distance * GAME_CONFIG.SPEED_INCREMENT
    );
    const speedMultiplier = this.getSpeedMultiplier(session);
    session.speed = baseSpeed * speedMultiplier;

    player.worldX += session.speed;
    session.distance = player.worldX;
    session.cameraX = player.worldX - 150;

    player.vy += GAME_CONFIG.GRAVITY;
    player.y += player.vy;

    this.handlePlatformCollisions(player, terrain.platforms, groundY, terrain.obstacles);

    if (!player.onGround && !player.isSliding) {
      if (player.vy > 0) {
        player.state = PLAYER_STATES.FALLING;
      } else if (player.jumpCount === 1) {
        player.state = PLAYER_STATES.JUMPING;
      } else if (player.jumpCount === 2) {
        player.state = PLAYER_STATES.DOUBLE_JUMPING;
      }
    } else if (player.onGround && !player.isSliding) {
      player.state = PLAYER_STATES.RUNNING;
    }

    if (player.y > GAME_CONFIG.CANVAS_HEIGHT + 100) {
      this.damagePlayer(session, 999, now);
      return;
    }

    this.checkObstacleCollisions(session, terrain.obstacles, now);
    this.checkItemCollisions(session, terrain.items, now);

    const scoreFromDistance = Math.floor(session.distance * GAME_CONFIG.SCORE_PER_DISTANCE);
    session.score = scoreFromDistance + session.obstaclesPassed * GAME_CONFIG.SCORE_PER_OBSTACLE_PASS + session.itemsCollected * GAME_CONFIG.SCORE_PER_ITEM;

    if (player.hp <= 0) {
      session.state = GAME_STATES.GAME_OVER;
    }
  }

  updateEffects(session, now) {
    session.activeEffects = session.activeEffects.filter(effect => {
      if (effect.endTime && now > effect.endTime) {
        return false;
      }
      return true;
    });
  }

  getSpeedMultiplier(session) {
    let mult = 1;
    for (const effect of session.activeEffects) {
      if (effect.type === 'SPEED_BOOST') {
      }
    }
    const boostEffects = session.activeEffects.filter(e => e.type === 'SPEED_BOOST');
    for (const e of boostEffects) {
      mult *= ITEM_CONFIG.SPEED_BOOST.speedMultiplier;
    }
    return Math.min(mult, Math.pow(ITEM_CONFIG.SPEED_BOOST.speedMultiplier, ITEM_CONFIG.SPEED_BOOST.maxStacks));
  }

  hasShield(session) {
    return session.activeEffects.some(e => e.type === 'SHIELD');
  }

  getShieldCount(session) {
    return session.activeEffects.filter(e => e.type === 'SHIELD').length;
  }

  hasMagnet(session) {
    return session.activeEffects.some(e => e.type === 'MAGNET');
  }

  getMagnetRange(session) {
    const magnet = session.activeEffects.find(e => e.type === 'MAGNET');
    return magnet ? ITEM_CONFIG.MAGNET.magnetRange : 0;
  }

  handlePlatformCollisions(player, platforms, groundY, obstacles) {
    player.onGround = false;
    const prevBottom = player.y + player.height - player.vy;
    const playerWorldX = player.worldX;
    const playerCenterX = playerWorldX + player.width / 2;

    let inPit = false;
    for (const obs of obstacles) {
      if (obs.type === OBSTACLE_TYPES.PIT) {
        if (playerCenterX > obs.x + 5 && playerCenterX < obs.x + obs.width - 5) {
          inPit = true;
          break;
        }
      }
    }

    const sortedPlatforms = [...platforms].sort((a, b) => b.y - a.y);
    for (const plat of sortedPlatforms) {
      if (plat.isGround && inPit) continue;
      this.checkPlatformCollision(player, plat, prevBottom);
    }
  }

  checkPlatformCollision(player, plat, prevBottom) {
    const px = player.worldX;
    const py = player.y;
    const pw = player.width;
    const ph = player.height;
    const platX = plat.x;
    const platY = plat.y;
    const platW = plat.width;

    const overlapX = px + pw > platX && px < platX + platW;
    if (!overlapX) return false;

    const playerBottom = py + ph;
    const platTop = platY;
    if (player.vy >= 0 && prevBottom <= platTop + 2 && playerBottom >= platTop) {
      player.y = platTop - ph;
      player.vy = 0;
      player.onGround = true;
      player.jumpCount = 0;
      player.canDoubleJump = true;
      if (player.isSliding) {
        player.state = PLAYER_STATES.SLIDING;
      }
      return true;
    }
    return false;
  }

  checkObstacleCollisions(session, obstacles, now) {
    const player = session.player;
    for (const obs of obstacles) {
      if (session.passedObstacleIds.has(obs.id)) {
        if (player.worldX > obs.x + obs.width) {
        }
        continue;
      }

      if (player.worldX > obs.x + obs.width && !session.passedObstacleIds.has(obs.id)) {
        session.passedObstacleIds.add(obs.id);
        if (obs.type !== OBSTACLE_TYPES.PIT) {
          session.obstaclesPassed++;
        }
        continue;
      }

      if (obs.type === OBSTACLE_TYPES.PIT) {
        const playerCenter = player.worldX + player.width / 2;
        if (playerCenter > obs.x && playerCenter < obs.x + obs.width) {
          if (player.y + player.height >= GAME_CONFIG.CANVAS_HEIGHT + 10) {
            this.damagePlayer(session, 999, now);
            return;
          }
        }
        continue;
      }

      if (this.checkObstacleAABB(player, obs)) {
        if (now < player.invincibleUntil) continue;

        if (this.hasShield(session)) {
          this.consumeShield(session);
          player.invincibleUntil = now + GAME_CONFIG.INVINCIBLE_DURATION;
          continue;
        }

        this.damagePlayer(session, 1, now);
      }
    }
  }

  checkObstacleAABB(player, obs) {
    if (obs.type === OBSTACLE_TYPES.PIT) return false;
    return (
      player.worldX + player.width > obs.x + 5 &&
      player.worldX < obs.x + obs.width - 5 &&
      player.y + player.height > obs.y + 5 &&
      player.y < obs.y + obs.height - 5
    );
  }

  damagePlayer(session, damage, now) {
    const player = session.player;
    player.hp -= damage;
    player.state = PLAYER_STATES.HURT;
    player.invincibleUntil = now + GAME_CONFIG.INVINCIBLE_DURATION;
    player.lastHurt = now;
    if (player.hp <= 0) {
      player.hp = 0;
      player.state = PLAYER_STATES.DEAD;
      session.state = GAME_STATES.GAME_OVER;
    }
  }

  consumeShield(session) {
    const idx = session.activeEffects.findIndex(e => e.type === 'SHIELD');
    if (idx >= 0) {
      session.activeEffects.splice(idx, 1);
    }
  }

  checkItemCollisions(session, items, now) {
    const player = session.player;
    const magnetRange = this.getMagnetRange(session);
    const hasMagnet = this.hasMagnet(session);

    for (const item of items) {
      if (session.collectedItemIds.has(item.id)) continue;

      const itemCX = item.x + item.width / 2;
      const itemCY = item.y + (item.bobOffset || 0) + item.height / 2;
      const playerCX = player.worldX + player.width / 2;
      const playerCY = player.y + player.height / 2;
      const dist = Math.hypot(itemCX - playerCX, itemCY - playerCY);

      if (hasMagnet && dist < magnetRange) {
        const dx = playerCX - itemCX;
        const dy = playerCY - itemCY;
        const pullStrength = 0.15;
        item.x += dx * pullStrength;
        item.y += dy * pullStrength;
      }

      if (
        player.worldX + player.width > item.x &&
        player.worldX < item.x + item.width &&
        player.y + player.height > item.y + (item.bobOffset || 0) &&
        player.y < item.y + (item.bobOffset || 0) + item.height
      ) {
        this.collectItem(session, item, now);
      }
    }
  }

  collectItem(session, item, now) {
    session.collectedItemIds.add(item.id);
    session.itemsCollected++;
    const cfg = ITEM_CONFIG[item.type];
    if (!cfg) return;

    if (cfg.stackable) {
      const existingCount = session.activeEffects.filter(e => e.type === cfg.type).length;
      if (existingCount < cfg.maxStacks) {
        session.activeEffects.push({
          type: cfg.type,
          startTime: now,
          endTime: now + cfg.duration,
          stacks: existingCount + 1,
        });
      } else {
          const existing = session.activeEffects.filter(e => e.type === cfg.type);
          if (existing.length > 0) {
            existing[existing.length - 1].endTime = now + cfg.duration;
          }
        }
    } else {
      const existing = session.activeEffects.findIndex(e => e.type === cfg.type);
      if (existing >= 0) {
        session.activeEffects.splice(existing, 1);
      }
      session.activeEffects.push({
        type: cfg.type,
        startTime: now,
        endTime: now + cfg.duration,
        stacks: 1,
      });
    }
  }

  getWorldUpdate(session, terrain) {
    const screenX = session.player.worldX - session.cameraX;
    return {
      type: MESSAGE_TYPES.WORLD_UPDATE,
      timestamp: Date.now(),
      player: {
        x: screenX,
        y: session.player.y,
        worldX: session.player.worldX,
        state: session.player.state,
        hp: session.player.hp,
        width: session.player.width,
        height: session.player.height,
        isSliding: session.player.isSliding,
        invincibleUntil: session.player.invincibleUntil,
        jumpCount: session.player.jumpCount,
        onGround: session.player.onGround,
      },
      cameraX: session.cameraX,
      score: Math.floor(session.score),
      distance: Math.floor(session.distance),
      speed: session.speed,
      obstaclesPassed: session.obstaclesPassed,
      itemsCollected: session.itemsCollected,
      activeEffects: session.activeEffects.map(e => ({
        type: e.type,
        remainingTime: Math.max(0, e.endTime - Date.now()),
        stacks: e.stacks,
      })),
      terrain: {
        platforms: terrain.platforms.map(p => ({
          id: p.id,
          type: p.type,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          isGround: p.isGround,
          moveAxis: p.moveAxis,
        })),
        obstacles: terrain.obstacles.filter(o => !session.passedObstacleIds.has(o.id)).map(o => ({
          id: o.id,
          type: o.type,
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
          spikeCount: o.spikeCount,
        })),
        items: terrain.items.filter(i => !session.collectedItemIds.has(i.id)).map(i => ({
          id: i.id,
          type: i.type,
          x: i.x,
          y: i.y + (i.bobOffset || 0),
          width: i.width,
          height: i.height,
        })),
      },
      gameState: session.state,
      duration: session.duration,
    };
  }
}

module.exports = { GameEngine };
