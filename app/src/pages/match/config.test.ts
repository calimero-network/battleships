import { describe, expect, it } from 'vitest';

import { resolveEffectiveMatchId, SHIP_TARGETS, validateFleetPayload } from './config';

describe('match config', () => {
  it('uses contract-aligned fleet composition targets', () => {
    expect(SHIP_TARGETS).toEqual([1, 2, 1, 1]);
  });

  it('prefers runtime match id when available', () => {
    expect(
      resolveEffectiveMatchId(
        'match-lobby-1',
        'match-runtime-1',
      ),
    ).toBe('match-runtime-1');
  });

  it('falls back to lobby match id when runtime id is missing', () => {
    expect(resolveEffectiveMatchId('match-lobby-1', null)).toBe('match-lobby-1');
    expect(resolveEffectiveMatchId('match-lobby-1', '')).toBe('match-lobby-1');
  });

  it('accepts valid fleet payload composition and shapes', () => {
    expect(
      validateFleetPayload([
        '1,0;2,0',
        '5,1;6,1;7,1',
        '0,3;0,4;0,5',
        '3,8;4,8;5,8;6,8',
        '2,6;3,6;4,6;5,6;6,6',
      ]),
    ).toBeNull();
  });

  it('rejects invalid fleet composition', () => {
    expect(
      validateFleetPayload([
        '1,0;2,0',
        '5,1;6,1;7,1',
        '3,8;4,8;5,8;6,8',
        '0,6;1,6;2,6;3,6;4,6',
      ]),
    ).toContain('Fleet must be');
  });

  it('rejects non-straight ships', () => {
    expect(
      validateFleetPayload([
        '1,0;2,0',
        '5,1;6,1;7,1',
        '3,8;4,8;5,8;6,8;6,9',
        '0,9;1,9;2,9',
        '4,4;4,5;4,6',
      ]),
    ).toContain('Invalid ship shape');
  });

  it('rejects adjacent ships, including diagonal touching', () => {
    expect(
      validateFleetPayload([
        '1,0;2,0',
        '4,1;5,1;6,1',
        '4,2;5,2;6,2',
        '3,8;4,8;5,8;6,8',
        '0,9;1,9;2,9;3,9;4,9',
      ]),
    ).toContain('adjacent');
  });
});
