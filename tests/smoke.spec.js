import { test, expect } from '@playwright/test';

test('Smoke: game opens, canvas renders, and no fatal browser errors occur', async ({ page }) => {
  const errors = [];
  // Start collecting before navigation so startup failures are included.
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const response = await page.goto('/');
  expect(response?.ok(), 'Game page must return a successful HTTP response').toBe(true);

  const canvas = page.locator('#arena');
  await expect(canvas).toBeVisible();
  // A visible canvas alone can still be blank. Read two pixels after a render frame:
  // the arena center must differ from the background at the canvas corner.
  await expect.poll(() => canvas.evaluate((element) => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const gl = element.getContext('webgl2');
      if (!gl || gl.isContextLost() || !element.width || !element.height) return resolve(false);
      const corner = new Uint8Array(4);
      const center = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner);
      gl.readPixels(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
      resolve(center[3] > 0 && center.slice(0, 3).some((value, i) => value !== corner[i]));
    });
  })), { message: 'WebGL must render arena pixels, not just an empty canvas' }).toBe(true);

  await expect(page.locator('#render-error')).toBeHidden();
  expect(errors, 'No console.error or uncaught page errors during startup').toEqual([]);
});
