import { test, expect } from '@playwright/test';

// Native visibility is checked with a visible browser, separately from synthetic events.
test.use({ headless: false, channel: process.platform === 'win32' ? 'msedge' : 'chromium' });
const state = (page) => page.evaluate(() => window.__ARENA__.snapshot());

test('a real second tab pauses the game and returning does not auto-resume', async ({ page, context }) => {
  await page.goto('/?qa=1');
  await page.waitForFunction(() => !!window.__ARENA_QA__);
  // Playwright normally forces every page to appear focused, hiding native tab events.
  const nativeSession = await context.newCDPSession(page);
  await nativeSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.bringToFront();
  if ((await state(page)).status === 'paused') await page.getByTestId('resume').click();
  await page.keyboard.down('w');
  const other = await context.newPage();
  await other.goto('about:blank');
  const otherSession = await context.newCDPSession(other);
  await otherSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await other.bringToFront();
  await expect.poll(async () => (await state(page)).status).toBe('paused');
  const before = await state(page);
  expect(before.pauseReason).toBe('focus-lost');
  expect(Object.values(before.input).some(Boolean)).toBe(false);
  await page.bringToFront();
  await page.keyboard.up('w');
  expect(await state(page)).toEqual(before);
  await page.getByTestId('resume').click();
  expect((await state(page)).status).toBe('playing');
  await other.close();
});
