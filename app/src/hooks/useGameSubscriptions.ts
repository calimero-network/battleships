import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSubscription } from '@calimero-network/mero-react';
import type { AllGameEvents } from '../types/events';
import { isLobbyEvent } from '../types/events';

export interface UseGameSubscriptionsOptions {
  /** Primary context to subscribe to (Match context when in-game, Lobby otherwise). */
  contextId: string;
  /** Optional second context so Lobby events keep flowing while in a Match. */
  lobbyContextId?: string;
  matchId?: string;
  onBoardUpdate?: () => void;
  onTurnUpdate?: () => void;
  onGameEvent?: (event: AllGameEvents) => void;
}

export interface UseGameSubscriptionsReturn {
  isSubscribed: boolean;
  isConnecting: boolean;
  lastEvent: AllGameEvents | null;
  error: string | null;
  events: AllGameEvents[];
  subscribe: () => void;
  unsubscribe: () => void;
}

type SubscriptionEvent = {
  contextId: string;
  data: unknown;
};

type GameEventRefreshMode = 'none' | 'debounced' | 'immediate';

type ExecutionEventRecord = {
  kind?: unknown;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeExecutionPayload(value: unknown): unknown {
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'number')
  ) {
    try {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(value)));
    } catch {
      return value;
    }
  }

  return value;
}

function toGameEvent(
  eventType: unknown,
  payload: unknown,
): AllGameEvents | null {
  if (typeof eventType !== 'string' || !isRecord(payload)) {
    return null;
  }

  const id = typeof payload.id === 'string' ? payload.id : '';

  switch (eventType) {
    case 'MatchCreated':
      return id ? { type: 'MatchCreated', id } : null;
    case 'ShipsPlaced':
      return id ? { type: 'ShipsPlaced', id } : null;
    case 'ShotProposed': {
      const { x, y } = payload;
      if (!id || typeof x !== 'number' || typeof y !== 'number') {
        return null;
      }

      return { type: 'ShotProposed', id, x, y };
    }
    case 'ShotFired': {
      const { x, y, result } = payload;
      if (
        !id ||
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof result !== 'string'
      ) {
        return null;
      }

      return { type: 'ShotFired', id, x, y, result };
    }
    case 'Winner':
      return id ? { type: 'Winner', id } : null;
    case 'MatchEnded':
      return id ? { type: 'MatchEnded', id } : null;
    case 'MatchListUpdated':
      return { type: 'MatchListUpdated', id };
    case 'PlayerStatsUpdated':
      return { type: 'PlayerStatsUpdated', id };
    default:
      return null;
  }
}

function parseExecutionEventRecord(value: unknown): AllGameEvents | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value as ExecutionEventRecord;
  return toGameEvent(record.kind, decodeExecutionPayload(record.data));
}

export function parseSubscriptionEvent(eventData: unknown): AllGameEvents | null {
  return parseSubscriptionEvents(eventData)[0] ?? null;
}

export function parseSubscriptionEvents(eventData: unknown): AllGameEvents[] {
  const directEvent = toGameEvent(
    isRecord(eventData) ? (eventData.type ?? eventData.event_type) : undefined,
    eventData,
  );
  if (directEvent) {
    return [directEvent];
  }

  if (!isRecord(eventData)) {
    return [];
  }

  const events = eventData.events;
  if (Array.isArray(events)) {
    const parsedEvents: AllGameEvents[] = [];
    for (const eventRecord of events) {
      const parsedEvent = parseExecutionEventRecord(eventRecord);
      if (parsedEvent) {
        parsedEvents.push(parsedEvent);
      }
    }

    return parsedEvents;
  }

  const parsedEvent = parseExecutionEventRecord(eventData);
  return parsedEvent ? [parsedEvent] : [];
}

