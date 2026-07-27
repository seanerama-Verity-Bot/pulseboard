import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@pulseboard/shared';

import { disconnectPrisma, getPrismaClient } from '../src/data/prisma';
import { validateEnv } from '../src/env';
import { createApp } from '../src/http/app';
import { SESSION_MAX_AGE_MS, sign } from '../src/session/cookie';

/**
 * Integration tests for the `/api/session` routes, against a real database.
 *
 * The database is a throwaway SQLite file of this test file's own, created with
 * `prisma migrate deploy` (exactly as the host does — never `migrate dev`) and
 * deleted in teardown. `DATABASE_URL` is set before anything touches Prisma,
 * because the client resolves it once, on first construction; a relative
 * `file:` URL is resolved relative to `apps/server/prisma/`.
 */

/** `npm test` runs vitest from `apps/server`; tolerate a run from the root too. */
const serverRoot = fs.existsSync(path.join(process.cwd(), 'prisma', 'schema.prisma'))
  ? process.cwd()
  : path.join(process.cwd(), 'apps', 'server');
const repoRoot = path.resolve(serverRoot, '..', '..');
const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
const prismaBin = path.join(repoRoot, 'node_modules', '.bin', 'prisma');

const DB_FILENAME = 'test-session-integration.db';
const DATABASE_URL = `file:./${DB_FILENAME}`;
const dbPath = path.join(serverRoot, 'prisma', DB_FILENAME);

const VERSION = '1.2.3-test';

/** Not secrets: deterministic throwaways built by repetition, never literals. */
const TEAM_CODE = 'stage-two-test-code';
const SESSION_SECRET = 'pulseboard-test-secret-'.repeat(2);
const OTHER_SECRET = 'pulseboard-other-secret-'.repeat(2);

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
  webDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pulseboard-session-dist-'));
  fs.writeFileSync(path.join(webDistPath, 'index.html'), '<!doctype html><html></html>', 'utf8');
}, 120_000);

afterAll(async () => {
  await disconnectPrisma();
  removeDatabaseFiles();
  if (webDistPath !== '') {
    fs.rmSync(webDistPath, { recursive: true, force: true });
  }
});

/** The normal case: configured, non-production (so no `Secure`). */
function devApp() {
  return createApp({
    version: VERSION,
    webDistPath,
    teamCode: TEAM_CODE,
    sessionSecret: SESSION_SECRET,
    isProduction: false,
  });
}

/** The same app built the way `NODE_ENV=production` builds it. */
function prodApp() {
  return createApp({
    version: VERSION,
    webDistPath,
    teamCode: TEAM_CODE,
    sessionSecret: SESSION_SECRET,
    isProduction: true,
  });
}

