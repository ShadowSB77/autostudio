import { defineConfig, devices } from '@playwright/test';

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const base = process.env.BASE_URL ?? 'http://localhost:4173/autostudio/s/graphite/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: base,
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    proxy,
    ignoreHTTPSErrors: false,
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : 'chrome') } },
    { name: 'desktop', use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: process.env.BASE_URL ? undefined : { command: 'pnpm preview --port 4173 --strictPort', url: 'http://localhost:4173/autostudio/', reuseExistingServer: true },
});
