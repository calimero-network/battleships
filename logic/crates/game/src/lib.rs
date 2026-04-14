//! Game service — live match gameplay with private boards.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::{LwwRegister, UnorderedMap, UserStorage};
use sha2::{Digest, Sha256};

pub mod audit;
pub mod board;
pub mod events;
pub mod players;
pub mod ships;
pub mod validation;

use board::{Cell, BOARD_SIZE};
use events::Event;
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

/// Pending-shot record — small value living in an `LwwRegister`.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PendingShot {
    pub x: u8,
    pub y: u8,
    pub shooter: PublicKey,
    pub target: PublicKey,
}

/// Export payload for cross-device durability. Defined locally (not re-used from
/// `battleships-types`) because the wasm-abi emitter resolves types by their
/// local path and would otherwise not find it.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ExportedSeed {
    pub board_bytes: Vec<u8>,
    pub salt: [u8; 16],
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

/// Bridge between our `battleships_types::PublicKey` and the SDK's own `PublicKey`
/// (needed for `UserStorage::get_for_user` and similar SDK-typed APIs).
fn sdk_pk(pk: &PublicKey) -> calimero_sdk::PublicKey {
    calimero_sdk::PublicKey::from(pk.0)
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct GameState {
    pub lobby_context_id: LwwRegister<Option<String>>,
    pub match_id: LwwRegister<Option<String>>,
    pub player1: LwwRegister<Option<PublicKey>>,
    pub player2: LwwRegister<Option<PublicKey>>,
    pub turn: LwwRegister<Option<PublicKey>>,
    pub winner: LwwRegister<Option<PublicKey>>,
    pub placed_p1: LwwRegister<bool>,
    pub placed_p2: LwwRegister<bool>,
    pub pending: LwwRegister<Option<PendingShot>>,
    /// key = `[y * 10 + x]`, value = Cell as u8 wrapped in LwwRegister (u8 itself is not Mergeable).
    /// A shot cell may transition Pending -> Hit/Miss, so LWW is correct: the ack always
    /// has a later HLC timestamp than the proposal.
    pub shots_p1: UnorderedMap<[u8; 1], LwwRegister<u8>>,
    pub shots_p2: UnorderedMap<[u8; 1], LwwRegister<u8>>,
    /// SHA256 commitment published by each player at placement time.
    /// `LwwRegister` wrapper provides the `Mergeable` impl that `UserStorage` requires;
    /// write-once semantics are enforced at the call site (`AlreadyCommitted`).
    pub commitments: UserStorage<LwwRegister<[u8; 32]>>,
}

#[app::logic]
impl GameState {
    #[app::init]
    pub fn init(player1: String, player2: String, lobby_context_id: Option<String>) -> GameState {
        let pk1 = PublicKey::from_base58(&player1).ok();
        let pk2 = PublicKey::from_base58(&player2).ok();
        let match_id = pk1
            .as_ref()
            .zip(pk2.as_ref())
            .map(|(_, _)| format!("match-{}-1", calimero_storage::env::time_now()));
        GameState {
            lobby_context_id: LwwRegister::new(lobby_context_id),
            match_id: LwwRegister::new(match_id),
            player1: LwwRegister::new(pk1.clone()),
            player2: LwwRegister::new(pk2),
            turn: LwwRegister::new(pk1),
            winner: LwwRegister::new(None),
            placed_p1: LwwRegister::new(false),
            placed_p2: LwwRegister::new(false),
            pending: LwwRegister::new(None),
            shots_p1: UnorderedMap::new_with_field_name("game:shots_p1"),
            shots_p2: UnorderedMap::new_with_field_name("game:shots_p2"),
            commitments: UserStorage::new_with_field_name("game:commitments"),
        }
    }

    // ---- Game API ----

    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if self.winner.get().is_some() {
            app::bail!(GameError::Finished);
        }

        let caller = from_executor_id()?;
        if !self.is_player(&caller) {
            app::bail!(GameError::Forbidden("not a player"));
        }

        // Write-once: reject a second commitment from the same player.
        let existing = self
            .commitments
            .get()
            .map_err(|e| AppError::msg(format!("commitments.get: {e}")))?;
        if existing.is_some() {
            app::bail!(GameError::AlreadyCommitted);
        }

        // Populate the private board (existing validation flow).
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut pb = priv_mut.boards.get(&key)?.unwrap_or_default();
        pb.place_ships(ships)?;
        // Snapshot the pristine board NOW — `own` will be mutated as shots
        // resolve, but the commitment hash must always match placement state.
        pb.capture_pristine();

        // Generate salt, compute commitment.
        let mut salt = [0u8; 16];
        calimero_sdk::env::random_bytes(&mut salt);
        pb.set_salt(salt);
        let board_bytes = calimero_sdk::borsh::to_vec(&pb.pristine().to_vec())
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        let commitment = compute_commitment(&board_bytes, &salt);

        // Publish commitment to UserStorage (writer-authorized).
        self.commitments
            .insert(LwwRegister::new(commitment))
            .map_err(|e| AppError::msg(format!("commitments.insert: {e}")))?;

        // Persist private board.
        priv_mut.boards.insert(key, pb)?;

        // Flip placed flag on shared state.
        if caller == self.player1_or_panic()? {
            self.placed_p1.set(true);
        } else {
            self.placed_p2.set(true);
        }

        let commitment_hex = hex_encode(&commitment);
        let caller_b58 = caller.to_base58();
        app::emit!(Event::BoardCommitted {
            id: match_id,
            player: &caller_b58,
            commitment: &commitment_hex,
        });
        app::emit!(Event::ShipsPlaced { id: match_id });
        Ok(())
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            app::bail!(GameError::Invalid("out of bounds"));
        }
        if self.winner.get().is_some() {
            app::bail!(GameError::Finished);
        }
        if !(*self.placed_p1.get()) || !(*self.placed_p2.get()) {
            app::bail!(GameError::Invalid("both players must place ships first"));
        }
        if self.pending.get().is_some() {
            app::bail!(GameError::Invalid("a shot is already pending"));
        }

        let caller = from_executor_id()?;
        let p1 = self.player1_or_panic()?;
        let p2 = self.player2_or_panic()?;
        if caller != p1 && caller != p2 {
            app::bail!(GameError::Forbidden("not a player"));
        }
        if self.turn.get().as_ref() != Some(&caller) {
            app::bail!(GameError::Forbidden("not your turn"));
        }

        let target = if caller == p1 { p2.clone() } else { p1.clone() };
        let key = [y * BOARD_SIZE + x];
        let shooter_map = if caller == p1 {
            &mut self.shots_p1
        } else {
            &mut self.shots_p2
        };
        shooter_map
            .insert(key, LwwRegister::new(Cell::Pending.to_u8()))
            .map_err(|e| AppError::msg(format!("shots.insert: {e}")))?;
        self.pending.set(Some(PendingShot {
            x,
            y,
            shooter: caller,
            target,
        }));

        app::emit!((
            Event::ShotProposed { id: match_id, x, y },
            "acknowledge_shot_handler"
        ));
        Ok(())
    }

    pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        if self.winner.get().is_some() {
            app::bail!(GameError::Finished);
        }

        let caller = from_executor_id()?;
        let pending = self
            .pending
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no pending shot")))?;
        if pending.target != caller {
            app::bail!(GameError::Forbidden("not the target"));
        }

        // Resolve against the caller's private board.
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id);
        let mut pb = priv_mut
            .boards
            .get(&key)?
            .ok_or_else(|| AppError::from(GameError::Invalid("target board unavailable")))?;
        let cur = pb.get_board().get(BOARD_SIZE, pending.x, pending.y);
        let is_hit = cur == Cell::Ship;
        if is_hit {
            pb.get_board_mut()
                .set(BOARD_SIZE, pending.x, pending.y, Cell::Hit);
            pb.decrement_ships();
        } else {
            pb.get_board_mut()
                .set(BOARD_SIZE, pending.x, pending.y, Cell::Miss);
        }
        let ships_remaining = pb.get_ship_count();
        let pristine_bytes = pb.pristine().to_vec();
        let salt = *pb.salt();
        priv_mut.boards.insert(key, pb)?;
        drop(priv_mut);
        drop(priv_boards);

        // Overwrite the shooter's map entry with the resolved cell.
        let p1 = self.player1_or_panic()?;
        let resolved = if is_hit { Cell::Hit } else { Cell::Miss };
        let shot_key = [pending.y * BOARD_SIZE + pending.x];
        let shooter_map = if pending.shooter == p1 {
            &mut self.shots_p1
        } else {
            &mut self.shots_p2
        };
        shooter_map
            .insert(shot_key, LwwRegister::new(resolved.to_u8()))
            .map_err(|e| AppError::msg(format!("shots.insert: {e}")))?;
        self.pending.set(None);

        let caller_b58 = caller.to_base58();
        let result_str = if is_hit { "hit" } else { "miss" };

        if ships_remaining == 0 {
            // Winning shot — run audit.
            let commitment = self
                .commitments
                .get_for_user(&sdk_pk(&caller))
                .map_err(|e| AppError::msg(format!("commitments.get_for_user: {e}")))?
                .ok_or_else(|| AppError::from(GameError::Invalid("no commitment for caller")))?;
            let commitment_hash = *commitment.get();
            let board_bytes = calimero_sdk::borsh::to_vec(&pristine_bytes)
                .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
            let against_me = if pending.shooter == p1 {
                &self.shots_p1
            } else {
                &self.shots_p2
            };
            let commitment_ok = audit::verify_commitment(&board_bytes, &salt, &commitment_hash);
            let replay_ok = audit::replay_shots(&pristine_bytes, against_me).is_ok();
            let audit_ok = commitment_ok && replay_ok;

            // Winner is always the shooter of this sinking hit.
            self.winner.set(Some(pending.shooter.clone()));

            if audit_ok {
                app::emit!(Event::AuditPassed {
                    id: match_id,
                    player: &caller_b58,
                });
            } else {
                let reason = if !commitment_ok {
                    "commitment_mismatch"
                } else {
                    "shot_inconsistent"
                };
                app::emit!(Event::AuditFailed {
                    id: match_id,
                    player: &caller_b58,
                    reason,
                });
            }

            app::emit!(Event::ShotFired {
                id: match_id,
                x: pending.x,
                y: pending.y,
                result: result_str,
            });
            app::emit!(Event::Winner { id: match_id });
            app::emit!(Event::MatchEnded { id: match_id });

            // xcall lobby with match-finished.
            if let Some(lobby_ctx) = self.lobby_context_id.get().as_ref() {
                if let Ok(lobby_bytes) = bs58::decode(lobby_ctx).into_vec() {
                    if let Ok(ctx_arr) = <[u8; 32]>::try_from(lobby_bytes.as_slice()) {
                        let winner_b58 = pending.shooter.to_base58();
                        let loser_b58 = caller.to_base58();
                        // Send the game context_id as the match identifier.
                        // The game's locally-synthesized match_id ("match-{ts}-1")
                        // doesn't match the lobby's "{p1}-{p2}-{ms}" scheme, so
                        // the lobby resolves the row by scanning for the
                        // matching `MatchSummary.context_id` (see
                        // `LobbyState::resolve_match_id`).
                        let game_ctx_b58 =
                            bs58::encode(calimero_sdk::env::context_id()).into_string();
                        let params = calimero_sdk::serde_json::json!({
                            "match_id": game_ctx_b58,
                            "winner": winner_b58,
                            "loser": loser_b58,
                        });
                        if let Ok(payload) = calimero_sdk::serde_json::to_vec(&params) {
                            calimero_sdk::env::xcall(&ctx_arr, "on_match_finished", &payload);
                        }
                    }
                }
            }
        } else {
            // Swap turn.
            let p2 = self.player2_or_panic()?;
            let next = if self.turn.get().as_ref() == Some(&p1) {
                p2
            } else {
                p1
            };
            self.turn.set(Some(next));
            app::emit!(Event::ShotFired {
                id: match_id,
                x: pending.x,
                y: pending.y,
                result: result_str,
            });
        }

        Ok(result_str.to_string())
    }

    pub fn reveal_board(&self, match_id: &str) -> app::Result<()> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        let caller = from_executor_id()?;
        let commitment = self
            .commitments
            .get_for_user(&sdk_pk(&caller))
            .map_err(|e| AppError::msg(format!("commitments.get_for_user: {e}")))?
            .ok_or_else(|| AppError::from(GameError::Invalid("no commitment for caller")))?;
        let commitment_hash = *commitment.get();
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id))?
            .ok_or_else(|| AppError::from(GameError::BoardNotFound))?;
        let own_cells = pb.pristine().to_vec();
        let board_bytes = calimero_sdk::borsh::to_vec(&own_cells)
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        let caller_b58 = caller.to_base58();
        if !audit::verify_commitment(&board_bytes, pb.salt(), &commitment_hash) {
            app::emit!(Event::AuditFailed {
                id: match_id,
                player: &caller_b58,
                reason: "commitment_mismatch",
            });
            app::bail!(GameError::CommitmentMismatch);
        }
        let p1 = self.player1_or_panic()?;
        let against_me = if caller == p1 {
            &self.shots_p2
        } else {
            &self.shots_p1
        };
        if let Err(failure) = audit::replay_shots(&own_cells, against_me) {
            let reason = failure.to_string();
            app::emit!(Event::AuditFailed {
                id: match_id,
                player: &caller_b58,
                reason: &reason,
            });
            app::bail!(GameError::AuditFailed { reason });
        }
        app::emit!(Event::BoardRevealed {
            id: match_id,
            player: &caller_b58,
        });
        app::emit!(Event::AuditPassed {
            id: match_id,
            player: &caller_b58,
        });
        Ok(())
    }

    pub fn export_board_seed(&self, match_id: &str) -> app::Result<ExportedSeed> {
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id))?
            .ok_or_else(|| AppError::from(GameError::BoardNotFound))?;
        // Export the pristine-board snapshot so the commitment recomputation
        // on re-import always matches regardless of mid-game mutations.
        let pristine = pb.pristine().to_vec();
        let board_bytes = calimero_sdk::borsh::to_vec(&pristine)
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        Ok(ExportedSeed {
            board_bytes,
            salt: *pb.salt(),
        })
    }

    pub fn import_board_seed(
        &mut self,
        match_id: &str,
        board_bytes: Vec<u8>,
        salt: [u8; 16],
    ) -> app::Result<()> {
        let caller = from_executor_id()?;
        let expected = self
            .commitments
            .get_for_user(&sdk_pk(&caller))
            .map_err(|e| AppError::msg(format!("commitments.get_for_user: {e}")))?
            .ok_or_else(|| AppError::from(GameError::Invalid("no commitment for caller")))?;
        let expected_hash = *expected.get();
        if !audit::verify_commitment(&board_bytes, &salt, &expected_hash) {
            app::bail!(GameError::CommitmentMismatch);
        }
        let board: board::Board = calimero_sdk::borsh::from_slice(&board_bytes)
            .map_err(|e| AppError::msg(format!("deserialize board: {e}")))?;
        let ship_count = board.0.iter().filter(|&&c| is_ship_cell(c)).count() as u64;
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        priv_mut.boards.insert(
            PrivateBoards::key(match_id),
            PlayerBoard::new_with_salt(board, ship_count, true, salt),
        )?;
        Ok(())
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        let caller = from_executor_id()?;
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id))?
            .ok_or_else(|| AppError::from(GameError::NotFound(match_id.to_string())))?;
        let mut board = pb.get_board().0.clone();
        if let Some(p) = self.pending.get().as_ref() {
            if p.target == caller {
                let idx = (p.y as usize) * (BOARD_SIZE as usize) + (p.x as usize);
                if idx < board.len() {
                    board[idx] = Cell::Pending.to_u8();
                }
            }
        }
        Ok(OwnBoardView {
            size: BOARD_SIZE,
            board,
        })
    }

    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let active_id = self
            .match_id
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("no active match")))?;
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        let caller = from_executor_id()?;
        let p1 = self.player1_or_panic()?;
        let p2 = self.player2_or_panic()?;
        if caller != p1 && caller != p2 {
            app::bail!(GameError::Forbidden("not a player"));
        }
        let map = if caller == p1 {
            &self.shots_p1
        } else {
            &self.shots_p2
        };
        let mut shots = vec![0u8; (BOARD_SIZE as usize) * (BOARD_SIZE as usize)];
        let entries = map
            .entries()
            .map_err(|e| AppError::msg(format!("shots.entries: {e}")))?;
        for (key, reg) in entries {
            let idx = key[0] as usize;
            if idx < shots.len() {
                shots[idx] = *reg.get();
            }
        }
        Ok(ShotsView {
            size: BOARD_SIZE,
            shots,
        })
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        Ok(self.match_id.get().clone())
    }

    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        Ok(self.turn.get().as_ref().map(|pk| pk.to_base58()))
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(from_executor_id()?.to_base58())
    }

    #[allow(unused_variables)]
    pub fn acknowledge_shot_handler(&mut self, id: &str, x: u8, y: u8) -> app::Result<()> {
        self.acknowledge_shot(id)?;
        Ok(())
    }
}

