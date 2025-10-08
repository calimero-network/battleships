//! # Validation Strategy Pattern
//!
//! This module implements a comprehensive **Validation Strategy Pattern** for the battleship game.
//! It addresses the scattered validation logic issue by providing a flexible, extensible, and maintainable approach to validation.
//!
//! ## Architecture Overview
//!
//! The pattern consists of three main components:
//! 1. **ValidationStrategy Trait** - Defines the contract for all validation strategies
//! 2. **ValidationInput Struct** - Flexible input structure for validation data
//! 3. **ValidationContext Manager** - Manages and executes multiple validation strategies
//!
//! ## Usage Examples
//!
//! ### Using Predefined Validation Contexts
//! ```rust
//! use crate::validation::{validate_ship_placement, validate_fleet_composition, validate_coordinates};
//!
//! // Ship placement validation
//! let board = Board::new_zeroed(BOARD_SIZE);
//! let coordinates = vec![
//!     Coordinate::new(0, 0).unwrap(),
//!     Coordinate::new(0, 1).unwrap(),
//!     Coordinate::new(0, 2).unwrap(),
//! ];
//! let result = validate_ship_placement(&board, &coordinates, BOARD_SIZE);
//! ```
//!
//! ### Creating Custom Validation Contexts
//! ```rust
//! use crate::validation::{ValidationContext, BoundsValidationStrategy, UniquenessValidationStrategy};
//!
//! let custom_context = ValidationContext::new()
//!     .add_strategy(Box::new(BoundsValidationStrategy))
//!     .add_strategy(Box::new(UniquenessValidationStrategy));
//!
//! let input = ValidationInput::new()
//!     .with_coordinates(coordinates)
//!     .with_size(BOARD_SIZE);
//!
//! let result = custom_context.validate(&input);
//! ```
//!
//! ### Extending with New Validation Strategies
//! ```rust
//! use crate::validation::ValidationStrategy;
//! use crate::GameError;
//!
//! struct CustomValidationStrategy {
//!     min_length: u8,
//!     max_length: u8,
//! }
//!
//! impl ValidationStrategy for CustomValidationStrategy {
//!     fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
//!         let length = input.ship_length
//!             .or_else(|| input.coordinates.as_ref().map(|coords| coords.len() as u8))
//!             .ok_or_else(|| GameError::Invalid("ship length required"))?;
//!
//!         if length < self.min_length || length > self.max_length {
//!             return Err(GameError::Invalid("ship length out of custom range"));
//!         }
//!         Ok(())
//!     }
//!
//!     fn name(&self) -> &'static str {
//!         "CustomLengthValidation"
//!     }
//! }
//! ```
//!
//! ## Benefits
//!
//! - **Extensibility**: Easy to add new validation rules
//! - **Composability**: Mix and match validation strategies
//! - **Testability**: Each strategy can be tested independently
//! - **Maintainability**: Validation logic is organized and separated
//! - **Reusability**: Strategies can be reused across the application
//! - **Flexibility**: Custom validation contexts for specific use cases
//! - **Single Responsibility**: Each strategy has one clear purpose
//! - **Open/Closed Principle**: Open for extension, closed for modification

use crate::board::{Board, Cell, Coordinate, BOARD_SIZE};
use crate::GameError;

// ============================================================================
// VALIDATION STRATEGY PATTERN
// ============================================================================

/// Trait defining the validation strategy interface
///
/// All validation strategies must implement this trait. This allows for
/// flexible composition of validation logic and easy extensibility.
///
/// # Example
/// ```rust
/// use crate::validation::{ValidationStrategy, ValidationInput};
/// use crate::GameError;
///
/// struct MyCustomStrategy;
///
/// impl ValidationStrategy for MyCustomStrategy {
///     fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
///         // Custom validation logic here
///         Ok(())
///     }
///
///     fn name(&self) -> &'static str {
///         "MyCustomStrategy"
///     }
/// }
/// ```
pub trait ValidationStrategy {
    /// Validates the given input and returns a result
    ///
    /// # Arguments
    /// * `input` - The validation input containing the data to validate
    ///
    /// # Returns
    /// * `Ok(())` - Validation passed
    /// * `Err(GameError)` - Validation failed with specific error
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError>;

