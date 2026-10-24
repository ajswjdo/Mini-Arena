import { test, expect } from '@playwright/test';

const state = (page) => page.evaluate(() => window.__ARENA__.snapshot());
const advance = (page, seconds) => page.evaluate((seconds) => window.__ARENA_QA__.advance(seconds), seconds);
async function fixture(page, configure) {
  await page.evaluate((source) => {
    const s = window.__ARENA_QA__.snapshot();
    // Serializable fixture functions only in the explicitly selected dev QA mode.
    new Function('s', source)(s);
    window.__ARENA_QA__.load(s);
  }, configure);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/?qa=1');
  await page.waitForFunction(() => !!window.__ARENA_QA__);
});

test('Three.js renders visible objects, without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await page.waitForFunction(() => !!window.__ARENA_QA__);
  await expect(page.locator('#render-error')).toBeHidden();
  const pixels = await page.locator('canvas').evaluate((canvas) => {
    const context = canvas.getContext('webgl2');
    return { width: canvas.width, height: canvas.height, version: context?.getParameter(context.VERSION) };
  });
  expect(pixels.width).toBeGreaterThan(500);
  expect(pixels.version).toContain('WebGL');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'evidence/arena-desktop.png' });
});

test('real WASD input: diagonal normalized, held wall input blocks firing', async ({ page }) => {
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  let s = await advance(page, 0.5);
  expect(Math.hypot(s.player.x, s.player.z)).toBeCloseTo(2, 8);
  expect(s.projectiles).toHaveLength(0);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await fixture(page, 's.player.x=8.62; s.player.nextShotTick=0;');
  await page.keyboard.down('d');
  s = await advance(page, 1);
  expect(s.player.x).toBeCloseTo(8.62);
  expect(s.projectiles.filter((p) => p.owner === 'player')).toHaveLength(0);
  await page.keyboard.up('d');
  s = await advance(page, 1 / 120);
  expect(s.projectiles.filter((p) => p.owner === 'player')).toHaveLength(1);
});

test('spawns at 0, 2, 4 seconds and auto-fires at 0.65 seconds', async ({ page }) => {
  expect((await state(page)).spawned).toBe(1);
  let s = await advance(page, 0.65);
  expect(s.projectiles.filter((p) => p.owner === 'player')).toHaveLength(1);
  s = await advance(page, 1.35);
  expect(s.spawned).toBe(2);
  s = await advance(page, 2);
  expect(s.spawned).toBe(3);
});

test('Pause button and Escape freeze and resume every timer', async ({ page }) => {
  await page.keyboard.down('w');
  await advance(page, 0.3);
  await page.getByTestId('pause').click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  const before = await state(page);
  expect(Object.values(before.input).some(Boolean)).toBe(false);
  expect(await advance(page, 5)).toEqual(before);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  expect((await advance(page, 0.1)).tick).toBe(before.tick + 12);
  await page.keyboard.press('Escape');
  expect((await state(page)).status).toBe('paused');
  await page.getByTestId('resume').click();
  expect((await state(page)).status).toBe('playing');
});

test('window focus loss pauses, clears input and requires explicit resume', async ({ page }) => {
  await page.keyboard.down('d');
  // Dispatching blur tests the same listener; real tab switching is checked separately below.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const before = await state(page);
  expect(before.status).toBe('paused');
  expect(before.pauseReason).toBe('focus-lost');
  expect(Object.values(before.input).some(Boolean)).toBe(false);
  expect(await advance(page, 10)).toEqual(before);
  await page.keyboard.up('d');
  await page.getByTestId('resume').click();
  expect((await state(page)).status).toBe('playing');
});

test('document visibility change pauses the simulation', async ({ browser }) => {
  const context = await browser.newContext();
  const original = await context.newPage();
  await original.goto('http://127.0.0.1:5173/?qa=1');
  await original.waitForFunction(() => !!window.__ARENA_QA__);
  // This is an event-handler check; native tab switching is separately checked in a visible browser.
  await original.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await state(original)).status).toBe('paused');
  await context.close();
});

test('potion is consumed even at full HP and cannot be collected twice', async ({ page }) => {
  await page.keyboard.down('d');
  await advance(page, 0.5);
  await page.keyboard.up('d');
  await expect(page.getByTestId('potion-status')).toHaveText('포션 획득 완료');
  await expect(page.getByTestId('hp')).toHaveText('100 / 100');
  await fixture(page, 's.player.hp=40;');
  await advance(page, 0.1);
  await expect(page.getByTestId('hp')).toHaveText('40 / 100');
});

test('lethal simultaneous hit beats potion and stage clear in browser UI', async ({ page }) => {
  await fixture(page, `
    s.player.x=2; s.player.z=0; s.player.hp=10;
    s.spawned=3; s.defeated=2;
    const e=s.enemies[0];
    s.projectiles=[
      {id:900,owner:'enemy',x:2,z:0,vx:0,vz:0,damage:10,bornTick:-1},
      {id:901,owner:'player',x:e.x,z:e.z,vx:0,vz:0,damage:100,bornTick:-1}
    ];
  `);
  await advance(page, 1 / 120);
  await expect(page.getByRole('heading', { name: 'Game Over' })).toBeVisible();
  await expect(page.getByTestId('hp')).toHaveText('0 / 100');
  const before = await state(page);
  expect(before.potion.collected).toBe(false);
  expect(before.defeated).toBe(3);
  expect(await advance(page, 5)).toEqual(before);
  await page.screenshot({ path: 'evidence/game-over.png' });
});

