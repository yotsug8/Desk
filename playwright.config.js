// Тесты идут против локального Supabase (npx supabase start) и статического сервера
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    // без UTF-8 локали Chromium теряет русские имена скачанных файлов
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
  },
});
