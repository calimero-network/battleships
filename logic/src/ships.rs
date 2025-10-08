//! # Ships Module
//!
//! This module contains all types and functionality related to ships, fleets,
//! and ship validation in the battleship game.
//!
//! ## Key Types
//!
//! - **`Ship`** - Represents a single ship with coordinates and length
//! - **`Fleet`** - Represents a collection of ships for a player
//! - **`ShipValidator`** - Service for validating ship placement and parsing
//!
//! ## Ship Rules
//!
//! Ships must follow these rules:
//! - Length between 2 and 5 cells
//! - Must be straight (horizontal or vertical)
//! - Must be contiguous (no gaps)
//! - Cannot overlap with other ships
//! - Cannot be adjacent to other ships
//!
//! ## Fleet Composition
//!
//! Standard battleship fleet:
//! - 1 ship of length 5 (carrier)
//! - 1 ship of length 4 (battleship)
//! - 2 ships of length 3 (cruiser, submarine)
//! - 1 ship of length 2 (destroyer)
//!
//! ## Usage Examples
//!
//! ### Creating a Ship
//! ```rust
//! use battleship::board::Coordinate;
//! use battleship::ships::Ship;
//!
//! let coords = vec![
//!     Coordinate::new(0, 0).unwrap(),
//!     Coordinate::new(0, 1).unwrap(),
//!     Coordinate::new(0, 2).unwrap(),
//! ];
//! let ship = Ship::new(coords)?;
//! assert_eq!(ship.length, 3);
//! ```
//!
//! ### Creating a Fleet
//! ```rust
//! use battleship::ships::{Ship, Fleet};
//! use battleship::board::Coordinate;
//!
//! let ships = vec![
//!     Ship::new(vec![Coordinate::new(0, 0).unwrap(), Coordinate::new(0, 1).unwrap()])?,
//!     // ... more ships
//! ];
//! let fleet = Fleet::new(ships)?;
//! ```

use crate::board::{Board, Coordinate};
use crate::validation::{validate_fleet_composition, validate_ship_placement};
use crate::GameError;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

// ============================================================================
// SHIPS MODULE - Everything related to ship placement and validation
// ============================================================================

/// Represents a single ship on the game board
///
/// A ship consists of a collection of coordinates that form a contiguous,
/// straight line on the board. Ships must follow specific rules for placement
/// and cannot overlap or be adjacent to other ships.
///
/// # Fields
/// * `coordinates` - Vector of coordinates that make up the ship
/// * `length` - The length of the ship (number of coordinates)
///
/// # Validation Rules
/// - Length must be between 2 and 5
/// - All coordinates must be valid (within board bounds)
/// - Ship must be straight (all same x or all same y)
/// - Ship must be contiguous (no gaps between coordinates)
///
/// # Example
/// ```rust
/// use battleship::board::Coordinate;
/// use battleship::ships::Ship;
///
/// let coords = vec![
///     Coordinate::new(0, 0).unwrap(),
///     Coordinate::new(0, 1).unwrap(),
///     Coordinate::new(0, 2).unwrap(),
/// ];
/// let ship = Ship::new(coords)?;
/// assert_eq!(ship.length, 3);
/// assert!(ship.is_straight());
/// assert!(ship.is_contiguous());
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Ship {
    /// Vector of coordinates that make up the ship
    pub coordinates: Vec<Coordinate>,
    /// The length of the ship (number of coordinates)
    pub length: u8,
}

impl Ship {
    pub fn new(coordinates: Vec<Coordinate>) -> Result<Ship, GameError> {
        if coordinates.is_empty() {
            return Err(GameError::Invalid("ship cannot be empty"));
        }

        let length = coordinates.len() as u8;
        if length < 2 || length > 5 {
            return Err(GameError::Invalid("ship length must be 2-5"));
        }

        // Validate all coordinates are valid
        for coord in &coordinates {
            if !coord.is_valid() {
                return Err(GameError::Invalid("ship contains invalid coordinates"));
            }
        }

        Ok(Ship {
            coordinates,
            length,
        })
    }

    pub fn is_straight(&self) -> bool {
        if self.coordinates.len() <= 1 {
            return true;
        }

        let same_x = self
            .coordinates
            .iter()
            .all(|coord| coord.x == self.coordinates[0].x);
        let same_y = self
            .coordinates
            .iter()
            .all(|coord| coord.y == self.coordinates[0].y);

        same_x ^ same_y // XOR: either all same X or all same Y, but not both
    }

