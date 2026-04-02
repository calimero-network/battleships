//! Lobby data models: match summaries, player stats, and match history.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

/// Lifecycle status of a match as tracked by the Lobby.
///
/// - `Pending` – `match_id` allocated, Match context not yet linked.
/// - `Active`  – Match `context_id` linked, game is playable.
/// - `Finished` – winner recorded, stats and history updated.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum MatchStatus {
    Pending,
    Active,
    Finished,
}

/// Public summary of a match stored in the Lobby.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchSummary {
    pub match_id: String,
    pub player1: String,
    pub player2: String,
    pub status: MatchStatus,
    /// Set once the client links the externally-created Match context.
    pub context_id: Option<String>,
    /// Base58 key of the winner, set when the match finishes.
    pub winner: Option<String>,
}

/// Aggregate win/loss stats for a single player.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStats {
    pub matches_played: u64,
    pub wins: u64,
    pub losses: u64,
}

impl PlayerStats {
    pub fn new() -> Self {
        PlayerStats {
            matches_played: 0,
            wins: 0,
            losses: 0,
        }
    }
}

/// A keyed player stats entry for storage in a flat Vec.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStatsEntry {
    pub player: String,
    pub stats: PlayerStats,
}

/// A completed match record appended to Lobby history.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchRecord {
    pub match_id: String,
    pub winner: String,
    pub loser: String,
    pub finished_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use calimero_sdk::borsh;

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
        assert_eq!(decoded.loser, "bob");
        assert_eq!(decoded.finished_ms, 1_700_000_000);
    }

    #[test]
    fn match_status_borsh_roundtrip() {
        for status in [MatchStatus::Pending, MatchStatus::Active, MatchStatus::Finished] {
            let bytes = borsh::to_vec(&status).unwrap();
            let decoded: MatchStatus = borsh::from_slice(&bytes).unwrap();
            assert_eq!(decoded, status);
        }
    }
}
