/**
 * The Member half of the `persistence-v1` repository seam.
 *
 * `data/` is the only layer permitted to import `@prisma/client`, and no Prisma
 * type crosses this boundary: routes and domain logic see plain objects.
 */

import { getPrismaClient } from './prisma';

export type MemberRow = {
  id: string;
  /** As typed (trimmed), for display. */
  displayName: string;
  joinedAt: Date;
};

/**
 * The find-or-create key from `contracts/persistence-v1.md`: lowercased and
 * whitespace-collapsed, so `"  Ada   Lovelace "` and `"ada lovelace"` are the
 * same teammate. Kept identical to the normalization in `data/testing.ts`.
 */
export function normalizeName(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A returning teammate re-joins as themselves rather than accumulating
 * duplicate Member rows (ADR 0005).
 *
 * `update: {}` is the point of the upsert: `joinedAt` is set on creation only
 * and is never refreshed, and the stored `displayName` keeps the casing the
 * member first used.
 */
export async function findOrCreateMember(displayName: string): Promise<MemberRow> {
  const prisma = getPrismaClient();
  const trimmed = displayName.trim();
  const normalizedName = normalizeName(trimmed);

  const row = await prisma.member.upsert({
    where: { normalizedName },
    update: {},
    create: { displayName: trimmed, normalizedName },
  });

  return { id: row.id, displayName: row.displayName, joinedAt: row.joinedAt };
}

export async function getMemberById(id: string): Promise<MemberRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.member.findUnique({ where: { id } });

  if (row === null) {
    return null;
  }

  return { id: row.id, displayName: row.displayName, joinedAt: row.joinedAt };
}
