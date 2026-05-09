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
 * Installs a route handler that injects CORS headers onto every response from
 * the merod node, and short-circuits OPTIONS preflights with a permissive 204.
 *
 * Required because Traefik's forward-auth middleware on the integration stack
 * rejects unauthenticated OPTIONS preflights, stripping the Access-Control-*
 * headers — without this, the browser blocks every cross-origin admin-api
 * fetch from the Vite dev server origin.
 */
export async function bypassCors(target: BrowserContext | Page, ...nodeUrls: string[]): Promise<void> {
  const hosts = nodeUrls.map((u) => new URL(u).host);
  for (const host of hosts) {
    await target.route(`http://${host}/**`, async (route: Route) => {
      const req = route.request();
      const origin = req.headerValue('origin');
      const allowOrigin = (await origin) ?? '*';

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

      const response = await route.fetch();
      const headers = {
        ...response.headers(),
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-credentials': 'true',
        'access-control-expose-headers': 'X-Auth-Error,Content-Length',
      };
      await route.fulfill({ response, headers });
    });
  }
}
