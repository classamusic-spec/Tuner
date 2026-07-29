import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests exist to answer one question the unit suite cannot: does the game
 * actually reach playable gameplay in a real browser, on a real canvas, driven
 * by real input? They run against the production build, because that is what
 * players receive.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // WebGL in headless Chromium needs software rendering in this container.
    launchOptions: {
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
        '--no-sandbox',
      ],
    },
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'tablet-touch',
      use: {
        ...devices['iPad (gen 7) landscape'],
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'phone-touch',
      use: {
        ...devices['Pixel 5 landscape'],
        hasTouch: true,
        isMobile: true,
      },
    },
  ],

  webServer: {
    command: 'pnpm --filter @tuner/web preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
