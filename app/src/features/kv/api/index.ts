import { AbiClient } from '../../../api/AbiClient';
import type { MeroJs } from '@calimero-network/mero-react';

import { resolveAppContext } from './context';
import type { AppContext, ContextRole, ResolveAppContextOptions } from './context';

export { AbiClient };
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
  groupId?: string | null;
  applicationId?: string | null;
}

export async function createKvClient(
  mero: MeroJs,
  options: CreateKvClientOptions = {},
): Promise<{ client: AbiClient; context: AppContext }> {
  const resolveOptions: ResolveAppContextOptions = {
    targetContextId: options.contextId,
    contextIdentity: options.contextIdentity,
    role: options.role,
    groupId: options.groupId,
    applicationId: options.applicationId,
  };

  const context = await resolveAppContext(mero, resolveOptions);

  return {
    client: new AbiClient(mero, context.contextId, context.executorPublicKey),
    context,
  };
}
