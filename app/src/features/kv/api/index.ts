import { AbiClient } from '../../../api/AbiClient';
import type { MeroJs } from '@calimero-network/mero-react';

import { resolveAppContext } from './context';
import type { AppContext } from './context';

export { AbiClient };
export type { AppContext };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

interface CreateKvClientOptions {
  contextId?: string | null;
  contextIdentity?: string | null;
}

export async function createKvClient(
  mero: MeroJs,
  options: CreateKvClientOptions = {},
): Promise<{ client: AbiClient; context: AppContext }> {
  const context = await resolveAppContext(mero, {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
  });

  return {
    client: new AbiClient(mero, context.contextId, context.executorPublicKey),
    context,
  };
}
