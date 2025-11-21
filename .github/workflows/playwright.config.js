import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './.github/workflows/tests',
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    browserName: 'chromium',
  },
});
