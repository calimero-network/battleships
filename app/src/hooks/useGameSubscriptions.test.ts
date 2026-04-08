import { describe, expect, it } from 'vitest';

import {
  getGameEventEffects,
  matchesActiveMatch,
  parseSubscriptionEvents,
  parseSubscriptionEvent,
} from './useGameSubscriptions';
import { isLobbyEvent, isMatchEvent } from '../types/events';
import type { AllGameEvents } from '../types/events';

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

  it('parses lobby events (MatchListUpdated, PlayerStatsUpdated)', () => {
    expect(
      parseSubscriptionEvent({
        event_type: 'MatchListUpdated',
        id: '',
      }),
    ).toEqual({ type: 'MatchListUpdated', id: '' });

    expect(
      parseSubscriptionEvent({
        event_type: 'PlayerStatsUpdated',
        id: '',
      }),
    ).toEqual({ type: 'PlayerStatsUpdated', id: '' });
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

  it('filters out match events from other matches', () => {
    expect(
      matchesActiveMatch('match-1', {
        type: 'ShipsPlaced',
        id: 'match-2',
      }),
    ).toBe(false);
  });

  it('ignores match events when the active match id is blank', () => {
    expect(
      matchesActiveMatch('', {
        type: 'ShipsPlaced',
        id: 'match-1',
      }),
    ).toBe(false);
  });

  it('always passes lobby events regardless of active match', () => {
    expect(
      matchesActiveMatch('match-1', { type: 'MatchListUpdated', id: '' }),
    ).toBe(true);

    expect(
      matchesActiveMatch('match-1', { type: 'PlayerStatsUpdated', id: '' }),
    ).toBe(true);

    expect(
      matchesActiveMatch('match-1', { type: 'MatchCreated', id: 'lobby-match' }),
    ).toBe(true);
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

  it('returns no effects for lobby-only events', () => {
    expect(
      getGameEventEffects({ type: 'MatchListUpdated', id: '' }),
    ).toEqual({ board: 'none', turn: 'none' });

    expect(
      getGameEventEffects({ type: 'PlayerStatsUpdated', id: '' }),
    ).toEqual({ board: 'none', turn: 'none' });
  });
});

describe('isLobbyEvent / isMatchEvent', () => {
  const lobbyEvents: AllGameEvents[] = [
    { type: 'MatchCreated', id: 'x' },
    { type: 'MatchListUpdated', id: '' },
    { type: 'PlayerStatsUpdated', id: '' },
  ];

  const matchEvents: AllGameEvents[] = [
    { type: 'ShipsPlaced', id: 'x' },
    { type: 'ShotProposed', id: 'x', x: 0, y: 0 },
    { type: 'ShotFired', id: 'x', x: 0, y: 0, result: 'miss' },
    { type: 'Winner', id: 'x' },
    { type: 'MatchEnded', id: 'x' },
  ];

  it('classifies lobby events correctly', () => {
    for (const event of lobbyEvents) {
      expect(isLobbyEvent(event)).toBe(true);
      expect(isMatchEvent(event)).toBe(false);
    }
  });

  it('classifies match events correctly', () => {
    for (const event of matchEvents) {
      expect(isMatchEvent(event)).toBe(true);
      expect(isLobbyEvent(event)).toBe(false);
    }
  });
});
