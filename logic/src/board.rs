//! # Board Module
//!
//! This module contains all types and functionality related to game boards,
//! coordinates, and cell states in the battleship game.
//!
//! ## Key Types
//!
//! - **`Coordinate`** - Represents a position on the board with x,y coordinates
//! - **`Cell`** - Represents the state of a board cell (Empty, Ship, Hit, Miss, Pending)
//! - **`Board`** - Represents the game board as a flat vector of cells
//!
//! ## Board Layout
//!
//! The board is a 10x10 grid where:
//! - Coordinates are 0-indexed (0-9 for both x and y)
//! - Cells are stored in row-major order (y * width + x)
//! - The board size is defined by the `BOARD_SIZE` constant
//!
//! ## Usage Examples
//!
//! ### Creating Coordinates
//! ```rust
//! use battleship::board::{Coordinate, BOARD_SIZE};
//!
//! let coord = Coordinate::new(5, 3)?; // (5, 3) position
//! assert!(coord.is_valid());
//! ```
//!
//! ### Working with Boards
//! ```rust
//! use battleship::board::{Board, Cell, BOARD_SIZE};
//!
//! let mut board = Board::new_zeroed(BOARD_SIZE);
//! board.set(BOARD_SIZE, 0, 0, Cell::Ship);
//! let cell = board.get(BOARD_SIZE, 0, 0);
//! assert_eq!(cell, Cell::Ship);
//! ```

use crate::GameError;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

// ============================================================================
// BOARD MODULE - Everything related to game boards and coordinates
// ============================================================================

/// Standard board size for battleship (10x10 grid)
pub const BOARD_SIZE: u8 = 10;

/// Represents a coordinate position on the game board
///
/// Coordinates are 0-indexed and must be within the board bounds (0 to BOARD_SIZE-1).
/// This struct implements ordering traits to allow use in collections like BTreeSet.
///
/// # Fields
/// * `x` - The x-coordinate (column, 0-9)
/// * `y` - The y-coordinate (row, 0-9)
///
/// # Example
/// ```rust
/// use battleship::board::Coordinate;
///
/// let coord = Coordinate::new(5, 3)?;
/// assert_eq!(coord.x, 5);
/// assert_eq!(coord.y, 3);
/// assert!(coord.is_valid());
/// ```
#[derive(
    Debug,
    Clone,
    Copy,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Coordinate {
    /// The x-coordinate (column, 0-9)
    pub x: u8,
    /// The y-coordinate (row, 0-9)
    pub y: u8,
}

impl Coordinate {
    pub fn new(x: u8, y: u8) -> Result<Coordinate, GameError> {
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            return Err(GameError::Invalid("coordinate out of bounds"));
        }
        Ok(Coordinate { x, y })
    }

    pub fn is_valid(&self) -> bool {
        self.x < BOARD_SIZE && self.y < BOARD_SIZE
    }
}

/// Represents the state of a cell on the game board
///
/// Each cell can be in one of five states, representing different game conditions.
/// The enum provides conversion methods to/from u8 for serialization.
///
/// # Variants
/// * `Empty` - Empty cell (no ship, no shot)
/// * `Ship` - Cell contains part of a ship
/// * `Hit` - Cell was shot and contains a hit ship
/// * `Miss` - Cell was shot but was empty
/// * `Pending` - Cell has a pending shot (not yet resolved)
///
/// # Example
/// ```rust
/// use battleship::board::Cell;
///
/// let cell = Cell::Ship;
/// assert_eq!(cell.to_u8(), 1);
/// assert_eq!(Cell::from_u8(1), Cell::Ship);
/// ```
#[derive(
    Debug, Clone, Copy, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Cell {
    /// Empty cell (no ship, no shot)
    Empty,
    /// Cell contains part of a ship
    Ship,
    /// Cell was shot and contains a hit ship
    Hit,
    /// Cell was shot but was empty
    Miss,
    /// Cell has a pending shot (not yet resolved)
    Pending,
}

impl Cell {
    pub fn to_u8(self) -> u8 {
        match self {
            Cell::Empty => 0,
            Cell::Ship => 1,
            Cell::Hit => 2,
            Cell::Miss => 3,
            Cell::Pending => 4,
        }
    }

    pub fn from_u8(value: u8) -> Cell {
        match value {
            1 => Cell::Ship,
            2 => Cell::Hit,
            3 => Cell::Miss,
            4 => Cell::Pending,
            _ => Cell::Empty,
        }
    }
}

/// Represents a game board as a flat vector of cells
///
/// The board is stored as a flat vector in row-major order (y * width + x).
/// This provides efficient access and serialization while maintaining a simple
/// interface for board operations.
///
/// # Storage Format
/// The board is stored as `Vec<u8>` where each element represents a cell state:
/// - Index calculation: `y * BOARD_SIZE + x`
/// - Cell values: 0=Empty, 1=Ship, 2=Hit, 3=Miss, 4=Pending
///
/// # Example
/// ```rust
/// use battleship::board::{Board, Cell, BOARD_SIZE};
///
/// let mut board = Board::new_zeroed(BOARD_SIZE);
/// board.set(BOARD_SIZE, 0, 0, Cell::Ship);
/// let cell = board.get(BOARD_SIZE, 0, 0);
/// assert_eq!(cell, Cell::Ship);
/// ```
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Board(pub Vec<u8>);

impl Board {
    pub fn new_zeroed(size: u8) -> Board {
        Board(vec![0; (size as usize) * (size as usize)])
    }

    pub fn idx(size: u8, x: u8, y: u8) -> usize {
        (y as usize) * (size as usize) + (x as usize)
    }

    pub fn in_bounds(size: u8, x: u8, y: u8) -> bool {
        x < size && y < size
    }

    pub fn get(&self, size: u8, x: u8, y: u8) -> Cell {
        Cell::from_u8(self.0[Board::idx(size, x, y)])
    }

    pub fn set(&mut self, size: u8, x: u8, y: u8, cell: Cell) {
        self.0[Board::idx(size, x, y)] = cell.to_u8();
    }

    pub fn is_adjacent_violation(&self, size: u8, x: u8, y: u8) -> bool {
        let xi = x as i16;
        let yi = y as i16;
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = xi + dx;
                let ny = yi + dy;
                if nx < 0 || ny < 0 {
                    continue;
                }
                let nxu = nx as u8;
                let nyu = ny as u8;
                if nxu >= size || nyu >= size {
                    continue;
                }
                if matches!(self.get(size, nxu, nyu), Cell::Ship) {
                    return true;
                }
            }
        }
        false
    }
}

// ============================================================================
// BOARD VIEWS - Data transfer objects for API responses
// ============================================================================

// OwnBoardView and ShotsView are now defined in lib.rs for ABI compatibility
