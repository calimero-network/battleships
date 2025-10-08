//! # Battleship Game Logic
//!
//! This crate implements a complete battleship game using the Calimero SDK.
//! It provides a modular, well-documented implementation following Domain-Driven Design (DDD) principles.
//!
//! ## Architecture Overview
//!
//! The codebase is organized into several modules, each with a specific responsibility:
//!
//! - **`board`** - Board representation, coordinates, and cell types
//! - **`ships`** - Ship definitions, fleet management, and ship validation
//! - **`players`** - Player management and private board logic
//! - **`game`** - Core game logic and match management
//! - **`events`** - Game events and state changes
//! - **`validation`** - Comprehensive validation strategy pattern implementation
//!
//! ## Key Features
//!
//! ### Validation Strategy Pattern
//! The validation system uses a sophisticated Strategy Pattern implementation that provides:
//! - **Extensibility**: Easy to add new validation rules
//! - **Composability**: Mix and match validation strategies
//! - **Testability**: Each strategy can be tested independently
//! - **Maintainability**: Validation logic is organized and separated
//!
//! ### Game Flow
//! 1. **Match Creation**: Players create matches and join them
//! 2. **Ship Placement**: Players place their ships using coordinate strings
//! 3. **Turn-based Gameplay**: Players take turns shooting at opponent boards
//! 4. **Shot Resolution**: Shots are resolved and results are recorded
//! 5. **Win Condition**: Game ends when all ships of one player are sunk
//!
//! ## Usage Examples
//!
//! ### Creating a Match
//! ```rust
//! use battleship::BattleshipState;
//!
//! let mut state = BattleshipState::init();
//! let match_id = state.create_match("player2_base58_key".to_string())?;
//! ```
//!
//! ### Placing Ships
//! ```rust
//! let ships = vec![
//!     "0,0;0,1;0,2".to_string(), // 3-length ship
//!     "2,0;2,1;2,2;2,3".to_string(), // 4-length ship
//!     // ... more ships
//! ];
//! state.place_ships(&match_id, ships)?;
//! ```
//!
//! ### Taking Shots
//! ```rust
//! state.propose_shot(&match_id, 5, 3)?; // Shoot at (5,3)
//! let result = state.acknowledge_shot(&match_id)?; // Resolve the shot
//! ```
//!
//! ## Error Handling
//!
//! The game uses a comprehensive error system with specific error types:
//! - `GameError::NotFound` - Resource not found
//! - `GameError::Invalid` - Invalid input or state
//! - `GameError::Forbidden` - Operation not allowed
//! - `GameError::Finished` - Game has ended
//!
//! ## Documentation
//!
//! For detailed API documentation, run:
//! ```bash
//! cargo doc --open
//! ```

#![allow(clippy::len_without_is_empty)]

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::env;

// ============================================================================
// MODULE DECLARATIONS
// ============================================================================

pub mod board;
pub mod events;
pub mod game;
pub mod players;
pub mod ships;
pub mod validation;

// ============================================================================
// ABI-COMPATIBLE TYPE DEFINITIONS
// ============================================================================

// These types must be defined in lib.rs for ABI compatibility
use calimero_sdk::serde::{Deserialize, Serialize};
use thiserror::Error;

// Re-export types from modules
pub use board::{Board, Cell, Coordinate, BOARD_SIZE};
pub use events::Event;
pub use game::{Match, ShotResolver};
pub use players::{PlayerBoard, PrivateBoards, PublicKey};
pub use ships::{Fleet, Ship, ShipValidator};
pub use validation::{
    validate_coordinates, validate_fleet_composition, validate_ship_placement,
    AdjacencyValidationStrategy, BoundsValidationStrategy, ContiguityValidationStrategy,
    FleetCompositionValidationStrategy, OverlapValidationStrategy, ShipAdjacencyValidationStrategy,
    ShipLengthValidationStrategy, ShipOverlapValidationStrategy, StraightLineValidationStrategy,
    UniquenessValidationStrategy, ValidationContext, ValidationInput, ValidationStrategy,
};

// Define ABI-critical types directly in lib.rs

