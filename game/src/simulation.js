import { RULES as R, DIRECTIONS, ticks, enemyShotSeconds } from './rules.js';

const clamp = (v, radius) => Math.max(-R.arenaHalfSize + radius, Math.min(R.arenaHalfSize - radius, v));
const distanceSq = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// Swept collision prevents a fast projectile from jumping through a target.
function segmentHit(a, b, target, radius) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / lengthSq)) : 0;
  return distanceSq({ x: a.x + dx * t, z: a.z + dz * t }, target) <= radius ** 2;
}

export class ArenaSimulation {
  constructor(seed = R.seed) {
    this.initialSeed = seed >>> 0;
    this.retry();
  }

  retry() {
    this.state = {
      status: 'playing', pauseReason: null, stage: 1, tick: 0, stageTick: 0,
      rng: this.initialSeed, nextId: 1, spawned: 0, defeated: 0,
      input: { w: false, a: false, s: false, d: false },
      player: { x: 0, z: 0, hp: R.maxHp, nextShotTick: ticks(R.playerShotSeconds) },
      potion: { ...R.potionPosition, collected: false }, enemies: [], projectiles: [],
    };
    this.spawnDue();
  }

  snapshot() {
    return structuredClone({ ...this.state, time: this.state.tick / R.tickRate, stageTime: this.state.stageTick / R.tickRate });
  }

  clearInput() {
    for (const key of Object.keys(this.state.input)) this.state.input[key] = false;
  }

  setKey(key, pressed) {
    if (this.state.status === 'playing' && Object.hasOwn(this.state.input, key)) this.state.input[key] = pressed;
  }

  pause(reason = 'manual') {
    if (this.state.status !== 'playing') return;
    this.state.status = 'paused';
    this.state.pauseReason = reason;
    this.clearInput();
  }

  resume() {
    if (this.state.status !== 'paused') return;
    this.state.status = 'playing';
    this.state.pauseReason = null;
    this.clearInput();
  }

  nextStage() {
    const s = this.state;
    if (s.status !== 'stage-clear' || s.stage >= R.maxStage) return;
    s.stage++;
    s.stageTick = 0;
    s.status = 'playing';
    s.pauseReason = null;
    s.spawned = 0;
    s.defeated = 0;
    s.enemies = [];
    s.projectiles = [];
    s.potion = { ...R.potionPosition, collected: false };
    Object.assign(s.player, { x: 0, z: 0, nextShotTick: ticks(R.playerShotSeconds) });
    this.clearInput();
    this.spawnDue();
  }

  random() {
    // All gameplay randomness has one serializable, reproducible source.
    this.state.rng = (Math.imul(this.state.rng, 1664525) + 1013904223) >>> 0;
    return this.state.rng / 4294967296;
  }

  spawnDue() {
    const s = this.state;
    while (s.spawned < R.spawnSeconds.length && s.stageTick >= ticks(R.spawnSeconds[s.spawned])) {
      s.enemies.push({
        id: s.nextId++, ...R.spawnPositions[s.spawned], hp: R.enemyHp,
        direction: Math.floor(this.random() * 8), bornTick: s.stageTick,
        nextDirectionTick: s.stageTick + ticks(R.directionSeconds),
        nextShotTick: s.stageTick + ticks(enemyShotSeconds(s.stage)),
      });
      s.spawned++;
    }
  }

  fire(owner, source, target) {
    const s = this.state;
    const dx = target.x - source.x, dz = target.z - source.z;
    const length = Math.hypot(dx, dz);
    // A coincident target is hit at the source, with a stable direction.
    const speed = owner === 'player' ? R.playerProjectileSpeed : R.enemyProjectileSpeed;
    s.projectiles.push({
      id: s.nextId++, owner, x: source.x, z: source.z,
      vx: (length ? dx / length : 1) * speed, vz: (length ? dz / length : 0) * speed,
      damage: owner === 'player' ? R.playerDamage : R.enemyDamage, bornTick: s.stageTick,
    });
  }

