/**
 * Game event types emitted by the Battleships contract.
 *
 * Events are split into two categories matching the contract's context model:
 * - **Lobby events** arrive on the shared Lobby context (match list, stats).
 * - **Match events** arrive on a per-game Match context (shots, ships, winner).
 */

export type LobbyEventType =
  | 'MatchCreated'
  | 'MatchListUpdated'
  | 'PlayerStatsUpdated';

export type MatchEventType =
  | 'ShipsPlaced'
  | 'ShotProposed'
  | 'ShotFired'
  | 'Winner'
  | 'MatchEnded';

export type GameEventType = LobbyEventType | MatchEventType;

export interface GameEvent {
  type: GameEventType;
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

export interface MatchListUpdatedEvent extends GameEvent {
  type: 'MatchListUpdated';
}

export interface PlayerStatsUpdatedEvent extends GameEvent {
  type: 'PlayerStatsUpdated';
}

export type LobbyEvent =
  | MatchCreatedEvent
  | MatchListUpdatedEvent
  | PlayerStatsUpdatedEvent;

export type MatchEvent =
  | ShipsPlacedEvent
  | ShotProposedEvent
  | ShotFiredEvent
  | WinnerEvent
  | MatchEndedEvent;

export type AllGameEvents = LobbyEvent | MatchEvent;

const LOBBY_EVENT_TYPES: ReadonlySet<string> = new Set<LobbyEventType>([
  'MatchCreated',
  'MatchListUpdated',
  'PlayerStatsUpdated',
]);

export function isLobbyEvent(event: AllGameEvents): event is LobbyEvent {
  return LOBBY_EVENT_TYPES.has(event.type);
}

export function isMatchEvent(event: AllGameEvents): event is MatchEvent {
  return !LOBBY_EVENT_TYPES.has(event.type);
}
