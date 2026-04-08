import { describe, expect, it } from 'vitest';

describe('useBattleshipsLobby', () => {
  it('exports the hook', async () => {
    const mod = await import('./useBattleshipsLobby');
    expect(typeof mod.useBattleshipsLobby).toBe('function');
  });
});
