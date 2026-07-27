/**
 * TEST-ONLY SEAM (`contracts/persistence-v1.md`).
 *
 * Nothing in `src/http/`, `src/domain/` or `src/index.ts` may import this
 * module, and none of it is reachable from an HTTP route. It exists so tests
 * for the 15-minute edit window (criterion A5) and the Today/Yesterday filter
 * (criterion A9) can backdate rows instead of waiting for the clock.
 */

import { type Mood } from '@pulseboard/shared';

import { getPrismaClient } from './prisma';

export type SeededMember = {
  id: string;
  displayName: string;
  joinedAt: Date;
};

export type SeededUpdate = {
  id: string;
  authorId: string;
  text: string;
  mood: Mood;
  createdAt: Date;
  editedAt: Date | null;
};

function normalizeName(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Creates (or reuses) a member. Test support for `seedUpdate`'s author. */
export async function seedMember(input: {
  displayName: string;
  joinedAt?: Date;
}): Promise<SeededMember> {
  const prisma = getPrismaClient();
  const displayName = input.displayName.trim();
  const normalizedName = normalizeName(displayName);

  const row = await prisma.member.upsert({
    where: { normalizedName },
    update: {},
    create:
      input.joinedAt === undefined
        ? { displayName, normalizedName }
        : { displayName, normalizedName, joinedAt: input.joinedAt },
  });

  return { id: row.id, displayName: row.displayName, joinedAt: row.joinedAt };
}

/**
 * Inserts an update with an explicit `createdAt`, which the production
 * repository seam deliberately does not allow.
 */
export async function seedUpdate(input: {
  authorId: string;
  text: string;
  mood: Mood;
  createdAt: Date;
  editedAt?: Date | null;
}): Promise<SeededUpdate> {
  const prisma = getPrismaClient();

  const row = await prisma.update.create({
    data: {
      authorId: input.authorId,
      text: input.text,
      mood: input.mood,
      createdAt: input.createdAt,
      editedAt: input.editedAt ?? null,
    },
  });

  return {
    id: row.id,
    authorId: row.authorId,
    text: row.text,
    mood: row.mood as Mood,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}
