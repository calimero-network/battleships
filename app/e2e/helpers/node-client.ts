/**
 * Writes the mero-react v2 storage keys directly so tests skip the
 * ConnectButton → auth-frontend → callback flow.
 *
 * Also seeds battleships:selectedNamespaceId so the LobbySelect picker
 * auto-selects the seeded lobby instead of waiting on the user.
 */

import type { BrowserContext, Page, Route } from '@playwright/test';

export interface InjectAuthOptions {
  nodeUrl: string;
  accessToken: string;
  refreshToken: string;
  applicationId: string;
  namespaceId: string;
  lobbyContextId: string;
  memberKey: string;
}

export async function injectMeroAuth(page: Page, opts: InjectAuthOptions): Promise<void> {
  await page.addInitScript((data) => {
    const expiresAt = String(Date.now() + 3_600_000);
    localStorage.setItem('mero:access_token', data.accessToken);
    localStorage.setItem('mero:refresh_token', data.refreshToken);
    localStorage.setItem('mero:expires_at', expiresAt);
    localStorage.setItem('mero:node_url', data.nodeUrl);
    localStorage.setItem('mero:application_id', data.applicationId);
    localStorage.setItem('mero:context_id', data.lobbyContextId);
    localStorage.setItem('mero:context_identity', data.memberKey);
    localStorage.setItem('battleships:selectedNamespaceId', data.namespaceId);
  }, opts);
}

/**
 * Route handler that turns every cross-origin merod request into something the
 * browser will accept, and re-injects the Bearer token server-side because
 * Chromium drops the Authorization header on cross-origin fetches whose
 * preflight didn't fully succeed (which is our case — Traefik's forward-auth
 * middleware kills the OPTIONS preflight before CORS headers attach).
 *
 * - OPTIONS preflights are short-circuited with a permissive 204.
 * - Real requests are re-issued from Node with `Authorization: Bearer <token>`
 *   forced, then the response is overlaid with Access-Control-Allow-Origin so
 *   the browser does not reject it.
 */
export async function bypassCors(
  target: BrowserContext | Page,
  bindings: ReadonlyArray<{ nodeUrl: string; accessToken: string }>,
): Promise<void> {
  for (const { nodeUrl, accessToken } of bindings) {
    const host = new URL(nodeUrl).host;
    await target.route(`http://${host}/**`, async (route: Route) => {
      const req = route.request();
      const allowOrigin = (await req.headerValue('origin')) ?? '*';

      if (req.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': allowOrigin,
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
            'access-control-allow-headers':
              'Authorization,Content-Type,Accept,X-Requested-With,X-Auth-Token,Cache-Control',
            'access-control-max-age': '600',
          },
        });
        return;
      }

      // Strip browser-set headers that confuse Traefik's routing/CORS
      // (Origin, Referer) and any auth-bearing headers we'll re-set ourselves.
      const original = req.headers();
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(original)) {
        const lk = k.toLowerCase();
        if (lk === 'origin' || lk === 'referer' || lk === 'authorization') continue;
        filtered[k] = v;
      }
      filtered['authorization'] = `Bearer ${accessToken}`;
      const response = await route.fetch({ headers: filtered });
      const respHeaders = {
        ...response.headers(),
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-credentials': 'true',
        'access-control-expose-headers': 'X-Auth-Error,Content-Length',
      };
      await route.fulfill({ response, headers: respHeaders });
    });
  }
}
