/**
 * The single `PrismaClient` for the process (`contracts/persistence-v1.md`).
 * `data/` is the only layer permitted to import `@prisma/client`.
 */

import { PrismaClient } from '@prisma/client';

import { logger } from '../logger';

let client: PrismaClient | undefined;

/** Creates the client on first use and reuses it for the life of the process. */
export function getPrismaClient(): PrismaClient {
  if (client === undefined) {
    client = new PrismaClient();
  }
  return client;
}

/**
 * SQLite runs in WAL mode: better concurrent-read behaviour under the board's
 * 3-second polling (ADR 0006) and a cleaner crash story. Set once at startup.
 *
 * `PRAGMA journal_mode` returns a row, so this is a query rather than an
 * execute. The pragma is idempotent — an existing WAL database simply reports
 * `wal` again.
 */
export async function enableWalMode(prisma: PrismaClient = getPrismaClient()): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>(
    'PRAGMA journal_mode = WAL;',
  );
  const mode = rows[0]?.journal_mode ?? 'unknown';
  logger.info(`SQLite journal_mode = ${mode}`);
  return mode;
}

export async function disconnectPrisma(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}
