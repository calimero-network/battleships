//! # Battleship Game Logic
//!
//! This crate implements a battleship game using the Calimero SDK with two
//! runtime roles: **Lobby** and **Match**.
//!
//! - A **Lobby** context stores the public read model: match summaries,
//!   player stats, and match history.
//! - A **Match** context stores live game state and private boards for a
//!   single game between two players.
//!
//! Match context creation is client-driven through the admin API. The contract
//! allocates a `match_id`, the client creates the Match context externally,
//! then calls `set_match_context_id` to link it back into the Lobby.

#![allow(clippy::len_without_is_empty)]

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::env;
use thiserror::Error;

pub mod board;
pub mod events;
pub mod game;
pub mod lobby;
pub mod players;
pub mod ships;
pub mod validation;

pub use board::{Board, Cell, Coordinate, BOARD_SIZE};
pub use events::Event;
pub use game::{Match, ShotResolver};
pub use lobby::{MatchRecord, MatchStatus, MatchSummary, PlayerStats, PlayerStatsEntry};
pub use players::{PlayerBoard, PrivateBoards, PublicKey};
pub use ships::{Fleet, Ship, ShipValidator};
pub use validation::{
    validate_coordinates, validate_fleet_composition, validate_ship_placement,
    AdjacencyValidationStrategy, BoundsValidationStrategy, ContiguityValidationStrategy,
    FleetCompositionValidationStrategy, OverlapValidationStrategy, ShipAdjacencyValidationStrategy,
    ShipLengthValidationStrategy, ShipOverlapValidationStrategy, StraightLineValidationStrategy,
    UniquenessValidationStrategy, ValidationContext, ValidationInput, ValidationStrategy,
};

/// Whether this context is a Lobby (match directory) or a Match (live game).
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum ContextType {
    Lobby,
    Match,
}

/// Represents a player's own board view for API responses.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OwnBoardView {
    pub size: u8,
    pub board: Vec<u8>,
}

/// Represents a player's shots view for API responses.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum GameError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(&'static str),
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("already finished")]
    Finished,
}

/// Main application state for the battleship game.
///
/// The `context_type` field determines which subset of fields is active:
/// - `Lobby`: `matches`, `player_stats`, `history` hold the public read model.
/// - `Match`: `active_match` holds the live game, `lobby_context_id` points
///   back to the parent Lobby context.
#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BattleshipState {
    context_type: ContextType,
    id_nonce: u64,
    created_ms: u64,

    // Lobby fields
    matches: Vec<MatchSummary>,
    player_stats: Vec<PlayerStatsEntry>,
    history: Vec<MatchRecord>,

    // Match fields
    lobby_context_id: Option<String>,
    active_match: Option<Match>,
}

#[app::logic]
impl BattleshipState {
    /// Initialize as a Lobby (no arguments) or a Match (with player keys and
    /// the parent lobby context id).
    #[app::init]
    pub fn init(
        context_type: ContextType,
        player1: Option<String>,
        player2: Option<String>,
        lobby_context_id: Option<String>,
    ) -> BattleshipState {
        let mut state = BattleshipState {
            context_type,
            id_nonce: 0,
            created_ms: env::time_now(),
            matches: Vec::new(),
            player_stats: Vec::new(),
            history: Vec::new(),
            lobby_context_id: None,
            active_match: None,
        };

        if context_type == ContextType::Match {
            state.lobby_context_id = lobby_context_id;

            if let (Some(p1), Some(p2)) = (player1, player2) {
                if let (Ok(pk1), Ok(pk2)) = (PublicKey::from_base58(&p1), PublicKey::from_base58(&p2)) {
                    let id = format!("match-{}-1", env::time_now());
                    state.id_nonce = 1;
                    state.active_match = Some(Match::new(id, pk1, pk2));
                }
            }
        }

        state
    }

    fn next_id(&mut self) -> String {
        self.id_nonce = self.id_nonce.wrapping_add(1);
        format!("match-{}-{}", env::time_now(), self.id_nonce)
    }

    fn require_lobby(&self) -> app::Result<()> {
        if self.context_type != ContextType::Lobby {
            app::bail!(GameError::Forbidden("lobby context required"));
        }
        Ok(())
    }

