//! Lobby service — match directory, player stats, and history.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{Counter, LwwRegister, Mergeable, UnorderedMap, Vector};
use calimero_storage::env as storage_env;
use calimero_storage_macros::Mergeable;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Lobby data models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum MatchStatus {
    Pending,
    Active,
    Finished,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchSummary {
    pub match_id: String,
    pub player1: String,
    pub player2: String,
    pub status: MatchStatus,
    pub context_id: Option<String>,
    pub winner: Option<String>,
    pub created_ms: u64,
}

impl Mergeable for MatchSummary {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // MatchSummary transitions are single-writer-per-stage in practice
        // (Pending -> Active -> Finished). Fall back to a deterministic
        // "Finished beats Active beats Pending" ordering if two replicas
        // disagree, with `winner` and `context_id` carried along.
        fn rank(s: &MatchStatus) -> u8 {
            match s {
                MatchStatus::Pending => 0,
                MatchStatus::Active => 1,
                MatchStatus::Finished => 2,
            }
        }
        if rank(&other.status) > rank(&self.status) {
            *self = other.clone();
        } else if rank(&other.status) == rank(&self.status) {
            // Same stage — prefer side that has more info filled in.
            if self.context_id.is_none() && other.context_id.is_some() {
                self.context_id = other.context_id.clone();
            }
            if self.winner.is_none() && other.winner.is_some() {
                self.winner = other.winner.clone();
            }
        }
        Ok(())
    }
}

#[derive(Mergeable, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PlayerStats {
    pub wins: Counter,
    pub losses: Counter,
    // games_played is intentionally NOT stored — it's `wins + losses` by
    // construction (every match increments exactly one), so deriving it in
    // `to_view` removes a "can these drift?" question from the data model.
}

impl PlayerStats {
    // pub(crate) so the wasm-abi emitter — which scans every `pub fn` in the
    // crate — does NOT expose this as a Calimero method on LobbyClient.
    pub(crate) fn new(player_key: &str) -> PlayerStats {
        PlayerStats {
            wins: Counter::new_with_field_name(&format!("stats:{player_key}:wins")),
            losses: Counter::new_with_field_name(&format!("stats:{player_key}:losses")),
        }
    }

    pub(crate) fn to_view(&self) -> Result<PlayerStatsView, GameError> {
        let wins = self
            .wins
            .value_unsigned()
            .map_err(|e| GameError::Invalid(format!("wins read: {e}")))?;
        let losses = self
            .losses
            .value_unsigned()
            .map_err(|e| GameError::Invalid(format!("losses read: {e}")))?;
        Ok(PlayerStatsView {
            wins,
            losses,
            games_played: wins.saturating_add(losses),
        })
    }
}

/// Flat snapshot of a player's stats — what consumers see over the wire.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStatsView {
    pub wins: u64,
    pub losses: u64,
    pub games_played: u64,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchRecord {
    pub match_id: String,
    pub winner: String,
    pub loser: String,
    pub finished_ms: u64,
}

