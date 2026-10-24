import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaSimulation } from '../game/src/simulation.js';
import { RULES as R, ticks, enemyShotSeconds } from '../game/src/rules.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function sandbox() {
  const sim = new ArenaSimulation();
  // Fixture: prevent unrelated spawn/attack events; keep one living enemy.
  sim.state.spawned = 3;
  sim.state.enemies[0].nextShotTick = Infinity;
  sim.state.player.nextShotTick = Infinity;
  return sim;
}
function shot(sim, owner, at, damage, extra = {}) {
  sim.state.projectiles.push({ id: sim.state.nextId++, owner, ...at, vx: 0, vz: 0, damage, bornTick: -1, ...extra });
}

test('시작 상태: HP 100, 적 1마리, 오른쪽 포션, 0초', () => {
  const sim = new ArenaSimulation();
  assert.equal(sim.state.player.hp, 100);
  assert.equal(sim.state.enemies.length, 1);
  assert.equal(sim.state.enemies[0].hp, 100);
  assert.equal(sim.state.tick, 0);
  assert.deepEqual(sim.state.potion, { x: 2, z: 0, collected: false });
});

test('직선과 대각선 이동 속도는 초당 4로 동일', () => {
  for (const keys of [['w'], ['w', 'd']]) {
    const sim = sandbox();
    keys.forEach((key) => sim.setKey(key, true));
    sim.advance(1);
    near(Math.hypot(sim.state.player.x, sim.state.player.z), R.playerSpeed);
  }
});

test('플레이어와 적은 반지름까지 경계 안에 유지', () => {
  const sim = sandbox();
  sim.setKey('d', true);
  sim.advance(20);
  near(sim.state.player.x, R.arenaHalfSize - R.playerRadius);
  for (const enemy of sim.state.enemies) {
    assert.ok(Math.abs(enemy.x) <= R.arenaHalfSize - R.enemyRadius);
    assert.ok(Math.abs(enemy.z) <= R.arenaHalfSize - R.enemyRadius);
  }
});

test('적은 0, 2, 4초에 정해진 위치에서 총 3마리만 생성', () => {
  const sim = new ArenaSimulation();
  sim.setKey('w', true);
  sim.advance(2 - 1 / R.tickRate);
  assert.equal(sim.state.spawned, 1);
  sim.step();
  assert.equal(sim.state.spawned, 2);
  assert.equal(sim.state.enemies[1].x, R.spawnPositions[1].x);
  assert.equal(sim.state.enemies[1].z, R.spawnPositions[1].z);
  sim.advance(2);
  assert.equal(sim.state.spawned, 3);
  assert.equal(sim.state.enemies[2].z, R.spawnPositions[2].z);
  sim.advance(2);
  assert.equal(sim.state.spawned, 3);
});

test('생성된 적은 즉시 이동하며 속도는 초당 1.2', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  const from = { ...enemy };
  sim.advance(0.5);
  near(Math.hypot(enemy.x - from.x, enemy.z - from.z), R.enemySpeed * 0.5);
});

test('적은 매 1초에 이전과 다른 8방향을 선택', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  let previous = enemy.direction;
  for (let i = 0; i < 12; i++) {
    sim.advance(1 - 1 / R.tickRate);
    assert.equal(enemy.direction, previous);
    sim.step();
    assert.notEqual(enemy.direction, previous);
    assert.ok(enemy.direction >= 0 && enemy.direction < 8);
    previous = enemy.direction;
  }
});

test('벽을 향한 적은 다음 방향 변경까지 막힐 수 있다', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  enemy.x = R.arenaHalfSize - R.enemyRadius;
  enemy.direction = 0;
  const z = enemy.z;
  sim.advance(0.9);
  near(enemy.x, R.arenaHalfSize - R.enemyRadius);
  near(enemy.z, z);
  assert.equal(enemy.direction, 0);
});

test('정지 시 정확히 0.65초 후 가장 가까운 적을 향해 발사', () => {
  const sim = sandbox();
  sim.state.player.nextShotTick = ticks(R.playerShotSeconds);
  const distant = sim.state.enemies[0];
  distant.x = -8; distant.z = 0;
  const close = { ...distant, id: 99, x: 2, z: 0, direction: 0 };
  sim.state.enemies.push(close);
  sim.advance(0.65 - 1 / R.tickRate);
  assert.equal(sim.state.projectiles.length, 0);
  sim.step();
  const projectile = sim.state.projectiles[0];
  assert.equal(projectile.owner, 'player');
  near(projectile.vx, R.playerProjectileSpeed);
  near(projectile.vz, 0);
});

