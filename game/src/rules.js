export const RULES = Object.freeze({
  tickRate: 120,
  arenaHalfSize: 9,
  playerSpeed: 4,
  playerRadius: 0.38,
  maxHp: 100,
  playerDamage: 20,
  playerShotSeconds: 0.65,
  playerProjectileSpeed: 12,
  enemyHp: 100,
  enemySpeed: 1.2,
  enemyRadius: 0.42,
  enemyDamage: 10,
  enemyShotSeconds: 1.8,
  stageShotReduction: 0.4,
  directionSeconds: 1,
  enemyProjectileSpeed: 5,
  projectileRadius: 0.12,
  potionRadius: 0.35,
  potionHealing: 30,
  potionPosition: Object.freeze({ x: 2, z: 0 }),
  spawnSeconds: Object.freeze([0, 2, 4]),
  spawnPositions: Object.freeze([
    Object.freeze({ x: -6, z: -5 }),
    Object.freeze({ x: 6, z: -5 }),
    Object.freeze({ x: 0, z: 6 }),
  ]),
  maxStage: 3,
  seed: 12345,
});

export const DIRECTIONS = Object.freeze(Array.from({ length: 8 }, (_, i) =>
  Object.freeze({ x: Math.cos(i * Math.PI / 4), z: Math.sin(i * Math.PI / 4) })));

export const ticks = (seconds) => Math.round(seconds * RULES.tickRate);
export const enemyShotSeconds = (stage) => RULES.enemyShotSeconds - (stage - 1) * RULES.stageShotReduction;