impl Mergeable for MatchRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // History records are append-only and immutable per match, so any two
        // replicas agreeing on `match_id` already agree on the rest. Use the
        // later `finished_ms` as a deterministic tiebreaker just in case.
        if other.finished_ms > self.finished_ms {
            *self = other.clone();
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn from_executor_id() -> Result<PublicKey, GameError> {
    let v = calimero_sdk::env::executor_id();
    if v.len() != 32 {
        return Err(GameError::Invalid("executor id length".into()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&v);
    Ok(PublicKey(arr))
}

// ---------------------------------------------------------------------------
// Lobby state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct LobbyState {
    created_ms: LwwRegister<u64>,
    matches: UnorderedMap<String, MatchSummary>,
    player_stats: UnorderedMap<String, PlayerStats>,
    history: Vector<MatchRecord>,
}

#[app::logic]
impl LobbyState {
    #[app::init]
    pub fn init() -> LobbyState {
        LobbyState {
            created_ms: LwwRegister::new(storage_env::time_now()),
            matches: UnorderedMap::new_with_field_name("lobby:matches"),
            player_stats: UnorderedMap::new_with_field_name("lobby:player_stats"),
            history: Vector::new_with_field_name("lobby:history"),
        }
    }

    // ---- Lobby API ----

    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        let caller = from_executor_id().map_err(|e| AppError::msg(e.to_string()))?;
        let caller_b58 = caller.to_base58();
        let now = storage_env::time_now();
        let mut nonce_bytes = [0u8; 4];
        calimero_sdk::env::random_bytes(&mut nonce_bytes);
        let nonce_hex = nonce_bytes
            .iter()
            .fold(String::with_capacity(8), |mut acc, b| {
                acc.push_str(&format!("{:02x}", b));
                acc
            });
        let id = self
            .create_match_with_id(&caller_b58, &player2, now, &nonce_hex)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchCreated { id: &id });
        app::emit!(Event::MatchListUpdated {});
        Ok(id)
    }

    /// Testable inner: deterministic given an explicit nonce, no event emits.
    /// The match_id is `{creator_b58}-{ts}-{nonce_hex}`. The 32-bit nonce
    /// makes a same-(creator, ts) collision astronomically unlikely; we still
    /// reject one if it ever happens (defensive — random-bytes giving the
    /// same 4 bytes twice is a hardware fault, not a runtime concern).
    pub(crate) fn create_match_with_id(
        &mut self,
        caller_b58: &str,
        player2_b58: &str,
        now_ms: u64,
        nonce_hex: &str,
    ) -> Result<String, GameError> {
        // Reject self-matches: the turn protocol assumes two distinct players.
        if caller_b58 == player2_b58 {
            return Err(GameError::Invalid(
                "cannot create match against self".into(),
            ));
        }
        // Reject malformed player2 keys early so the game context can validate
        // its caller against a real key.
        PublicKey::from_base58(player2_b58)
            .map_err(|e| GameError::Invalid(format!("player2 is not a valid base58 key: {e}")))?;
        let match_id = format!("{caller_b58}-{now_ms}-{nonce_hex}");
        let collides = self
            .matches
            .contains(&match_id)
            .map_err(|e| GameError::Invalid(format!("matches.contains failed: {e}")))?;
        if collides {
            return Err(GameError::MatchIdCollision);
        }
        let summary = MatchSummary {
            match_id: match_id.clone(),
            player1: caller_b58.to_string(),
            player2: player2_b58.to_string(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
            created_ms: now_ms,
        };
        self.matches
            .insert(match_id.clone(), summary)
            .map_err(|e| GameError::Invalid(format!("matches.insert failed: {e}")))?;
        Ok(match_id)
    }

    pub fn set_match_context_id(
        &mut self,
        match_id: String,
        context_id: String,
    ) -> app::Result<()> {
        self.set_match_context_id_inner(&match_id, &context_id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchListUpdated {});
        Ok(())
    }

    pub(crate) fn set_match_context_id_inner(
        &mut self,
        match_id: &str,
        context_id: &str,
    ) -> Result<(), GameError> {
        let mut summary = self
            .matches
            .get(&match_id.to_string())
            .map_err(|e| GameError::Invalid(format!("matches.get failed: {e}")))?
            .ok_or(GameError::Invalid("unknown match_id".into()))?;
        // Only allow the Pending -> Active transition. Re-linking an Active
        // match silently is redundant; reactivating a Finished match would
        // corrupt history.
        if summary.status != MatchStatus::Pending {
            return Err(GameError::Invalid("match not in Pending state".into()));
        }
        summary.status = MatchStatus::Active;
        summary.context_id = Some(context_id.to_string());
        self.matches
            .insert(match_id.to_string(), summary)
            .map_err(|e| GameError::Invalid(format!("matches.insert failed: {e}")))?;
        Ok(())
    }

    pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
        let entries = self
            .matches
            .entries()
            .map_err(|e| AppError::msg(format!("matches.entries: {e}")))?;
        Ok(entries.map(|(_, v)| v).collect())
    }

    pub fn get_player_stats(&self, player: String) -> app::Result<Option<PlayerStatsView>> {
        let stats = self
            .player_stats
            .get(&player)
            .map_err(|e| AppError::msg(format!("player_stats.get: {e}")))?;
        match stats {
            Some(s) => Ok(Some(s.to_view().map_err(|e| AppError::msg(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
        let iter = self
            .history
            .iter()
            .map_err(|e| AppError::msg(format!("history.iter: {e}")))?;
        Ok(iter.collect())
    }

    pub fn on_match_finished(
        &mut self,
        match_id: String,
        winner: String,
        loser: String,
    ) -> app::Result<()> {
        let now = storage_env::time_now();
        self.on_match_finished_inner(&match_id, &winner, &loser, now)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchListUpdated {});
        app::emit!(Event::PlayerStatsUpdated {});
        Ok(())
    }

    pub(crate) fn on_match_finished_inner(
        &mut self,
        match_id: &str,
        winner: &str,
        loser: &str,
        finished_ms: u64,
    ) -> Result<(), GameError> {
        // Direct map lookup. The game context now receives the lobby-issued
        // match_id at init time and echoes it back here, so the
        // resolve-by-context-id fallback the previous version needed is gone.
        let mut summary = self
            .matches
            .get(&match_id.to_string())
            .map_err(|e| GameError::Invalid(format!("matches.get failed: {e}")))?
            .ok_or(GameError::Invalid("unknown match_id".into()))?;
        summary.status = MatchStatus::Finished;
        summary.winner = Some(winner.to_string());
        self.matches
            .insert(match_id.to_string(), summary)
            .map_err(|e| GameError::Invalid(format!("matches.insert failed: {e}")))?;

        self.history
            .push(MatchRecord {
                match_id: match_id.to_string(),
                winner: winner.to_string(),
                loser: loser.to_string(),
                finished_ms,
            })
            .map_err(|e| GameError::Invalid(format!("history.push failed: {e}")))?;

        bump_stats(&mut self.player_stats, winner, true)?;
        bump_stats(&mut self.player_stats, loser, false)?;
        Ok(())
    }
}

fn bump_stats(
    stats_map: &mut UnorderedMap<String, PlayerStats>,
    player_key: &str,
    is_winner: bool,
) -> Result<(), GameError> {
    let mut stats = stats_map
        .get(&player_key.to_string())
        .map_err(|e| GameError::Invalid(format!("stats.get failed: {e}")))?
        .unwrap_or_else(|| PlayerStats::new(player_key));
    if is_winner {
        stats
            .wins
            .increment()
            .map_err(|e| GameError::Invalid(format!("wins.increment failed: {e}")))?;
    } else {
        stats
            .losses
            .increment()
            .map_err(|e| GameError::Invalid(format!("losses.increment failed: {e}")))?;
    }
    stats_map
        .insert(player_key.to_string(), stats)
        .map_err(|e| GameError::Invalid(format!("stats.insert failed: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use battleships_types::GameError;

    #[test]
    fn player_stats_counters_start_at_zero() {
        let stats = PlayerStats::new("alice_b58");
        assert_eq!(stats.wins.value_unsigned().unwrap(), 0);
        assert_eq!(stats.losses.value_unsigned().unwrap(), 0);
        assert_eq!(stats.to_view().unwrap().games_played, 0);
    }

    #[test]
    fn player_stats_increments_accumulate() {
        let mut stats = PlayerStats::new("alice_b58");
        stats.wins.increment().unwrap();
        stats.losses.increment().unwrap();
        stats.losses.increment().unwrap();
        assert_eq!(stats.wins.value_unsigned().unwrap(), 1);
        assert_eq!(stats.losses.value_unsigned().unwrap(), 2);
        // games_played is derived as wins + losses in the view.
        assert_eq!(stats.to_view().unwrap().games_played, 3);
    }

    #[test]
    fn init_populates_created_ms() {
        let state = LobbyState::init();
        assert!(*state.created_ms.get() > 0);
    }

    #[test]
    fn create_match_uses_creator_ts_nonce_id() {
        // The match_id format is `{creator_b58}-{ts}-{nonce_hex}` —
        // creator key + lobby clock + 32-bit random nonce. Player2's key
        // is no longer in the id (the lobby summary keeps it separately).
        let mut state = LobbyState::init();
        let caller_b58 = bs58::encode([1u8; 32]).into_string();
        let player2_b58 = bs58::encode([2u8; 32]).into_string();
        let id = state
            .create_match_with_id(&caller_b58, &player2_b58, 1_700_000_000_000, "deadbeef")
            .unwrap();
        assert_eq!(id, format!("{caller_b58}-1700000000000-deadbeef"));
        assert!(
            !id.contains(&player2_b58),
            "player2 should not be in the match-id"
        );
        let summary = state.matches.get(&id).unwrap().unwrap();
        assert_eq!(summary.player2, player2_b58);
    }

    #[test]
    fn create_match_rejects_nonce_collision_defensive() {
        // Same (creator, ts, nonce_hex) tuple should be rejected. With a
        // 32-bit random nonce in the real path this is astronomically unlikely,
        // but the defensive guard remains.
        let mut state = LobbyState::init();
        let a = bs58::encode([1u8; 32]).into_string();
        let b = bs58::encode([2u8; 32]).into_string();
        let ts = 1_700_000_000_000u64;
        let _ = state.create_match_with_id(&a, &b, ts, "abcd1234").unwrap();
        let err = state
            .create_match_with_id(&a, &b, ts, "abcd1234")
            .unwrap_err();
        assert!(matches!(err, GameError::MatchIdCollision));
    }

    #[test]
    fn set_match_context_id_promotes_to_active() {
        let mut state = LobbyState::init();
        let a = bs58::encode([1u8; 32]).into_string();
        let b = bs58::encode([2u8; 32]).into_string();
        let id = state
            .create_match_with_id(&a, &b, 1_700_000_000_000, "deadbeef")
            .unwrap();
        state.set_match_context_id_inner(&id, "ctx_abc").unwrap();
        let summary = state.matches.get(&id).unwrap().unwrap();
        assert!(matches!(summary.status, MatchStatus::Active));
        assert_eq!(summary.context_id.as_deref(), Some("ctx_abc"));
    }

    #[test]
    fn on_match_finished_records_winner_and_increments_counters() {
        let mut state = LobbyState::init();
        let winner = bs58::encode([1u8; 32]).into_string();
        let loser = bs58::encode([2u8; 32]).into_string();
        let id = state
            .create_match_with_id(&winner, &loser, 1_700_000_000_000, "deadbeef")
            .unwrap();
        state
            .on_match_finished_inner(&id, &winner, &loser, 1_700_000_000_999)
            .unwrap();

        let summary = state.matches.get(&id).unwrap().unwrap();
        assert!(matches!(summary.status, MatchStatus::Finished));
        assert_eq!(summary.winner.as_deref(), Some(winner.as_str()));

        let winner_view = state
            .player_stats
            .get(&winner)
            .unwrap()
            .unwrap()
            .to_view()
            .unwrap();
        assert_eq!(winner_view.wins, 1);
        assert_eq!(winner_view.losses, 0);
        assert_eq!(winner_view.games_played, 1); // derived: 1 + 0

        let loser_view = state
            .player_stats
            .get(&loser)
            .unwrap()
            .unwrap()
            .to_view()
            .unwrap();
        assert_eq!(loser_view.wins, 0);
        assert_eq!(loser_view.losses, 1);
        assert_eq!(loser_view.games_played, 1); // derived: 0 + 1

        assert_eq!(state.history.len().unwrap(), 1);
    }

    #[test]
    fn create_match_rejects_self_match() {
        let mut state = LobbyState::init();
        let a = bs58::encode([1u8; 32]).into_string();
        let err = state
            .create_match_with_id(&a, &a, 1_700_000_000_000, "deadbeef")
            .unwrap_err();
        assert!(matches!(err, GameError::Invalid(_)));
    }

    #[test]
    fn create_match_rejects_non_base58_player2() {
        let mut state = LobbyState::init();
        let a = bs58::encode([1u8; 32]).into_string();
        let err = state
            .create_match_with_id(&a, "!!!not-base58!!!", 1_700_000_000_000, "deadbeef")
            .unwrap_err();
        assert!(matches!(err, GameError::Invalid(_)));
    }

    #[test]
    fn set_match_context_id_rejects_non_pending_transition() {
        let mut state = LobbyState::init();
        let a = bs58::encode([1u8; 32]).into_string();
        let b = bs58::encode([2u8; 32]).into_string();
        let id = state
            .create_match_with_id(&a, &b, 1_700_000_000_000, "deadbeef")
            .unwrap();
        state.set_match_context_id_inner(&id, "ctx_abc").unwrap();
        let err = state
            .set_match_context_id_inner(&id, "ctx_xyz")
            .unwrap_err();
        assert!(matches!(err, GameError::Invalid(_)));
    }

    #[test]
    fn on_match_finished_rejects_unknown_match_id() {
        // The lobby-issued id is now passed into game::init and echoed back
        // in the on_match_finished xcall, so an unknown id is a real error
        // instead of being silently resolved via a context-id reverse scan.
        let mut state = LobbyState::init();
        let winner = bs58::encode([1u8; 32]).into_string();
        let loser = bs58::encode([2u8; 32]).into_string();
        let err = state
            .on_match_finished_inner("does-not-exist", &winner, &loser, 1_700_000_000_999)
            .unwrap_err();
        assert!(matches!(err, GameError::Invalid(_)));
    }

    #[test]
    fn set_match_context_id_rejects_finished_match() {
        let mut state = LobbyState::init();
        let winner = bs58::encode([1u8; 32]).into_string();
        let loser = bs58::encode([2u8; 32]).into_string();
        let id = state
            .create_match_with_id(&winner, &loser, 1_700_000_000_000, "deadbeef")
            .unwrap();
        state
            .on_match_finished_inner(&id, &winner, &loser, 1_700_000_000_999)
            .unwrap();
        let err = state
            .set_match_context_id_inner(&id, "ctx_abc")
            .unwrap_err();
        assert!(matches!(err, GameError::Invalid(_)));
    }
}
