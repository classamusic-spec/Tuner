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
      // The environment ships a pre-installed Chromium whose build number does
      // not match what this Playwright version would download. Point at the real
      // binary rather than fetching a second copy.
      executablePath: process.env.TUNER_CHROMIUM ?? undefined,
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
        '--no-sandbox',
        '--disable-dev-shm-usage',
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
        // The iPad profiles default to WebKit, which is not installed here, so
        // the browser died at launch rather than on any assertion. The tablet
        // form factor is what matters to this suite, not the engine.
        browserName: 'chromium',
        hasTouch: true,
        isMobile: true,
        // The device profile's 2x scale factor asks software rendering for a
        // 2160x1620 framebuffer, which this container cannot allocate — the GPU
        // process dies during initialisation. Rendering at 1x tests the same
        // code paths at a size that fits.
        deviceScaleFactor: 1,
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
