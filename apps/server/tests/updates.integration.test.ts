import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPDATE_LENGTH, MOODS, SESSION_COOKIE_NAME } from '@pulseboard/shared';

import { disconnectPrisma, getPrismaClient } from '../src/data/prisma';
import { createApp } from '../src/http/app';
import { sign } from '../src/session/cookie';

/**
 * Integration tests for `POST /api/updates`, against a real database.
 *
 * The database is a throwaway SQLite file of this test file's own, created with
 * `prisma migrate deploy` (exactly as the host does — never `migrate dev`) and
 * deleted in teardown. `DATABASE_URL` is set before anything touches Prisma,
 * because the client resolves it once, on first construction.
 *
 * The claim every rejection test makes is the same one criterion A7 makes:
 * **no row was written**. Counting rows is the assertion, not the status code.
 */

/** `npm test` runs vitest from `apps/server`; tolerate a run from the root too. */
const serverRoot = fs.existsSync(path.join(process.cwd(), 'prisma', 'schema.prisma'))
  ? process.cwd()
  : path.join(process.cwd(), 'apps', 'server');
const repoRoot = path.resolve(serverRoot, '..', '..');
const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
const prismaBin = path.join(repoRoot, 'node_modules', '.bin', 'prisma');

const DB_FILENAME = 'test-updates-integration.db';
const DATABASE_URL = `file:./${DB_FILENAME}`;
const dbPath = path.join(serverRoot, 'prisma', DB_FILENAME);

const VERSION = '1.2.3-test';

/** Not secrets: deterministic throwaways built by repetition, never literals. */
const TEAM_CODE = 'stage-three-test-code';
const SESSION_SECRET = 'pulseboard-updates-secret-'.repeat(2);

let webDistPath = '';

function removeDatabaseFiles(): void {
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

beforeAll(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  removeDatabaseFiles();

  execFileSync(prismaBin, ['migrate', 'deploy', '--schema', schemaPath], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });

  // A stand-in for `apps/web/dist`; these tests never request it, but the app
  // registers the static routes unconditionally.
  webDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulseboard-updates-dist-'));
  fs.writeFileSync(path.join(webDistPath, 'index.html'), '<!doctype html><html></html>', 'utf8');
}, 120_000);

afterAll(async () => {
  await disconnectPrisma();
  removeDatabaseFiles();
  if (webDistPath !== '') {
    fs.rmSync(webDistPath, { recursive: true, force: true });
  }
});

/** Every test starts from an empty Update table, so "no row written" is exact. */
beforeEach(async () => {
  await getPrismaClient().update.deleteMany({});
});

function devApp() {
  return createApp({
    version: VERSION,
    webDistPath,
    teamCode: TEAM_CODE,
    sessionSecret: SESSION_SECRET,
    isProduction: false,
  });
}

function cookieHeader(value: string): string {
  return `${SESSION_COOKIE_NAME}=${value}`;
}

type JoinedMember = { id: string; displayName: string; cookie: string };

/** Joins through the real door, so the cookie under test is a real one. */
async function join(displayName: string): Promise<JoinedMember> {
  const response = await request(devApp())
    .post('/api/session')
    .send({ teamCode: TEAM_CODE, displayName });

  expect(response.status).toBe(201);

  const member = (response.body as { member: { id: string; displayName: string } }).member;
  const setCookie = response.headers['set-cookie'] as unknown as string[] | string | undefined;
  const raw = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  const header = raw.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
  const value = decodeURIComponent(
    (header.split(';')[0] ?? '').slice(`${SESSION_COOKIE_NAME}=`.length),
  );

  return { id: member.id, displayName: member.displayName, cookie: value };
}

async function countUpdates(): Promise<number> {
  return getPrismaClient().update.count();
}

type WireUpdate = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  mood: string;
  createdAt: string;
  editedAt: string | null;
  canMutate: boolean;
};

