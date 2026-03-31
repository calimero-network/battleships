import type { MeroJs } from '@calimero-network/mero-react';

export interface AppContext {
  applicationId: string;
  contextId: string;
  executorPublicKey: string;
}

interface ResolveAppContextOptions {
  targetContextId?: string | null;
  contextIdentity?: string | null;
}

interface MeroContextRecord {
  id: string;
  applicationId: string;
}

function selectContext(
  contexts: MeroContextRecord[],
  targetContextId?: string | null,
): MeroContextRecord {
  if (contexts.length === 0) {
    throw new Error('No contexts are available for the connected node.');
  }

  if (!targetContextId) {
    return contexts[0];
  }

  const targetContext = contexts.find((context) => context.id === targetContextId);
  if (!targetContext) {
    throw new Error('The requested context is not available on this node.');
  }

  return targetContext;
}

export async function resolveAppContext(
  mero: MeroJs,
  options: ResolveAppContextOptions = {},
): Promise<AppContext> {
  const { contexts } = await mero.admin.getContexts();
  const selectedContext = selectContext(contexts, options.targetContextId);

  if (options.contextIdentity) {
    return {
      applicationId: selectedContext.applicationId,
      contextId: selectedContext.id,
      executorPublicKey: options.contextIdentity,
    };
  }

  const { identities } = await mero.admin.getContextIdentitiesOwned(
    selectedContext.id,
  );
  const executorPublicKey = identities[0];

  if (!executorPublicKey) {
    throw new Error('No context identity is available for the selected context.');
  }

  return {
    applicationId: selectedContext.applicationId,
    contextId: selectedContext.id,
    executorPublicKey,
  };
}
