//! # Game Module
//!
//! This module contains the core game logic and match management functionality
//! for the battleship game. It handles match creation, turn management, shot
//! processing, and game state transitions.
//!
//! ## Key Types
//!
//! - **`Match`** - Represents a game match between two players
//! - **`ShotResolver`** - Service for resolving shot outcomes
//!
//! ## Game Flow
//!
//! 1. **Match Creation**: Two players create a match
//! 2. **Ship Placement**: Both players place their ships
//! 3. **Turn-based Gameplay**: Players take turns shooting
//! 4. **Shot Resolution**: Shots are resolved and results recorded
//! 5. **Win Condition**: Game ends when all ships are sunk
//!
//! ## Match State
//!
//! Each match tracks:
//! - Player information and turn order
//! - Ship placement status for both players
//! - Pending shots and their resolution
//! - Shot history for both players
//! - Winner determination
//!
//! ## Usage Examples
//!
//! ### Creating a Match
//! ```rust
//! use battleship::game::Match;
//! use battleship::players::PublicKey;
//!
//! let player1 = PublicKey::from_executor_id()?;
//! let player2 = PublicKey::from_base58("player2_key")?;
//! let match_id = "match-123".to_string();
//! let game = Match::new(match_id, player1, player2);
//! ```
//!
//! ### Processing Shots
//! ```rust
//! use battleship::game::ShotResolver;
//!
//! let result = ShotResolver::resolve_shot(&mut match_state, &mut target_board)?;
//! println!("Shot result: {}", result);
//! ```

use crate::board::{Board, Cell, BOARD_SIZE};
use crate::players::{PlayerBoard, PublicKey};
use crate::GameError;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

// ============================================================================
// GAME MODULE - Core game logic and match management
// ============================================================================

/// Represents a game match between two players
///
/// A match contains all the state information for a battleship game, including
/// player information, turn management, shot tracking, and game status. It
/// handles the complete game flow from creation to completion.
///
/// # Fields
/// * `id` - Unique identifier for the match
/// * `player1` - First player's public key
/// * `player2` - Second player's public key
/// * `turn` - Current player whose turn it is
/// * `winner` - Winner of the match (if any)
/// * `placed_p1` - Whether player1 has placed their ships
/// * `placed_p2` - Whether player2 has placed their ships
/// * `pending_x` - X coordinate of pending shot
/// * `pending_y` - Y coordinate of pending shot
/// * `pending_shooter` - Player who fired the pending shot
/// * `pending_target` - Player targeted by the pending shot
/// * `shots_p1` - Player1's shot history board
/// * `shots_p2` - Player2's shot history board
///
/// # Game States
/// - **Setup**: Both players placing ships
/// - **Active**: Turn-based gameplay with shots
/// - **Pending**: Shot fired, waiting for resolution
/// - **Finished**: Game completed with winner
///
/// # Example
/// ```rust
/// use battleship::game::Match;
/// use battleship::players::PublicKey;
///
/// let player1 = PublicKey::from_executor_id()?;
/// let player2 = PublicKey::from_base58("player2_key")?;
/// let match_id = "match-123".to_string();
/// let game = Match::new(match_id, player1, player2);
/// assert_eq!(game.turn, player1);
/// assert!(!game.is_finished());
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Match {
    /// Unique identifier for the match
    pub id: String,
    /// First player's public key
    pub player1: PublicKey,
    /// Second player's public key
    pub player2: PublicKey,
    /// Current player whose turn it is
    pub turn: PublicKey,
    /// Winner of the match (if any)
    pub winner: Option<PublicKey>,
    /// Whether player1 has placed their ships
    pub placed_p1: bool,
    /// Whether player2 has placed their ships
    pub placed_p2: bool,
    /// X coordinate of pending shot
    pub pending_x: Option<u8>,
    /// Y coordinate of pending shot
    pub pending_y: Option<u8>,
    /// Player who fired the pending shot
    pub pending_shooter: Option<PublicKey>,
    /// Player targeted by the pending shot
    pub pending_target: Option<PublicKey>,
    /// Player1's shot history board
    pub shots_p1: Board,
    /// Player2's shot history board
    pub shots_p2: Board,
}

impl Match {
    pub fn new(id: String, player1: PublicKey, player2: PublicKey) -> Match {
        Match {
            id,
            player1: player1.clone(),
            player2: player2.clone(),
            turn: player1,
            winner: None,
            placed_p1: false,
            placed_p2: false,
            pending_x: None,
            pending_y: None,
            pending_shooter: None,
            pending_target: None,
            shots_p1: Board::new_zeroed(BOARD_SIZE),
            shots_p2: Board::new_zeroed(BOARD_SIZE),
        }
    }

    pub fn is_player(&self, player: &PublicKey) -> bool {
        *player == self.player1 || *player == self.player2
    }

    pub fn get_opponent(&self, player: &PublicKey) -> PublicKey {
        if *player == self.player1 {
            self.player2.clone()
        } else {
            self.player1.clone()
        }
    }

    pub fn is_turn(&self, player: &PublicKey) -> bool {
        self.turn == *player
    }

    pub fn switch_turn(&mut self) {
        self.turn = self.get_opponent(&self.turn);
    }

