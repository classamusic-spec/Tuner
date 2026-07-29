import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end smoke tests.
 *
 * These answer the one question no unit test can: does the game actually reach
 * playable gameplay in a real browser, on a real canvas, driven by real input?
 *
 * They are deliberately shallow and robust. Deep gameplay assertions belong in
 * the simulation's unit tests, where they run in milliseconds and do not depend
 * on software-rendered WebGL. What is checked here is that the pieces are
 * genuinely wired together.
 *
 * The host exposes a small diagnostic surface on `window.__tuner` specifically
 * for these tests — frame count, simulation tick, and the player's position —
 * because reading pixels to decide whether the player moved is slow and flaky.
 */

declare global {
  interface Window {
    __tuner?: {
      readonly ready: boolean;
      readonly frames: number;
      readonly tick: number;
      readonly screen: string;
      readonly playerPosition: { x: number; y: number; z: number };
      readonly stageId: string | null;
      readonly errors: readonly string[];
    };
  }
}

async function waitForBoot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('tuner-root')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => window.__tuner?.ready === true, undefined, {
    timeout: 60_000,
  });
}

/** Enters gameplay from the title screen and waits for the simulation to tick. */
async function startGameplay(page: Page): Promise<void> {
  await waitForBoot(page);
  await page.getByTestId('title-new-journey').click();
  await page.waitForFunction(() => (window.__tuner?.tick ?? 0) > 30, undefined, {
    timeout: 60_000,
  });
}

test.describe('boot and title', () => {
  test('the title screen renders and offers a new journey', async ({ page }) => {
    await waitForBoot(page);
    await expect(page.getByTestId('title-new-journey')).toBeVisible();
    await expect(page.getByTestId('title-settings')).toBeVisible();
    await expect(page.getByTestId('title-accessibility')).toBeVisible();
  });

  test('no uncaught errors during boot', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await waitForBoot(page);
    expect(consoleErrors).toEqual([]);
  });

  test('a WebGL canvas is present and producing frames', async ({ page }) => {
    await startGameplay(page);
    await expect(page.locator('canvas')).toBeVisible();

    const before = await page.evaluate(() => window.__tuner?.frames ?? 0);
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => window.__tuner?.frames ?? 0);

    // Software-rendered WebGL is slow; the bar is "advancing", not "fast".
    expect(after).toBeGreaterThan(before);
  });
});

test.describe('gameplay', () => {
  test('the simulation advances at a fixed rate', async ({ page }) => {
    await startGameplay(page);

    const first = await page.evaluate(() => window.__tuner?.tick ?? 0);
    await page.waitForTimeout(1000);
    const second = await page.evaluate(() => window.__tuner?.tick ?? 0);

    const elapsed = second - first;
    // One second of wall time should advance roughly 60 fixed steps. Allow a
    // wide band: this container has no GPU and the step count is clamped when
    // frames run long.
    expect(elapsed).toBeGreaterThan(15);
    expect(elapsed).toBeLessThan(120);
  });

  test('keyboard input moves the player', async ({ page }) => {
    await startGameplay(page);
    await page.locator('canvas').click({ position: { x: 100, y: 100 } });

    // The stage opens on a cutscene that deliberately holds control — the Tuner
    // is waking up mid-attack. Skip it the way a player would.
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    const start = await page.evaluate(() => window.__tuner?.playerPosition);
    expect(start).toBeDefined();

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);

    const end = await page.evaluate(() => window.__tuner?.playerPosition);
    expect(end).toBeDefined();

    const moved = Math.hypot(
      (end?.x ?? 0) - (start?.x ?? 0),
      (end?.z ?? 0) - (start?.z ?? 0),
    );
    expect(moved).toBeGreaterThan(1);
  });

  test('pause is reachable at any time and resumes cleanly', async ({ page }) => {
    await startGameplay(page);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();

    const paused = await page.evaluate(() => window.__tuner?.tick ?? 0);
    await page.waitForTimeout(600);
    const stillPaused = await page.evaluate(() => window.__tuner?.tick ?? 0);
    expect(stillPaused).toBe(paused);

    await page.getByTestId('pause-resume').click();
    await expect(page.getByTestId('pause-menu')).toBeHidden();

    await page.waitForTimeout(600);
    const resumed = await page.evaluate(() => window.__tuner?.tick ?? 0);
    expect(resumed).toBeGreaterThan(stillPaused);
  });

  test('the HUD shows Coherence and the equipped form', async ({ page }) => {
    await startGameplay(page);
    await expect(page.getByTestId('hud-coherence')).toBeVisible();
    await expect(page.getByTestId('hud-form')).toBeVisible();
  });
});

test.describe('settings and accessibility', () => {
  test('accessibility settings persist across a reload', async ({ page }) => {
    await waitForBoot(page);
    await page.getByTestId('title-accessibility').click();

    const toggle = page.getByTestId('a11y-reduced-motion');
    await expect(toggle).toBeVisible();
    await toggle.click();

    await page.reload();
    await page.waitForFunction(() => window.__tuner?.ready === true, undefined, {
      timeout: 60_000,
    });
    await page.getByTestId('title-accessibility').click();
    await expect(page.getByTestId('a11y-reduced-motion')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('touch', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'touch-capable projects only');

  test('on-screen controls appear and drive the player', async ({ page }) => {
    await startGameplay(page);

    const controls = page.getByTestId('touch-controls');
    await expect(controls).toBeVisible();

    // Playwright's mouse API emits mouse events, which the touch source
    // correctly ignores — so a real touch drag has to be dispatched through CDP.
    const cdp = await page.context().newCDPSession(page);
    const touchAt = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      x: number,
      y: number,
    ): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      });
    };

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    // Skip the opening cutscene first. What this test is actually about is
    // whether a touch drag reaches the simulation, so the skip is setup.
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    const start = await page.evaluate(() => window.__tuner?.playerPosition);

    // The stick's origin follows the thumb, so any left-half touch engages it.
    const originX = viewport.width * 0.2;
    const originY = viewport.height * 0.7;
    await touchAt('touchStart', originX, originY);
    for (let i = 1; i <= 6; i++) {
      await touchAt('touchMove', originX, originY - i * 15);
    }
    await page.waitForTimeout(900);
    await touchAt('touchEnd', originX, originY - 90);
    await page.waitForTimeout(200);

    const end = await page.evaluate(() => window.__tuner?.playerPosition);
    const moved = Math.hypot(
      (end?.x ?? 0) - (start?.x ?? 0),
      (end?.z ?? 0) - (start?.z ?? 0),
    );
    expect(moved).toBeGreaterThan(0.5);
  });
});
