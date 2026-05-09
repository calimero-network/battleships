/**
 * Reads the integration env that ci writes to app/.env.integration.
 * Specs use envAvailable() to skip gracefully when the file is absent
 * (i.e. when running outside a live-merod CI job).
 */

export interface IntegrationEnv {
  applicationId: string;
  namespaceId: string;
  lobbyContextId: string;
  node1: NodeEnv;
  node2: NodeEnv;
}

export interface NodeEnv {
  url: string;
  accessToken: string;
  refreshToken: string;
  memberKey: string;
}

// Tokens are optional: when merobox runs without auth_service, the merod
// admin API is unauthenticated and tests don't need a Bearer header.
const REQUIRED_KEYS = [
  'E2E_APPLICATION_ID',
  'E2E_NAMESPACE_ID',
  'E2E_LOBBY_CONTEXT_ID',
  'E2E_NODE_URL',
  'E2E_MEMBER_KEY',
  'E2E_NODE_URL_2',
  'E2E_MEMBER_KEY_2',
] as const;

export function envAvailable(): boolean {
  return REQUIRED_KEYS.every((k) => Boolean(process.env[k]));
}

export function getEnv(): IntegrationEnv {
  for (const k of REQUIRED_KEYS) {
    if (!process.env[k]) {
      throw new Error(`Missing integration env var: ${k}`);
    }
  }
  return {
    applicationId: process.env.E2E_APPLICATION_ID!,
    namespaceId: process.env.E2E_NAMESPACE_ID!,
    lobbyContextId: process.env.E2E_LOBBY_CONTEXT_ID!,
    node1: {
      url: process.env.E2E_NODE_URL!,
      accessToken: process.env.E2E_ACCESS_TOKEN ?? '',
      refreshToken: process.env.E2E_REFRESH_TOKEN ?? '',
      memberKey: process.env.E2E_MEMBER_KEY!,
    },
    node2: {
      url: process.env.E2E_NODE_URL_2!,
      accessToken: process.env.E2E_ACCESS_TOKEN_2 ?? '',
      refreshToken: process.env.E2E_REFRESH_TOKEN_2 ?? '',
      memberKey: process.env.E2E_MEMBER_KEY_2!,
    },
  };
}
