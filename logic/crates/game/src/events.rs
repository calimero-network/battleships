#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A player placed their ships.
    ShipsPlaced { id: &'a str },
    /// A player proposed a shot.
    ShotProposed { id: &'a str, x: u8, y: u8 },
    /// A shot was resolved.
    ShotFired {
        id: &'a str,
        x: u8,
        y: u8,
        result: &'a str,
    },
    /// A winner was determined.
    Winner { id: &'a str },
    /// The match ended.
    MatchEnded { id: &'a str },
}
