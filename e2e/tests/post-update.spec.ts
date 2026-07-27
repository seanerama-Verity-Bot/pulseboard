import { expect, test, type Page } from '@playwright/test';

import { E2E_TEAM_CODE } from '../playwright.config';

/**
 * Stage 3's end-to-end proof: the journey spine (criteria A1/A10) — join, type,
 * pick a mood, post, see it — in a real browser, plus the two things the
 * composer must get right on its own: the 280-character limit is the server's
 * rule and the counter only echoes it (A7), and the mood picker is a real radio
 * group rather than clickable `div`s.
 *
 * Every test uses its own display name, so a run never depends on what another
 * test left in the database.
 */

async function join(page: Page, displayName: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('join-team-code').fill(E2E_TEAM_CODE);
  await page.getByTestId('join-display-name').fill(displayName);
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('composer')).toBeVisible();
}

test('join, write, pick a mood and post — the update comes back with its text and mood (A1/A10)', async ({
  page,
}) => {
  await join(page, 'Poster Pauline');

  await expect(page.getByTestId('posted-updates-empty')).toBeVisible();

  await page.getByTestId('composer-text').fill('Shipping the composer today.');
  await page.getByTestId('composer-mood-focused').check();
  await page.getByTestId('composer-submit').click();

  const posted = page.getByTestId('update-item');
  await expect(posted).toHaveCount(1);
  await expect(page.getByTestId('update-item-text')).toHaveText('Shipping the composer today.');
  await expect(page.getByTestId('update-item-mood')).toHaveText('Focused');
  await expect(page.getByTestId('update-item-author')).toHaveText('Poster Pauline');

  // The composer is empty and back to "no mood chosen", ready for the next one.
  await expect(page.getByTestId('composer-text')).toHaveValue('');
  await expect(page.getByTestId('composer-mood-focused')).not.toBeChecked();
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
});

test('a second post joins the first, newest first', async ({ page }) => {
  await join(page, 'Two Posts Tomasz');

  await page.getByTestId('composer-text').fill('First thing.');
  await page.getByTestId('composer-mood-cruising').check();
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('update-item')).toHaveCount(1);

  await page.getByTestId('composer-text').fill('Second thing.');
  await page.getByTestId('composer-mood-blocked').check();
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('update-item')).toHaveCount(2);

  await expect(page.getByTestId('update-item-text').first()).toHaveText('Second thing.');
  await expect(page.getByTestId('update-item-mood').first()).toHaveText('Blocked');
});

test('the counter counts down, warns past 280 and blocks submit (A7)', async ({ page }) => {
  await join(page, 'Counter Connie');

  const counter = page.getByTestId('composer-counter');
  const submit = page.getByTestId('composer-submit');

  await expect(counter).toHaveText('280 characters left');

  // Exactly at the limit: still postable.
  await page.getByTestId('composer-text').fill('a'.repeat(280));
  await page.getByTestId('composer-mood-away').check();
  await expect(counter).toHaveText('0 characters left');
  await expect(counter).toHaveAttribute('data-over', 'false');
  await expect(submit).toBeEnabled();

  // One character over: the counter warns, and the button will not post.
  await page.getByTestId('composer-text').fill('a'.repeat(281));
  await expect(counter).toHaveText('1 characters over the limit');
  await expect(counter).toHaveAttribute('data-over', 'true');
  await expect(submit).toBeDisabled();

  // The warning is a plain sentence: no status number, no stack trace.
  const warning = (await counter.textContent()) ?? '';
  expect(warning).not.toMatch(/\b400\b/);
  expect(warning.toLowerCase()).not.toContain('error');

  // And nothing was posted while it was over the limit.
  await expect(page.getByTestId('update-item')).toHaveCount(0);

  // Back under the limit, it recovers rather than staying stuck.
  await page.getByTestId('composer-text').fill('a'.repeat(279));
  await expect(counter).toHaveText('1 characters left');
  await expect(submit).toBeEnabled();
});

/**
 * 280 emoji are 560 UTF-16 code units. A counter reaching for `String.length`
 * would call this 280 characters over the limit while the server accepted it —
 * the exact client/server disagreement criterion A7 rules out. Both sides call
 * the same `countCharacters` from `@pulseboard/shared`, so both say "fine".
 */