    pub fn is_finished(&self) -> bool {
        self.winner.is_some()
    }

    pub fn both_players_placed(&self) -> bool {
        self.placed_p1 && self.placed_p2
    }

    pub fn has_pending_shot(&self) -> bool {
        self.pending_x.is_some()
    }

    pub fn propose_shot(&mut self, shooter: PublicKey, x: u8, y: u8) -> Result<(), GameError> {
        if self.is_finished() {
            return Err(GameError::Finished);
        }
        if !self.both_players_placed() {
            return Err(GameError::Invalid("both players must place ships first"));
        }
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            return Err(GameError::Invalid("out of bounds"));
        }
        if self.has_pending_shot() {
            return Err(GameError::Invalid("shot already pending"));
        }
        if !self.is_player(&shooter) {
            return Err(GameError::Forbidden("not a player"));
        }
        if !self.is_turn(&shooter) {
            return Err(GameError::Forbidden("not your turn"));
        }

        // Record shot in shooter's board
        if shooter == self.player1 {
            self.shots_p1.set(BOARD_SIZE, x, y, Cell::Pending);
        } else {
            self.shots_p2.set(BOARD_SIZE, x, y, Cell::Pending);
        }

        // Set pending shot
        let opponent = self.get_opponent(&shooter);
        self.pending_x = Some(x);
        self.pending_y = Some(y);
        self.pending_shooter = Some(shooter);
        self.pending_target = Some(opponent);

        Ok(())
    }

    pub fn acknowledge_shot(&mut self, target: PublicKey) -> Result<String, GameError> {
        let pending_target = self
            .pending_target
            .as_ref()
            .ok_or_else(|| GameError::Invalid("no pending shot"))?;

        if *pending_target != target {
            return Err(GameError::Forbidden("not the target"));
        }

        // This will be resolved by the shot resolver
        Ok("acknowledged".to_string())
    }

    pub fn resolve_shot(&mut self, is_hit: bool) -> String {
        let x = self.pending_x.take().expect("pending x should exist");
        let y = self.pending_y.take().expect("pending y should exist");
        let shooter = self
            .pending_shooter
            .take()
            .expect("pending shooter should exist");
        self.pending_target = None;

        let result = if is_hit { "hit" } else { "miss" };

        // Update shooter's board with result
        let shot_result = if is_hit { Cell::Hit } else { Cell::Miss };
        if shooter == self.player1 {
            self.shots_p1.set(BOARD_SIZE, x, y, shot_result);
        } else {
            self.shots_p2.set(BOARD_SIZE, x, y, shot_result);
        }

        // Switch turns if no winner
        if self.winner.is_none() {
            self.switch_turn();
        }

        result.to_string()
    }

    pub fn set_winner(&mut self, winner: PublicKey) {
        self.winner = Some(winner);
    }

    pub fn get_shots_for_player(&self, player: &PublicKey) -> &Board {
        if *player == self.player1 {
            &self.shots_p1
        } else {
            &self.shots_p2
        }
    }
}

// ============================================================================
// SHOT RESOLVER SERVICE
// ============================================================================

/// Service for resolving shot outcomes in the game
///
/// The ShotResolver handles the logic for determining whether a shot hits or
/// misses, updating the target board accordingly, and managing win conditions.
/// It's responsible for the core game mechanics of shot resolution.
///
/// # Shot Resolution Process
/// 1. Extract pending shot coordinates and shooter information
/// 2. Check if the shot hits a ship on the target board
/// 3. Update the target board with hit/miss result
/// 4. Decrement ship count if hit
/// 5. Set winner if all ships are sunk
/// 6. Update match state with shot result
///
/// # Example
/// ```rust
/// use battleship::game::ShotResolver;
///
/// let result = ShotResolver::resolve_shot(&mut match_state, &mut target_board)?;
/// match result.as_str() {
///     "hit" => println!("Shot hit!"),
///     "miss" => println!("Shot missed!"),
///     _ => unreachable!(),
/// }
/// ```
pub struct ShotResolver;

impl ShotResolver {
    pub fn resolve_shot(
        match_state: &mut Match,
        target_board: &mut PlayerBoard,
    ) -> Result<String, GameError> {
        let x = match_state
            .pending_x
            .ok_or_else(|| GameError::Invalid("no pending shot"))?;
        let y = match_state
            .pending_y
            .ok_or_else(|| GameError::Invalid("no pending shot"))?;
        let shooter = match_state
            .pending_shooter
            .as_ref()
            .ok_or_else(|| GameError::Invalid("no pending shot"))?;

        let cur = target_board.get_board().get(BOARD_SIZE, x, y);
        let is_hit = matches!(cur, Cell::Ship);

        if is_hit {
            target_board
                .get_board_mut()
                .set(BOARD_SIZE, x, y, Cell::Hit);
            target_board.decrement_ships();

            if target_board.get_ship_count() == 0 {
                match_state.set_winner(shooter.clone());
            }
        } else {
            target_board
                .get_board_mut()
                .set(BOARD_SIZE, x, y, Cell::Miss);
        }

        Ok(match_state.resolve_shot(is_hit))
    }
}

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

// GameError is now defined in lib.rs for ABI compatibility
