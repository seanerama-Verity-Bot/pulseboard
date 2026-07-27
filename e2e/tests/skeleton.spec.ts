import { expect, test } from '@playwright/test';

/**
 * The walking skeleton's end-to-end proof: the BUILT SPA is served by the same
 * Express process that answers `/healthz`, and the browser renders the result.
 */

test('the built app serves the shell and renders the health status', async ({ page }) => {
  await page.goto('/');

  // The app shell.
  await expect(page.getByRole('heading', { level: 1, name: 'Pulseboard' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();

  // The health view, resolved (not the loading state).
  const status = page.getByTestId('health-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/Server status:\s*ok/);
  await expect(page.getByTestId('health-version')).toContainText('Version');
});

test('the deep-linked SPA route falls back to the shell rather than a 404 page', async ({
  page,
}) => {
  const response = await page.goto('/board/today');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Pulseboard' })).toBeVisible();
});

test('/healthz answers the documented JSON and an unmatched /api route is JSON 404', async ({
  request,
}) => {
  const health = await request.get('/healthz');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok' });

  const missing = await request.get('/api/nope');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
});

test('the shell is usable at a 375px viewport with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Pulseboard' })).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
