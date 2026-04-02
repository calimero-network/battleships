import { describe, expect, it } from 'vitest';

import { shouldAutoJoinGroupContext } from './useBattleshipsLobby';

describe('shouldAutoJoinGroupContext', () => {
  it('skips auto-join when lobby was just joined via invitation', () => {
    expect(
      shouldAutoJoinGroupContext({
        groupId: 'group-1',
        lobbyContextId: 'ctx-1',
        lobbyJoined: false,
        autoJoinAttempted: false,
        joinGroupContextLoading: false,
        lastJoinContextId: 'ctx-1',
      }),
    ).toBe(false);
  });

  it('allows auto-join when no invitation join happened', () => {
    expect(
      shouldAutoJoinGroupContext({
        groupId: 'group-1',
        lobbyContextId: 'ctx-1',
        lobbyJoined: false,
        autoJoinAttempted: false,
        joinGroupContextLoading: false,
        lastJoinContextId: null,
      }),
    ).toBe(true);
  });
});
