import fs from 'node:fs';
import path from 'node:path';

/**
 * The value `/healthz` reports. A deploy sets `GIT_SHA` (CI sets `GITHUB_SHA`);
 * otherwise we fall back to the server package's version.
 */
export function resolveVersion(source: NodeJS.ProcessEnv = process.env): string {
  const sha = source.GIT_SHA ?? source.GITHUB_SHA;
  if (typeof sha === 'string' && sha.trim() !== '') {
    return sha.trim();
  }
  return readPackageVersion();
}

function readPackageVersion(fromDir: string = __dirname): string {
  // `src/version.ts` and `dist/version.js` are both one level under apps/server.
  const packageJsonPath = path.resolve(fromDir, '..', 'package.json');
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const { version } = parsed as { version: unknown };
      if (typeof version === 'string' && version !== '') {
        return version;
      }
    }
  } catch {
    // Fall through to the sentinel below.
  }
  return '0.0.0-unknown';
}