    pub fn is_contiguous(&self) -> bool {
        if self.coordinates.len() <= 1 {
            return true;
        }

        let same_x = self
            .coordinates
            .iter()
            .all(|coord| coord.x == self.coordinates[0].x);
        let mut sorted = self.coordinates.clone();

        if same_x {
            sorted.sort_by_key(|coord| coord.y);
        } else {
            sorted.sort_by_key(|coord| coord.x);
        }

        for window in sorted.windows(2) {
            let a = window[0];
            let b = window[1];
            let step = if same_x { (0i16, 1i16) } else { (1i16, 0i16) };
            let dx = (b.x as i16 - a.x as i16, b.y as i16 - a.y as i16);
            if dx != step {
                return false;
            }
        }
        true
    }

    pub fn overlaps_with(&self, other: &Ship) -> bool {
        for coord1 in &self.coordinates {
            for coord2 in &other.coordinates {
                if coord1 == coord2 {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_adjacent_to(&self, other: &Ship) -> bool {
        for coord1 in &self.coordinates {
            for coord2 in &other.coordinates {
                let dx = (coord1.x as i16 - coord2.x as i16).abs();
                let dy = (coord1.y as i16 - coord2.y as i16).abs();
                if dx <= 1 && dy <= 1 && !(dx == 0 && dy == 0) {
                    return true;
                }
            }
        }
        false
    }
}

/// Represents a collection of ships for a player
///
/// A fleet contains all the ships that a player has placed on their board.
/// The fleet must follow the standard battleship composition rules and all
/// ships must be valid according to ship placement rules.
///
/// # Fields
/// * `ships` - Vector of ships in the fleet
///
/// # Fleet Composition Rules
/// Standard battleship fleet must contain exactly:
/// - 1 ship of length 5 (carrier)
/// - 1 ship of length 4 (battleship)
/// - 2 ships of length 3 (cruiser, submarine)
/// - 1 ship of length 2 (destroyer)
///
/// # Validation
/// - All ships must be valid (straight, contiguous, proper length)
/// - Ships cannot overlap with each other
/// - Ships cannot be adjacent to each other
/// - Fleet composition must match standard rules
///
/// # Example
/// ```rust
/// use battleship::ships::{Ship, Fleet};
/// use battleship::board::Coordinate;
///
/// let ships = vec![
///     Ship::new(vec![Coordinate::new(0, 0).unwrap(), Coordinate::new(0, 1).unwrap()])?,
///     // ... more ships to complete the fleet
/// ];
/// let fleet = Fleet::new(ships)?;
/// assert_eq!(fleet.total_ships(), 5);
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Fleet {
    /// Vector of ships in the fleet
    pub ships: Vec<Ship>,
}

impl Fleet {
    pub fn new(ships: Vec<Ship>) -> Result<Fleet, GameError> {
        // Calculate ship counts for validation
        let mut ship_counts = [0; 4]; // [2,3,4,5] lengths

        for ship in &ships {
            let idx = (ship.length - 2) as usize;
            if idx >= 4 {
                return Err(GameError::Invalid("invalid ship length"));
            }
            ship_counts[idx] += 1;
        }

        // Extract ship coordinates for validation
        let ship_coordinates: Vec<Vec<Coordinate>> =
            ships.iter().map(|ship| ship.coordinates.clone()).collect();

        // Use the validation strategy pattern for fleet composition
        validate_fleet_composition(ship_counts, ship_coordinates)?;

        Ok(Fleet { ships })
    }

    pub fn total_ships(&self) -> usize {
        self.ships.len()
    }

    pub fn get_ship_count(&self) -> u64 {
        self.ships.len() as u64
    }
}

// ============================================================================
// SHIP VALIDATION SERVICE
// ============================================================================

pub struct ShipValidator;

impl ShipValidator {
    /// Validates ship placement using the validation strategy pattern
    pub fn validate_ship_placement(
        board: &Board,
        size: u8,
        coords: &[Coordinate],
    ) -> Result<(), GameError> {
        if coords.is_empty() {
            return Err(GameError::Invalid("empty ship"));
        }

        // Use the validation strategy pattern
        validate_ship_placement(board, coords, size)
    }

    /// Parses ship coordinates from a string format
    pub fn parse_ship_coords(group: &str) -> Result<Vec<Coordinate>, GameError> {
        let coords: Vec<Coordinate> = group
            .split(';')
            .filter_map(|p| {
                let p = p.trim();
                if p.is_empty() {
                    return None;
                }
                let mut it = p.split(',');
                let sx = it.next().unwrap_or("");
                let sy = it.next().unwrap_or("");
                let x: u8 = match sx.parse() {
                    Ok(v) => v,
                    Err(_) => return None,
                };
                let y: u8 = match sy.parse() {
                    Ok(v) => v,
                    Err(_) => return None,
                };
                Coordinate::new(x, y).ok()
            })
            .collect();
        Ok(coords)
    }
}