describe('POST /api/updates — the happy path', () => {
  it('answers 201 with the full Update DTO, including authorName and canMutate', async () => {
    const member = await join('Ada Lovelace');

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text: '  shipping the composer  ', mood: 'focused' });

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');

    const update = (response.body as { update: WireUpdate }).update;
    expect(update).toEqual({
      id: expect.any(String) as unknown as string,
      authorId: member.id,
      authorName: 'Ada Lovelace',
      // Trimmed by the domain layer before it was ever stored.
      text: 'shipping the composer',
      mood: 'focused',
      createdAt: expect.any(String) as unknown as string,
      editedAt: null,
      canMutate: true,
    });

    // ISO-8601 UTC with a Z suffix, per `http-api-v1`.
    expect(update.createdAt).toMatch(/Z$/);
    expect(new Date(update.createdAt).toISOString()).toBe(update.createdAt);
  });

  it('persists a row that matches the response, for each of the four moods', async () => {
    const member = await join('Grace Hopper');

    for (const mood of MOODS) {
      const response = await request(devApp())
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text: `feeling ${mood}`, mood });

      expect(response.status, mood).toBe(201);

      const update = (response.body as { update: WireUpdate }).update;
      const row = await getPrismaClient().update.findUnique({ where: { id: update.id } });

      expect(row).not.toBeNull();
      expect(row?.authorId).toBe(member.id);
      expect(row?.text).toBe(`feeling ${mood}`);
      expect(row?.mood).toBe(mood);
      expect(row?.editedAt).toBeNull();
      expect(row?.createdAt.toISOString()).toBe(update.createdAt);
    }

    expect(await countUpdates()).toBe(MOODS.length);
  });

  it('accepts text at exactly 280 characters and stores it whole', async () => {
    const member = await join('Boundary Betty');
    const text = 'a'.repeat(MAX_UPDATE_LENGTH);

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text, mood: 'cruising' });

    expect(response.status).toBe(201);

    const update = (response.body as { update: WireUpdate }).update;
    expect(update.text).toBe(text);

    const row = await getPrismaClient().update.findUnique({ where: { id: update.id } });
    expect(row?.text).toBe(text);
    expect(row?.text).toHaveLength(MAX_UPDATE_LENGTH);
    expect(await countUpdates()).toBe(1);
  });

  it('accepts 280 emoji — 560 UTF-16 units — because the limit is in code points', async () => {
    const member = await join('Emoji Emma');
    const text = '🚀'.repeat(MAX_UPDATE_LENGTH);

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text, mood: 'focused' });

    expect(response.status).toBe(201);
    expect(await countUpdates()).toBe(1);
  });
});

describe('POST /api/updates — text validation (criterion A7)', () => {
  it('rejects 281 characters with 400 TEXT_TOO_LONG and writes no row', async () => {
    const member = await join('Too Long Tom');

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text: 'a'.repeat(MAX_UPDATE_LENGTH + 1), mood: 'focused' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'TEXT_TOO_LONG',
        message: expect.any(String) as unknown as string,
        field: 'text',
      },
    });

    // The claim that matters: nothing was written.
    expect(await countUpdates()).toBe(0);
  });

  it('rejects 281 emoji as well — no row, and not a silent truncation', async () => {
    const member = await join('Emoji Overflow');

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text: '🚀'.repeat(MAX_UPDATE_LENGTH + 1), mood: 'focused' });

    expect(response.status).toBe(400);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('TEXT_TOO_LONG');
    expect(await countUpdates()).toBe(0);
  });

  it('rejects empty, whitespace-only and missing text with 400 TEXT_EMPTY and no row', async () => {
    const member = await join('Empty Ellie');

    for (const text of ['', '   \t\n ', undefined, 42, null]) {
      const response = await request(devApp())
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text, mood: 'focused' });

      expect(response.status, JSON.stringify(text)).toBe(400);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe('TEXT_EMPTY');
      expect((response.body as { error?: { field?: string } }).error?.field).toBe('text');
    }

    expect(await countUpdates()).toBe(0);
  });
});

describe('POST /api/updates — mood validation', () => {
  it('rejects a mood outside the four with 400 INVALID_MOOD and writes no row', async () => {
    const member = await join('Mood Molly');

    for (const mood of ['sleepy', 'FOCUSED', '', undefined, 7, null]) {
      const response = await request(devApp())
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text: 'a perfectly good update', mood });

      expect(response.status, JSON.stringify(mood)).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_MOOD',
          message: expect.any(String) as unknown as string,
          field: 'mood',
        },
      });
    }

    expect(await countUpdates()).toBe(0);
  });

  it('checks the text before the mood, so the first thing wrong is the first thing said', async () => {
    const member = await join('Order Olive');

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text: '', mood: 'sleepy' });

    expect(response.status).toBe(400);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('TEXT_EMPTY');
    expect(await countUpdates()).toBe(0);
  });
});

