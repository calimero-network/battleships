import { describe, expect, it, vi } from 'vitest';

import { resolveAppContext } from './context';

function makeMero(contexts: { id: string; applicationId: string }[]) {
  return {
    admin: {
      getContexts: vi.fn().mockResolvedValue({ contexts }),
      getContextIdentitiesOwned: vi.fn().mockResolvedValue({
        identities: ['owned-identity'],
      }),
    },
  };
}

describe('resolveAppContext', () => {
  it('throws when no context intent is provided', async () => {
    const mero = makeMero([
      { id: 'ctx-1', applicationId: 'app-1' },
      { id: 'ctx-2', applicationId: 'app-2' },
    ]);

    await expect(resolveAppContext(mero as never)).rejects.toThrow(
      'No context intent provided.',
    );
  });

  it('does not fall back to the first context when no target is given', async () => {
    const mero = makeMero([{ id: 'ctx-1', applicationId: 'app-1' }]);

    await expect(resolveAppContext(mero as never, {})).rejects.toThrow(
      'No context intent provided.',
    );
  });

  it('resolves a lobby context with explicit target', async () => {
    const mero = makeMero([
      { id: 'lobby-ctx', applicationId: 'app-1' },
      { id: 'match-ctx', applicationId: 'app-1' },
    ]);

    await expect(
      resolveAppContext(mero as never, {
        role: 'lobby',
        targetContextId: 'lobby-ctx',
        contextIdentity: 'auth-identity',
      }),
    ).resolves.toEqual({
      applicationId: 'app-1',
      contextId: 'lobby-ctx',
      executorPublicKey: 'auth-identity',
    });
  });

  it('throws when lobby role is given without a target context id', async () => {
    const mero = makeMero([{ id: 'ctx-1', applicationId: 'app-1' }]);

    await expect(
      resolveAppContext(mero as never, { role: 'lobby' }),
    ).rejects.toThrow(
      'A target context id is required when resolving a lobby context.',
    );
  });

  it('resolves a match context with explicit target', async () => {
    const mero = makeMero([
      { id: 'lobby-ctx', applicationId: 'app-1' },
      { id: 'match-ctx', applicationId: 'app-1' },
    ]);

    await expect(
      resolveAppContext(mero as never, {
        role: 'match',
        targetContextId: 'match-ctx',
        contextIdentity: 'auth-identity',
      }),
    ).resolves.toEqual({
      applicationId: 'app-1',
      contextId: 'match-ctx',
      executorPublicKey: 'auth-identity',
    });
  });

  it('throws when match role is given without a target context id', async () => {
    const mero = makeMero([{ id: 'ctx-1', applicationId: 'app-1' }]);

    await expect(
      resolveAppContext(mero as never, { role: 'match' }),
    ).rejects.toThrow(
      'A target context id is required when resolving a match context.',
    );
  });

  it('throws when the requested context does not exist', async () => {
    const mero = makeMero([{ id: 'ctx-1', applicationId: 'app-1' }]);

    await expect(
      resolveAppContext(mero as never, { targetContextId: 'ctx-missing' }),
    ).rejects.toThrow('The requested context is not available on this node.');
  });

  it('resolves with explicit targetContextId and no role', async () => {
    const mero = makeMero([
      { id: 'ctx-1', applicationId: 'app-1' },
      { id: 'ctx-2', applicationId: 'app-2' },
    ]);

    await expect(
      resolveAppContext(mero as never, {
        targetContextId: 'ctx-2',
        contextIdentity: 'auth-identity',
      }),
    ).resolves.toEqual({
      applicationId: 'app-2',
      contextId: 'ctx-2',
      executorPublicKey: 'auth-identity',
    });

    expect(mero.admin.getContextIdentitiesOwned).not.toHaveBeenCalled();
  });

  it('falls back to the first owned identity when no contextIdentity is given', async () => {
    const mero = makeMero([{ id: 'ctx-1', applicationId: 'app-1' }]);

    await expect(
      resolveAppContext(mero as never, { targetContextId: 'ctx-1' }),
    ).resolves.toEqual({
      applicationId: 'app-1',
      contextId: 'ctx-1',
      executorPublicKey: 'owned-identity',
    });

    expect(mero.admin.getContextIdentitiesOwned).toHaveBeenCalledWith('ctx-1');
  });

  it('throws when the selected context has no executor identity', async () => {
    const mero = {
      admin: {
        getContexts: vi.fn().mockResolvedValue({
          contexts: [{ id: 'ctx-1', applicationId: 'app-1' }],
        }),
        getContextIdentitiesOwned: vi.fn().mockResolvedValue({
          identities: [],
        }),
      },
    };

    await expect(
      resolveAppContext(mero as never, { targetContextId: 'ctx-1' }),
    ).rejects.toThrow(
      'No context identity is available for the selected context.',
    );
  });
});
