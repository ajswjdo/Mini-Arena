import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { GameTestAdapter } from './helpers/game-test-adapter.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
});

test('adapter sends keyboard input and checks real Hook state', async ({ page }, testInfo) => {
  const game = new GameTestAdapter(page, testInfo);
  await game.expectState({ player: { hp: 100 }, stage: 1, gameState: 'playing' });
  await game.run('W moves the player', async () => {
    const before = await game.readState();
    await game.holdKey('w', 200);
    const after = await game.readState();
    expect(after.player.position.z).toBeLessThan(before.player.position.z);
    expect(after.player.position.x).toBe(before.player.position.x);
  });
  await game.pressKey('Escape');
  await game.expectState({ gameState: 'paused' });
  await game.pressKey('Escape');
  await game.expectState({ gameState: 'playing' });
});

test('adapter delivers mouse input at canvas-relative coordinates', async ({ page }, testInfo) => {
  const game = new GameTestAdapter(page, testInfo);
  // The current game has no mouse action. Observe delivery without adding a game rule.
  await page.locator('#arena').evaluate((canvas) => {
    canvas.addEventListener('click', (event) => {
      const box = canvas.getBoundingClientRect();
      canvas.dataset.testClick = JSON.stringify({ x: event.clientX - box.x, y: event.clientY - box.y, button: event.button });
    }, { once: true });
  });
  await game.clickCanvas(20, 30);
  await game.run('Canvas receives the requested click', async () => {
    const click = JSON.parse(await page.locator('#arena').getAttribute('data-test-click'));
    expect(click).toEqual({ x: 20, y: 30, button: 0 });
  });
});

test('adapter preserves a comparison failure and attaches its exact state snapshot', async ({ page }, testInfo) => {
  await page.goto('/?qa=1');
  await page.waitForFunction(() => !!window.__ARENA_QA__);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.reset());
  const game = new GameTestAdapter(page, testInfo);
  const before = await game.readState();
  // Deliberately wrong expectation: the adapter must throw, not silently pass.
  await expect(game.expectState({ score: 999 })).rejects.toThrow();
  const attachment = testInfo.attachments.find((item) => item.name === 'game-state-failure-1.json');
  expect(attachment).toBeDefined();
  const saved = JSON.parse(await readFile(attachment.path, 'utf8'));
  expect(saved.operation).toBe('expectState');
  expect(saved.expected).toEqual({ score: 999 });
  expect(saved.actual).toEqual(before);
  expect(saved.error.message).toContain('999');
  expect(await game.readState()).toEqual(before);
  console.log(`Intentional comparison failure captured: ${attachment.path}`);
});
