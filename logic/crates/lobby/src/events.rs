#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new match was allocated in the Lobby.
    MatchCreated { id: &'a str },
    /// A create_match call lost a race — the composed id already existed.
    MatchIdCollision { attempted_id: &'a str },
    /// The Lobby match list changed (created, linked, or finished).
    MatchListUpdated {},
    /// Lobby player stats were updated after a match finished.
    PlayerStatsUpdated {},
}
