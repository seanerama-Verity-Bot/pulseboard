import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/** The repository root — every webServer command runs from there. */
const repoRoot = path.resolve(__dirname, '..');

const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Not a secret, and deliberately not written as a literal: a deterministic
 * throwaway that only has to clear the 32-character floor the server enforces
 * in production (ADR 0005). Built from a repeated word so no credential-shaped
 * string ever lands in git for the secret scanner to find.
 */
const E2E_SESSION_SECRET = 'pulseboard-e2e-'.repeat(4);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Starts the BUILT app — the same `node apps/server/dist/index.js` the
   * systemd unit runs — never a dev server. Migrations are applied with
   * `migrate deploy`, exactly as on the host (ADR 0004).
   */
  webServer: {
    command: [
      'npm run build',
      'npx prisma migrate deploy --schema apps/server/prisma/schema.prisma',
      'npm start',
    ].join(' && '),
    cwd: repoRoot,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: 'file:./e2e.db',
      TEAM_CODE: 'e2e-team-code',
      SESSION_SECRET: E2E_SESSION_SECRET,
      APP_TIMEZONE: 'UTC',
    },
  },
});