  // One fixed tick is the atomic unit for simultaneous damage, healing and victory.
  step() {
    const s = this.state;
    if (s.status !== 'playing') return;
    const dt = 1 / R.tickRate;
    s.tick++;
    s.stageTick++;
    this.spawnDue();

    const ix = Number(s.input.d) - Number(s.input.a);
    const iz = Number(s.input.s) - Number(s.input.w);
    const hasMoveInput = Object.values(s.input).some(Boolean);
    const length = Math.hypot(ix, iz);
    if (length) {
      s.player.x = clamp(s.player.x + ix / length * R.playerSpeed * dt, R.playerRadius);
      s.player.z = clamp(s.player.z + iz / length * R.playerSpeed * dt, R.playerRadius);
    }

    for (const enemy of s.enemies) {
      if (s.stageTick >= enemy.nextDirectionTick) {
        // Pick one of the other seven directions without a retry loop.
        enemy.direction = (enemy.direction + 1 + Math.floor(this.random() * 7)) % 8;
        enemy.nextDirectionTick += ticks(R.directionSeconds);
      }
      if (s.stageTick > enemy.bornTick) {
        const direction = DIRECTIONS[enemy.direction];
        enemy.x = clamp(enemy.x + direction.x * R.enemySpeed * dt, R.enemyRadius);
        enemy.z = clamp(enemy.z + direction.z * R.enemySpeed * dt, R.enemyRadius);
      }
    }

    if (!hasMoveInput && s.enemies.length && s.stageTick >= s.player.nextShotTick) {
      const nearest = s.enemies.reduce((best, enemy) => distanceSq(enemy, s.player) < distanceSq(best, s.player) ? enemy : best);
      this.fire('player', s.player, nearest);
      s.player.nextShotTick = s.stageTick + ticks(R.playerShotSeconds);
    }
    for (const enemy of s.enemies) {
      if (s.stageTick >= enemy.nextShotTick) {
        this.fire('enemy', enemy, s.player);
        enemy.nextShotTick += ticks(enemyShotSeconds(s.stage));
      }
    }

    const enemyDamage = new Map();
    let playerDamage = 0;
    s.projectiles = s.projectiles.filter((shot) => {
      if (shot.bornTick === s.stageTick) return true;
      const from = { x: shot.x, z: shot.z };
      shot.x += shot.vx * dt;
      shot.z += shot.vz * dt;
      if (shot.owner === 'enemy') {
        if (segmentHit(from, shot, s.player, R.playerRadius + R.projectileRadius)) {
          playerDamage += shot.damage;
          return false;
        }
      } else {
        // Stable nearest intersection along the projectile, rather than enemy array order.
        const hits = s.enemies.filter((enemy) => segmentHit(from, shot, enemy, R.enemyRadius + R.projectileRadius));
        hits.sort((a, b) => distanceSq(a, from) - distanceSq(b, from) || a.id - b.id);
        if (hits.length) {
          enemyDamage.set(hits[0].id, (enemyDamage.get(hits[0].id) ?? 0) + shot.damage);
          return false;
        }
      }
      return Math.abs(shot.x) <= R.arenaHalfSize && Math.abs(shot.z) <= R.arenaHalfSize;
    });

    // Resolve every hit before choosing a terminal state.
    s.player.hp = Math.max(0, s.player.hp - playerDamage);
    for (const enemy of s.enemies) enemy.hp = Math.max(0, enemy.hp - (enemyDamage.get(enemy.id) ?? 0));
    const dead = s.enemies.filter((enemy) => enemy.hp === 0).length;
    s.defeated += dead;
    s.enemies = s.enemies.filter((enemy) => enemy.hp > 0);
    if (s.player.hp === 0) {
      s.status = 'game-over';
      this.clearInput();
      return;
    }
    if (!s.potion.collected && distanceSq(s.player, s.potion) <= (R.playerRadius + R.potionRadius) ** 2) {
      s.potion.collected = true;
      s.player.hp = Math.min(R.maxHp, s.player.hp + R.potionHealing);
    }
    if (s.spawned === R.spawnSeconds.length && s.enemies.length === 0) {
      s.status = 'stage-clear';
      this.clearInput();
    }
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('진행 시간은 0 이상의 유한한 숫자여야 합니다.');
    for (let i = 0, count = ticks(seconds); i < count; i++) this.step();
    return this.snapshot();
  }
}
