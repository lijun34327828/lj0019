const { GAME_CONFIG, OBSTACLE_TYPES, PLATFORM_TYPES, ITEM_CONFIG } = require('../shared/constants');

class SeededRandom {
  constructor(seed) {
    this.seed = seed || Date.now();
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

class TerrainGenerator {
  constructor() {
    this.chunks = new Map();
    this.baseSeed = Math.floor(Math.random() * 1000000);
  }

  getChunkKey(chunkIndex) {
    return chunkIndex;
  }

  getOrGenerateChunk(chunkIndex) {
    const key = this.getChunkKey(chunkIndex);
    if (this.chunks.has(key)) {
      return this.chunks.get(key);
    }
    const chunk = this.generateChunk(chunkIndex);
    this.chunks.set(key, chunk);
    return chunk;
  }

  generateChunk(chunkIndex) {
    const seed = this.baseSeed + chunkIndex * 7919;
    const rand = new SeededRandom(seed);
    const chunkStartX = chunkIndex * GAME_CONFIG.CHUNK_SIZE;
    const chunkEndX = chunkStartX + GAME_CONFIG.CHUNK_SIZE;

    const platforms = [];
    const obstacles = [];
    const items = [];
    const groundY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.GROUND_HEIGHT;

    if (chunkIndex === 0) {
      platforms.push({
        id: `p_${chunkIndex}_ground`,
        type: PLATFORM_TYPES.NORMAL,
        x: 0,
        y: groundY,
        width: GAME_CONFIG.CHUNK_SIZE,
        height: GAME_CONFIG.GROUND_HEIGHT,
        isGround: true,
      });
      return {
        index: chunkIndex,
        startX: 0,
        endX: GAME_CONFIG.CHUNK_SIZE,
        platforms,
        obstacles,
        items,
      };
    }

    let currentX = chunkStartX;
    let lastPlatformY = groundY;
    let platformIdCounter = 0;
    let obstacleIdCounter = 0;
    let itemIdCounter = 0;

    platforms.push({
      id: `p_${chunkIndex}_ground_start`,
      type: PLATFORM_TYPES.NORMAL,
      x: chunkStartX,
      y: groundY,
      width: GAME_CONFIG.CHUNK_SIZE,
      height: GAME_CONFIG.GROUND_HEIGHT,
      isGround: true,
    });

    while (currentX < chunkEndX - 200) {
      if (rand.chance(0.6)) {
        const gapWidth = rand.int(GAME_CONFIG.PLATFORM_GAP_MIN, GAME_CONFIG.PLATFORM_GAP_MAX);
        currentX += gapWidth;

        const pitX = currentX - gapWidth + 50;
        const pitWidth = gapWidth - 50;
        platforms[0].width = chunkEndX;
        obstacles.push({
          id: `o_${chunkIndex}_${obstacleIdCounter++}`,
          type: OBSTACLE_TYPES.PIT,
          x: pitX,
          y: groundY,
          width: pitWidth,
          height: GAME_CONFIG.GROUND_HEIGHT,
          passed: false,
        });
      }

      if (rand.chance(0.5) && currentX < chunkEndX - 100) {
        const platWidth = rand.int(GAME_CONFIG.PLATFORM_MIN_WIDTH, GAME_CONFIG.PLATFORM_MAX_WIDTH);
        const platHeightOffset = rand.int(GAME_CONFIG.PLATFORM_HEIGHT_MIN, GAME_CONFIG.PLATFORM_HEIGHT_MAX);
        const platY = lastPlatformY - platHeightOffset;
        const clampedY = Math.max(100, Math.min(groundY - 60, platY));

        let platType = PLATFORM_TYPES.NORMAL;
        if (rand.chance(GAME_CONFIG.MOVING_OBSTACLE_RATE * 0.8)) {
          platType = PLATFORM_TYPES.MOVING;
        }

        const platform = {
          id: `p_${chunkIndex}_${platformIdCounter++}`,
          type: platType,
          x: currentX,
          y: clampedY,
          originalY: clampedY,
          width: platWidth,
          height: 20,
          isGround: false,
        };

        if (platType === PLATFORM_TYPES.MOVING) {
          platform.moveRange = rand.int(30, 80);
          platform.moveSpeed = rand.range(0.02, 0.04);
          platform.movePhase = rand.range(0, Math.PI * 2);
          platform.moveAxis = rand.chance(0.5) ? 'y' : 'x';
          platform.originalX = currentX;
        }

        platforms.push(platform);
        lastPlatformY = clampedY;

        if (rand.chance(GAME_CONFIG.ITEM_SPAWN_RATE)) {
          const item = this.generateItem(rand, chunkIndex, itemIdCounter++, currentX + platWidth / 2, clampedY - 50);
          if (item) items.push(item);
        }

        currentX += platWidth;
      } else {
        if (rand.chance(GAME_CONFIG.TRAP_SPAWN_RATE) && currentX > chunkStartX + 300) {
          const trapType = this.selectTrapType(rand);
          const trap = this.generateTrap(trapType, rand, chunkIndex, obstacleIdCounter++, currentX, groundY);
          if (trap) {
            obstacles.push(trap);
            currentX += (trap.width || 40) + 30;
          }
        }

        if (rand.chance(GAME_CONFIG.ITEM_SPAWN_RATE * 0.8)) {
          const itemY = groundY - rand.int(60, 150);
          const item = this.generateItem(rand, chunkIndex, itemIdCounter++, currentX + 30, itemY);
          if (item) items.push(item);
        }

        currentX += rand.int(80, 200);
      }
    }

    return {
      index: chunkIndex,
      startX: chunkStartX,
      endX: chunkEndX,
      platforms,
      obstacles,
      items,
    };
  }

  selectTrapType(rand) {
    const types = [
      { type: OBSTACLE_TYPES.SPIKE, weight: 35 },
      { type: OBSTACLE_TYPES.BLOCK, weight: 25 },
      { type: OBSTACLE_TYPES.LOW_BAR, weight: 20 },
      { type: OBSTACLE_TYPES.MOVING_V, weight: 10 },
      { type: OBSTACLE_TYPES.MOVING_H, weight: 10 },
    ];
    const total = types.reduce((s, t) => s + t.weight, 0);
    let r = rand.range(0, total);
    for (const t of types) {
      r -= t.weight;
      if (r <= 0) return t.type;
    }
    return OBSTACLE_TYPES.SPIKE;
  }

  generateTrap(type, rand, chunkIndex, idCounter, x, groundY) {
    switch (type) {
      case OBSTACLE_TYPES.SPIKE: {
        const count = rand.int(1, 3);
        return {
          id: `o_${chunkIndex}_${idCounter}`,
          type,
          x,
          y: groundY - 25,
          width: 30 * count,
          height: 25,
          passed: false,
          spikeCount: count,
        };
      }
      case OBSTACLE_TYPES.BLOCK: {
        const height = rand.int(40, 80);
        return {
          id: `o_${chunkIndex}_${idCounter}`,
          type,
          x,
          y: groundY - height,
          width: 40,
          height,
          passed: false,
        };
      }
      case OBSTACLE_TYPES.LOW_BAR: {
        return {
          id: `o_${chunkIndex}_${idCounter}`,
          type,
          x,
          y: groundY - 120,
          width: rand.int(100, 180),
          height: 20,
          passed: false,
        };
      }
      case OBSTACLE_TYPES.MOVING_V: {
        const baseY = groundY - 100;
        return {
          id: `o_${chunkIndex}_${idCounter}`,
          type,
          x,
          y: baseY,
          originalY: baseY,
          width: 30,
          height: 60,
          passed: false,
          moveRange: rand.int(40, 80),
          moveSpeed: rand.range(0.03, 0.05),
          movePhase: rand.range(0, Math.PI * 2),
        };
      }
      case OBSTACLE_TYPES.MOVING_H: {
        return {
          id: `o_${chunkIndex}_${idCounter}`,
          type,
          x,
          y: groundY - 50,
          originalX: x,
          width: 50,
          height: 35,
          passed: false,
          moveRange: rand.int(50, 100),
          moveSpeed: rand.range(0.025, 0.045),
          movePhase: rand.range(0, Math.PI * 2),
        };
      }
      default:
        return null;
    }
  }

  generateItem(rand, chunkIndex, idCounter, x, y) {
    const itemTypes = Object.values(ITEM_CONFIG);
    const totalWeight = itemTypes.reduce((s, i) => s + i.spawnWeight, 0);
    let r = rand.range(0, totalWeight);
    let selected = itemTypes[0];
    for (const item of itemTypes) {
      r -= item.spawnWeight;
      if (r <= 0) {
        selected = item;
        break;
      }
    }
    return {
      id: `i_${chunkIndex}_${idCounter}`,
      type: selected.type,
      x,
      y,
      width: 32,
      height: 32,
      collected: false,
      bobPhase: rand.range(0, Math.PI * 2),
    };
  }

  getTerrainRange(startX, endX) {
    const startChunk = Math.floor(startX / GAME_CONFIG.CHUNK_SIZE);
    const endChunk = Math.ceil(endX / GAME_CONFIG.CHUNK_SIZE);
    const result = { platforms: [], obstacles: [], items: [] };
    for (let i = startChunk; i <= endChunk; i++) {
      const chunk = this.getOrGenerateChunk(i);
      result.platforms.push(...chunk.platforms);
      result.obstacles.push(...chunk.obstacles);
      result.items.push(...chunk.items);
    }
    return result;
  }

  updateMovingObjects(terrain, timestamp) {
    for (const p of terrain.platforms) {
      if (p.type === PLATFORM_TYPES.MOVING) {
        const offset = Math.sin(timestamp * p.moveSpeed + p.movePhase) * p.moveRange;
        if (p.moveAxis === 'y') {
          p.y = p.originalY + offset;
        } else {
          p.x = p.originalX + offset;
        }
      }
    }
    for (const o of terrain.obstacles) {
      if (o.type === OBSTACLE_TYPES.MOVING_V) {
        o.y = o.originalY + Math.sin(timestamp * o.moveSpeed + o.movePhase) * o.moveRange;
      } else if (o.type === OBSTACLE_TYPES.MOVING_H) {
        o.x = o.originalX + Math.sin(timestamp * o.moveSpeed + o.movePhase) * o.moveRange;
      }
    }
    for (const item of terrain.items) {
      item.bobOffset = Math.sin(timestamp * 0.003 + item.bobPhase) * 5;
    }
  }

  cleanupOldChunks(playerX) {
    const keepStart = Math.floor((playerX - GAME_CONFIG.CHUNK_SIZE * 2) / GAME_CONFIG.CHUNK_SIZE);
    for (const key of this.chunks.keys()) {
      if (key < keepStart) {
        this.chunks.delete(key);
      }
    }
  }
}

module.exports = { TerrainGenerator, SeededRandom };
