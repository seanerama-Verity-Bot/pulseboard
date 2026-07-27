/**
 * Serving the built SPA out of the same process as the API (ADR 0002), with the
 * cache headers the A8 Lighthouse budget depends on.
 *
 * - `/assets/*` are Vite's content-hashed files: `public, max-age=31536000, immutable`.
 * - `index.html` is the mutable entry point: `no-cache`.
 * - Any other unmatched **GET** falls back to `index.html` so client-side routes
 *   deep-link correctly. Unmatched `/api/*` never reaches here (see `http/app.ts`).
 */

import path from 'node:path';

import express, { type Express } from 'express';

import { HttpError } from '../http/errors';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * `apps/web/dist`, resolved from this module's directory. The path is identical
 * whether we are running from `src/static/` (tsx, dev) or `dist/static/`
 * (compiled, production) because both sit one level under `apps/server`.
 */
export function resolveWebDistPath(fromDir: string = __dirname): string {
  return path.resolve(fromDir, '..', '..', '..', 'web', 'dist');
}

export function registerStaticRoutes(app: Express, webDistPath: string): void {
  const indexHtmlPath = path.join(webDistPath, 'index.html');

  // Content-hashed bundles. A new build produces new filenames, so these are
  // safe to cache forever.
  app.use(
    '/assets',
    express.static(path.join(webDistPath, 'assets'), {
      index: false,
      immutable: true,
      maxAge: ONE_YEAR_MS,
    }),
  );

  // A missing hashed asset is a deploy bug, not a client route: answer with the
  // JSON envelope rather than handing back `index.html`.
  app.use('/assets', (_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'That asset does not exist.'));
  });

  // Everything else that physically exists in the build output (favicon, etc.).
  app.use(
    express.static(webDistPath, {
      index: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // History fallback for client-side routes.
  app.get('*', (_req, res, next) => {
    res.sendFile(
      indexHtmlPath,
      { cacheControl: false, headers: { 'Cache-Control': 'no-cache' } },
      (error?: Error) => {
        if (error) {
          next(error);
        }
      },
    );
  });
}
