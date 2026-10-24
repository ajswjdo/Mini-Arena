import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { RULES } from '../game/src/rules.js';

const observe = (page) => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
const snapshot = (page) => page.evaluate(() => window.__ARENA_QA__.snapshot());
const advance = (page, seconds) => page.evaluate((value) => window.__ARENA_QA__.advance(value), seconds);

// These fixtures only arrange inputs to real combat, never the expected outcome.
async function prepareDuel(page, { playerHp = 100, enemyHp = 100, immediateEnemyShot = false } = {}) {
  await page.evaluate((options) => {
    const s = window.__ARENA_QA__.snapshot();
    s.player.hp = options.playerHp;
    const enemy = s.enemies[0];
    enemy.x = 2;
    enemy.z = 0;
    enemy.hp = options.enemyHp;
    if (options.immediateEnemyShot) enemy.nextShotTick = s.stageTick + 1;
    window.__ARENA_QA__.load(s);
  }, { playerHp, enemyHp, immediateEnemyShot });
}

async function prepareFullWave(page) {
  // Suppress player fire with real movement input while all three enemies spawn.
  await page.keyboard.down('w');
  try { await advance(page, 4); }
  finally { await page.keyboard.up('w'); }
  const spawned = await snapshot(page);
  expect(spawned.spawned).toBe(3);
  expect(spawned.enemies).toHaveLength(3);
  expect(spawned.defeated).toBe(0);
  await page.evaluate(() => {
    const s = window.__ARENA_QA__.snapshot();
    Object.assign(s.player, { x: 0, z: 0, hp: 100 });
    s.projectiles = [];
    s.enemies.forEach((enemy, index) => {
      // Each still needs one genuine player hit; enemy movement and attacks stay active.
      Object.assign(enemy, { x: 1.5 + index * 0.7, z: 0, hp: 20 });
    });
    window.__ARENA_QA__.load(s);
  });
}

async function record(testInfo, result) {
  const data = { seed: RULES.seed, ...result };
  const path = testInfo.outputPath('p0-result.json');
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  await testInfo.attach('P0 before and after', { path, contentType: 'application/json' });
  console.log(`${testInfo.title}: ${JSON.stringify(data)}`);
}

// Playwright gives each test a fresh page/context; no serial tests or shared results.
test.beforeEach(async ({ page }) => {
  await page.goto('/?qa=1');
  await page.waitForFunction(() => !!window.__ARENA_QA__ && !!window.__THREE_GAME_TEST_HOOKS__);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.reset());
  expect(await observe(page)).toEqual({
    player: { hp: 100, position: { x: 0, z: 0 } },
    enemyCount: 1, enemies: [{ id: 1, hp: 100 }],
    score: 0, stage: 1, gameState: 'playing',
  });
});

test('P0-01: player attack reduces enemy HP by 20', async ({ page }, testInfo) => {
  await prepareDuel(page);
  const before = await observe(page);
  await advance(page, 0.65);
  const fired = await snapshot(page);
  expect(fired.projectiles.some((shot) => shot.owner === 'player')).toBe(true);
  await advance(page, 0.35);
  const after = await observe(page);
  await record(testInfo, { before, after });
  const target = after.enemies.find((enemy) => enemy.id === before.enemies[0].id);
  expect(target, 'The same enemy must remain observable').toBeDefined();
  expect(target.hp).toBe(before.enemies[0].hp - 20);
});

test('P0-02: lethal enemy hits cause Game Over at zero HP', async ({ page }, testInfo) => {
  const cases = [];
  // Exact-zero damage and overkill are both processed by real collision logic.
  for (const hp of [10, 5]) {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.reset());
    await prepareDuel(page, { playerHp: hp, immediateEnemyShot: true });
    const before = await observe(page);
    await advance(page, 1 / RULES.tickRate);
    expect((await snapshot(page)).projectiles.some((shot) => shot.owner === 'enemy' && shot.damage === 10)).toBe(true);
    await advance(page, 0.5);
    const after = await observe(page);
    cases.push({ before, after });
    expect(after.player.hp).toBe(0);
    expect(after.gameState).toBe('game-over');
    await expect(page.getByRole('heading', { name: 'Game Over', exact: true })).toBeVisible();
    const frozen = await snapshot(page);
    await advance(page, 1);
    expect(await snapshot(page)).toEqual(frozen);
  }
  await record(testInfo, { cases });
});

test('P0-03: Retry resets HP, score and stage', async ({ page }, testInfo) => {
  const initial = await snapshot(page);
  // Reach a different stage in this test itself, without relying on P0-04.
  await prepareFullWave(page);
  await advance(page, 3);
  await expect(page.getByRole('heading', { name: 'Stage Clear', exact: true })).toBeVisible();
  await page.getByTestId('next-stage').click();
  await prepareDuel(page, { playerHp: 70, enemyHp: 20 });
  await advance(page, 1);
  const before = await observe(page);
  expect(before.player.hp).toBe(70);
  expect(before.score).toBe(1);
  expect(before.stage).toBe(2);
  await page.getByTestId('retry').click();
  const after = await observe(page);
  await record(testInfo, { before, after });
  expect(after.player.hp).toBe(100);
  expect(after.score).toBe(0);
  expect(after.stage).toBe(1);
  expect(after.gameState).toBe('playing');
  // Also proves the RNG, timers, inputs, potion and projectiles were restored.
  expect(await snapshot(page)).toEqual(initial);
});

test('P0-04: defeating all three spawned enemies causes Stage Clear', async ({ page }, testInfo) => {
  await prepareFullWave(page);
  const before = await observe(page);
  expect(before.enemyCount).toBe(3);
  expect(before.gameState).toBe('playing');
  await advance(page, 3);
  const after = await observe(page);
  await record(testInfo, { before, after });
  expect(after.enemyCount).toBe(0);
  expect(after.enemies).toEqual([]);
  expect(after.score).toBe(3);
  expect(after.player.hp).toBeGreaterThan(0);
  expect(after.gameState).toBe('stage-clear');
  await expect(page.getByRole('heading', { name: 'Stage Clear', exact: true })).toBeVisible();
  const frozen = await snapshot(page);
  await advance(page, 1);
  expect(await snapshot(page)).toEqual(frozen);
});