/// Represents a player's own board view for API responses
///
/// This struct is used to return a player's board state including their ships
/// and any pending shots targeting them. The board is represented as a flat
/// vector of u8 values where each value corresponds to a cell state.
///
/// # Fields
/// * `size` - The board size (always 10 for standard battleship)
/// * `board` - Flat vector representation of the board cells
///
/// # Cell Values
/// * `0` - Empty cell
/// * `1` - Ship cell
/// * `2` - Hit cell
/// * `3` - Miss cell
/// * `4` - Pending shot cell
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OwnBoardView {
    /// The board size (always 10 for standard battleship)
    pub size: u8,
    /// Flat vector representation of the board cells
    pub board: Vec<u8>,
}

/// Represents a player's shots view for API responses
///
/// This struct is used to return a player's shot history, showing where they
/// have fired and the results of those shots. The shots are represented as a
/// flat vector of u8 values where each value corresponds to a cell state.
///
/// # Fields
/// * `size` - The board size (always 10 for standard battleship)
/// * `shots` - Flat vector representation of the shot cells
///
/// # Cell Values
/// * `0` - No shot fired
/// * `2` - Hit shot
/// * `3` - Miss shot
/// * `4` - Pending shot
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    /// The board size (always 10 for standard battleship)
    pub size: u8,
    /// Flat vector representation of the shot cells
    pub shots: Vec<u8>,
}

/// Comprehensive error type for all game operations
///
/// This enum represents all possible errors that can occur during game operations.
/// It uses a tagged representation for JSON serialization, making it easy to
/// handle different error types on the client side.
///
/// # Variants
/// * `NotFound(String)` - Resource not found (e.g., match ID, player)
/// * `Invalid(&'static str)` - Invalid input or state (e.g., invalid coordinates, game rules)
/// * `Forbidden(&'static str)` - Operation not allowed (e.g., not your turn, not a player)
/// * `Finished` - Game has already ended
///
/// # Example
/// ```rust
/// use battleship::GameError;
///
/// match result {
///     Err(GameError::NotFound(id)) => println!("Match {} not found", id),
///     Err(GameError::Invalid(msg)) => println!("Invalid operation: {}", msg),
///     Err(GameError::Forbidden(msg)) => println!("Forbidden: {}", msg),
///     Err(GameError::Finished) => println!("Game has ended"),
///     Ok(_) => println!("Success!"),
/// }
/// ```
#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum GameError {
    /// Resource not found (e.g., match ID, player)
    #[error("not found: {0}")]
    NotFound(String),
    /// Invalid input or state (e.g., invalid coordinates, game rules)
    #[error("invalid input: {0}")]
    Invalid(&'static str),
    /// Operation not allowed (e.g., not your turn, not a player)
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    /// Game has already ended
    #[error("already finished")]
    Finished,
}

// ============================================================================
// APPLICATION STATE
// ============================================================================

/// Main application state for the battleship game
///
/// This struct holds the global state of the battleship game application,
/// including the active match and metadata for ID generation. It implements
/// the Calimero SDK's state management system.
///
/// # Fields
/// * `id_nonce` - Counter for generating unique match IDs
/// * `created_ms` - Timestamp when the state was created
/// * `active_match` - Currently active match (if any)
///
/// # Example
/// ```rust
/// use battleship::BattleshipState;
///
/// let state = BattleshipState::init();
/// let match_id = state.create_match("player2_key".to_string())?;
/// ```
#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BattleshipState {
    /// Counter for generating unique match IDs
    id_nonce: u64,
    /// Timestamp when the state was created
    created_ms: u64,
    /// Currently active match (if any)
    active_match: Option<Match>,
}

#[app::logic]
impl BattleshipState {
    #[app::init]
    pub fn init() -> BattleshipState {
        BattleshipState {
            id_nonce: 0,
            created_ms: env::time_now(),
            active_match: None,
        }
    }