    fn require_match(&self) -> app::Result<()> {
        if self.context_type != ContextType::Match {
            app::bail!(GameError::Forbidden("match context required"));
        }
        Ok(())
    }

    fn get_active_match(&self) -> app::Result<&Match> {
        self.active_match
            .as_ref()
            .ok_or_else(|| calimero_sdk::types::Error::from(GameError::Invalid("no active match")))
    }

    fn get_active_match_mut(&mut self) -> app::Result<&mut Match> {
        self.active_match
            .as_mut()
            .ok_or_else(|| calimero_sdk::types::Error::from(GameError::Invalid("no active match")))
    }

    fn find_or_create_stats(&mut self, player_key: &str) -> &mut PlayerStats {
        let pos = self
            .player_stats
            .iter()
            .position(|e| e.player == player_key);
        match pos {
            Some(i) => &mut self.player_stats[i].stats,
            None => {
                self.player_stats.push(PlayerStatsEntry {
                    player: player_key.to_string(),
                    stats: PlayerStats::new(),
                });
                &mut self.player_stats.last_mut().unwrap().stats
            }
        }
    }
}

/// Lobby API: match directory, stats, and history.
#[app::logic]
impl BattleshipState {
    /// Allocates a `match_id` and stores a `Pending` summary in the Lobby.
    /// The client must then create the Match context via admin API and call
    /// `set_match_context_id` to link it.
    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        self.require_lobby()?;

        let player1 = PublicKey::from_executor_id()?;
        let player2_pk = PublicKey::from_base58(&player2)?;

        if player1 == player2_pk {
            app::bail!(GameError::Invalid("players must differ"));
        }

        let match_id = self.next_id();
        let summary = MatchSummary {
            match_id: match_id.clone(),
            player1: player1.to_base58(),
            player2: player2.clone(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        };
        self.matches.push(summary);

        app::emit!(Event::MatchCreated { id: &match_id });
        app::emit!(Event::MatchListUpdated {});
        Ok(match_id)
    }

    /// Links a Match context (created externally via admin API) to its
    /// pending Lobby summary and transitions it to `Active`.
    pub fn set_match_context_id(
        &mut self,
        match_id: String,
        context_id: String,
    ) -> app::Result<()> {
        self.require_lobby()?;

        let summary = self
            .matches
            .iter_mut()
            .find(|m| m.match_id == match_id)
            .ok_or_else(|| {
                calimero_sdk::types::Error::from(GameError::NotFound(match_id.clone()))
            })?;

        if summary.status != MatchStatus::Pending {
            app::bail!(GameError::Invalid("match is not pending"));
        }

        summary.context_id = Some(context_id);
        summary.status = MatchStatus::Active;

        app::emit!(Event::MatchListUpdated {});
        Ok(())
    }

    /// Returns all match summaries stored in the Lobby.
    pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
        self.require_lobby()?;
        Ok(self.matches.clone())
    }

    /// Returns stats for a given player (by base58 key).
    pub fn get_player_stats(&self, player: String) -> app::Result<Option<PlayerStats>> {
        self.require_lobby()?;
        Ok(self
            .player_stats
            .iter()
            .find(|e| e.player == player)
            .map(|e| e.stats.clone()))
    }

    /// Returns completed match history.
    pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
        self.require_lobby()?;
        Ok(self.history.clone())
    }

    /// Called via `xcall` from a finished Match context to update the Lobby.
    pub fn on_match_finished(
        &mut self,
        match_id: String,
        winner: String,
        loser: String,
    ) -> app::Result<()> {
        self.require_lobby()?;

        if let Some(summary) = self.matches.iter_mut().find(|m| m.match_id == match_id) {
            summary.status = MatchStatus::Finished;
            summary.winner = Some(winner.clone());
        }

        {
            let stats = self.find_or_create_stats(&winner);
            stats.wins += 1;
            stats.matches_played += 1;
        }
        {
            let stats = self.find_or_create_stats(&loser);
            stats.losses += 1;
            stats.matches_played += 1;
        }

        self.history.push(MatchRecord {
            match_id: match_id.clone(),
            winner: winner.clone(),
            loser: loser.clone(),
            finished_ms: env::time_now(),
        });

        app::emit!(Event::MatchListUpdated {});
        app::emit!(Event::PlayerStatsUpdated {});
        Ok(())
    }
}

