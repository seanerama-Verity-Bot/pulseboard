import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The env validator is unit-tested in `env.test.ts`. This file proves the other
 * half of the requirement: that the **process** really refuses to start.
 *
 * It boots the actual entry point (`src/index.ts`, via tsx) with a deliberately
 * invalid production environment and asserts a non-zero exit code. `cwd` is
 * `apps/server`, so a developer's root `.env` cannot leak in and rescue it.
 */

const serverRoot = process.cwd(); // vitest runs from apps/server
const repoRoot = path.resolve(serverRoot, '..', '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const entryPoint = path.join(serverRoot, 'src', 'index.ts');

type BootResult = { code: number | null; stderr: string };

function boot(env: Record<string, string>): Promise<BootResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [entryPoint], {
      cwd: serverRoot,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.on('data', () => {
      // The server should never get far enough to log a listening line; if it
      // does, the exit-code assertion below is what fails.
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('The server did not exit; it apparently started anyway.'));
    }, 20_000);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

const canRun = fs.existsSync(tsxBin);

describe.runIf(canRun)('boot refusal', () => {
  it('exits non-zero in production when SESSION_SECRET is too short', async () => {
    const result = await boot({
      NODE_ENV: 'production',
      DATABASE_URL: 'file:./boot-test.db',
      TEAM_CODE: 'sunrise-42',
      SESSION_SECRET: 'far-too-short',
    });

    expect(result.code).not.toBe(0);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SESSION_SECRET');
  }, 30_000);

  it('exits non-zero in production when APP_TIMEZONE is not a real zone', async () => {
    const result = await boot({
      NODE_ENV: 'production',
      DATABASE_URL: 'file:./boot-test.db',
      TEAM_CODE: 'sunrise-42',
      SESSION_SECRET: 'x'.repeat(48),
      APP_TIMEZONE: 'Mars/Olympus_Mons',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('APP_TIMEZONE');
  }, 30_000);
});