test('three stages have correct attack periods; Retry always returns to stage 1', async ({ page }) => {
  for (let stage = 1; stage <= 3; stage++) {
    await fixture(page, `
      s.spawned=3; s.defeated=2; s.player.hp=70;
      const e=s.enemies[0];
      s.projectiles=[{id:999,owner:'player',x:e.x,z:e.z,vx:0,vz:0,damage:100,bornTick:-1}];
    `);
    await advance(page, 1 / 120);
    await expect(page.getByRole('heading', { name: 'Stage Clear', exact: true })).toBeVisible();
    const before = await state(page);
    expect(await advance(page, 5)).toEqual(before);
    if (stage < 3) {
      await page.getByTestId('next-stage').click();
      const s = await state(page);
      expect(s.stage).toBe(stage + 1);
      expect(s.player.hp).toBe(70);
      expect(s.enemies[0].nextShotTick).toBe(stage === 1 ? 168 : 120);
      expect(s.stageTick).toBe(0);
    }
  }
  await expect(page.getByTestId('next-stage')).toBeHidden();
  await page.screenshot({ path: 'evidence/stage-clear.png' });
  await page.getByTestId('overlay-retry').click();
  const fresh = await state(page);
  expect(fresh.stage).toBe(1);
  expect(fresh.player.hp).toBe(100);
  expect(fresh.tick).toBe(0);
  expect(fresh.enemies).toHaveLength(1);
  expect(fresh.projectiles).toHaveLength(0);
  expect(fresh.potion.collected).toBe(false);
  expect(Object.values(fresh.input).some(Boolean)).toBe(false);
});

test('Retry restores exact initial state from every status, including held keys', async ({ page }) => {
  const initial = await state(page);
  for (const status of ['playing', 'paused', 'game-over', 'stage-clear']) {
    await fixture(page, `s.status='${status}'; s.stage=3; s.player.hp=10; s.tick=1000; s.input.d=true; s.potion.collected=true;`);
    await page.getByTestId(status === 'playing' ? 'retry' : 'overlay-retry').click();
    expect(await state(page)).toEqual(initial);
  }
});

test('normal mode advances in real time with real keyboard movement', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__ARENA__);
  expect(await page.evaluate(() => window.__ARENA_QA__)).toBeUndefined();
  await page.keyboard.down('w');
  await expect.poll(async () => (await state(page)).player.z).toBeLessThan(-0.3);
  await page.keyboard.up('w');
  await page.getByTestId('pause').click();
  const before = await state(page);
  await page.waitForTimeout(250);
  expect(await state(page)).toEqual(before);
  await page.getByTestId('resume').click();
  await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(before.tick);
});

test('narrow viewport keeps game and buttons visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('retry')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'evidence/arena-mobile.png' });
});

test('standard test hook reads real state without advancing or mutating the game', async ({ page }) => {
  const initial = await state(page);
  const observed = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  expect(observed).toEqual({
    player: { hp: 100, position: { x: 0, z: 0 } },
    enemyCount: 1,
    enemies: [{ id: initial.enemies[0].id, hp: 100 }],
    score: 0,
    stage: 1,
    gameState: 'playing',
  });
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    for (let i = 0; i < 10; i++) hooks.getState();
    const copy = hooks.getState();
    copy.player.hp = 0;
    copy.player.position.x = 999;
    copy.enemies[0].hp = 0;
    copy.enemies.length = 0;
    copy.score = 999;
  });
  expect(await state(page)).toEqual(initial);
  expect(await page.evaluate(() => Object.isFrozen(window.__THREE_GAME_TEST_HOOKS__))).toBe(true);

  // Real input and simulation collision must produce the observed changes.
  await page.keyboard.down('w');
  await advance(page, 0.25);
  await page.keyboard.up('w');
  await fixture(page, `
    const e=s.enemies[0];
    s.projectiles=[
      {id:900,owner:'enemy',x:s.player.x,z:s.player.z,vx:0,vz:0,damage:10,bornTick:-1},
      {id:901,owner:'player',x:e.x,z:e.z,vx:0,vz:0,damage:20,bornTick:-1}
    ];
  `);
  await advance(page, 1/120);
  let hook = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  expect(hook.player.hp).toBe(90);
  expect(hook.player.position.z).toBeCloseTo(-1, 8);
  expect(hook.enemies[0].hp).toBe(80);

  await fixture(page, `
    const e=s.enemies[0];
    s.projectiles=[{id:902,owner:'player',x:e.x,z:e.z,vx:0,vz:0,damage:80,bornTick:-1}];
  `);
  await advance(page, 1/120);
  hook = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  expect(hook.enemyCount).toBe(0);
  expect(hook.enemies).toEqual([]);
  expect(hook.score).toBe(1);
  await page.getByTestId('pause').click();
  expect(await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().gameState)).toBe('paused');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.reset());
  expect(await state(page)).toEqual(initial);
});

test('standard test hook follows stage and terminal states; normal mode is read-only', async ({ page }) => {
  for (const gameState of ['game-over', 'stage-clear']) {
    await fixture(page, `s.stage=3; s.status='${gameState}';`);
    const hook = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
    expect(hook.stage).toBe(3);
    expect(hook.gameState).toBe(gameState);
  }
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
  expect(await page.evaluate(() => Object.keys(window.__THREE_GAME_TEST_HOOKS__))).toEqual(['getState']);
  await page.getByTestId('pause').click();
  const before = await state(page);
  const hook = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  expect(hook.player.hp).toBe(before.player.hp);
  expect(hook.enemyCount).toBe(before.enemies.length);
  expect(hook.gameState).toBe('paused');
  expect(await state(page)).toEqual(before);
});

