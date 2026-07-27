import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/http/errors';
import { createApp } from '../src/http/app';

const VERSION = '1.2.3-test';
const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const ASSET_JS = 'console.log("hashed asset");\n';

let webDistPath: string;

/** A stand-in for `apps/web/dist`, laid out exactly as Vite emits it. */
beforeAll(() => {
  webDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulseboard-dist-'));
  fs.mkdirSync(path.join(webDistPath, 'assets'));
  fs.writeFileSync(path.join(webDistPath, 'index.html'), INDEX_HTML, 'utf8');
  fs.writeFileSync(path.join(webDistPath, 'assets', 'index-abc12345.js'), ASSET_JS, 'utf8');
});

afterAll(() => {
  fs.rmSync(webDistPath, { recursive: true, force: true });
});

function app() {
  return createApp({ version: VERSION, webDistPath });
}

describe('GET /healthz', () => {
  it('returns the documented shape with no auth', async () => {
    const response = await request(app()).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok', version: VERSION });
  });

  it('is not cached', async () => {
    const response = await request(app()).get('/healthz');

    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('unmatched /api routes', () => {
  it('returns a JSON 404 envelope, never index.html', async () => {
    const response = await request(app()).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.text).not.toContain('<!doctype html');
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) as unknown as string },
    });
  });

  it('does the same for a bare /api and for non-GET methods', async () => {
    for (const call of [
      request(app()).get('/api'),
      request(app()).post('/api/updates'),
      request(app()).delete('/api/session'),
      request(app()).patch('/api/updates/abc'),
    ]) {
      const response = await call;
      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_FOUND');
    }
  });

  it('returns a JSON 404 for an unmatched non-GET request outside /api', async () => {
    const response = await request(app()).post('/anything');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_FOUND');
  });
});

describe('SPA history fallback', () => {
  it('serves index.html for an unmatched non-/api GET', async () => {
    const response = await request(app()).get('/board/today');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<div id="root"></div>');
  });

  it('marks index.html no-cache', async () => {
    const response = await request(app()).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });
});

describe('static asset cache headers (the A8 budget)', () => {
  it('serves hashed /assets immutable for a year', async () => {
    const response = await request(app()).get('/assets/index-abc12345.js');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('returns a JSON 404 for a missing asset rather than index.html', async () => {
    const response = await request(app()).get('/assets/missing-00000000.js');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_FOUND');
  });

  it('advertises compression support', async () => {
    const response = await request(app())
      .get('/healthz')
      .set('Accept-Encoding', 'gzip')
      .buffer(true);

    // `compression()` always negotiates, and small bodies stay uncompressed;
    // what proves it is mounted is the Vary header it adds.
    expect(response.headers['vary']).toContain('Accept-Encoding');
  });
});

describe('the global error handler', () => {
  it('converts a thrown error into the ApiError envelope with no stack trace', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const boom = express();
    boom.get('/boom', () => {
      throw new Error('kaboom: a very identifiable secret detail');
    });
    boom.use(errorHandler);

    const response = await request(boom).get('/boom');

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our end. Please try again.',
      },
    });
    expect(response.text).not.toContain('kaboom');
    expect(response.text).not.toContain('at ');
    expect(response.text).not.toContain('.ts:');

    // The detail is logged, not sent.
    expect(consoleError).toHaveBeenCalled();
    const logged = consoleError.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('kaboom');
  });

  it('converts a rejected async handler the same way', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const boom = express();
    boom.get('/boom', (_req, _res, next) => {
      Promise.reject(new Error('async kaboom')).catch(next);
    });
    boom.use(errorHandler);

    const response = await request(boom).get('/boom');

    expect(response.status).toBe(500);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('async kaboom');
    expect(consoleError).toHaveBeenCalled();
  });

  it('produces the envelope through the real app when the build output is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const brokenApp = createApp({
      version: VERSION,
      webDistPath: path.join(webDistPath, 'nope-not-built'),
    });

    const response = await request(brokenApp).get('/');

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our end. Please try again.',
      },
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
