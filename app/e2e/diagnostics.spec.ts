/**
 * One-shot diagnostics — runs first, dumps the auth/network surface so we
 * can see why MeroProvider is failing to mark the session authenticated.
 */

import { test, expect } from '@playwright/test';
import { envAvailable, getEnv } from './helpers/rpc-client';
import { injectMeroAuth } from './helpers/node-client';

test.describe('Diagnostics', () => {
  test.skip(!envAvailable(), 'integration env not available');

  test('auth tokens reach the merod admin API from the browser', async ({ page }) => {
    const env = getEnv();

    page.on('console', (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[browser pageerror] ${err.message}`));
    page.on('requestfailed', (req) => {
      console.log(`[browser requestfailed] ${req.method()} ${req.url()} → ${req.failure()?.errorText}`);
    });

    await injectMeroAuth(page, {
      nodeUrl: env.node1.url,
      accessToken: env.node1.accessToken,
      refreshToken: env.node1.refreshToken,
      applicationId: env.applicationId,
      namespaceId: env.namespaceId,
      lobbyContextId: env.lobbyContextId,
      memberKey: env.node1.memberKey,
    });

    await page.goto('/');

    const ls = await page.evaluate(() => {
      const out: Record<string, string | null> = {};
      for (const k of [
        'mero-tokens',
        'mero:expires_at',
        'mero:node_url',
        'mero:application_id',
        'mero:context_id',
        'mero:context_identity',
        'battleships:selectedNamespaceId',
      ]) {
        const v = localStorage.getItem(k);
        out[k] = v ? `${v.slice(0, 24)}…(len=${v.length})` : null;
      }
      return out;
    });
    console.log('localStorage:', JSON.stringify(ls, null, 2));

    const result = await page.evaluate(async (cfg) => {
      try {
        const headers = { Authorization: `Bearer ${cfg.token}` };
        const r = await fetch(`${cfg.nodeUrl}/admin-api/contexts`, { headers });
        const text = await r.text();
        return {
          ok: r.ok,
          status: r.status,
          statusText: r.statusText,
          body: text.slice(0, 400),
        };
      } catch (e) {
        return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
    }, { nodeUrl: env.node1.url, token: env.node1.accessToken });
    console.log('fetch /admin-api/contexts result:', JSON.stringify(result, null, 2));

    expect(result, 'expected the browser to reach /admin-api/contexts').toMatchObject({ ok: true });
  });
});
