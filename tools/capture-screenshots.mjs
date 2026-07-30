/**
 * Captures screenshots from the production build.
 *
 * Run against `pnpm preview`. Rendering here goes through SwiftShader (this
 * container has no GPU), so the images are genuine output from the real build —
 * just software-rasterised, which mostly costs speed rather than fidelity.
 */
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.TUNER_URL ?? 'http://127.0.0.1:4173';
const OUT = 'docs/screenshots';
const EXECUTABLE =
  process.env.TUNER_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const LAUNCH = {
  executablePath: EXECUTABLE,
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBoot(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__tuner?.ready === true, null, { timeout: 60_000 });
  await sleep(400);
}

/** Enters the stage, skips the opening scene, and lets the world settle. */
async function enterGameplay(page, settleMs = 2500) {
  await page.getByTestId('title-new-journey').click();
  await page.waitForFunction(() => (window.__tuner?.tick ?? 0) > 40, null, { timeout: 60_000 });
  await page.keyboard.press('Space');
  await sleep(settleMs);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  const shots = [];

  // --- Desktop -------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    await waitForBoot(page);
    await page.screenshot({ path: `${OUT}/01-title.png` });
    shots.push('01-title.png');

    await page.getByTestId('title-accessibility').click();
    await sleep(300);
    await page.screenshot({ path: `${OUT}/02-accessibility.png` });
    shots.push('02-accessibility.png');

    await page.getByTestId('screen-back').click();
    await page.getByTestId('title-settings').click();
    await sleep(300);
    await page.screenshot({ path: `${OUT}/03-settings.png` });
    shots.push('03-settings.png');

    await page.getByTestId('screen-back').click();
    await sleep(200);

    await enterGameplay(page);
    await page.screenshot({ path: `${OUT}/04-gameplay.png` });
    shots.push('04-gameplay.png');

    // Move forward a little so the shot is not the spawn point, and fire.
    await page.keyboard.down('KeyW');
    await sleep(1200);
    await page.keyboard.up('KeyW');
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await sleep(500);
    await page.screenshot({ path: `${OUT}/05-gameplay-firing.png` });
    shots.push('05-gameplay-firing.png');
    await page.mouse.up();

    // A wider look: drag the camera up to show the level rather than the floor.
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(640, 300, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await sleep(800);
    await page.screenshot({ path: `${OUT}/06-gameplay-wide.png` });
    shots.push('06-gameplay-wide.png');

    await page.keyboard.press('Escape');
    await sleep(400);
    await page.screenshot({ path: `${OUT}/07-pause.png` });
    shots.push('07-pause.png');

    await context.close();
  }

  // --- Phone, to show the touch controls -----------------------------------
  {
    const context = await browser.newContext({
      ...devices['Pixel 5 landscape'],
      browserName: 'chromium',
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await waitForBoot(page);
    await enterGameplay(page, 2000);

    // Engage the floating stick so it is visible in the capture.
    const cdp = await context.newCDPSession(page);
    const size = page.viewportSize();
    const ox = size.width * 0.2;
    const oy = size.height * 0.68;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: ox, y: oy, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: ox + 34, y: oy - 40, id: 1 }],
    });
    await sleep(700);
    await page.screenshot({ path: `${OUT}/08-touch-phone.png` });
    shots.push('08-touch-phone.png');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await context.close();
  }

  // --- High contrast + large text, to show the options doing something -----
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await waitForBoot(page);
    await page.getByTestId('title-accessibility').click();
    await page.getByTestId('a11y-high-contrast').click();
    // Push text scale to maximum.
    await page.getByTestId('a11y-text-scale').locator('input').fill('1.8');
    await page.getByTestId('a11y-colourblind').click();
    await sleep(400);
    await page.screenshot({ path: `${OUT}/09-accessibility-high-contrast.png` });
    shots.push('09-accessibility-high-contrast.png');
    await context.close();
  }

  await browser.close();
  console.info(`captured ${shots.length}:\n${shots.join('\n')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
