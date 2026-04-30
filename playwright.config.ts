import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  retries: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'output/raw.json' }],
  ],
  use: {
    channel: 'chrome',
    userAgent: 'RyzeQABot/0.1 (+pm@ryze.example)',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
      scale: 'css',
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile',
      use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'lighthouse',
      use: {
        channel: 'chrome',
        launchOptions: { args: ['--remote-debugging-port=9222'] },
      },
    },
  ],
});