    /// Returns the name of this validation strategy
    ///
    /// This is used for debugging and logging purposes.
    fn name(&self) -> &'static str;
}

/// Input data for validation strategies
///
/// This struct provides a flexible way to pass different types of data
/// to validation strategies. It uses the builder pattern for easy construction.
///
/// # Example
/// ```rust
/// use crate::validation::ValidationInput;
/// use crate::board::{Board, Coordinate, BOARD_SIZE};
///
/// let input = ValidationInput::new()
///     .with_board(Board::new_zeroed(BOARD_SIZE))
///     .with_coordinates(vec![Coordinate::new(0, 0).unwrap()])
///     .with_size(BOARD_SIZE)
///     .with_ship_length(3);
/// ```
#[derive(Debug, Clone)]
pub struct ValidationInput {
    /// The game board for validation
    pub board: Option<Board>,
    /// Coordinates to validate
    pub coordinates: Option<Vec<Coordinate>>,
    /// Board size for bounds checking
    pub size: Option<u8>,
    /// Ship length for length validation
    pub ship_length: Option<u8>,
    /// Fleet composition counts \[2,3,4,5\] lengths
    pub fleet_composition: Option<[usize; 4]>,
    /// Multiple ship coordinate sets for fleet validation
    pub ships: Option<Vec<Vec<Coordinate>>>,
}

impl ValidationInput {
    pub fn new() -> Self {
        ValidationInput {
            board: None,
            coordinates: None,
            size: None,
            ship_length: None,
            fleet_composition: None,
            ships: None,
        }
    }

    pub fn with_board(mut self, board: Board) -> Self {
        self.board = Some(board);
        self
    }

    pub fn with_coordinates(mut self, coordinates: Vec<Coordinate>) -> Self {
        self.coordinates = Some(coordinates);
        self
    }

    pub fn with_size(mut self, size: u8) -> Self {
        self.size = Some(size);
        self
    }

    pub fn with_ship_length(mut self, length: u8) -> Self {
        self.ship_length = Some(length);
        self
    }

    pub fn with_fleet_composition(mut self, composition: [usize; 4]) -> Self {
        self.fleet_composition = Some(composition);
        self
    }

    pub fn with_ships(mut self, ships: Vec<Vec<Coordinate>>) -> Self {
        self.ships = Some(ships);
        self
    }
}

// ============================================================================
// CONCRETE VALIDATION STRATEGIES
// ============================================================================

/// Validates that coordinates are within board bounds
///
/// This strategy ensures all coordinates are within the valid board range (0 to size-1).
/// It's typically the first validation to run as it's a prerequisite for other validations.
pub struct BoundsValidationStrategy;

impl ValidationStrategy for BoundsValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let coordinates = input
            .coordinates
            .as_ref()
            .ok_or_else(|| GameError::Invalid("coordinates required for bounds validation"))?;
        let size = input.size.unwrap_or(BOARD_SIZE);

        for coord in coordinates {
            if coord.x >= size || coord.y >= size {
                return Err(GameError::Invalid("coordinate out of bounds"));
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "BoundsValidation"
    }
}

/// Validates that coordinates are unique (no duplicates)
///
/// This strategy ensures no coordinate appears more than once in the input.
/// It's essential for preventing ships from overlapping with themselves.
pub struct UniquenessValidationStrategy;

impl ValidationStrategy for UniquenessValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let coordinates = input
            .coordinates
            .as_ref()
            .ok_or_else(|| GameError::Invalid("coordinates required for uniqueness validation"))?;

        let mut set = std::collections::BTreeSet::new();
        for &coord in coordinates {
            if !set.insert(coord) {
                return Err(GameError::Invalid("duplicate coordinate"));
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "UniquenessValidation"
    }
}

/// Validates that ship placement doesn't overlap with existing ships
pub struct OverlapValidationStrategy;

