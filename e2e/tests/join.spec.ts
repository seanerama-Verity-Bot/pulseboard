import { expect, test, type Page } from '@playwright/test';

import { E2E_TEAM_CODE } from '../playwright.config';

/**
 * Stage 2's end-to-end proof: the app's only door works in a real browser, a
 * wrong code is refused politely (criterion A2), and the session survives a
 * reload because the cookie is signed rather than held in memory.
 *
 * Every test uses its own display name, so a run never depends on what another
 * test left in the database.
 */

async function join(page: Page, teamCode: string, displayName: string): Promise<void> {
  await page.getByTestId('join-team-code').fill(teamCode);
  await page.getByTestId('join-display-name').fill(displayName);
  await page.getByTestId('join-submit').click();
}

test('a wrong team code is refused with a visible, polite error and no sign-in (A2)', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByTestId('join-view')).toBeVisible();
  await join(page, 'not-the-team-code', 'Wrong Code Wanda');

  const error = page.getByTestId('join-team-code-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).not.toBeEmpty();

  // Polite and non-blaming: no shouting, no accusation, no status code.
  const message = (await error.textContent()) ?? '';
  expect(message.toLowerCase()).not.toContain('denied');
  expect(message.toLowerCase()).not.toContain('forbidden');
  expect(message).not.toMatch(/\b401\b/);

  // Still on the join page, and definitively not signed in.
  await expect(page.getByTestId('join-view')).toBeVisible();
  await expect(page.getByTestId('signed-in-view')).toHaveCount(0);

  // The offending field keeps focus so the fix is one keystroke away.
  await expect(page.getByTestId('join-team-code')).toBeFocused();

  // And the server issued nothing.
  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => cookie.name === 'pb_session')).toHaveLength(0);
});

test('the right code and a display name sign you in, and the name is visible', async ({ page }) => {
  await page.goto('/');
  await join(page, E2E_TEAM_CODE, 'Ada Lovelace');

  await expect(page.getByTestId('signed-in-view')).toBeVisible();
  await expect(page.getByTestId('session-member-name')).toHaveText('Ada Lovelace');
  await expect(page.getByTestId('join-view')).toHaveCount(0);

  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'pb_session');
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
});

test('a reload after joining leaves you signed in', async ({ page }) => {
  await page.goto('/');
  await join(page, E2E_TEAM_CODE, 'Grace Hopper');

  await expect(page.getByTestId('session-member-name')).toHaveText('Grace Hopper');

  await page.reload();

  await expect(page.getByTestId('signed-in-view')).toBeVisible();
  await expect(page.getByTestId('session-member-name')).toHaveText('Grace Hopper');
  await expect(page.getByTestId('join-view')).toHaveCount(0);
});

test('signing out returns you to the join page', async ({ page }) => {
  await page.goto('/');
  await join(page, E2E_TEAM_CODE, 'Katherine Johnson');

  await expect(page.getByTestId('signed-in-view')).toBeVisible();
  await page.getByTestId('sign-out').click();

  await expect(page.getByTestId('join-view')).toBeVisible();
  await expect(page.getByTestId('signed-in-view')).toHaveCount(0);

  // The cookie is gone, so a reload does not resurrect the session.
  await page.reload();
  await expect(page.getByTestId('join-view')).toBeVisible();
});

test('the join form submits on Enter without reaching for the mouse', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('join-team-code').fill(E2E_TEAM_CODE);
  await page.getByTestId('join-display-name').fill('Enter Key Ellie');
  await page.getByTestId('join-display-name').press('Enter');

  await expect(page.getByTestId('session-member-name')).toHaveText('Enter Key Ellie');
});

test('join is usable at a 375px viewport with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/');

  await expect(page.getByTestId('join-view')).toBeVisible();
  await expect(page.getByTestId('join-team-code')).toBeVisible();
  await expect(page.getByTestId('join-display-name')).toBeVisible();
  await expect(page.getByTestId('join-submit')).toBeVisible();

  const overflowsOnJoin = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsOnJoin).toBe(false);

  await join(page, E2E_TEAM_CODE, 'Narrow Viewport Nadia');
  await expect(page.getByTestId('session-member-name')).toHaveText('Narrow Viewport Nadia');

  const overflowsSignedIn = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsSignedIn).toBe(false);
});

test('a forged cookie is not accepted as a member (the A6 foundation)', async ({ page }) => {
  await page.goto('/');
  await join(page, E2E_TEAM_CODE, 'Forgery Target');
  await expect(page.getByTestId('signed-in-view')).toBeVisible();

  // Replace the signed cookie with a well-formed but unsigned impersonation.
  const payload = Buffer.from(
    JSON.stringify({
      memberId: 'forged-member-id',
      displayName: 'Forgery Target',
      issuedAt: Date.now(),
    }),
    'utf8',
  ).toString('base64url');

  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: 'pb_session',
      value: `${payload}.${'A'.repeat(43)}`,
      url: page.url(),
    },
  ]);

  await page.reload();

  await expect(page.getByTestId('join-view')).toBeVisible();
  await expect(page.getByTestId('signed-in-view')).toHaveCount(0);
});
