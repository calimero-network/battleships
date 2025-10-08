//! # Players Module
//!
//! This module contains all types and functionality related to player management,
//! player boards, and private data storage in the battleship game.
//!
//! ## Key Types
//!
//! - **`PublicKey`** - Represents a player's public key for identification
//! - **`PlayerBoard`** - Represents a player's private board and ship data
//! - **`PrivateBoards`** - Repository for storing player board data privately
//!
//! ## Player Management
//!
//! Players are identified by their public keys, which are derived from the
//! Calimero executor ID or provided as Base58-encoded strings. Each player
//! has their own private board where they place their ships.
//!
//! ## Private Data Storage
//!
//! Player boards are stored privately using the Calimero SDK's private storage
//! system. This ensures that only the player can see their own ship placements
//! until they are hit by the opponent.
//!
//! ## Usage Examples
//!
//! ### Creating a Public Key
//! ```rust
//! use battleship::players::PublicKey;
//!
//! let key = PublicKey::from_executor_id()?;
//! let encoded = key.to_base58();
//! println!("Player key: {}", encoded);
//! ```
//!
//! ### Managing Player Boards
//! ```rust
//! use battleship::players::PlayerBoard;
//!
//! let mut board = PlayerBoard::new();
//! let ships = vec!["0,0;0,1;0,2".to_string()];
//! board.place_ships(ships)?;
//! assert!(board.is_placed());
//! ```

use crate::board::{Board, Cell, BOARD_SIZE};
use crate::ships::ShipValidator;
use crate::validation::validate_fleet_composition;
use crate::GameError;
use bs58;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::collections::UnorderedMap;

// ============================================================================
// PLAYERS MODULE - Everything related to player management and boards
// ============================================================================

/// Represents a player's public key for identification
///
/// Public keys are used to uniquely identify players in the game. They can be
/// created from the Calimero executor ID or from Base58-encoded strings.
/// The key is stored as a 32-byte array for efficient comparison and storage.
///
/// # Fields
/// * `0` - 32-byte array representing the public key
///
/// # Example
/// ```rust
/// use battleship::players::PublicKey;
///
/// let key = PublicKey::from_executor_id()?;
/// let encoded = key.to_base58();
/// let decoded = PublicKey::from_base58(&encoded)?;
/// assert_eq!(key, decoded);
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    pub fn from_executor_id() -> Result<PublicKey, GameError> {
        let v = calimero_sdk::env::executor_id();
        if v.len() != 32 {
            return Err(GameError::Invalid("executor id length"));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&v);
        Ok(PublicKey(arr))
    }

    pub fn from_base58(encoded: &str) -> Result<PublicKey, GameError> {
        let decoded = bs58::decode(encoded)
            .into_vec()
            .map_err(|_| GameError::Invalid("bad base58 key"))?;
        if decoded.len() != 32 {
            return Err(GameError::Invalid("key length"));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&decoded);
        Ok(PublicKey(arr))
    }

    pub fn to_base58(&self) -> String {
        bs58::encode(&self.0).into_string()
    }
}

/// Represents a player's private board and ship data
///
/// This struct contains all the private information for a player, including
/// their ship placements, board state, and placement status. It's stored
/// privately so only the player can see their own ship locations.
///
/// # Fields
/// * `own` - The player's private board with ship placements
/// * `ships` - Number of ships remaining (decremented when hit)
/// * `placed` - Whether the player has finished placing their ships
///
/// # Privacy
/// This data is stored privately using the Calimero SDK's private storage
/// system, ensuring that only the player can see their ship placements
/// until they are hit by the opponent.
///
/// # Example
/// ```rust
/// use battleship::players::PlayerBoard;
///
/// let mut board = PlayerBoard::new();
/// let ships = vec![
///     "0,0;0,1;0,2".to_string(),
///     "2,0;2,1;2,2;2,3".to_string(),
/// ];
/// board.place_ships(ships)?;
/// assert!(board.is_placed());
/// assert_eq!(board.get_ship_count(), 7); // 3 + 4 ships
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerBoard {
    /// The player's private board with ship placements
    own: Board,
    /// Number of ships remaining (decremented when hit)
    ships: u64,
    /// Whether the player has finished placing their ships
    placed: bool,
}

impl PlayerBoard {
    pub fn new() -> PlayerBoard {
        PlayerBoard {
            own: Board::new_zeroed(BOARD_SIZE),
            ships: 0,
            placed: false,
        }
    }

    pub fn place_ships(&mut self, ships: Vec<String>) -> Result<(), GameError> {
        if self.placed {
            return Err(GameError::Invalid("already placed"));
        }

        let mut ship_counts = [0; 4]; // [2,3,4,5] lengths
        let mut total_ships = 0;
        let mut all_ship_coordinates = Vec::new();

        for group in ships.iter() {
            let coords = ShipValidator::parse_ship_coords(group)?;
            if coords.is_empty() {
                continue;
            }

            let ship_len = coords.len();
            if ship_len < 2 || ship_len > 5 {
                return Err(GameError::Invalid("ship length must be 2-5"));
            }

            let idx = ship_len - 2;
            if idx >= 4 {
                return Err(GameError::Invalid("invalid ship length"));
            }
            ship_counts[idx] += 1;
            total_ships += 1;

            // Store coordinates for fleet validation
            all_ship_coordinates.push(coords.clone());

            ShipValidator::validate_ship_placement(&self.own, BOARD_SIZE, &coords)?;

            // Place the ship
            for coord in coords {
                self.own.set(BOARD_SIZE, coord.x, coord.y, Cell::Ship);
                self.ships = self.ships.saturating_add(1);
            }
        }

        if total_ships == 0 {
            return Err(GameError::Invalid("no ships"));
        }

        // Use validation strategy pattern for fleet composition
        Self::validate_fleet_composition(ship_counts, all_ship_coordinates)?;
        self.placed = true;
        Ok(())
    }

    fn validate_fleet_composition(
        ship_counts: [usize; 4],
        ship_coordinates: Vec<Vec<crate::board::Coordinate>>,
    ) -> Result<(), GameError> {
        // Use the validation strategy pattern
        validate_fleet_composition(ship_counts, ship_coordinates)
    }

    pub fn get_board(&self) -> &Board {
        &self.own
    }

    pub fn get_board_mut(&mut self) -> &mut Board {
        &mut self.own
    }

    pub fn is_placed(&self) -> bool {
        self.placed
    }

    pub fn get_ship_count(&self) -> u64 {
        self.ships
    }

    pub fn decrement_ships(&mut self) {
        if self.ships > 0 {
            self.ships = self.ships.saturating_sub(1);
        }
    }
}

// ============================================================================
// REPOSITORY PATTERN - Data access abstraction
// ============================================================================

#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[calimero_sdk::app::private]
pub struct PrivateBoards {
    pub boards: UnorderedMap<String, PlayerBoard>,
}

impl Default for PrivateBoards {
    fn default() -> PrivateBoards {
        PrivateBoards {
            boards: UnorderedMap::new(),
        }
    }
}

impl PrivateBoards {
    pub fn key(match_id: &str) -> String {
        match_id.to_string()
    }
}
