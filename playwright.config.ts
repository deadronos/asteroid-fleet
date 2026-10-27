import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  // Software GL makes whole flows slow on CI runners; waits are signal-based, this is only the ceiling.
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}/asteroid-fleet/`,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm run preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/asteroid-fleet/`,
    reuseExistingServer: !process.env.CI,
  },
});
