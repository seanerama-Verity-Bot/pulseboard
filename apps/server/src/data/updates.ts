/**
 * The Update half of the `persistence-v1` repository seam.
 *
 * `data/` is the only layer permitted to import `@prisma/client`, and no Prisma
 * type crosses this boundary: routes and domain logic see plain objects.
 *
 * Nothing here validates. `text` arrives already trimmed and length-checked by
 * `domain/validateUpdateText`, and `mood` already narrowed to `Mood` by
 * `domain/validateMood` — a row outside the four moods is a contract violation
 * (`persistence-v1`), so the type is the guard.
 */

import { type Mood } from '@pulseboard/shared';

import { getPrismaClient } from './prisma';

export type UpdateRow = {
  id: string;
  authorId: string;
  text: string;
  mood: Mood;
  createdAt: Date;
  editedAt: Date | null;
};

/**
 * `mood` is a plain `String` column because SQLite has no native enum
 * (`persistence-v1`); the union in `packages/shared` is the authority and the
 * domain layer has already enforced it on the way in.
 */
function toRow(row: {
  id: string;
  authorId: string;
  text: string;
  mood: string;
  createdAt: Date;
  editedAt: Date | null;
}): UpdateRow {
  return {
    id: row.id,
    authorId: row.authorId,
    text: row.text,
    mood: row.mood as Mood,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}

/**
 * Inserts one update. `createdAt` is the database default — deliberately not an
 * input, so no route can backdate a row (the test-only `seedUpdate` seam in
 * `data/testing.ts` is the single exception, and it is unreachable from HTTP).
 *
 * `authorId` is whatever the caller passes; the route is what guarantees it
 * came from the session cookie and nothing else (`session-cookie-v1`).
 */
export async function createUpdate(input: {
  authorId: string;
  text: string;
  mood: Mood;
}): Promise<UpdateRow> {
  const prisma = getPrismaClient();

  const row = await prisma.update.create({
    data: { authorId: input.authorId, text: input.text, mood: input.mood },
  });

  return toRow(row);
}
