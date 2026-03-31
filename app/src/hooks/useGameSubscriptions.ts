import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSubscription } from '@calimero-network/mero-react';
import type { AllGameEvents } from '../types/events';

export interface UseGameSubscriptionsOptions {
  contextId: string;
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

  const id = payload.id;
  if (typeof id !== 'string') {
    return null;
  }

  switch (eventType) {
    case 'MatchCreated':
      return { type: 'MatchCreated', id };
    case 'ShipsPlaced':
      return { type: 'ShipsPlaced', id };
    case 'ShotProposed': {
      const { x, y } = payload;
      if (typeof x !== 'number' || typeof y !== 'number') {
        return null;
      }

      return { type: 'ShotProposed', id, x, y };
    }
    case 'ShotFired': {
      const { x, y, result } = payload;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof result !== 'string'
      ) {
        return null;
      }

      return { type: 'ShotFired', id, x, y, result };
    }
    case 'Winner':
      return { type: 'Winner', id };
    case 'MatchEnded':
      return { type: 'MatchEnded', id };
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
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

export function useGameSubscriptions({
  contextId,
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

  const contextIds = useMemo(() => {
    if (!contextId || !isEnabled) {
      return [];
    }

    return [contextId];
  }, [contextId, isEnabled]);

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
