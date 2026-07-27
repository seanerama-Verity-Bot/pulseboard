/**
 * Express app assembly. Registration order is the contract:
 *
 *   1. `/healthz`            — liveness, no auth, no DB
 *   2. `/api/...`            — the JSON API (`/api/session`, `/api/updates`; more later)
 *   3. `/api` catch-all      — JSON 404, never `index.html` (ADR 0002)
 *   4. static + SPA fallback — the built client
 *   5. terminal 404          — JSON for anything left (e.g. `POST /nope`)
 *   6. error handler         — the envelope, registered last
 */

import compression from 'compression';
import express, { type Express, Router } from 'express';

import { errorHandler, notFoundHandler } from './errors';
import { createHealthRouter } from './health';
import { createSessionRouter } from './session';
import { createUpdatesRouter } from './updates';
import { registerStaticRoutes } from '../static/spa';

export type CreateAppOptions = {
  /** Reported by `/healthz`. */
  version: string;
  /** Absolute path to `apps/web/dist`. */
  webDistPath: string;
  /**
   * `AppConfig.teamCode` — `null` outside production when `TEAM_CODE` is unset,
   * in which case joining is always rejected with `INVALID_TEAM_CODE`.
   */
  teamCode?: string | null;
  /**
   * `AppConfig.sessionSecret` — `null` outside production when unset. There is
   * no default in any environment (ADR 0005); a server that cannot sign cannot
   * issue a session, so joining is rejected the same way.
   */
  sessionSecret?: string | null;
  /** `AppConfig.isProduction` — selects the cookie's `Secure` attribute. */
  isProduction?: boolean;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // A8 budget: gzip everything compressible, including the JSON API.
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));

  app.use(createHealthRouter(options.version));

  // Feature routers mount here from Stage 2 onwards.
  const api = Router();
  api.use(
    createSessionRouter({
      teamCode: options.teamCode ?? null,
      sessionSecret: options.sessionSecret ?? null,
      isProduction: options.isProduction ?? false,
    }),
  );
  api.use(
    createUpdatesRouter({
      sessionSecret: options.sessionSecret ?? null,
      isProduction: options.isProduction ?? false,
    }),
  );
  app.use('/api', api);

  // Anything under /api that no router claimed is a JSON 404 — never the SPA.
  app.all('/api', notFoundHandler);
  app.all('/api/*', notFoundHandler);

  registerStaticRoutes(app, options.webDistPath);

  // Unmatched non-GET requests outside /api (the SPA fallback only handles GET).
  app.use(notFoundHandler);

  app.use(errorHandler);

  return app;
}