test('정지 중 발사 간격은 0.65초이며 한 프레임에 몰아쏘지 않는다', () => {
  const sim = sandbox();
  sim.state.player.nextShotTick = ticks(0.65);
  sim.advance(0.65);
  assert.equal(sim.state.player.nextShotTick, ticks(1.3));
  sim.advance(0.65);
  assert.equal(sim.state.player.nextShotTick, ticks(1.95));
});

test('이동 중에는 발사하지 않고 기존 투사체는 계속 이동', () => {
  const sim = sandbox();
  sim.state.player.nextShotTick = 0;
  shot(sim, 'player', { x: 0, z: 7 }, 20, { vx: 1 });
  sim.setKey('w', true);
  sim.advance(0.7);
  assert.equal(sim.state.projectiles.length, 1);
  near(sim.state.projectiles[0].x, 0.7);
});

test('벽에 막히거나 반대 키가 상쇄되어도 이동 입력 중 발사 금지', () => {
  for (const keys of [['d'], ['a', 'd']]) {
    const sim = sandbox();
    sim.state.player.x = R.arenaHalfSize - R.playerRadius;
    sim.state.player.nextShotTick = 0;
    keys.forEach((key) => sim.setKey(key, true));
    sim.advance(1);
    assert.equal(sim.state.projectiles.length, 0);
    keys.forEach((key) => sim.setKey(key, false));
    sim.step();
    assert.equal(sim.state.projectiles.length, 1);
  }
});

test('플레이어 투사체 피해는 20, 적 HP 100은 5회 적중으로 사망', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  for (let i = 1; i <= 5; i++) {
    sim.fire('player', enemy, enemy);
    const bullet = sim.state.projectiles.at(-1);
    assert.equal(bullet.damage, 20);
    sim.step();
    assert.equal(enemy.hp, Math.max(0, 100 - i * 20));
  }
  assert.equal(sim.state.defeated, 1);
});

test('적 공격은 생성 시점 기준 1.8초 간격이고 이동 중에도 발사', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  enemy.nextShotTick = ticks(1.8);
  sim.advance(1.8 - 1 / R.tickRate);
  assert.equal(sim.state.projectiles.length, 0);
  const before = { x: enemy.x, z: enemy.z };
  sim.step();
  assert.equal(sim.state.projectiles.length, 1);
  assert.notDeepEqual({ x: enemy.x, z: enemy.z }, before);
  assert.equal(enemy.nextShotTick, ticks(3.6));
  assert.equal(sim.state.projectiles[0].damage, 10);
});

test('적 투사체는 발사 순간 위치를 겨냥하며 이후 방향은 고정', () => {
  const sim = sandbox();
  const enemy = sim.state.enemies[0];
  enemy.nextShotTick = 1;
  sim.step();
  const bullet = sim.state.projectiles[0];
  const length = Math.hypot(bullet.x - sim.state.player.x, bullet.z - sim.state.player.z);
  near(bullet.vx, (sim.state.player.x - bullet.x) / length * R.enemyProjectileSpeed);
  near(bullet.vz, (sim.state.player.z - bullet.z) / length * R.enemyProjectileSpeed);
  const velocity = [bullet.vx, bullet.vz];
  sim.setKey('d', true);
  sim.advance(0.5);
  assert.deepEqual([bullet.vx, bullet.vz], velocity);
});

test('포션: 30 회복, 최대 100, 최대 HP에서도 1회 소모', () => {
  for (const [hp, expected] of [[40,70],[90,100],[100,100]]) {
    const sim = sandbox();
    Object.assign(sim.state.player, { ...R.potionPosition, hp });
    sim.step();
    assert.equal(sim.state.player.hp, expected);
    assert.equal(sim.state.potion.collected, true);
    sim.state.player.hp = 20;
    sim.step();
    assert.equal(sim.state.player.hp, 20);
  }
});

test('적 투사체는 HP를 10 줄이며 적 접촉 자체는 피해 없음', () => {
  const sim = sandbox();
  sim.state.enemies[0].x = 0;
  sim.state.enemies[0].z = 0;
  sim.step();
  assert.equal(sim.state.player.hp, 100);
  sim.fire('enemy', sim.state.player, sim.state.player);
  sim.step();
  assert.equal(sim.state.player.hp, 90);
});

