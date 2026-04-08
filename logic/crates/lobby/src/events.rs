#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new match was allocated in the Lobby.
    MatchCreated { id: &'a str },
    /// The Lobby match list changed (created, linked, or finished).
    MatchListUpdated {},
    /// Lobby player stats were updated after a match finished.
    PlayerStatsUpdated {},
}