    fn next_id(&mut self) -> String {
        self.id_nonce = self.id_nonce.wrapping_add(1);
        format!("match-{}-{}", env::time_now(), self.id_nonce)
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
}

// ============================================================================
// PUBLIC API - GAME OPERATIONS
// ============================================================================

/// Public API for game operations
///
/// This implementation provides all the public methods for interacting with
/// the battleship game, including match creation, ship placement, and gameplay.
#[app::logic]
impl BattleshipState {
    /// Creates a new match between the current player and another player
    ///
    /// This method creates a new battleship match and sets up the initial
    /// game state. Only one active match is allowed at a time.
    ///
    /// # Arguments
    /// * `player2` - Base58-encoded public key of the second player
    ///
    /// # Returns
    /// * `Ok(String)` - The unique match ID
    /// * `Err(GameError)` - If another match is active or players are the same
    ///
    /// # Example
    /// ```rust
    /// let mut state = BattleshipState::init();
    /// let match_id = state.create_match("player2_base58_key".to_string())?;
    /// println!("Created match: {}", match_id);
    /// ```
    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        if self.active_match.is_some() && !self.get_active_match()?.is_finished() {
            app::bail!(GameError::Invalid("another match is active"));
        }

        let player1 = PublicKey::from_executor_id()?;
        let player2_pk = PublicKey::from_base58(&player2)?;

        if player1 == player2_pk {
            app::bail!(GameError::Invalid("players must differ"));
        }

        let id = self.next_id();
        self.active_match = Some(Match::new(id.clone(), player1, player2_pk));

        app::emit!(Event::MatchCreated { id: &id });
        Ok(id)
    }

    /// Places ships on the current player's board
    ///
    /// This method allows a player to place their fleet of ships on their board.
    /// Ships must follow the standard battleship rules: 1x5, 1x4, 2x3, 1x2 lengths.
    ///
    /// # Arguments
    /// * `match_id` - The ID of the match
    /// * `ships` - Vector of ship coordinate strings in format "x1,y1;x2,y2;..."
    ///
    /// # Returns
    /// * `Ok(())` - Ships placed successfully
    /// * `Err(GameError)` - If match not found, not a player, or invalid ship placement
    ///
    /// # Example
    /// ```rust
    /// let ships = vec![
    ///     "0,0;0,1;0,2".to_string(), // 3-length ship
    ///     "2,0;2,1;2,2;2,3".to_string(), // 4-length ship
    ///     "5,5;5,6".to_string(), // 2-length ship
    /// ];
    /// state.place_ships(&match_id, ships)?;
    /// ```
    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
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

        // Update match state
        if caller == match_state.player1 {
            match_state.placed_p1 = true;
        } else {
            match_state.placed_p2 = true;
        }

        app::emit!(Event::ShipsPlaced { id: match_id });
        Ok(())
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
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
        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if match_state.is_finished() {
            app::bail!(GameError::Finished);
        }

        let caller = PublicKey::from_executor_id()?;
        match_state.acknowledge_shot(caller)?;

        // Resolve the shot
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut target_pb = priv_mut.boards.get(&key)?.ok_or_else(|| {
            calimero_sdk::types::Error::from(GameError::Invalid("target board unavailable"))
        })?;

        let result = ShotResolver::resolve_shot(match_state, &mut target_pb)?;
        priv_mut.boards.insert(key, target_pb)?;

        if match_state.winner.is_some() {
            app::emit!(Event::Winner { id: match_id });
            app::emit!(Event::MatchEnded { id: match_id });
        }

        app::emit!(Event::ShotFired {
            id: match_id,
            x: match_state.pending_x.unwrap_or(0),
            y: match_state.pending_y.unwrap_or(0),
            result: &result
        });

        Ok(result)
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
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

        // Add pending shot if targeting this player
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

    pub fn get_matches(&self) -> app::Result<Vec<String>> {
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let ids: Vec<String> = priv_boards.boards.entries()?.map(|(k, _)| k).collect();
        Ok(ids)
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        Ok(self.active_match.as_ref().map(|m| m.id.clone()))
    }

    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        Ok(self.active_match.as_ref().map(|m| m.turn.to_base58()))
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(PublicKey::from_executor_id()?.to_base58())
    }

    // Handlers must have the same parameters as the events they are emitting for now
    // (same name, same number of parameters, same types)
    pub fn acknowledge_shot_handler(&mut self, id: &str, x: u8, y: u8) -> app::Result<()> {
        self.acknowledge_shot(id)?;
        Ok(())
    }
}
