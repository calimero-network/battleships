import { describe, expect, it, vi } from 'vitest';

import { resolveAppContext } from './context';

describe('resolveAppContext', () => {
  it('prefers the auth-selected context and executor identity', async () => {
    const mero = {
      admin: {
        getContexts: vi.fn().mockResolvedValue({
          contexts: [
            { id: 'ctx-1', applicationId: 'app-1' },
            { id: 'ctx-2', applicationId: 'app-2' },
          ],
        }),
        getContextIdentitiesOwned: vi.fn(),
      },
    };

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

  it('falls back to the first owned identity for the chosen context', async () => {
    const mero = {
      admin: {
        getContexts: vi.fn().mockResolvedValue({
          contexts: [{ id: 'ctx-1', applicationId: 'app-1' }],
        }),
        getContextIdentitiesOwned: vi.fn().mockResolvedValue({
          identities: ['owned-identity', 'secondary-identity'],
        }),
      },
    };

    await expect(resolveAppContext(mero as never)).resolves.toEqual({
      applicationId: 'app-1',
      contextId: 'ctx-1',
      executorPublicKey: 'owned-identity',
    });
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

    await expect(resolveAppContext(mero as never)).rejects.toThrow(
      'No context identity is available for the selected context.',
    );
  });

  it('throws when the requested context is missing', async () => {
    const mero = {
      admin: {
        getContexts: vi.fn().mockResolvedValue({
          contexts: [{ id: 'ctx-1', applicationId: 'app-1' }],
        }),
        getContextIdentitiesOwned: vi.fn(),
      },
    };

    await expect(
      resolveAppContext(mero as never, { targetContextId: 'ctx-2' }),
    ).rejects.toThrow('The requested context is not available on this node.');
  });
});
