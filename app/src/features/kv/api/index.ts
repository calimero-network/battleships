import { AbiClient, AbiEvent } from '../../../api/AbiClient';
import { MeroJs } from '@calimero-network/mero-react';

export { AbiClient };
export type { AbiEvent };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

export async function createKvClient(app: MeroJs): Promise<AbiClient> {
  console.log('Creating KV client');
  const contexts = await app.admin.getContexts();
  const context = contexts[0];
  if (!context) {
    throw new Error('No contexts available');
  }
  return new AbiClient(app, {
    contextId: context.contextId,
    executorId: context.contextIdentity?.publicKey || '',
    applicationId: context.applicationId,
  });
}
