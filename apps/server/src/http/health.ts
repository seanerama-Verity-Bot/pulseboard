import { Router } from 'express';
import { type HealthResponse } from '@pulseboard/shared';

/**
 * `GET /healthz` — liveness. Deliberately outside `/api`, no auth, and it
 * performs no database work at all: the deploy readiness poll (ADR 0004) must
 * not be able to write to the database.
 */
export function createHealthRouter(version: string): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    const body: HealthResponse = { status: 'ok', version };
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(body);
  });

  return router;
}
