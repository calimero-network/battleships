/**
 * Writes the mero-react v2 storage keys directly so tests skip the
 * ConnectButton → auth-frontend → callback flow.
 *
 * Also seeds battleships:selectedNamespaceId so the LobbySelect picker
 * auto-selects the seeded lobby instead of waiting on the user.
 */

import type { Page } from '@playwright/test';

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
