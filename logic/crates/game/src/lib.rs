//! Game service — live match gameplay with private boards.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::env;

pub mod board;
pub mod events;
pub mod game;
pub mod players;
pub mod ships;
pub mod validation;

use board::{Cell, BOARD_SIZE};
use events::Event;
use game::{Match, ShotResolver};
use players::{PlayerBoard, PrivateBoards};

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OwnBoardView {
    pub size: u8,
    pub board: Vec<u8>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn from_executor_id() -> Result<PublicKey, GameError> {
    let v = calimero_sdk::env::executor_id();
    if v.len() != 32 {
        return Err(GameError::Invalid("executor id length"));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&v);
    Ok(PublicKey(arr))
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct GameState {
    lobby_context_id: Option<String>,
    active_match: Option<Match>,
}

#[app::logic]
impl GameState {
    #[app::init]
    pub fn init(
        player1: String,
        player2: String,
        lobby_context_id: Option<String>,
    ) -> GameState {
        let mut state = GameState {
            lobby_context_id,
            active_match: None,
        };

        if let (Ok(pk1), Ok(pk2)) = (
            PublicKey::from_base58(&player1),
            PublicKey::from_base58(&player2),
        ) {
            let id = format!("match-{}-1", env::time_now());
            state.active_match = Some(Match::new(id, pk1, pk2));
        }

        state
    }

    fn get_active_match(&self) -> app::Result<&Match> {
        self.active_match
            .as_ref()
            .ok_or_else(|| calimero_sdk::types::Error::from(GameError::Invalid("no active match")))
    }

    fn get_active_match_mut(&mut self) -> app::Result<&mut Match> {
        self.active_match
            .as_mut()
            .ok_or_else(|| calimero_sdk::types::Error::from(GameError::Invalid("no active match")))
    }

    // ---- Game API ----

    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if match_state.is_finished() {
            app::bail!(GameError::Finished);
        }

        let caller = from_executor_id()?;
        if !match_state.is_player(&caller) {
            app::bail!(GameError::Forbidden("not a player"));
        }

        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut pb = priv_mut.boards.get(&key)?.unwrap_or(PlayerBoard::new());

        pb.place_ships(ships)?;
        priv_mut.boards.insert(key, pb)?;

        if caller == match_state.player1 {
            match_state.placed_p1 = true;
        } else {
            match_state.placed_p2 = true;
        }

        app::emit!(Event::ShipsPlaced { id: match_id });
        Ok(())
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = from_executor_id()?;
        match_state.propose_shot(caller, x, y)?;

        app::emit!((
            Event::ShotProposed { id: match_id, x, y },
            "acknowledge_shot_handler"
        ));
        Ok(())
    }

    pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
        let match_state = self.get_active_match_mut()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if match_state.is_finished() {
            app::bail!(GameError::Finished);
        }

        let caller = from_executor_id()?;
        match_state.acknowledge_shot(caller)?;

        let shot_x = match_state.pending_x.unwrap_or(0);
        let shot_y = match_state.pending_y.unwrap_or(0);

        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut target_pb = priv_mut.boards.get(&key)?.ok_or_else(|| {
            calimero_sdk::types::Error::from(GameError::Invalid("target board unavailable"))
        })?;

        let had_winner_before = match_state.winner.is_some();
        let result = ShotResolver::resolve_shot(match_state, &mut target_pb)?;
        priv_mut.boards.insert(key, target_pb)?;

        let just_finished = !had_winner_before && match_state.winner.is_some();

        let xcall_payload = if just_finished {
            match_state.winner.as_ref().map(|w| {
                let winner_key = w.to_base58();
                let loser_key = match_state.get_opponent(w).to_base58();
                let mid = match_state.id.clone();
                (mid, winner_key, loser_key)
            })
        } else {
            None
        };

        if just_finished {
            app::emit!(Event::Winner { id: match_id });
            app::emit!(Event::MatchEnded { id: match_id });

            if let (Some((mid, winner_key, loser_key)), Some(ref lobby_ctx)) =
                (xcall_payload, &self.lobby_context_id)
            {
                if let Ok(lobby_bytes) = bs58::decode(lobby_ctx).into_vec() {
                    if let Ok(ctx_arr) = <[u8; 32]>::try_from(lobby_bytes.as_slice()) {
                        let params = calimero_sdk::serde_json::json!({
                            "match_id": mid,
                            "winner": winner_key,
                            "loser": loser_key,
                        });
                        if let Ok(params_bytes) = calimero_sdk::serde_json::to_vec(&params) {
                            calimero_sdk::env::xcall(&ctx_arr, "on_match_finished", &params_bytes);
                        }
                    }
                }
            }
        }

        app::emit!(Event::ShotFired {
            id: match_id,
            x: shot_x,
            y: shot_y,
            result: &result
        });

        Ok(result)
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
        let match_state = self.get_active_match()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = from_executor_id()?;
        let key = match_id.to_string();
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards.boards.get(&key)?.ok_or_else(|| {
            calimero_sdk::types::Error::from(GameError::NotFound(match_id.to_string()))
        })?;

        let mut board = pb.get_board().0.clone();

        if let Some(pending_target) = &match_state.pending_target {
            if *pending_target == caller {
                if let (Some(x), Some(y)) = (match_state.pending_x, match_state.pending_y) {
                    let idx = (y as usize) * (BOARD_SIZE as usize) + (x as usize);
                    if idx < board.len() {
                        board[idx] = Cell::Pending.to_u8();
                    }
                }
            }
        }

        Ok(OwnBoardView {
            size: BOARD_SIZE,
            board,
        })
    }

    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let match_state = self.get_active_match()?;
        if match_id != match_state.id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }

        let caller = from_executor_id()?;
        if !match_state.is_player(&caller) {
            app::bail!(GameError::Forbidden("not a player"));
        }

        let shots = match_state.get_shots_for_player(&caller);
        Ok(ShotsView {
            size: BOARD_SIZE,
            shots: shots.0.clone(),
        })
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        Ok(self.active_match.as_ref().map(|m| m.id.clone()))
    }

    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        Ok(self.active_match.as_ref().map(|m| m.turn.to_base58()))
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(from_executor_id()?.to_base58())
    }

    pub fn acknowledge_shot_handler(&mut self, id: &str, _x: u8, _y: u8) -> app::Result<()> {
        self.acknowledge_shot(id)?;
        Ok(())
    }
}
