/**
 * Game event types that can be received from the WebSocket connection
 * These correspond to the events emitted by the Rust backend
 */

export interface GameEvent {
  type:
    | 'MatchCreated'
    | 'ShipsPlaced'
    | 'ShotProposed'
    | 'ShotFired'
    | 'Winner'
    | 'MatchEnded';
  id: string;
  x?: number;
  y?: number;
  result?: string;
}

export interface MatchCreatedEvent extends GameEvent {
  type: 'MatchCreated';
  id: string;
}

export interface ShipsPlacedEvent extends GameEvent {
  type: 'ShipsPlaced';
  id: string;
}

export interface ShotProposedEvent extends GameEvent {
  type: 'ShotProposed';
  id: string;
  x: number;
  y: number;
}

export interface ShotFiredEvent extends GameEvent {
  type: 'ShotFired';
  id: string;
  x: number;
  y: number;
  result: string;
}

export interface WinnerEvent extends GameEvent {
  type: 'Winner';
  id: string;
}

export interface MatchEndedEvent extends GameEvent {
  type: 'MatchEnded';
  id: string;
}

export type AllGameEvents =
  | MatchCreatedEvent
  | ShipsPlacedEvent
  | ShotProposedEvent
  | ShotFiredEvent
  | WinnerEvent
  | MatchEndedEvent;

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  type: 'event' | 'error' | 'connected' | 'disconnected';
  data?: AllGameEvents;
  error?: string;
  timestamp?: number;
}