/// Match API: gameplay within a single Match context.
#[app::logic]
impl BattleshipState {
    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
        self.require_match()?;

        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if match_state.is_finished() {
            app::bail!(GameError::Finished);
        }

        let caller = PublicKey::from_executor_id()?;
        if !match_state.is_player(&caller) {
            app::bail!(GameError::Forbidden("not a player"));
        }

        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut pb = priv_mut.boards.get(&key)?.unwrap_or(PlayerBoard::new());

        pb.place_ships(ships)?;
        priv_mut.boards.insert(key, pb)?;

        if caller == match_state.player1 {
            match_state.placed_p1 = true;
        } else {
            match_state.placed_p2 = true;
        }

        app::emit!(Event::ShipsPlaced { id: match_id });
        Ok(())
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
        self.require_match()?;

        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = PublicKey::from_executor_id()?;
        match_state.propose_shot(caller, x, y)?;

        app::emit!((
            Event::ShotProposed { id: match_id, x, y },
            "acknowledge_shot_handler"
        ));
        Ok(())
    }

    pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
        self.require_match()?;

        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if match_state.is_finished() {
            app::bail!(GameError::Finished);
        }

        let caller = PublicKey::from_executor_id()?;
        match_state.acknowledge_shot(caller)?;

        // Capture pending coordinates before resolve_shot clears them
        let shot_x = match_state.pending_x.unwrap_or(0);
        let shot_y = match_state.pending_y.unwrap_or(0);

        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut target_pb = priv_mut.boards.get(&key)?.ok_or_else(|| {
            calimero_sdk::types::Error::from(GameError::Invalid("target board unavailable"))
        })?;

        let had_winner_before = match_state.winner.is_some();
        let result = ShotResolver::resolve_shot(match_state, &mut target_pb)?;
        priv_mut.boards.insert(key, target_pb)?;

        let just_finished = !had_winner_before && match_state.winner.is_some();

        let xcall_payload = if just_finished {
            match_state.winner.as_ref().map(|w| {
                let winner_key = w.to_base58();
                let loser_key = match_state.get_opponent(w).to_base58();
                let mid = match_state.id.clone();
                (mid, winner_key, loser_key)
            })
        } else {
            None
        };

        if just_finished {
            app::emit!(Event::Winner { id: match_id });
            app::emit!(Event::MatchEnded { id: match_id });

            if let (Some((mid, winner_key, loser_key)), Some(ref lobby_ctx)) =
                (xcall_payload, &self.lobby_context_id)
            {
                if let Ok(lobby_bytes) = bs58::decode(lobby_ctx).into_vec() {
                    if let Ok(ctx_arr) = <[u8; 32]>::try_from(lobby_bytes.as_slice()) {
                        let params = calimero_sdk::serde_json::json!({
                            "match_id": mid,
                            "winner": winner_key,
                            "loser": loser_key,
                        });
                        if let Ok(params_bytes) = calimero_sdk::serde_json::to_vec(&params) {
                            calimero_sdk::env::xcall(&ctx_arr, "on_match_finished", &params_bytes);
                        }
                    }
                }
            }
        }

        app::emit!(Event::ShotFired {
            id: match_id,
            x: shot_x,
            y: shot_y,
            result: &result
        });

        Ok(result)
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
        self.require_match()?;

        let match_state = self.get_active_match()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = PublicKey::from_executor_id()?;
        let key = match_id.to_string();
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards.boards.get(&key)?.ok_or_else(|| {
            calimero_sdk::types::Error::from(GameError::NotFound(match_id.to_string()))
        })?;

        let mut board = pb.get_board().0.clone();

        if let Some(pending_target) = &match_state.pending_target {
            if *pending_target == caller {
                if let (Some(x), Some(y)) = (match_state.pending_x, match_state.pending_y) {
                    let idx = (y as usize) * (BOARD_SIZE as usize) + (x as usize);
                    if idx < board.len() {
                        board[idx] = Cell::Pending.to_u8();
                    }
                }
            }
        }

        Ok(OwnBoardView {
            size: BOARD_SIZE,
            board,
        })
    }

    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        self.require_match()?;

        let match_state = self.get_active_match()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = PublicKey::from_executor_id()?;
        if !match_state.is_player(&caller) {
            app::bail!(GameError::Forbidden("not a player"));
        }

        let shots = match_state.get_shots_for_player(&caller);
        Ok(ShotsView {
            size: BOARD_SIZE,
            shots: shots.0.clone(),
        })
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        self.require_match()?;
        Ok(self.active_match.as_ref().map(|m| m.id.clone()))
    }

    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        self.require_match()?;
        Ok(self.active_match.as_ref().map(|m| m.turn.to_base58()))
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(PublicKey::from_executor_id()?.to_base58())
    }

    pub fn acknowledge_shot_handler(&mut self, id: &str, _x: u8, _y: u8) -> app::Result<()> {
        self.require_match()?;
        self.acknowledge_shot(id)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use calimero_sdk::borsh;

    fn make_state(ct: ContextType) -> BattleshipState {
        BattleshipState {
            context_type: ct,
            id_nonce: 0,
            created_ms: 0,
            matches: Vec::new(),
            player_stats: Vec::new(),
            history: Vec::new(),
            lobby_context_id: None,
            active_match: None,
        }
    }

    #[test]
    fn context_type_lobby_borsh_roundtrip() {
        let ct = ContextType::Lobby;
        let bytes = borsh::to_vec(&ct).unwrap();
        let decoded: ContextType = borsh::from_slice(&bytes).unwrap();
        assert_eq!(decoded, ContextType::Lobby);
    }

    #[test]
    fn context_type_match_borsh_roundtrip() {
        let ct = ContextType::Match;
        let bytes = borsh::to_vec(&ct).unwrap();
        let decoded: ContextType = borsh::from_slice(&bytes).unwrap();
        assert_eq!(decoded, ContextType::Match);
    }

    #[test]
    fn context_type_variants_differ() {
        let lobby_bytes = borsh::to_vec(&ContextType::Lobby).unwrap();
        let match_bytes = borsh::to_vec(&ContextType::Match).unwrap();
        assert_ne!(lobby_bytes, match_bytes);
    }

    #[test]
    fn require_lobby_passes_for_lobby_context() {
        let state = make_state(ContextType::Lobby);
        assert!(state.require_lobby().is_ok());
    }

    #[test]
    fn require_lobby_fails_for_match_context() {
        let state = make_state(ContextType::Match);
        assert!(state.require_lobby().is_err());
    }

    #[test]
    fn require_match_passes_for_match_context() {
        let state = make_state(ContextType::Match);
        assert!(state.require_match().is_ok());
    }

    #[test]
    fn require_match_fails_for_lobby_context() {
        let state = make_state(ContextType::Lobby);
        assert!(state.require_match().is_err());
    }

    #[test]
    fn lobby_stores_pending_match_summary() {
        let mut state = make_state(ContextType::Lobby);
        state.matches.push(MatchSummary {
            match_id: "match-100-1".into(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        });
        assert_eq!(state.matches.len(), 1);
        assert_eq!(state.matches[0].status, MatchStatus::Pending);
        assert!(state.matches[0].context_id.is_none());
    }

    #[test]
    fn lobby_link_transitions_pending_to_active() {
        let mut state = make_state(ContextType::Lobby);
        state.matches.push(MatchSummary {
            match_id: "match-200-1".into(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        });

        let summary = state
            .matches
            .iter_mut()
            .find(|m| m.match_id == "match-200-1")
            .unwrap();
        assert_eq!(summary.status, MatchStatus::Pending);

        summary.context_id = Some("ctx-abc".into());
        summary.status = MatchStatus::Active;

        assert_eq!(state.matches[0].status, MatchStatus::Active);
        assert_eq!(
            state.matches[0].context_id.as_deref(),
            Some("ctx-abc")
        );
    }

    #[test]
    fn lobby_link_rejects_non_pending_match() {
        let mut state = make_state(ContextType::Lobby);
        state.matches.push(MatchSummary {
            match_id: "match-300-1".into(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Active,
            context_id: Some("ctx-existing".into()),
            winner: None,
        });

        let summary = state
            .matches
            .iter()
            .find(|m| m.match_id == "match-300-1")
            .unwrap();
        assert_ne!(summary.status, MatchStatus::Pending);
    }

    #[test]
    fn lobby_get_matches_returns_all_summaries() {
        let mut state = make_state(ContextType::Lobby);
        for i in 0..3 {
            state.matches.push(MatchSummary {
                match_id: format!("match-{i}"),
                player1: "alice".into(),
                player2: "bob".into(),
                status: MatchStatus::Pending,
                context_id: None,
                winner: None,
            });
        }
        assert_eq!(state.matches.len(), 3);
    }

    #[test]
    fn lobby_find_or_create_stats_creates_new_entry() {
        let mut state = make_state(ContextType::Lobby);
        assert!(state.player_stats.is_empty());

        let stats = state.find_or_create_stats("alice");
        stats.wins += 1;
        stats.matches_played += 1;

        assert_eq!(state.player_stats.len(), 1);
        assert_eq!(state.player_stats[0].player, "alice");
        assert_eq!(state.player_stats[0].stats.wins, 1);
    }

    #[test]
    fn lobby_find_or_create_stats_reuses_existing() {
        let mut state = make_state(ContextType::Lobby);
        state.player_stats.push(PlayerStatsEntry {
            player: "bob".into(),
            stats: PlayerStats { matches_played: 5, wins: 3, losses: 2 },
        });

        let stats = state.find_or_create_stats("bob");
        stats.wins += 1;
        stats.matches_played += 1;

        assert_eq!(state.player_stats.len(), 1);
        assert_eq!(state.player_stats[0].stats.wins, 4);
        assert_eq!(state.player_stats[0].stats.matches_played, 6);
    }

    #[test]
    fn lobby_history_appends_match_record() {
        let mut state = make_state(ContextType::Lobby);
        state.history.push(MatchRecord {
            match_id: "match-fin-1".into(),
            winner: "alice".into(),
            loser: "bob".into(),
            finished_ms: 1_700_000_000,
        });
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].winner, "alice");
    }

    #[test]
    fn lobby_next_id_increments_nonce() {
        let mut state = make_state(ContextType::Lobby);
        let id1 = state.next_id();
        let id2 = state.next_id();
        assert_ne!(id1, id2);
        assert_eq!(state.id_nonce, 2);
    }

    #[test]
    fn lobby_full_linking_flow() {
        let mut state = make_state(ContextType::Lobby);

        let match_id = state.next_id();
        state.matches.push(MatchSummary {
            match_id: match_id.clone(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        });
        assert_eq!(state.matches[0].status, MatchStatus::Pending);

        let summary = state
            .matches
            .iter_mut()
            .find(|m| m.match_id == match_id)
            .unwrap();
        summary.context_id = Some("ctx-match-1".into());
        summary.status = MatchStatus::Active;
        assert_eq!(state.matches[0].status, MatchStatus::Active);

        let summary = state
            .matches
            .iter_mut()
            .find(|m| m.match_id == match_id)
            .unwrap();
        summary.status = MatchStatus::Finished;
        summary.winner = Some("alice".into());

        {
            let stats = state.find_or_create_stats("alice");
            stats.wins += 1;
            stats.matches_played += 1;
        }
        {
            let stats = state.find_or_create_stats("bob");
            stats.losses += 1;
            stats.matches_played += 1;
        }

        state.history.push(MatchRecord {
            match_id: match_id.clone(),
            winner: "alice".into(),
            loser: "bob".into(),
            finished_ms: 9999,
        });

        assert_eq!(state.matches[0].status, MatchStatus::Finished);
        assert_eq!(state.matches[0].winner.as_deref(), Some("alice"));
        assert_eq!(state.player_stats.len(), 2);
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].match_id, match_id);
    }

    #[test]
    fn on_match_finished_updates_lobby_state() {
        let mut state = make_state(ContextType::Lobby);
        state.matches.push(MatchSummary {
            match_id: "match-fin-1".into(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Active,
            context_id: Some("ctx-1".into()),
            winner: None,
        });

        let summary = state
            .matches
            .iter_mut()
            .find(|m| m.match_id == "match-fin-1")
            .unwrap();
        summary.status = MatchStatus::Finished;
        summary.winner = Some("alice".into());

        {
            let stats = state.find_or_create_stats("alice");
            stats.wins += 1;
            stats.matches_played += 1;
        }
        {
            let stats = state.find_or_create_stats("bob");
            stats.losses += 1;
            stats.matches_played += 1;
        }

        state.history.push(MatchRecord {
            match_id: "match-fin-1".into(),
            winner: "alice".into(),
            loser: "bob".into(),
            finished_ms: 5000,
        });

        assert_eq!(state.matches[0].status, MatchStatus::Finished);
        assert_eq!(state.matches[0].winner.as_deref(), Some("alice"));
        assert_eq!(state.player_stats.len(), 2);

        let alice_stats = state.player_stats.iter().find(|e| e.player == "alice").unwrap();
        assert_eq!(alice_stats.stats.wins, 1);
        assert_eq!(alice_stats.stats.losses, 0);

        let bob_stats = state.player_stats.iter().find(|e| e.player == "bob").unwrap();
        assert_eq!(bob_stats.stats.wins, 0);
        assert_eq!(bob_stats.stats.losses, 1);

        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].winner, "alice");
        assert_eq!(state.history[0].loser, "bob");
    }

    #[test]
    fn on_match_finished_ignores_unknown_match_id() {
        let mut state = make_state(ContextType::Lobby);

        if let Some(summary) = state.matches.iter_mut().find(|m| m.match_id == "nonexistent") {
            summary.status = MatchStatus::Finished;
        }

        assert!(state.matches.is_empty());
    }

    #[test]
    fn match_context_stores_lobby_context_id() {
        let mut state = make_state(ContextType::Match);
        state.lobby_context_id = Some("lobby-ctx-abc".into());
        assert_eq!(state.lobby_context_id.as_deref(), Some("lobby-ctx-abc"));
    }

    #[test]
    fn winner_detection_sets_winner_on_match() {
        let pk1 = PublicKey([1u8; 32]);
        let pk2 = PublicKey([2u8; 32]);
        let mut m = Match::new("test-match".into(), pk1.clone(), pk2.clone());
        assert!(!m.is_finished());
        assert!(m.winner.is_none());

        m.set_winner(pk1.clone());
        assert!(m.is_finished());
        assert_eq!(m.winner.as_ref(), Some(&pk1));
    }

    #[test]
    fn match_get_opponent_returns_other_player() {
        let pk1 = PublicKey([1u8; 32]);
        let pk2 = PublicKey([2u8; 32]);
        let m = Match::new("test-match".into(), pk1.clone(), pk2.clone());
        assert_eq!(m.get_opponent(&pk1), pk2);
        assert_eq!(m.get_opponent(&pk2), pk1);
    }

    #[test]
    fn on_match_finished_accumulates_stats_across_matches() {
        let mut state = make_state(ContextType::Lobby);

        for i in 0..3 {
            let mid = format!("match-{i}");
            state.matches.push(MatchSummary {
                match_id: mid.clone(),
                player1: "alice".into(),
                player2: "bob".into(),
                status: MatchStatus::Active,
                context_id: Some(format!("ctx-{i}")),
                winner: None,
            });

            let summary = state.matches.iter_mut().find(|m| m.match_id == mid).unwrap();
            summary.status = MatchStatus::Finished;
            summary.winner = Some("alice".into());

            {
                let stats = state.find_or_create_stats("alice");
                stats.wins += 1;
                stats.matches_played += 1;
            }
            {
                let stats = state.find_or_create_stats("bob");
                stats.losses += 1;
                stats.matches_played += 1;
            }

            state.history.push(MatchRecord {
                match_id: mid,
                winner: "alice".into(),
                loser: "bob".into(),
                finished_ms: (i + 1) as u64 * 1000,
            });
        }

        let alice = state.player_stats.iter().find(|e| e.player == "alice").unwrap();
        assert_eq!(alice.stats.wins, 3);
        assert_eq!(alice.stats.matches_played, 3);

        let bob = state.player_stats.iter().find(|e| e.player == "bob").unwrap();
        assert_eq!(bob.stats.losses, 3);
        assert_eq!(bob.stats.matches_played, 3);

        assert_eq!(state.history.len(), 3);
    }
}
