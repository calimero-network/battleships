//! Domain events for the battleship game.
//!
//! Events cover both Lobby-level changes (match list, player stats) and
//! Match-level gameplay (shots, ships, winner).

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new match was allocated in the Lobby.
    MatchCreated { id: &'a str },
    /// The Lobby match list changed (created, linked, or finished).
    MatchListUpdated {},
    /// Lobby player stats were updated after a match finished.
    PlayerStatsUpdated {},
    /// A player placed their ships (Match context).
    ShipsPlaced { id: &'a str },
    /// A player proposed a shot (Match context).
    ShotProposed { id: &'a str, x: u8, y: u8 },
    /// A shot was resolved (Match context).
    ShotFired {
        id: &'a str,
        x: u8,
        y: u8,
        result: &'a str,
    },
    /// A winner was determined (Match context).
    Winner { id: &'a str },
    /// The match ended (Match context).
    MatchEnded { id: &'a str },
}
