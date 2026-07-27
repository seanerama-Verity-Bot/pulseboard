/**
 * Process entry point: load and validate the environment, put SQLite into WAL
 * mode, then listen on loopback (ADR 0004 — the only public path in is the
 * Tailscale funnel).
 */

import 'dotenv/config';

import type { Server } from 'node:http';

import { disconnectPrisma, enableWalMode } from './data/prisma';
import { loadEnv } from './env';
import { createApp } from './http/app';
import { logger } from './logger';
import { resolveWebDistPath } from './static/spa';
import { resolveVersion } from './version';

const HOST = '127.0.0.1';

async function main(): Promise<void> {
  const config = loadEnv();
  const version = resolveVersion();

  await enableWalMode();

  const app = createApp({
    version,
    webDistPath: resolveWebDistPath(),
    teamCode: config.teamCode,
    sessionSecret: config.sessionSecret,
    isProduction: config.isProduction,
  });

  const server: Server = app.listen(config.port, HOST, () => {
    logger.info(
      `Pulseboard ${version} listening on http://${HOST}:${config.port} ` +
        `(env=${config.nodeEnv}, timezone=${config.appTimezone})`,
    );
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down.`);
    server.close(() => {
      void disconnectPrisma().finally(() => {
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  logger.error('Failed to start Pulseboard.', error);
  process.exit(1);
});