impl ValidationStrategy for OverlapValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let board = input
            .board
            .as_ref()
            .ok_or_else(|| GameError::Invalid("board required for overlap validation"))?;
        let coordinates = input
            .coordinates
            .as_ref()
            .ok_or_else(|| GameError::Invalid("coordinates required for overlap validation"))?;
        let size = input.size.unwrap_or(BOARD_SIZE);

        for &coord in coordinates {
            if matches!(board.get(size, coord.x, coord.y), Cell::Ship) {
                return Err(GameError::Invalid("overlap with existing ship"));
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "OverlapValidation"
    }
}

/// Validates that ships are not adjacent to each other
pub struct AdjacencyValidationStrategy;

impl ValidationStrategy for AdjacencyValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let board = input
            .board
            .as_ref()
            .ok_or_else(|| GameError::Invalid("board required for adjacency validation"))?;
        let coordinates = input
            .coordinates
            .as_ref()
            .ok_or_else(|| GameError::Invalid("coordinates required for adjacency validation"))?;
        let size = input.size.unwrap_or(BOARD_SIZE);

        for &coord in coordinates {
            if board.is_adjacent_violation(size, coord.x, coord.y) {
                return Err(GameError::Invalid("adjacent to existing ship"));
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "AdjacencyValidation"
    }
}

/// Validates that ship is in a straight line
pub struct StraightLineValidationStrategy;

impl ValidationStrategy for StraightLineValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let coordinates = input.coordinates.as_ref().ok_or_else(|| {
            GameError::Invalid("coordinates required for straight line validation")
        })?;

        if coordinates.len() <= 1 {
            return Ok(());
        }

        let same_x = coordinates.iter().all(|coord| coord.x == coordinates[0].x);
        let same_y = coordinates.iter().all(|coord| coord.y == coordinates[0].y);

        if !(same_x ^ same_y) {
            return Err(GameError::Invalid(
                "ship must be straight (horizontal or vertical)",
            ));
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "StraightLineValidation"
    }
}

/// Validates that ship coordinates are contiguous
pub struct ContiguityValidationStrategy;

impl ValidationStrategy for ContiguityValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let coordinates = input
            .coordinates
            .as_ref()
            .ok_or_else(|| GameError::Invalid("coordinates required for contiguity validation"))?;

        if coordinates.len() <= 1 {
            return Ok(());
        }

        let same_x = coordinates.iter().all(|coord| coord.x == coordinates[0].x);
        let mut sorted = coordinates.clone();

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
                return Err(GameError::Invalid("ship must be contiguous"));
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "ContiguityValidation"
    }
}

/// Validates ship length is within acceptable range
pub struct ShipLengthValidationStrategy;

impl ValidationStrategy for ShipLengthValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let length = input
            .ship_length
            .or_else(|| input.coordinates.as_ref().map(|coords| coords.len() as u8))
            .ok_or_else(|| GameError::Invalid("ship length required for length validation"))?;

        if length < 2 || length > 5 {
            return Err(GameError::Invalid("ship length must be between 2 and 5"));
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "ShipLengthValidation"
    }
}

/// Validates fleet composition follows standard battleship rules
pub struct FleetCompositionValidationStrategy;

impl ValidationStrategy for FleetCompositionValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let composition = input.fleet_composition.ok_or_else(|| {
            GameError::Invalid("fleet composition required for composition validation")
        })?;

        // Standard battleship fleet: 1x5, 1x4, 2x3, 1x2
        if composition[3] != 1 {
            return Err(GameError::Invalid("need exactly 1 ship of length 5"));
        }
        if composition[2] != 1 {
            return Err(GameError::Invalid("need exactly 1 ship of length 4"));
        }
        if composition[1] != 2 {
            return Err(GameError::Invalid("need exactly 2 ships of length 3"));
        }
        if composition[0] != 1 {
            return Err(GameError::Invalid("need exactly 1 ship of length 2"));
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "FleetCompositionValidation"
    }
}

/// Validates that ships don't overlap with each other
pub struct ShipOverlapValidationStrategy;

