import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('W held for 1 second changes player position according to the Test Hook', async ({ page }, testInfo) => {
  // Normal real-time game: no fixture injection or manual simulation advance.
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
  await page.locator('#arena').focus();
  const before = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
  expect(before.gameState).toBe('playing');

  const requestedHoldMs = 1000;
  await page.keyboard.down('w');
  const started = performance.now();
  try {
    // This delay is the input duration under test, not a page-readiness wait.
    await page.waitForTimeout(requestedHoldMs);
  } finally {
    await page.keyboard.up('w');
  }
  const actualHoldMs = Math.round(performance.now() - started);
  const after = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());

  const delta = {
    x: after.player.position.x - before.player.position.x,
    z: after.player.position.z - before.player.position.z,
  };
  const result = {
    input: 'W', requestedHoldMs, actualHoldMs,
    beforePosition: before.player.position,
    afterPosition: after.player.position,
    delta,
    beforeGameState: before.gameState,
    afterGameState: after.gameState,
    moved: Math.hypot(delta.x, delta.z) > 0,
  };
  const json = JSON.stringify(result, null, 2);
  const resultPath = testInfo.outputPath('movement-positions.json');
  await writeFile(resultPath, json, 'utf8');
  await testInfo.attach('W input: positions before and after', { path: resultPath, contentType: 'application/json' });
  console.log(`W movement result:\n${json}\nSaved: ${resultPath}`);

  expect(after.gameState, 'Game must keep running during the input').toBe('playing');
  expect(result.moved, 'Test Hook position must change').toBe(true);
  expect(delta.z, 'W must move toward negative Z').toBeLessThan(0);
  expect(delta.x, 'W alone must not move along X').toBeCloseTo(0, 8);
});