function setCookieHeaders(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (raw === undefined) {
    return [];
  }
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

function sessionSetCookie(headers: Record<string, unknown>): string | undefined {
  return setCookieHeaders(headers).find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
}

function cookieValue(setCookie: string): string {
  const first = setCookie.split(';')[0] ?? '';
  return decodeURIComponent(first.slice(`${SESSION_COOKIE_NAME}=`.length));
}

function cookieHeader(value: string): string {
  return `${SESSION_COOKIE_NAME}=${value}`;
}

type JoinBody = { teamCode?: unknown; displayName?: unknown };

async function join(app: ReturnType<typeof devApp>, body: JoinBody) {
  return request(app).post('/api/session').send(body);
}

describe('POST /api/session — the wrong team code (criterion A2)', () => {
  it('answers 401 INVALID_TEAM_CODE and sets no cookie at all', async () => {
    const response = await join(devApp(), {
      teamCode: 'definitely-not-the-code',
      displayName: 'Ada',
    });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: { code: 'INVALID_TEAM_CODE', message: expect.any(String) as unknown as string },
    });

    // Not "no session cookie" — no `Set-Cookie` header whatsoever.
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers the same way for an empty, missing, wrong-type or wrong-length code', async () => {
    const attempts: JoinBody[] = [
      { teamCode: '', displayName: 'Ada' },
      { displayName: 'Ada' },
      { teamCode: 42, displayName: 'Ada' },
      { teamCode: TEAM_CODE.slice(0, -1), displayName: 'Ada' },
      { teamCode: `${TEAM_CODE}x`, displayName: 'Ada' },
      { teamCode: TEAM_CODE.toUpperCase(), displayName: 'Ada' },
      {},
    ];

    for (const attempt of attempts) {
      const response = await join(devApp(), attempt);

      expect(response.status, JSON.stringify(attempt)).toBe(401);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe(
        'INVALID_TEAM_CODE',
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('checks the team code before the display name, so a stranger learns nothing', async () => {
    const response = await join(devApp(), { teamCode: 'wrong', displayName: '   ' });

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('INVALID_TEAM_CODE');
    expect(response.text).not.toContain('displayName');
  });

  it('never echoes the expected code or the secret', async () => {
    const response = await join(devApp(), { teamCode: 'wrong', displayName: 'Ada' });

    expect(response.text).not.toContain(TEAM_CODE);
    expect(response.text).not.toContain(SESSION_SECRET);
    expect(JSON.stringify(response.headers)).not.toContain(TEAM_CODE);
    expect(JSON.stringify(response.headers)).not.toContain(SESSION_SECRET);
  });
});

describe('POST /api/session — no team code configured', () => {
  it('rejects every join, rather than letting anyone in', async () => {
    const unconfigured = createApp({
      version: VERSION,
      webDistPath,
      teamCode: null,
      sessionSecret: SESSION_SECRET,
      isProduction: false,
    });

    for (const teamCode of ['', 'anything', TEAM_CODE]) {
      const response = await request(unconfigured)
        .post('/api/session')
        .send({ teamCode, displayName: 'Ada' });

      expect(response.status).toBe(401);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe(
        'INVALID_TEAM_CODE',
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rejects every join when there is no signing secret, rather than issuing an unsigned cookie', async () => {
    const unsigned = createApp({
      version: VERSION,
      webDistPath,
      teamCode: TEAM_CODE,
      sessionSecret: null,
      isProduction: false,
    });

    const response = await request(unsigned)
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Ada' });

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('INVALID_TEAM_CODE');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('is the default when the new options are omitted entirely', async () => {
    const bare = createApp({ version: VERSION, webDistPath });

    const response = await request(bare)
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Ada' });

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('INVALID_TEAM_CODE');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /api/session — the display name', () => {
  it('rejects an empty or whitespace-only name with 400 INVALID_DISPLAY_NAME and no cookie', async () => {
    for (const displayName of ['', '   ', undefined, 42]) {
      const response = await join(devApp(), { teamCode: TEAM_CODE, displayName });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_DISPLAY_NAME',
          message: expect.any(String) as unknown as string,
          field: 'displayName',
        },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rejects a name longer than the limit', async () => {
    const response = await join(devApp(), {
      teamCode: TEAM_CODE,
      displayName: 'a'.repeat(41),
    });

    expect(response.status).toBe(400);
    expect((response.body as { error?: { field?: string } }).error?.field).toBe('displayName');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /api/session — the happy path and the cookie', () => {
  it('answers 201 with the member and a HttpOnly, SameSite=Lax cookie', async () => {
    const response = await join(devApp(), {
      teamCode: TEAM_CODE,
      displayName: 'Grace Hopper',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      member: {
        id: expect.any(String) as unknown as string,
        displayName: 'Grace Hopper',
        joinedAt: expect.any(String) as unknown as string,
      },
    });

    const setCookie = sessionSetCookie(response.headers);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${SESSION_MAX_AGE_MS / 1000}`, 'i'));
  });

  it('omits Secure outside production, so local login over plain HTTP works', async () => {
    const response = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Dev Mode' });
    const setCookie = sessionSetCookie(response.headers);

    expect(setCookie).toBeDefined();
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  it('sets Secure when the app is built in production mode', async () => {
    const response = await request(prodApp())
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Prod Mode' });
    const setCookie = sessionSetCookie(response.headers);

    expect(response.status).toBe(201);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  /**
   * The same claim, but wired from `NODE_ENV` rather than from a hand-set flag:
   * the `Secure`-in-dev trap breaks local login silently, so both directions are
   * asserted through the real environment validator (ADR 0005).
   */
  it('derives Secure from NODE_ENV through the real env validator', async () => {
    const appForNodeEnv = (nodeEnv: string) => {
      const result = validateEnv({
        NODE_ENV: nodeEnv,
        DATABASE_URL,
        TEAM_CODE,
        SESSION_SECRET,
      });
      if (!result.ok) {
        throw new Error(`the test environment did not validate: ${result.errors.join('; ')}`);
      }
      return createApp({
        version: VERSION,
        webDistPath,
        teamCode: result.config.teamCode,
        sessionSecret: result.config.sessionSecret,
        isProduction: result.config.isProduction,
      });
    };

    const inProduction = await request(appForNodeEnv('production'))
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Env Production' });
    expect(inProduction.status).toBe(201);
    expect(sessionSetCookie(inProduction.headers)).toMatch(/;\s*Secure/i);

    const inDevelopment = await request(appForNodeEnv('development'))
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Env Development' });
    expect(inDevelopment.status).toBe(201);
    expect(sessionSetCookie(inDevelopment.headers)).not.toMatch(/;\s*Secure/i);
  });

  it('puts no secret and no fragment of the team code into the response', async () => {
    const response = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Quiet Type' });
    const everything = `${response.text}${JSON.stringify(response.headers)}`;

    expect(everything).not.toContain(TEAM_CODE);
    expect(everything).not.toContain(SESSION_SECRET);
  });

  it('signs a cookie this server verifies and nobody else can', async () => {
    const response = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Signed In' });
    const value = cookieValue(sessionSetCookie(response.headers) ?? '');

    const probe = await request(devApp()).get('/api/session').set('Cookie', cookieHeader(value));
    expect(probe.status).toBe(200);

    const strangerApp = createApp({
      version: VERSION,
      webDistPath,
      teamCode: TEAM_CODE,
      sessionSecret: OTHER_SECRET,
      isProduction: false,
    });
    const rejected = await request(strangerApp)
      .get('/api/session')
      .set('Cookie', cookieHeader(value));
    expect(rejected.status).toBe(401);
  });
});

describe('POST /api/session — find-or-create (a returning teammate)', () => {
  it('reuses the Member row for a case and whitespace variant, and never refreshes joinedAt', async () => {
    const first = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Ada Lovelace' });
    expect(first.status).toBe(201);

    type WireMember = { id: string; displayName: string; joinedAt: string };
    const firstMember = (first.body as { member: WireMember }).member;

    const again = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Ada Lovelace' });
    const variant = await join(devApp(), {
      teamCode: TEAM_CODE,
      displayName: '   ADA    lovelace  ',
    });

    for (const response of [again, variant]) {
      expect(response.status).toBe(201);
      const member = (response.body as { member: WireMember }).member;
      expect(member.id).toBe(firstMember.id);
      expect(member.joinedAt).toBe(firstMember.joinedAt);
      // The stored name keeps the casing the member first used.
      expect(member.displayName).toBe('Ada Lovelace');
    }

    const rows = await getPrismaClient().member.findMany({
      where: { normalizedName: 'ada lovelace' },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/session', () => {
  it('answers 401 NOT_AUTHENTICATED with no cookie, and sets no cookie', async () => {
    const response = await request(devApp()).get('/api/session');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'NOT_AUTHENTICATED', message: expect.any(String) as unknown as string },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers 200 with the member for a valid cookie', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Katherine Johnson' });
    const value = cookieValue(sessionSetCookie(joined.headers) ?? '');

    const response = await request(devApp()).get('/api/session').set('Cookie', cookieHeader(value));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(joined.body);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  /**
   * The A6 foundation. A hand-forged cookie carries a real member's id and a
   * real member's display name in a perfectly well-formed payload — everything
   * a client can see and copy — and a signature of exactly the right shape and
   * length. It must not be honoured, and the response must not leak the member.
   */
  it('rejects a hand-forged cookie and does not treat the caller as that member', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Real Member' });
    const realMember = (joined.body as { member: { id: string; displayName: string } }).member;

    const forgedPayload = Buffer.from(
      JSON.stringify({
        memberId: realMember.id,
        displayName: realMember.displayName,
        issuedAt: Date.now(),
      }),
      'utf8',
    ).toString('base64url');

    // Right shape, right length, wrong key.
    const forgedSignature = crypto
      .createHmac('sha256', OTHER_SECRET)
      .update(Buffer.from(forgedPayload, 'utf8'))
      .digest('base64url');

    const genuineSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(Buffer.from(forgedPayload, 'utf8'))
      .digest('base64url');
    expect(forgedSignature).toHaveLength(genuineSignature.length);
    expect(forgedSignature).not.toBe(genuineSignature);

    const response = await request(devApp())
      .get('/api/session')
      .set('Cookie', cookieHeader(`${forgedPayload}.${forgedSignature}`));

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_AUTHENTICATED');

    // Not treated as that member: the identity appears nowhere in the answer.
    expect(response.text).not.toContain(realMember.id);
    expect(response.text).not.toContain(realMember.displayName);

    // And the stale cookie is cleared on the way out.
    const cleared = sessionSetCookie(response.headers);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it('rejects an unsigned payload, a truncated cookie and outright garbage', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Target Member' });
    const value = cookieValue(sessionSetCookie(joined.headers) ?? '');
    const [payloadSegment = '', signature = ''] = value.split('.');

    const forgeries = [
      payloadSegment,
      `${payloadSegment}.`,
      `${payloadSegment}.${signature.slice(0, -2)}`,
      `${payloadSegment}.${signature}.${signature}`,
      value.slice(0, Math.floor(value.length / 2)),
      'not-a-cookie',
      Buffer.from(JSON.stringify({ memberId: 'anyone', displayName: 'Anyone' }), 'utf8').toString(
        'base64url',
      ),
    ];

    for (const forgery of forgeries) {
      const response = await request(devApp())
        .get('/api/session')
        .set('Cookie', cookieHeader(forgery));

      expect(response.status, forgery.slice(0, 32)).toBe(401);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe(
        'NOT_AUTHENTICATED',
      );
    }
  });

  it('rejects a correctly signed cookie whose issuedAt is older than 30 days', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Long Ago' });
    const member = (joined.body as { member: { id: string; displayName: string } }).member;

    const stale = sign(
      {
        memberId: member.id,
        displayName: member.displayName,
        issuedAt: Date.now() - SESSION_MAX_AGE_MS - 1000,
      },
      SESSION_SECRET,
    );

    const response = await request(devApp()).get('/api/session').set('Cookie', cookieHeader(stale));

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_AUTHENTICATED');
  });

  it('takes identity from the cookie only — no body, header or query override', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Victim Member' });
    const member = (joined.body as { member: { id: string; displayName: string } }).member;

    const response = await request(devApp())
      .get(
        `/api/session?memberId=${member.id}&displayName=${encodeURIComponent(member.displayName)}`,
      )
      .set('X-Member-Id', member.id)
      .set('X-Display-Name', member.displayName);

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_AUTHENTICATED');
    expect(response.text).not.toContain(member.id);
  });

  it('signs out a member whose row has since disappeared', async () => {
    const joined = await join(devApp(), { teamCode: TEAM_CODE, displayName: 'Since Deleted' });
    const value = cookieValue(sessionSetCookie(joined.headers) ?? '');
    const member = (joined.body as { member: { id: string } }).member;

    await getPrismaClient().member.delete({ where: { id: member.id } });

    const response = await request(devApp()).get('/api/session').set('Cookie', cookieHeader(value));

    expect(response.status).toBe(401);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('NOT_AUTHENTICATED');
  });
});

describe('DELETE /api/session', () => {
  it('answers 204, clears the cookie, and the next probe is a 401 — twice over', async () => {
    const app = devApp();
    const agent = request.agent(app);

    const joined = await agent
      .post('/api/session')
      .send({ teamCode: TEAM_CODE, displayName: 'Signing Out' });
    expect(joined.status).toBe(201);

    const signedIn = await agent.get('/api/session');
    expect(signedIn.status).toBe(200);

    const first = await agent.delete('/api/session');
    expect(first.status).toBe(204);
    expect(first.text).toBe('');
    expect(sessionSetCookie(first.headers)).toBeDefined();

    const afterSignOut = await agent.get('/api/session');
    expect(afterSignOut.status).toBe(401);
    expect((afterSignOut.body as { error?: { code?: string } }).error?.code).toBe(
      'NOT_AUTHENTICATED',
    );

    // Idempotent: no session, no complaint.
    const second = await agent.delete('/api/session');
    expect(second.status).toBe(204);
  });

  it('is 204 for a caller who never had a session', async () => {
    const response = await request(devApp()).delete('/api/session');

    expect(response.status).toBe(204);
  });
});

describe('the session surface as a whole', () => {
  it('leaks neither the team code nor the session secret in any response', async () => {
    const app = devApp();
    const responses = [
      await request(app).post('/api/session').send({ teamCode: 'wrong', displayName: 'Ada' }),
      await request(app).post('/api/session').send({ teamCode: TEAM_CODE, displayName: '' }),
      await request(app)
        .post('/api/session')
        .send({ teamCode: TEAM_CODE, displayName: 'Leak Test' }),
      await request(app).get('/api/session'),
      await request(app).delete('/api/session'),
    ];

    for (const response of responses) {
      const everything = `${response.text}${JSON.stringify(response.headers)}`;
      expect(everything).not.toContain(TEAM_CODE);
      expect(everything).not.toContain(SESSION_SECRET);
      expect(everything).not.toContain('.ts:');
      expect(everything).not.toContain('Error:');
    }
  });
});
