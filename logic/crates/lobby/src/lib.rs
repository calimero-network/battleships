//! Lobby service — match directory, player stats, and history.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::env;

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
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStats {
    pub matches_played: u64,
    pub wins: u64,
    pub losses: u64,
}

impl Default for PlayerStats {
    fn default() -> PlayerStats {
        PlayerStats::new()
    }
}

impl PlayerStats {
    pub fn new() -> PlayerStats {
        PlayerStats {
            matches_played: 0,
            wins: 0,
            losses: 0,
        }
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStatsEntry {
    pub player: String,
    pub stats: PlayerStats,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn from_executor_id() -> Result<PublicKey, GameError> {
    let v = calimero_sdk::env::executor_id();
    if v.len() != 32 {
        return Err(GameError::Invalid("executor id length"));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&v);
    Ok(PublicKey(arr))
}

// ---------------------------------------------------------------------------
// Lobby state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct LobbyState {
    id_nonce: u64,
    created_ms: u64,
    matches: Vec<MatchSummary>,
    player_stats: Vec<PlayerStatsEntry>,
    history: Vec<MatchRecord>,
}

#[app::logic]
impl LobbyState {
    #[app::init]
    pub fn init() -> LobbyState {
        LobbyState {
            id_nonce: 0,
            created_ms: env::time_now(),
            matches: Vec::new(),
            player_stats: Vec::new(),
            history: Vec::new(),
        }
    }

    fn next_id(&mut self) -> String {
        self.id_nonce = self.id_nonce.wrapping_add(1);
        format!("match-{}-{}", env::time_now(), self.id_nonce)
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

    // ---- Lobby API ----

    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        let player1 = from_executor_id()?;
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

    pub fn set_match_context_id(
        &mut self,
        match_id: String,
        context_id: String,
    ) -> app::Result<()> {
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

    pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
        Ok(self.matches.clone())
    }

    pub fn get_player_stats(&self, player: String) -> app::Result<Option<PlayerStats>> {
        Ok(self
            .player_stats
            .iter()
            .find(|e| e.player == player)
            .map(|e| e.stats.clone()))
    }

    pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
        Ok(self.history.clone())
    }

    pub fn on_match_finished(
        &mut self,
        match_id: String,
        winner: String,
        loser: String,
    ) -> app::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use calimero_sdk::borsh;

    fn make_lobby() -> LobbyState {
        LobbyState {
            id_nonce: 0,
            created_ms: 0,
            matches: Vec::new(),
            player_stats: Vec::new(),
            history: Vec::new(),
        }
    }

    #[test]
    fn player_stats_new_is_zeroed() {
        let stats = PlayerStats::new();
        assert_eq!(stats.matches_played, 0);
        assert_eq!(stats.wins, 0);
        assert_eq!(stats.losses, 0);
    }

    #[test]
    fn match_summary_borsh_roundtrip() {
        let summary = MatchSummary {
            match_id: "match-1".into(),
            player1: "p1".into(),
            player2: "p2".into(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        };
        let bytes = borsh::to_vec(&summary).unwrap();
        let decoded: MatchSummary = borsh::from_slice(&bytes).unwrap();
        assert_eq!(decoded.match_id, "match-1");
        assert_eq!(decoded.status, MatchStatus::Pending);
    }

    #[test]
    fn match_record_borsh_roundtrip() {
        let record = MatchRecord {
            match_id: "match-42".into(),
            winner: "alice".into(),
            loser: "bob".into(),
            finished_ms: 1_700_000_000,
        };
        let bytes = borsh::to_vec(&record).unwrap();
        let decoded: MatchRecord = borsh::from_slice(&bytes).unwrap();
        assert_eq!(decoded.match_id, "match-42");
        assert_eq!(decoded.winner, "alice");
    }

    #[test]
    fn match_status_borsh_roundtrip() {
        for status in [MatchStatus::Pending, MatchStatus::Active, MatchStatus::Finished] {
            let bytes = borsh::to_vec(&status).unwrap();
            let decoded: MatchStatus = borsh::from_slice(&bytes).unwrap();
            assert_eq!(decoded, status);
        }
    }

    #[test]
    fn lobby_stores_pending_match_summary() {
        let mut state = make_lobby();
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
    }

    #[test]
    fn lobby_link_transitions_pending_to_active() {
        let mut state = make_lobby();
        state.matches.push(MatchSummary {
            match_id: "match-200-1".into(),
            player1: "alice".into(),
            player2: "bob".into(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
        });
        let summary = state.matches.iter_mut().find(|m| m.match_id == "match-200-1").unwrap();
        summary.context_id = Some("ctx-abc".into());
        summary.status = MatchStatus::Active;
        assert_eq!(state.matches[0].status, MatchStatus::Active);
    }

    #[test]
    fn lobby_get_matches_returns_all_summaries() {
        let mut state = make_lobby();
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
        let mut state = make_lobby();
        assert!(state.player_stats.is_empty());
        let stats = state.find_or_create_stats("alice");
        stats.wins += 1;
        stats.matches_played += 1;
        assert_eq!(state.player_stats.len(), 1);
        assert_eq!(state.player_stats[0].stats.wins, 1);
    }

    #[test]
    fn lobby_find_or_create_stats_reuses_existing() {
        let mut state = make_lobby();
        state.player_stats.push(PlayerStatsEntry {
            player: "bob".into(),
            stats: PlayerStats { matches_played: 5, wins: 3, losses: 2 },
        });
        let stats = state.find_or_create_stats("bob");
        stats.wins += 1;
        assert_eq!(state.player_stats.len(), 1);
        assert_eq!(state.player_stats[0].stats.wins, 4);
    }

    #[test]
    fn lobby_next_id_increments_nonce() {
        let mut state = make_lobby();
        let id1 = state.next_id();
        let id2 = state.next_id();
        assert_ne!(id1, id2);
        assert_eq!(state.id_nonce, 2);
    }

    #[test]
    fn lobby_history_appends_match_record() {
        let mut state = make_lobby();
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
    fn on_match_finished_accumulates_stats() {
        let mut state = make_lobby();
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
        let bob = state.player_stats.iter().find(|e| e.player == "bob").unwrap();
        assert_eq!(bob.stats.losses, 3);
        assert_eq!(state.history.len(), 3);
    }
}
