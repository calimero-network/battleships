/**
 * Game event types emitted by the Battleships contract.
 *
 * Events are split into two categories matching the contract's context model:
 * - **Lobby events** arrive on the shared Lobby context (match list, stats).
 * - **Match events** arrive on a per-game Match context (shots, ships, winner).
 */

export type LobbyEventType =
  | 'MatchCreated'
  | 'MatchIdCollision'
  | 'MatchListUpdated'
  | 'PlayerStatsUpdated';

export type MatchEventType =
  | 'ShipsPlaced'
  | 'BoardCommitted'
  | 'BoardRevealed'
  | 'AuditPassed'
  | 'AuditFailed'
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

/** Lobby-side: `create_match` lost the composed-id uniqueness race. */
export interface MatchIdCollisionEvent extends GameEvent {
  type: 'MatchIdCollision';
  /** The colliding `{p1}-{p2}-{ms}` id the caller tried to create. */
  attempted_id: string;
  /** Echoed into `id` for compatibility with the GameEvent base shape. */
  id: string;
}

/** A player published their SHA256 board commitment to UserStorage. */
export interface BoardCommittedEvent extends GameEvent {
  type: 'BoardCommitted';
  id: string;
  /** Base58 of the player's PublicKey. */
  player: string;
  /** 64-char lowercase hex SHA256 hash. */
  commitment: string;
}

/** A player ran `reveal_board` and the lobby successfully recorded the reveal. */
export interface BoardRevealedEvent extends GameEvent {
  type: 'BoardRevealed';
  id: string;
  player: string;
}

/** Audit (commitment check + shot replay) succeeded for a player. */
export interface AuditPassedEvent extends GameEvent {
  type: 'AuditPassed';
  id: string;
  player: string;
}

/** Audit failed — commitment mismatch or a shot inconsistency. */
export interface AuditFailedEvent extends GameEvent {
  type: 'AuditFailed';
  id: string;
  player: string;
  reason: string;
}

export type LobbyEvent =
  | MatchCreatedEvent
  | MatchIdCollisionEvent
  | MatchListUpdatedEvent
  | PlayerStatsUpdatedEvent;

export type MatchEvent =
  | ShipsPlacedEvent
  | BoardCommittedEvent
  | BoardRevealedEvent
  | AuditPassedEvent
  | AuditFailedEvent
  | ShotProposedEvent
  | ShotFiredEvent
  | WinnerEvent
  | MatchEndedEvent;

export type AllGameEvents = LobbyEvent | MatchEvent;

const LOBBY_EVENT_TYPES: ReadonlySet<string> = new Set<LobbyEventType>([
  'MatchCreated',
  'MatchIdCollision',
  'MatchListUpdated',
  'PlayerStatsUpdated',
]);

export function isLobbyEvent(event: AllGameEvents): event is LobbyEvent {
  return LOBBY_EVENT_TYPES.has(event.type);
}

export function isMatchEvent(event: AllGameEvents): event is MatchEvent {
  return !LOBBY_EVENT_TYPES.has(event.type);
}
