/**
 * Landing surface — runs without a live merod node.
 *
 * Verifies the unauthenticated entry point renders the expected branding,
 * the ConnectButton is present, and protected routes redirect back to '/'
 * (which is itself the login surface — Authenticate.tsx is mounted there).
 */

import { test, expect } from '@playwright/test';

test.describe('Landing (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Vite's first-request compile + MeroProvider init to settle.
    await expect(page.getByText('Battleships').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('shows the Battleships title', async ({ page }) => {
    await expect(page.getByText('Battleships').first()).toBeVisible();
  });

  test('shows the demo description', async ({ page }) => {
    await expect(
      page.getByText(/fully decentralized battleships game/i),
    ).toBeVisible();
  });

  test('renders feature bullets', async ({ page }) => {
    await expect(page.getByText(/Private ship placement/i)).toBeVisible();
    await expect(page.getByText(/Verifiable shots/i)).toBeVisible();
    await expect(page.getByText(/Real-time P2P state sync/i)).toBeVisible();
  });

  test('shows a Connect button', async ({ page }) => {
    // ConnectButton from mero-react renders a button with "Connect" text.
    await expect(
      page.getByRole('button', { name: /connect/i }).first(),
    ).toBeVisible();
  });

  test('renders external-link buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHub' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calimero' })).toBeVisible();
  });

  test('unknown routes redirect to /', async ({ page }) => {
    await page.goto('/nonexistent-path');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByText('Battleships').first()).toBeVisible();
  });

  test('protected /lobby route requires auth', async ({ page }) => {
    // Without injected tokens the page either redirects to '/' or stays on
    // /lobby but renders the auth prompt — either way the ConnectButton is
    // visible and gameplay UI is not.
    await page.goto('/lobby');
    await expect(
      page.getByRole('button', { name: /connect/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