impl GameState {
    fn is_player(&self, pk: &PublicKey) -> bool {
        self.player1.get().as_ref() == Some(pk) || self.player2.get().as_ref() == Some(pk)
    }

    fn player1_or_panic(&self) -> app::Result<PublicKey> {
        self.player1
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("player1 unset")))
    }

    fn player2_or_panic(&self) -> app::Result<PublicKey> {
        self.player2
            .get()
            .clone()
            .ok_or_else(|| AppError::from(GameError::Invalid("player2 unset")))
    }
}

/// Compute `SHA256(board_bytes || salt)` — exposed for tests and cross-module use.
pub fn compute_commitment(board_bytes: &[u8], salt: &[u8; 16]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    h.finalize().into()
}

fn hex_encode(bytes: &[u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Helper used by the audit routine (Task 9) and commitment bootstrapping (Task 7).
pub fn is_ship_cell(value: u8) -> bool {
    Cell::from_u8(value) == Cell::Ship
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_ship_cell_identifies_ship_sentinel() {
        assert!(is_ship_cell(Cell::Ship.to_u8()));
        assert!(!is_ship_cell(Cell::Empty.to_u8()));
        assert!(!is_ship_cell(Cell::Hit.to_u8()));
        assert!(!is_ship_cell(Cell::Miss.to_u8()));
        assert!(!is_ship_cell(Cell::Pending.to_u8()));
    }

    #[test]
    fn game_state_skeleton_fields_are_empty() {
        let state = GameState::init("".into(), "".into(), None);
        assert!(state.lobby_context_id.get().is_none());
        assert!(state.match_id.get().is_none());
        assert!(state.player1.get().is_none());
        assert!(state.winner.get().is_none());
        assert!(!(*state.placed_p1.get()));
        assert!(!(*state.placed_p2.get()));
        assert!(state.pending.get().is_none());
    }

    #[test]
    fn compute_commitment_matches_manual_sha256() {
        let board_bytes = calimero_sdk::borsh::to_vec(&vec![1u8, 0, 0, 1u8]).unwrap();
        let salt = [9u8; 16];
        let mut h = Sha256::new();
        h.update(&board_bytes);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        assert_eq!(compute_commitment(&board_bytes, &salt), expected);
    }

    #[test]
    fn hex_encode_produces_64_char_lowercase() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xAB;
        bytes[31] = 0xCD;
        let s = hex_encode(&bytes);
        assert_eq!(s.len(), 64);
        assert!(s.starts_with("ab"));
        assert!(s.ends_with("cd"));
        assert!(s
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn init_with_valid_players_sets_turn_to_player1() {
        let pk1 = PublicKey([1u8; 32]).to_base58();
        let pk2 = PublicKey([2u8; 32]).to_base58();
        let state = GameState::init(pk1.clone(), pk2, Some("lobby".into()));
        assert_eq!(state.turn.get().as_ref().unwrap().to_base58(), pk1);
        assert!(state.match_id.get().is_some());
        assert_eq!(state.lobby_context_id.get().as_deref(), Some("lobby"));
    }
}