test('the counter counts code points, so 280 emoji are still postable', async ({ page }) => {
  await join(page, 'Emoji Edith');

  const counter = page.getByTestId('composer-counter');

  await page.getByTestId('composer-text').fill('🚀'.repeat(280));
  await expect(counter).toHaveText('0 characters left');
  await expect(counter).toHaveAttribute('data-over', 'false');

  await page.getByTestId('composer-mood-away').check();
  await page.getByTestId('composer-submit').click();

  await expect(page.getByTestId('update-item')).toHaveCount(1);

  // 281 is over on both sides.
  await page.getByTestId('composer-text').fill('🚀'.repeat(281));
  await expect(counter).toHaveAttribute('data-over', 'true');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
});

test('no mood is chosen for you, and nothing posts until one is picked', async ({ page }) => {
  await join(page, 'No Default Nora');

  for (const mood of ['focused', 'cruising', 'blocked', 'away']) {
    await expect(page.getByTestId(`composer-mood-${mood}`)).not.toBeChecked();
  }

  await page.getByTestId('composer-text').fill('Text but no mood yet.');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();

  await page.getByTestId('composer-mood-away').check();
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
});

test('a double-click posts exactly one update', async ({ page }) => {
  await join(page, 'Double Click Dara');

  await page.getByTestId('composer-text').fill('Posted once, clicked twice.');
  await page.getByTestId('composer-mood-away').check();
  await page.getByTestId('composer-submit').dblclick();

  await expect(page.getByTestId('update-item')).toHaveCount(1);

  // Give a second request time to have arrived before believing the count.
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('update-item')).toHaveCount(1);
});

test('the mood picker is a real radio group, reachable and changeable from the keyboard', async ({
  page,
}) => {
  await join(page, 'Keyboard Kwame');

  const focused = page.getByTestId('composer-mood-focused');
  const cruising = page.getByTestId('composer-mood-cruising');

  // Real radios: `type="radio"`, one shared name, inside a fieldset with a legend.
  await expect(focused).toHaveAttribute('type', 'radio');
  await expect(focused).toHaveAttribute('name', 'mood');
  await expect(page.getByRole('group', { name: 'Mood' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);

  // Tab from the textarea lands on the group; arrow keys move within it.
  await page.getByTestId('composer-text').fill('Posted without touching the mouse.');
  await page.getByTestId('composer-text').press('Tab');
  await expect(focused).toBeFocused();

  await page.keyboard.press('Space');
  await expect(focused).toBeChecked();

  await page.keyboard.press('ArrowRight');
  await expect(cruising).toBeChecked();
  await expect(focused).not.toBeChecked();

  await page.keyboard.press('ArrowLeft');
  await expect(focused).toBeChecked();

  // …and the whole post completes from the keyboard.
  await page.getByTestId('composer-submit').press('Enter');
  await expect(page.getByTestId('update-item-text')).toHaveText(
    'Posted without touching the mouse.',
  );
  await expect(page.getByTestId('update-item-mood')).toHaveText('Focused');
});

test('the composer is usable at a 375px viewport with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await join(page, 'Narrow Composer Nia');

  await expect(page.getByTestId('composer-text')).toBeVisible();
  await expect(page.getByTestId('composer-submit')).toBeVisible();
  for (const mood of ['focused', 'cruising', 'blocked', 'away']) {
    await expect(page.getByTestId(`composer-mood-${mood}`)).toBeVisible();
  }

  const overflowsEmpty = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsEmpty).toBe(false);

  // A long, unbroken word is the classic 375px overflow: post one and check.
  await page.getByTestId('composer-text').fill(`Narrow: ${'x'.repeat(120)}`);
  await page.getByTestId('composer-mood-cruising').check();
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('update-item')).toHaveCount(1);

  const overflowsPosted = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsPosted).toBe(false);
});

test('a post without a session is refused politely rather than swallowed', async ({ page }) => {
  await join(page, 'Expired Session Esme');

  await page.getByTestId('composer-text').fill('Typed before the session went away.');
  await page.getByTestId('composer-mood-focused').check();

  // The cookie disappears out from under a tab that is still open — the stale
  // client the server is the authority for.
  await page.context().clearCookies();
  await page.getByTestId('composer-submit').click();

  const error = page.getByTestId('composer-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');

  const message = (await error.textContent()) ?? '';
  expect(message).not.toMatch(/\b401\b/);
  expect(message.toLowerCase()).not.toContain('unauthorized');
  expect(message.toLowerCase()).not.toContain('.ts:');

  // Nothing was added to the list, and the text is still there to retry with.
  await expect(page.getByTestId('update-item')).toHaveCount(0);
  await expect(page.getByTestId('composer-text')).toHaveValue(
    'Typed before the session went away.',
  );
});
