import { describe, expect, it } from 'vitest';

import {
  getGameEventEffects,
  matchesActiveMatch,
  parseSubscriptionEvents,
  parseSubscriptionEvent,
} from './useGameSubscriptions';

describe('parseSubscriptionEvent', () => {
  it('parses direct emitted event payloads', () => {
    expect(
      parseSubscriptionEvent({
        event_type: 'ShotProposed',
        id: 'match-1',
        x: 4,
        y: 7,
      }),
    ).toEqual({
      type: 'ShotProposed',
      id: 'match-1',
      x: 4,
      y: 7,
    });
  });

  it('parses execution event arrays with object payloads', () => {
    expect(
      parseSubscriptionEvent({
        events: [
          {
            kind: 'ShotFired',
            data: {
              id: 'match-2',
              x: 2,
              y: 5,
              result: 'hit',
            },
          },
        ],
      }),
    ).toEqual({
      type: 'ShotFired',
      id: 'match-2',
      x: 2,
      y: 5,
      result: 'hit',
    });
  });

  it('returns every parsed event from batched execution payloads', () => {
    expect(
      parseSubscriptionEvents({
        events: [
          {
            kind: 'ShotProposed',
            data: {
              id: 'match-3',
              x: 1,
              y: 2,
            },
          },
          {
            kind: 'ShotFired',
            data: {
              id: 'match-3',
              x: 1,
              y: 2,
              result: 'hit',
            },
          },
        ],
      }),
    ).toEqual([
      {
        type: 'ShotProposed',
        id: 'match-3',
        x: 1,
        y: 2,
      },
      {
        type: 'ShotFired',
        id: 'match-3',
        x: 1,
        y: 2,
        result: 'hit',
      },
    ]);
  });
});

describe('matchesActiveMatch', () => {
  it('accepts events when no active match is selected', () => {
    expect(
      matchesActiveMatch(undefined, {
        type: 'MatchCreated',
        id: 'match-1',
      }),
    ).toBe(true);
  });

  it('filters out events from other matches', () => {
    expect(
      matchesActiveMatch('match-1', {
        type: 'MatchCreated',
        id: 'match-2',
      }),
    ).toBe(false);
  });

  it('ignores events when the active match id is blank', () => {
    expect(
      matchesActiveMatch('', {
        type: 'MatchCreated',
        id: 'match-1',
      }),
    ).toBe(false);
  });
});

describe('getGameEventEffects', () => {
  it('refreshes board and turn immediately for shot events', () => {
    expect(
      getGameEventEffects({
        type: 'ShotProposed',
        id: 'match-1',
        x: 1,
        y: 1,
      }),
    ).toEqual({
      board: 'immediate',
      turn: 'immediate',
    });
  });

  it('uses a debounced board refresh for non-shot game events', () => {
    expect(
      getGameEventEffects({
        type: 'Winner',
        id: 'match-1',
      }),
    ).toEqual({
      board: 'debounced',
      turn: 'none',
    });
  });
});