impl ValidationStrategy for ShipOverlapValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let ships = input
            .ships
            .as_ref()
            .ok_or_else(|| GameError::Invalid("ships required for ship overlap validation"))?;

        for i in 0..ships.len() {
            for j in (i + 1)..ships.len() {
                for coord1 in &ships[i] {
                    for coord2 in &ships[j] {
                        if coord1 == coord2 {
                            return Err(GameError::Invalid("ships overlap"));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "ShipOverlapValidation"
    }
}

/// Validates that ships are not adjacent to each other
pub struct ShipAdjacencyValidationStrategy;

impl ValidationStrategy for ShipAdjacencyValidationStrategy {
    fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        let ships = input
            .ships
            .as_ref()
            .ok_or_else(|| GameError::Invalid("ships required for ship adjacency validation"))?;

        for i in 0..ships.len() {
            for j in (i + 1)..ships.len() {
                for coord1 in &ships[i] {
                    for coord2 in &ships[j] {
                        let dx = (coord1.x as i16 - coord2.x as i16).abs();
                        let dy = (coord1.y as i16 - coord2.y as i16).abs();
                        if dx <= 1 && dy <= 1 && !(dx == 0 && dy == 0) {
                            return Err(GameError::Invalid("ships are adjacent"));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "ShipAdjacencyValidation"
    }
}

// ============================================================================
// VALIDATION CONTEXT (STRATEGY MANAGER)
// ============================================================================

/// Manages validation strategies and executes them in sequence
///
/// The ValidationContext allows you to compose multiple validation strategies
/// and execute them together. This provides flexibility in creating custom
/// validation flows for different use cases.
///
/// # Example
/// ```rust
/// use crate::validation::{ValidationContext, BoundsValidationStrategy, UniquenessValidationStrategy};
///
/// let context = ValidationContext::new()
///     .add_strategy(Box::new(BoundsValidationStrategy))
///     .add_strategy(Box::new(UniquenessValidationStrategy));
///
/// let input = ValidationInput::new()
///     .with_coordinates(coordinates)
///     .with_size(BOARD_SIZE);
///
/// let result = context.validate(&input);
/// ```
pub struct ValidationContext {
    strategies: Vec<Box<dyn ValidationStrategy>>,
}

impl ValidationContext {
    pub fn new() -> Self {
        ValidationContext {
            strategies: Vec::new(),
        }
    }

    /// Adds a validation strategy to the context
    pub fn add_strategy(mut self, strategy: Box<dyn ValidationStrategy>) -> Self {
        self.strategies.push(strategy);
        self
    }

    /// Executes all validation strategies in sequence
    pub fn validate(&self, input: &ValidationInput) -> Result<(), GameError> {
        for strategy in &self.strategies {
            strategy.validate(input)?;
        }
        Ok(())
    }

    /// Returns the number of strategies in this context
    pub fn strategy_count(&self) -> usize {
        self.strategies.len()
    }

    /// Returns the names of all strategies in this context
    pub fn strategy_names(&self) -> Vec<&'static str> {
        self.strategies.iter().map(|s| s.name()).collect()
    }
}

// ============================================================================
// PREDEFINED VALIDATION CONTEXTS
// ============================================================================

impl ValidationContext {
    /// Creates a validation context for ship placement
    pub fn ship_placement() -> Self {
        ValidationContext::new()
            .add_strategy(Box::new(BoundsValidationStrategy))
            .add_strategy(Box::new(UniquenessValidationStrategy))
            .add_strategy(Box::new(OverlapValidationStrategy))
            .add_strategy(Box::new(AdjacencyValidationStrategy))
            .add_strategy(Box::new(StraightLineValidationStrategy))
            .add_strategy(Box::new(ContiguityValidationStrategy))
            .add_strategy(Box::new(ShipLengthValidationStrategy))
    }

    /// Creates a validation context for fleet composition
    pub fn fleet_composition() -> Self {
        ValidationContext::new()
            .add_strategy(Box::new(FleetCompositionValidationStrategy))
            .add_strategy(Box::new(ShipOverlapValidationStrategy))
            .add_strategy(Box::new(ShipAdjacencyValidationStrategy))
    }

    /// Creates a validation context for coordinate validation only
    pub fn coordinates_only() -> Self {
        ValidationContext::new()
            .add_strategy(Box::new(BoundsValidationStrategy))
            .add_strategy(Box::new(UniquenessValidationStrategy))
    }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/// Validates ship placement using the ship placement strategy
///
/// This is a convenience function that validates ship placement using
/// all the standard ship placement validation strategies:
/// - Bounds validation
/// - Uniqueness validation
/// - Overlap validation
/// - Adjacency validation
/// - Straight line validation
/// - Contiguity validation
/// - Ship length validation
///
/// # Arguments
/// * `board` - The game board to validate against
/// * `coordinates` - The ship coordinates to validate
/// * `size` - The board size for bounds checking
///
/// # Returns
/// * `Ok(())` - Ship placement is valid
/// * `Err(GameError)` - Ship placement is invalid with specific error
///
/// # Example
/// ```rust
/// use crate::validation::validate_ship_placement;
/// use crate::board::{Board, Coordinate, BOARD_SIZE};
///
/// let board = Board::new_zeroed(BOARD_SIZE);
/// let coordinates = vec![
///     Coordinate::new(0, 0).unwrap(),
///     Coordinate::new(0, 1).unwrap(),
///     Coordinate::new(0, 2).unwrap(),
/// ];
/// let result = validate_ship_placement(&board, &coordinates, BOARD_SIZE);
/// ```
pub fn validate_ship_placement(
    board: &Board,
    coordinates: &[Coordinate],
    size: u8,
) -> Result<(), GameError> {
    let input = ValidationInput::new()
        .with_board(board.clone())
        .with_coordinates(coordinates.to_vec())
        .with_size(size);

    ValidationContext::ship_placement().validate(&input)
}

/// Validates fleet composition using the fleet composition strategy
///
/// This is a convenience function that validates fleet composition using
/// all the standard fleet validation strategies:
/// - Fleet composition validation (standard battleship fleet: 1x5, 1x4, 2x3, 1x2)
/// - Ship overlap validation
/// - Ship adjacency validation
///
/// # Arguments
/// * `ship_counts` - Array of ship counts by length \[2,3,4,5\]
/// * `ships` - Vector of ship coordinate sets
///
/// # Returns
/// * `Ok(())` - Fleet composition is valid
/// * `Err(GameError)` - Fleet composition is invalid with specific error
///
/// # Example
/// ```rust
/// use crate::validation::validate_fleet_composition;
/// use crate::board::Coordinate;
///
/// let ship_counts = [1, 2, 1, 1]; // Standard battleship fleet
/// let ships = vec![
///     vec![Coordinate::new(0, 0).unwrap(), Coordinate::new(0, 1).unwrap()], // Length 2
///     // ... more ships
/// ];
/// let result = validate_fleet_composition(ship_counts, ships);
/// ```
pub fn validate_fleet_composition(
    ship_counts: [usize; 4],
    ships: Vec<Vec<Coordinate>>,
) -> Result<(), GameError> {
    let input = ValidationInput::new()
        .with_fleet_composition(ship_counts)
        .with_ships(ships);

    ValidationContext::fleet_composition().validate(&input)
}

/// Validates coordinates using the coordinates-only strategy
///
/// This is a convenience function that validates coordinates using
/// basic coordinate validation strategies:
/// - Bounds validation
/// - Uniqueness validation
///
/// # Arguments
/// * `coordinates` - The coordinates to validate
/// * `size` - The board size for bounds checking
///
/// # Returns
/// * `Ok(())` - Coordinates are valid
/// * `Err(GameError)` - Coordinates are invalid with specific error
///
/// # Example
/// ```rust
/// use crate::validation::validate_coordinates;
/// use crate::board::{Coordinate, BOARD_SIZE};
///
/// let coordinates = vec![
///     Coordinate::new(0, 0).unwrap(),
///     Coordinate::new(0, 1).unwrap(),
/// ];
/// let result = validate_coordinates(&coordinates, BOARD_SIZE);
/// ```
pub fn validate_coordinates(coordinates: &[Coordinate], size: u8) -> Result<(), GameError> {
    let input = ValidationInput::new()
        .with_coordinates(coordinates.to_vec())
        .with_size(size);

    ValidationContext::coordinates_only().validate(&input)
}
