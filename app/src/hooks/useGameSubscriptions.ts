import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { AllGameEvents } from '../types/events';

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

export function useGameSubscriptions({
  contextId,
  matchId,
  onBoardUpdate,
  onTurnUpdate,
  onGameEvent,
}: UseGameSubscriptionsOptions): UseGameSubscriptionsReturn {
  const { app } = useCalimero();

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastEvent, setLastEvent] = useState<AllGameEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AllGameEvents[]>([]);

  const currentSubscriptionRef = useRef<string | null>(null);
  const isProcessingEvent = useRef(false);
  const hasSubscribedRef = useRef(false);

  // Create debounced functions using useMemo to avoid recreating them on every render
  const debouncedBoardUpdate = useMemo(() => {
    let timeout: ReturnType<typeof setTimeout>;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        onBoardUpdate?.();
      }, 300);
    };
  }, [onBoardUpdate]);

  const handleGameEvent = useCallback(
    (event: AllGameEvents) => {
      console.log('🎮 Game event received:', event);
      console.log('🔄 Triggering UI refresh for event type:', event.type);

      // Add to events list
      setEvents((prev) => [...prev, event]);
      setLastEvent(event);

      switch (event.type) {
        case 'MatchCreated':
          console.log('→ MatchCreated: calling boardUpdate');
          debouncedBoardUpdate();
          break;

        case 'ShipsPlaced':
          console.log('→ ShipsPlaced: calling boardUpdate');
          debouncedBoardUpdate();
          break;

        case 'ShotProposed':
          console.log(
            '→ ShotProposed: calling boardUpdate + turnUpdate IMMEDIATELY',
          );
          // Refresh immediately so pending shot state is reflected
          onBoardUpdate?.();
          onTurnUpdate?.();
          break;

        case 'ShotFired':
          console.log(
            '→ ShotFired: calling boardUpdate + turnUpdate IMMEDIATELY',
          );
          // Call immediately for instant turn feedback
          onBoardUpdate?.();
          onTurnUpdate?.();
          break;

        case 'Winner':
          console.log('→ Winner: calling boardUpdate');
          debouncedBoardUpdate();
          break;

        case 'MatchEnded':
          console.log('→ MatchEnded: calling boardUpdate');
          debouncedBoardUpdate();
          break;
      }

      // Fallback: trigger a refresh on any game event to keep UI in sync
      console.log('→ Fallback: calling boardUpdate');
      debouncedBoardUpdate();

      // Call custom event handler
      onGameEvent?.(event);
    },
    [debouncedBoardUpdate, onBoardUpdate, onTurnUpdate, onGameEvent],
  );

  const parseGameEvent = useCallback((eventData: any): AllGameEvents | null => {
    console.log('🔍 Parsing event data:', JSON.stringify(eventData, null, 2));
    try {
      // Handle different event structures from Calimero
      if (eventData.event_type) {
        console.log('  → Found direct event_type:', eventData.event_type);
        // Direct event structure
        switch (eventData.event_type) {
          case 'MatchCreated':
            return { type: 'MatchCreated', id: eventData.id };
          case 'ShipsPlaced':
            return { type: 'ShipsPlaced', id: eventData.id };
          case 'ShotProposed':
            return {
              type: 'ShotProposed',
              id: eventData.id,
              x: eventData.x,
              y: eventData.y,
            };
          case 'ShotFired':
            return {
              type: 'ShotFired',
              id: eventData.id,
              x: eventData.x,
              y: eventData.y,
              result: eventData.result,
            };
          case 'Winner':
            return { type: 'Winner', id: eventData.id };
          case 'MatchEnded':
            return { type: 'MatchEnded', id: eventData.id };
        }
      } else if (eventData.events && Array.isArray(eventData.events)) {
        console.log(
          '  → Found events array with',
          eventData.events.length,
          'events',
        );
        // Handle execution/state mutation events array
        for (const executionEvent of eventData.events) {
          const kind = executionEvent.kind;
          const raw = executionEvent.data;
          console.log('    → Processing event kind:', kind, 'data:', raw);
          if (!kind || raw === undefined || raw === null) continue;

          // Data can be a byte array representing JSON. Decode if necessary.
          let payload: any = raw;
          try {
            if (
              Array.isArray(raw) &&
              raw.every((n: any) => typeof n === 'number')
            ) {
              const decoder = new TextDecoder();
              const jsonStr = decoder.decode(new Uint8Array(raw));
              console.log('    → Decoded JSON string:', jsonStr);
              payload = JSON.parse(jsonStr);
            }
          } catch (e) {
            console.warn('Failed to decode execution event payload', e);
          }

          console.log('    → Final payload:', payload);
          switch (kind) {
            case 'MatchCreated':
              return { type: 'MatchCreated', id: payload.id } as AllGameEvents;
            case 'ShipsPlaced':
              return { type: 'ShipsPlaced', id: payload.id } as AllGameEvents;
            case 'ShotProposed':
              return {
                type: 'ShotProposed',
                id: payload.id,
                x: payload.x,
                y: payload.y,
              } as AllGameEvents;
            case 'ShotFired':
              return {
                type: 'ShotFired',
                id: payload.id,
                x: payload.x,
                y: payload.y,
                result: payload.result,
              } as AllGameEvents;
            case 'Winner':
              return { type: 'Winner', id: payload.id } as AllGameEvents;
            case 'MatchEnded':
              return { type: 'MatchEnded', id: payload.id } as AllGameEvents;
          }
        }
      }
      console.log('  ⚠️ No matching event structure found');
    } catch (error) {
      console.error('Error parsing game event:', error);
    }
    return null;
  }, []);

  const eventCallback = useCallback(
    async (event: any) => {
      // Log all incoming events for debugging
      console.log('📡 Calimero SSE Event:', {
        type: event.type,
        timestamp: new Date().toISOString(),
        data: event.data ? Object.keys(event.data) : 'no data',
        fullEvent: event,
      });

      // Prevent infinite loops
      if (isProcessingEvent.current) {
        console.log('Event processing already in progress, skipping');
        return;
      }

      isProcessingEvent.current = true;

      try {
        // Handle different event types
        switch (event.type) {
          case 'StateMutation':
            console.log('🔄 Handling StateMutation event');
            if (event.data) {
              const gameEvent = parseGameEvent(event.data);
              if (gameEvent) {
                console.log(
                  '  ✅ Successfully parsed StateMutation to:',
                  gameEvent,
                );
                handleGameEvent(gameEvent);
              } else {
                console.log('  ❌ Failed to parse StateMutation event');
              }
            }
            break;

          case 'ExecutionEvent':
            console.log('⚡ Handling ExecutionEvent');
            if (event.data) {
              const gameEvent = parseGameEvent(event.data);
              if (gameEvent) {
                console.log(
                  '  ✅ Successfully parsed ExecutionEvent to:',
                  gameEvent,
                );
                handleGameEvent(gameEvent);
              } else {
                console.log('  ❌ Failed to parse ExecutionEvent');
              }
            }
            break;

          default:
            console.log(
              'Unknown event type:',
              event.type,
              '- Full event:',
              event,
            );
        }
      } catch (callbackError) {
        console.error('Error in subscription callback:', callbackError);
        setError('Error processing game event');
      } finally {
        isProcessingEvent.current = false;
      }
    },
    [parseGameEvent, handleGameEvent],
  );

  const subscribe = useCallback(() => {
    if (!app || !contextId || isConnecting || hasSubscribedRef.current) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Unsubscribe from previous context if exists
      if (currentSubscriptionRef.current) {
        console.log(
          '🔄 Unsubscribing from previous context:',
          currentSubscriptionRef.current,
        );
        app.unsubscribeFromEvents([currentSubscriptionRef.current]);
      }

      // Subscribe to new context with the updated SSE client
      console.log('📤 Subscribing to context:', contextId);
      app.subscribeToEvents([contextId], eventCallback);

      currentSubscriptionRef.current = contextId;
      hasSubscribedRef.current = true;
      setIsSubscribed(true);
      setIsConnecting(false);

      console.log('✅ Subscribed to game events for context:', contextId);
    } catch (error) {
      console.error('Failed to subscribe to game events:', error);
      setError('Failed to subscribe to events');
      setIsConnecting(false);
    }
  }, [app, contextId, isConnecting, eventCallback]);

  const unsubscribe = useCallback(() => {
    if (!app || !currentSubscriptionRef.current) return;

    try {
      app.unsubscribeFromEvents([currentSubscriptionRef.current]);
      currentSubscriptionRef.current = null;
      hasSubscribedRef.current = false;
      setIsSubscribed(false);
      console.log('❌ Unsubscribed from game events');
    } catch (error) {
      console.error('Failed to unsubscribe from game events:', error);
    }
  }, [app]);

  // Auto-subscribe when contextId changes (only once)
  useEffect(() => {
    if (contextId && app && !hasSubscribedRef.current) {
      subscribe();
    }
  }, [contextId, app, subscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

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
