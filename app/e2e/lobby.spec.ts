/**
 * Single-player lobby surface against a live merod node.
 *
 * Injects node-1 auth + the seeded namespace into localStorage, navigates to
 * /lobby?id=<NS>, and asserts the lobby renders with both members online.
 */

import { test, expect } from '@playwright/test';
import { envAvailable, getEnv } from './helpers/rpc-client';
import { bypassCors, injectMeroAuth } from './helpers/node-client';

test.describe('Lobby (integration)', () => {
  test.beforeEach(async ({ page }) => {
    if (!envAvailable()) test.skip();
    const env = getEnv();
    await bypassCors(page, [{ nodeUrl: env.node1.url, accessToken: env.node1.accessToken }]);
    await injectMeroAuth(page, {
      nodeUrl: env.node1.url,
      accessToken: env.node1.accessToken,
      refreshToken: env.node1.refreshToken,
      applicationId: env.applicationId,
      namespaceId: env.namespaceId,
      lobbyContextId: env.lobbyContextId,
      memberKey: env.node1.memberKey,
    });
  });

  test('renders the lobby with both members online', async ({ page }) => {
    const env = getEnv();
    await page.goto(`/lobby?id=${encodeURIComponent(env.namespaceId)}`);
    await expect(page.getByText('Lobby').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 members online/i)).toBeVisible({ timeout: 30_000 });
  });

  test('opens the members list and shows the self marker', async ({ page }) => {
    const env = getEnv();
    await page.goto(`/lobby?id=${encodeURIComponent(env.namespaceId)}`);
    await expect(page.getByText(/2 members online/i)).toBeVisible({ timeout: 30_000 });

    const summary = page.getByRole('group').getByText('Members').or(page.locator('summary', { hasText: 'Members' })).first();
    await summary.click();
    await expect(page.getByText('(you)')).toBeVisible({ timeout: 5_000 });
  });

  test('exposes the executor key with a copy affordance', async ({ page }) => {
    const env = getEnv();
    await page.goto(`/lobby?id=${encodeURIComponent(env.namespaceId)}`);
    await expect(page.getByText('Your Key')).toBeVisible({ timeout: 30_000 });
    // Truncated key uses ellipsis: first 12 chars … last 8.
    const head = env.node1.memberKey.slice(0, 12);
    await expect(page.getByText(new RegExp(`^${escapeRegex(head)}\\.\\.\\.`))).toBeVisible();
  });

  test('renders the New Match form', async ({ page }) => {
    const env = getEnv();
    await page.goto(`/lobby?id=${encodeURIComponent(env.namespaceId)}`);
    await expect(
      page.getByPlaceholder(/Opponent's executor public key/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Challenge' })).toBeVisible();
  });
});

test.describe('Lobby Picker (integration)', () => {
  test.beforeEach(async ({ page }) => {
    if (!envAvailable()) test.skip();
    const env = getEnv();
    await bypassCors(page, [{ nodeUrl: env.node1.url, accessToken: env.node1.accessToken }]);
    await injectMeroAuth(page, {
      nodeUrl: env.node1.url,
      accessToken: env.node1.accessToken,
      refreshToken: env.node1.refreshToken,
      applicationId: env.applicationId,
      namespaceId: env.namespaceId,
      lobbyContextId: env.lobbyContextId,
      memberKey: env.node1.memberKey,
    });
  });

  test('lists the seeded lobby and switches to cards view', async ({ page }) => {
    // Bare /lobby (no ?id=) keeps the picker visible instead of auto-entering.
    await page.goto('/lobby');
    await expect(page.getByText('Add a Lobby')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.lobby-row').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /cards/i }).click();
    await expect(page.locator('.lobby-grid')).toBeVisible();
  });

  test('swaps between Create new and Join via invitation tabs', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page.getByText('Add a Lobby')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByPlaceholder(/Lobby name/i)).toBeVisible();

    await page.getByRole('tab', { name: /Join via invitation/i }).click();
    await expect(page.getByPlaceholder(/Paste invitation/i)).toBeVisible({ timeout: 5_000 });

    await page.getByRole('tab', { name: /Create new/i }).click();
    await expect(page.getByPlaceholder(/Lobby name/i)).toBeVisible({ timeout: 5_000 });
  });

  test('info icon is keyboard-focusable with an aria label', async ({ page }) => {
    await page.goto('/lobby');
    const infoIcon = page.locator('.info-icon').first();
    await expect(infoIcon).toBeVisible({ timeout: 30_000 });
    await expect(infoIcon).toHaveAttribute('aria-label', /lobby/i);
    await infoIcon.focus();
    await expect(infoIcon).toBeFocused();
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
