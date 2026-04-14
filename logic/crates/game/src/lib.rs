//! Game service — live match gameplay with private boards.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::collections::{LwwRegister, UnorderedMap, UserStorage};

pub mod board;
pub mod events;
pub mod game;
pub mod players;
pub mod ships;
pub mod validation;

use board::Cell;
use events::Event;

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OwnBoardView {
    pub size: u8,
    pub board: Vec<u8>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

/// Pending-shot record — small value living in an `LwwRegister`.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PendingShot {
    pub x: u8,
    pub y: u8,
    pub shooter: PublicKey,
    pub target: PublicKey,
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
// Game state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct GameState {
    pub lobby_context_id: LwwRegister<Option<String>>,
    pub match_id: LwwRegister<Option<String>>,
    pub player1: LwwRegister<Option<PublicKey>>,
    pub player2: LwwRegister<Option<PublicKey>>,
    pub turn: LwwRegister<Option<PublicKey>>,
    pub winner: LwwRegister<Option<PublicKey>>,
    pub placed_p1: LwwRegister<bool>,
    pub placed_p2: LwwRegister<bool>,
    pub pending: LwwRegister<Option<PendingShot>>,
    /// key = `[y * 10 + x]`, value = Cell as u8 wrapped in LwwRegister (u8 itself is not Mergeable).
    /// A shot cell may transition Pending -> Hit/Miss, so LWW is correct: the ack always
    /// has a later HLC timestamp than the proposal.
    pub shots_p1: UnorderedMap<[u8; 1], LwwRegister<u8>>,
    pub shots_p2: UnorderedMap<[u8; 1], LwwRegister<u8>>,
    /// SHA256 commitment published by each player at placement time.
    /// `LwwRegister` wrapper provides the `Mergeable` impl that `UserStorage` requires;
    /// write-once semantics are enforced at the call site (`AlreadyCommitted`).
    pub commitments: UserStorage<LwwRegister<[u8; 32]>>,
}

#[app::logic]
impl GameState {
    #[app::init]
    pub fn init(
        _player1: String,
        _player2: String,
        _lobby_context_id: Option<String>,
    ) -> GameState {
        // Full CRDT-shaped init lands in Task 7 (place_ships + init rewrite).
        // For now, construct an empty skeleton so the #[app::state] macro
        // plumbing compiles against the new field layout.
        GameState {
            lobby_context_id: LwwRegister::new(None),
            match_id: LwwRegister::new(None),
            player1: LwwRegister::new(None),
            player2: LwwRegister::new(None),
            turn: LwwRegister::new(None),
            winner: LwwRegister::new(None),
            placed_p1: LwwRegister::new(false),
            placed_p2: LwwRegister::new(false),
            pending: LwwRegister::new(None),
            shots_p1: UnorderedMap::new_with_field_name("game:shots_p1"),
            shots_p2: UnorderedMap::new_with_field_name("game:shots_p2"),
            commitments: UserStorage::new_with_field_name("game:commitments"),
        }
    }

    // ---- Game API ----

    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
        let _ = (match_id, ships);
        todo!("task 7: place_ships with SHA256 commitment scheme")
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
        let _ = (match_id, x, y);
        todo!("task 8: propose_shot writes to shot UnorderedMap + pending LwwRegister")
    }

    pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
        let _ = match_id;
        todo!("task 10: acknowledge_shot + inline audit on winning shot")
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
        let _ = match_id;
        todo!("task 7: get_own_board reads PrivateBoards + overlays pending Cell")
    }

    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let _ = match_id;
        todo!("task 8: get_shots serializes the caller's shot UnorderedMap to a flat Vec")
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        Ok(self.match_id.get().clone())
    }

    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        Ok(self.turn.get().as_ref().map(|pk| pk.to_base58()))
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(from_executor_id()?.to_base58())
    }

    #[allow(unused_variables)]
    pub fn acknowledge_shot_handler(&mut self, id: &str, x: u8, y: u8) -> app::Result<()> {
        self.acknowledge_shot(id)?;
        Ok(())
    }
}

/// Helper used by the audit routine (Task 9) and commitment bootstrapping (Task 7).
pub fn is_ship_cell(value: u8) -> bool {
    Cell::from_u8(value) == Cell::Ship
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_ship_cell_identifies_ship_sentinel() {
        assert!(is_ship_cell(Cell::Ship.to_u8()));
        assert!(!is_ship_cell(Cell::Empty.to_u8()));
        assert!(!is_ship_cell(Cell::Hit.to_u8()));
        assert!(!is_ship_cell(Cell::Miss.to_u8()));
        assert!(!is_ship_cell(Cell::Pending.to_u8()));
    }

    #[test]
    fn game_state_skeleton_fields_are_empty() {
        let state = GameState::init("".into(), "".into(), None);
        assert!(state.lobby_context_id.get().is_none());
        assert!(state.match_id.get().is_none());
        assert!(state.player1.get().is_none());
        assert!(state.winner.get().is_none());
        assert!(!(*state.placed_p1.get()));
        assert!(!(*state.placed_p2.get()));
        assert!(state.pending.get().is_none());
    }
}
