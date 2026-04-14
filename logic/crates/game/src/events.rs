#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A player placed their ships.
    ShipsPlaced { id: &'a str },
    /// A player's SHA256 board commitment has been recorded.
    BoardCommitted {
        id: &'a str,
        player: &'a str,
        commitment: &'a str,
    },
    /// A player revealed their board post-match and the audit passed/failed.
    BoardRevealed { id: &'a str, player: &'a str },
    /// Audit (commitment check + shot replay) passed for a player.
    AuditPassed { id: &'a str, player: &'a str },
    /// Audit failed for a player; reason gives the specific failure.
    AuditFailed {
        id: &'a str,
        player: &'a str,
        reason: &'a str,
    },
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