export function matchesActiveMatch(
  activeMatchId: string | undefined,
  event: AllGameEvents,
): boolean {
  if (isLobbyEvent(event)) {
    return true;
  }

  if (activeMatchId === undefined) {
    return true;
  }

  if (activeMatchId.trim() === '') {
    return false;
  }

  return event.id === activeMatchId;
}

export function getGameEventEffects(event: AllGameEvents): {
  board: GameEventRefreshMode;
  turn: GameEventRefreshMode;
} {
  switch (event.type) {
    case 'MatchCreated':
    case 'ShipsPlaced':
    case 'Winner':
    case 'MatchEnded':
      return { board: 'debounced', turn: 'none' };
    case 'ShotProposed':
    case 'ShotFired':
      return { board: 'immediate', turn: 'immediate' };
    case 'MatchListUpdated':
    case 'PlayerStatsUpdated':
      return { board: 'none', turn: 'none' };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

/**
 * Build the deduplicated list of context ids to subscribe to.
 *
 * When a separate `lobbyContextId` is provided (e.g. while the player is
 * inside a Match context), both contexts are subscribed so Lobby-level
 * events (match list updates, stats) keep flowing alongside Match events.
 */
function buildContextIds(
  contextId: string,
  lobbyContextId: string | undefined,
  isEnabled: boolean,
): string[] {
  if (!isEnabled) return [];

  const ids: string[] = [];
  if (contextId) ids.push(contextId);
  if (lobbyContextId && lobbyContextId !== contextId) ids.push(lobbyContextId);
  return ids;
}

export function useGameSubscriptions({
  contextId,
  lobbyContextId,
  matchId,
  onBoardUpdate,
  onTurnUpdate,
  onGameEvent,
}: UseGameSubscriptionsOptions): UseGameSubscriptionsReturn {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastEvent, setLastEvent] = useState<AllGameEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AllGameEvents[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedBoardUpdate = useMemo(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(() => {
        onBoardUpdate?.();
      }, 300);
    };
  }, [onBoardUpdate]);

  const eventCallback = useCallback(
    (event: SubscriptionEvent) => {
      try {
        const gameEvents = parseSubscriptionEvents(event.data).filter((gameEvent) =>
          matchesActiveMatch(matchId, gameEvent),
        );
        if (gameEvents.length === 0) {
          return;
        }

        setEvents((previousEvents) => [...previousEvents, ...gameEvents]);
        setLastEvent(gameEvents[gameEvents.length - 1]);
        setError(null);

        for (const gameEvent of gameEvents) {
          const effects = getGameEventEffects(gameEvent);
          if (effects.board === 'immediate') {
            onBoardUpdate?.();
          } else if (effects.board === 'debounced') {
            debouncedBoardUpdate();
          }

          if (effects.turn === 'immediate') {
            onTurnUpdate?.();
          }

          onGameEvent?.(gameEvent);
        }
      } catch (callbackError) {
        console.error('Error in subscription callback:', callbackError);
        setError('Error processing game event');
      }
    },
    [
      debouncedBoardUpdate,
      matchId,
      onBoardUpdate,
      onGameEvent,
      onTurnUpdate,
    ],
  );

  const subscribe = useCallback(() => {
    setIsEnabled(true);
  }, []);

  const unsubscribe = useCallback(() => {
    setIsEnabled(false);
    setIsSubscribed(false);
    setIsConnecting(false);
  }, []);

  const contextIds = useMemo(
    () => buildContextIds(contextId, lobbyContextId, isEnabled),
    [contextId, lobbyContextId, isEnabled],
  );

  useEffect(() => {
    if (contextIds.length === 0) {
      setIsSubscribed(false);
      setIsConnecting(false);
      return;
    }

    setError(null);
    setIsConnecting(true);
    setIsSubscribed(true);
    setIsConnecting(false);
  }, [contextIds]);

  useSubscription(contextIds, eventCallback);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    isSubscribed,
    isConnecting,
    lastEvent,
    error,
    events,
    subscribe,
    unsubscribe,
  };
}
