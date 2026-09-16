import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', fullyParallel: false, workers: 1, use: { baseURL: 'http://127.0.0.1:4173', headless: true }, webServer: { command: 'node scripts/serve-spike.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false }, reporter: 'list' });