describe('POST /api/updates — the session is the only actor (criterion A6)', () => {
  it('answers 401 NOT_AUTHENTICATED without a session, and writes no row', async () => {
    const response = await request(devApp())
      .post('/api/updates')
      .send({ text: 'posted by nobody', mood: 'focused' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'NOT_AUTHENTICATED', message: expect.any(String) as unknown as string },
    });
    expect(await countUpdates()).toBe(0);
  });

  it('answers 401 for a forged or tampered cookie, and writes no row', async () => {
    const victim = await join('Victim Vera');
    const [payloadSegment = '', signature = ''] = victim.cookie.split('.');

    const forgeries = [
      payloadSegment,
      `${payloadSegment}.${signature.slice(0, -2)}`,
      'not-a-cookie',
      sign(
        { memberId: victim.id, displayName: victim.displayName, issuedAt: Date.now() },
        'a-completely-different-secret-'.repeat(2),
      ),
    ];

    for (const forgery of forgeries) {
      const response = await request(devApp())
        .post('/api/updates')
        .set('Cookie', cookieHeader(forgery))
        .send({ text: 'posted by a forgery', mood: 'focused' });

      expect(response.status, forgery.slice(0, 24)).toBe(401);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe(
        'NOT_AUTHENTICATED',
      );
    }

    expect(await countUpdates()).toBe(0);
  });

  /**
   * The `session-cookie-v1` trust rule, stated as a row in the database: the
   * body names somebody else, and the row still belongs to the cookie's member.
   */
  it('stores the cookie’s member when the body names another member', async () => {
    const author = await join('Cookie Author');
    const victim = await join('Body Victim');

    expect(author.id).not.toBe(victim.id);

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(author.cookie))
      .send({
        text: 'posted as me, addressed as someone else',
        mood: 'blocked',
        authorId: victim.id,
        memberId: victim.id,
        authorName: victim.displayName,
      });

    expect(response.status).toBe(201);

    const update = (response.body as { update: WireUpdate }).update;
    expect(update.authorId).toBe(author.id);
    expect(update.authorName).toBe(author.displayName);

    // The stored row, not just the response.
    const row = await getPrismaClient().update.findUnique({ where: { id: update.id } });
    expect(row?.authorId).toBe(author.id);

    const victimRows = await getPrismaClient().update.count({ where: { authorId: victim.id } });
    expect(victimRows).toBe(0);
  });

  it('signs out a member whose row has since disappeared, rather than writing an orphan', async () => {
    const member = await join('Since Deleted');
    await getPrismaClient().member.delete({ where: { id: member.id } });

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .send({ text: 'from a member who is gone', mood: 'away' });

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_AUTHENTICATED');
    expect(await countUpdates()).toBe(0);
  });
});

describe('POST /api/updates — the surface as a whole', () => {
  it('leaks no secret, no team code and no stack trace on any path', async () => {
    const member = await join('Leak Test');
    const app = devApp();

    const responses = [
      await request(app).post('/api/updates').send({ text: 'no session', mood: 'focused' }),
      await request(app)
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text: 'a'.repeat(MAX_UPDATE_LENGTH + 1), mood: 'focused' }),
      await request(app)
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text: 'fine', mood: 'sleepy' }),
      await request(app)
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send({ text: 'fine', mood: 'focused' }),
    ];

    for (const response of responses) {
      const everything = `${response.text}${JSON.stringify(response.headers)}`;
      expect(everything).not.toContain(TEAM_CODE);
      expect(everything).not.toContain(SESSION_SECRET);
      expect(everything).not.toContain('.ts:');
      expect(everything).not.toContain('Error:');
    }
  });

  it('treats a body with no fields as empty text rather than crashing', async () => {
    const member = await join('Odd Body');

    // An array and an empty object both parse, and neither has a `text`. The
    // handler reads fields defensively, so this is a 400, not a 500.
    for (const body of [[], {}, [{ text: 'sneaky', mood: 'focused' }]]) {
      const response = await request(devApp())
        .post('/api/updates')
        .set('Cookie', cookieHeader(member.cookie))
        .send(body);

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe('TEXT_EMPTY');
    }

    expect(await countUpdates()).toBe(0);
  });

  /**
   * Malformed JSON never reaches this router — `express.json` rejects it first.
   * What is asserted is the guarantee that survives that: the answer is still
   * the `http-api-v1` envelope with a polite message, not a framework HTML
   * error page and not a stack trace. (The status is body-parser's, and is the
   * same on every route that takes a body; nothing about it is Stage 3's.)
   */
  it('answers malformed JSON with the envelope, never a stack trace', async () => {
    const member = await join('Broken JSON');

    const response = await request(devApp())
      .post('/api/updates')
      .set('Cookie', cookieHeader(member.cookie))
      .set('Content-Type', 'application/json')
      .send('{ this is not json');

    expect(response.headers['content-type']).toMatch(/application\/json/);

    const error = (response.body as { error?: { code?: string; message?: string } }).error;
    expect(error?.code).not.toBe(undefined);
    expect(error?.message).not.toBe(undefined);

    expect(response.text).not.toContain('.ts:');
    expect(response.text).not.toContain('SyntaxError');
    expect(response.text).not.toContain('<!doctype html');
    expect(await countUpdates()).toBe(0);
  });
});
