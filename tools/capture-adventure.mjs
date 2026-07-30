/**
 * Captures the adventure layer from the production build.
 *
 * Separate from `capture-screenshots.mjs` because this one has to *play*: it
 * walks the terraces, steers to Sava, waits for the interaction prompt and
 * presses interact. A still of a village proves nothing about whether the
 * village is reachable.
 *
 * It also checks the facing numerically rather than by eye. A survivor turned
 * 180° out looks plausible in a dark frame and is unmistakable as a dot product.
 *
 * Run against `pnpm --filter @tuner/web preview`.
 */
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173';
const OUT = 'docs/screenshots';
const LAUNCH = {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__tuner?.ready === true, null, { timeout: 60_000 });
await page.getByTestId('title-new-journey').click();
await page.waitForFunction(() => (window.__tuner?.tick ?? 0) > 40, null, { timeout: 60_000 });
console.log('npcs at load:', JSON.stringify(await page.evaluate(() => window.__tuner?.npcs)));

const pos = () => page.evaluate(() => window.__tuner?.playerPosition);
await page.keyboard.down('KeyW');
await sleep(2600);
await page.keyboard.up('KeyW');
await page.keyboard.press('Space');
await sleep(400);
await page.keyboard.down('KeyW');
for (let i = 0; i < 3; i++) {
  await sleep(1500);
  await page.keyboard.press('Space');
}
await page.keyboard.up('KeyW');
await sleep(600);
console.log('pos:', JSON.stringify(await pos()));

for (let i = 0; i < 60; i++) {
  const t = await page.evaluate(() => window.__tuner?.interactionTarget);
  if (t) {
    console.log('PROMPT:', JSON.stringify(t));
    break;
  }
  const state = await page.evaluate(() => ({
    p: window.__tuner.playerPosition,
    n: window.__tuner.npcs.find((x) => x.id === 'npc-sava'),
  }));
  if (!state.n) {
    console.log('no sava in projection');
    break;
  }
  const dx = state.n.x - state.p.x;
  const dz = state.n.z - state.p.z;
  const keys = [];
  if (dz < -0.8) keys.push('KeyW');
  else if (dz > 0.8) keys.push('KeyS');
  if (dx < -0.8) keys.push('KeyA');
  else if (dx > 0.8) keys.push('KeyD');
  for (const k of keys) await page.keyboard.down(k);
  await sleep(200);
  if (i % 4 === 0) await page.keyboard.press('Space');
  for (const k of keys) await page.keyboard.up(k);
  await sleep(60);
}
console.log('final:', JSON.stringify(await pos()));
await sleep(800);
await page.screenshot({ path: `${OUT}/12-meeting-sava.png` });
await page.keyboard.press('KeyE');
await sleep(3000);
await page.screenshot({ path: `${OUT}/13-talking-to-sava.png` });
await page.screenshot({
  path: `${OUT}/14-sava-close.png`,
  clip: { x: 480, y: 280, width: 460, height: 300 },
});
const check = await page.evaluate(() => {
  const p = window.__tuner.playerPosition;
  const n = window.__tuner.npcs.find((x) => x.id === 'npc-sava');
  // forward(yaw) = (-sin yaw, -cos yaw); a yaw of zero faces -Z.
  const fx = -Math.sin(n.yaw);
  const fz = -Math.cos(n.yaw);
  const dx = p.x - n.x;
  const dz = p.z - n.z;
  const span = Math.hypot(dx, dz) || 1;
  return { yaw: n.yaw, speaking: n.speaking, dot: (fx * dx + fz * dz) / span };
});
console.log('sava facing check:', JSON.stringify(check));
console.log(check.dot > 0.9 ? 'FACING THE PLAYER' : 'NOT FACING THE PLAYER');
await browser.close();