test('Pause는 생성·이동·공격·투사체·회복·모든 시간을 동결', () => {
  const sim = new ArenaSimulation();
  Object.assign(sim.state.player, { ...R.potionPosition, hp: 50 });
  sim.setKey('w', true);
  shot(sim, 'enemy', { x: 0, z: -2 }, 10, { vz: 5 });
  sim.pause();
  const before = sim.snapshot();
  sim.advance(10);
  assert.deepEqual(sim.snapshot(), before);
  assert.equal(Object.values(sim.state.input).some(Boolean), false);
  sim.resume();
  sim.step();
  assert.equal(sim.state.tick, 1);
  assert.equal(sim.state.potion.collected, true);
});

test('적을 일찍 죽여도 3마리 전체 생성·처치 전에는 클리어 아님', () => {
  const sim = new ArenaSimulation();
  sim.state.player.nextShotTick = Infinity;
  sim.state.enemies[0].nextShotTick = Infinity;
  shot(sim, 'player', sim.state.enemies[0], 100);
  sim.step();
  assert.equal(sim.state.enemies.length, 0);
  assert.equal(sim.state.status, 'playing');
  sim.advance(4);
  for (const enemy of sim.state.enemies) shot(sim, 'player', enemy, 100);
  sim.step();
  assert.equal(sim.state.defeated, 3);
  assert.equal(sim.state.status, 'stage-clear');
});

test('동시 치명타·포션 접촉·마지막 적 처치에서는 Game Over 우선', () => {
  const sim = sandbox();
  Object.assign(sim.state.player, { ...R.potionPosition, hp: 10 });
  sim.state.defeated = 2;
  shot(sim, 'enemy', sim.state.player, 10);
  shot(sim, 'player', sim.state.enemies[0], 100);
  sim.step();
  assert.equal(sim.state.player.hp, 0);
  assert.equal(sim.state.defeated, 3);
  assert.equal(sim.state.status, 'game-over');
  assert.equal(sim.state.potion.collected, false);
});

test('치명적이지 않은 동시 피해 뒤에는 포션 회복', () => {
  const sim = sandbox();
  Object.assign(sim.state.player, { ...R.potionPosition, hp: 20 });
  shot(sim, 'enemy', sim.state.player, 10);
  sim.step();
  assert.equal(sim.state.player.hp, 40);
});

test('Game Over와 Stage Clear 이후 시간과 모든 시뮬레이션 정지', () => {
  for (const status of ['game-over', 'stage-clear']) {
    const sim = sandbox();
    sim.state.status = status;
    const snapshot = sim.snapshot();
    sim.advance(10);
    sim.pause(); sim.resume();
    assert.deepEqual(sim.snapshot(), snapshot);
  }
});

test('다음 단계: 총 3단계, 공격 주기 1.8 / 1.4 / 1.0초', () => {
  const sim = new ArenaSimulation();
  sim.state.player.hp = 60;
  for (let stage = 1; stage <= 3; stage++) {
    near(enemyShotSeconds(sim.state.stage), 1.8 - (stage - 1) * 0.4);
    assert.equal(sim.state.enemies[0].nextShotTick, ticks(enemyShotSeconds(stage)));
    sim.state.status = 'stage-clear';
    sim.nextStage();
    assert.equal(sim.state.stage, Math.min(3, stage + 1));
    assert.equal(sim.state.player.hp, 60);
    assert.equal(sim.state.potion.collected, false);
    assert.equal(sim.state.stageTick, 0);
    assert.equal(sim.state.projectiles.length, 0);
  }
  assert.equal(sim.state.status, 'stage-clear');
});

test('Retry는 모든 상태·진행 단계에서 처음 스냅샷으로 완전히 복원', () => {
  const initial = new ArenaSimulation().snapshot();
  for (const status of ['playing', 'paused', 'game-over', 'stage-clear']) {
    const sim = new ArenaSimulation();
    sim.advance(3);
    Object.assign(sim.state, { stage: 3, status, defeated: 2 });
    sim.state.player.hp = 10;
    sim.state.potion.collected = true;
    sim.state.input.d = true;
    sim.retry();
    assert.deepEqual(sim.snapshot(), initial);
  }
});

test('동일한 난수 시드와 입력은 동일한 전체 결과를 재현', () => {
  const run = () => {
    const sim = new ArenaSimulation(42);
    sim.setKey('w', true); sim.advance(1);
    sim.setKey('w', false); sim.advance(1.3);
    sim.setKey('d', true); sim.advance(2);
    return sim.snapshot();
  };
  assert.deepEqual(run(), run());
});
