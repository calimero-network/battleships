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
    const expiresAt = Date.now() + 3_600_000;
    // mero-js's LocalStorageTokenStore (the one MeroProvider actually uses)
    // stores a single JSON blob under 'mero-tokens'. The namespaced
    // 'mero:access_token' / 'mero:refresh_token' keys exported by
    // mero-react/storage are unused for the token itself, so writing only
    // those leaves MeroProvider's first /admin-api/contexts call unauthed.
    localStorage.setItem('mero-tokens', JSON.stringify({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      expires_at: expiresAt,
    }));
    // The non-token mero-react state (node URL, ids) does use the
    // namespaced keys.
    localStorage.setItem('mero:expires_at', String(expiresAt));
    localStorage.setItem('mero:node_url', data.nodeUrl);
    localStorage.setItem('mero:application_id', data.applicationId);
    localStorage.setItem('mero:context_id', data.lobbyContextId);
    localStorage.setItem('mero:context_identity', data.memberKey);
    localStorage.setItem('battleships:selectedNamespaceId', data.namespaceId);
  }, opts);
}

