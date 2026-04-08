import { LobbyClient } from '../../../api/lobby/LobbyClient';
import { GameClient } from '../../../api/game/GameClient';
import type { MeroJs } from '@calimero-network/mero-react';

import { resolveAppContext } from './context';
import type { AppContext, ContextRole, ResolveAppContextOptions } from './context';

export { LobbyClient, GameClient };
export type { AppContext, ContextRole };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

export interface CreateKvClientOptions {
  contextId?: string | null;
  contextIdentity?: string | null;
  role?: ContextRole | null;
  applicationId?: string | null;
}

export async function createLobbyClient(
  mero: MeroJs,
  options: CreateKvClientOptions = {},
): Promise<{ client: LobbyClient; context: AppContext }> {
  const resolveOptions: ResolveAppContextOptions = {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
    role: options.role,
    applicationId: options.applicationId,
  };

  const context = await resolveAppContext(mero, resolveOptions);

  return {
    client: new LobbyClient(mero, context.contextId, context.executorPublicKey),
    context,
  };
}

export async function createGameClient(
  mero: MeroJs,
  options: CreateKvClientOptions = {},
): Promise<{ client: GameClient; context: AppContext }> {
  const resolveOptions: ResolveAppContextOptions = {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
    role: options.role,
    applicationId: options.applicationId,
  };

  const context = await resolveAppContext(mero, resolveOptions);

  return {
    client: new GameClient(mero, context.contextId, context.executorPublicKey),
    context,
  };
}

// Backward compat — createKvClient creates a LobbyClient by default
export async function createKvClient(
  mero: MeroJs,
  options: CreateKvClientOptions = {},
): Promise<{ client: LobbyClient; context: AppContext }> {
  return createLobbyClient(mero, options);
}
