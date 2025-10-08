//! # Events Module
//!
//! This module defines domain events for the battleship game, providing a
//! decoupled way to track game state changes and enable event-driven architecture.
//!
//! ## Event Types
//!
//! The module defines several event types that are emitted during game play:
//! - **Match Events**: Match creation and completion
//! - **Ship Events**: Ship placement notifications
//! - **Shot Events**: Shot proposal and resolution
//! - **Game Events**: Winner determination and match ending
//!
//! ## Event-Driven Benefits
//!
//! - **Decoupling**: Events allow loose coupling between game components
//! - **Auditing**: All game actions are tracked through events
//! - **Integration**: Events can be consumed by external systems
//! - **Debugging**: Events provide a clear audit trail of game actions
//!
//! ## Usage
//!
//! Events are automatically emitted by the game logic using the `app::emit!` macro.
//! They can be consumed by external systems or used for logging and debugging.
//!
//! ## Example
//! ```rust
//! use battleship::events::Event;
//!
//! // Events are emitted automatically by the game logic
//! // app::emit!(Event::MatchCreated { id: "match-123" });
//! // app::emit!(Event::ShotFired { id: "match-123", x: 5, y: 3, result: "hit" });
//! ```

// ============================================================================
// EVENTS MODULE - Domain events for decoupling
// ============================================================================

/// Domain events for the battleship game
///
/// This enum defines all the events that can be emitted during game play.
/// Events are used to track game state changes and enable event-driven
/// architecture patterns.
///
/// # Event Variants
/// * `MatchCreated` - Emitted when a new match is created
/// * `ShipsPlaced` - Emitted when a player places their ships
/// * `ShotProposed` - Emitted when a player proposes a shot
/// * `ShotFired` - Emitted when a shot is resolved (hit/miss)
/// * `Winner` - Emitted when a winner is determined
/// * `MatchEnded` - Emitted when a match is completed
///
/// # Lifetime Parameter
/// The `'a` lifetime parameter allows events to reference string data
/// without requiring ownership, making them more efficient for emission.
///
/// # Example
/// ```rust
/// use battleship::events::Event;
///
/// // Events are typically emitted by the game logic
/// // app::emit!(Event::MatchCreated { id: "match-123" });
/// // app::emit!(Event::ShotFired { id: "match-123", x: 5, y: 3, result: "hit" });
/// ```
#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// Emitted when a new match is created
    MatchCreated { id: &'a str },
    /// Emitted when a player places their ships
    ShipsPlaced { id: &'a str },
    /// Emitted when a player proposes a shot
    ShotProposed { id: &'a str, x: u8, y: u8 },
    /// Emitted when a shot is resolved (hit/miss)
    ShotFired {
        id: &'a str,
        x: u8,
        y: u8,
        result: &'a str,
    },
    /// Emitted when a winner is determined
    Winner { id: &'a str },
    /// Emitted when a match is completed
    MatchEnded { id: &'a str },
}
