import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Thin Playwright helper: no game rules, state injection, retries or custom test runner.
export class GameTestAdapter {
  constructor(page, testInfo, canvasSelector = '#arena') {
    this.page = page;
    this.testInfo = testInfo;
    this.canvas = page.locator(canvasSelector);
    this.snapshotIndex = 0;
  }

  // Also wrap custom assertions here to capture failures outside expectState().
  async run(operation, action, details = {}) {
    try {
      return await action();
    } catch (error) {
      try {
        await this.saveSnapshot(operation, { ...details, error: { name: error.name, message: error.message } });
      } catch (snapshotError) {
        error.message += `\n상태 snapshot 저장 실패: ${snapshotError.message}`;
      }
      throw error; // A saved snapshot must never turn a failure into a pass.
    }
  }

  async holdKey(key, durationMs) {
    return this.run('holdKey', async () => {
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('durationMs must be a non-negative finite number');
      await this.canvas.focus();
      await this.page.keyboard.down(key);
      try { await this.page.waitForTimeout(durationMs); }
      finally { await this.page.keyboard.up(key); }
    }, { key, durationMs });
  }

  async pressKey(key) {
    return this.run('pressKey', async () => {
      await this.canvas.focus();
      await this.page.keyboard.press(key);
    }, { key });
  }

  // Coordinates are CSS pixels from the canvas's top-left, not world positions.
  async clickCanvas(x, y, button = 'left') {
    return this.run('clickCanvas', async () => {
      await expect(this.canvas).toBeVisible();
      const box = await this.canvas.boundingBox();
      if (!box || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= box.width || y >= box.height) {
        throw new RangeError('Click coordinates must be inside the canvas');
      }
      await this.page.mouse.click(box.x + x, box.y + y, { button });
    }, { x, y, button });
  }

  async readState() {
    return this.run('readState', () => this.page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState()));
  }

  async expectState(expected) {
    const actual = await this.readState();
    return this.run('expectState', () => {
      expect(actual).toMatchObject(expected);
      return actual;
    }, { expected, actual });
  }

  async saveSnapshot(operation, details = {}) {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      test: this.testInfo.title,
      url: this.page.url(),
      operation,
      ...details,
    };
    // Reuse the exact compared state on assertion failures; don't replace it with a later frame.
    if (!Object.hasOwn(snapshot, 'actual')) {
      try { snapshot.actual = await this.page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState()); }
      catch (error) { snapshot.stateReadError = error.message; }
    }
    const name = `game-state-failure-${++this.snapshotIndex}.json`;
    const path = this.testInfo.outputPath(name);
    await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
    await this.testInfo.attach(name, { path, contentType: 'application/json' });
    return path;
  }
}
