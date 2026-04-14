//! Audit routine: verifies a player's commitment and replays the shots
//! recorded against them against their revealed board.
//!
//! Called by:
//!   - `acknowledge_shot` on the winning shot (Task 10) — ensures the
//!     acknowledger is not lying about the sunk-ship count.
//!   - `reveal_board` (Task 11) — optional post-match proof by the loser.

use calimero_storage::collections::{LwwRegister, UnorderedMap};
use sha2::{Digest, Sha256};

use crate::board::{Cell, BOARD_SIZE};

#[derive(Debug, Clone, PartialEq)]
pub enum AuditFailure {
    CommitmentMismatch,
    ShotInconsistent {
        x: u8,
        y: u8,
        recorded: Cell,
        actual_is_ship: bool,
    },
}

impl core::fmt::Display for AuditFailure {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AuditFailure::CommitmentMismatch => write!(f, "commitment_mismatch"),
            AuditFailure::ShotInconsistent {
                x,
                y,
                recorded,
                actual_is_ship,
            } => write!(
                f,
                "shot_inconsistent(x={x}, y={y}, recorded={recorded:?}, actual_is_ship={actual_is_ship})"
            ),
        }
    }
}

/// Recompute `SHA256(board_bytes || salt)` and compare against the published commitment.
pub fn verify_commitment(board_bytes: &[u8], salt: &[u8; 16], expected: &[u8; 32]) -> bool {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    let got: [u8; 32] = h.finalize().into();
    &got == expected
}

/// Replay every recorded shot against the revealed board. A `Hit` at a
/// non-ship cell or a `Miss` at a ship cell is a lie.
pub fn replay_shots(
    own_board_cells: &[u8],
    shots_against_me: &UnorderedMap<[u8; 1], LwwRegister<u8>>,
) -> Result<(), AuditFailure> {
    // Snapshot keys so we don't borrow across the map.
    let keys: Vec<[u8; 1]> = match shots_against_me.entries() {
        Ok(iter) => iter.map(|(k, _)| k).collect(),
        Err(_) => return Err(AuditFailure::CommitmentMismatch),
    };
    for key in keys {
        let cell_u8 = match shots_against_me.get(&key) {
            Ok(Some(reg)) => *reg.get(),
            _ => continue,
        };
        let idx_flat = key[0];
        let x = idx_flat % BOARD_SIZE;
        let y = idx_flat / BOARD_SIZE;
        let idx = (y as usize) * (BOARD_SIZE as usize) + (x as usize);
        if idx >= own_board_cells.len() {
            continue;
        }
        let actual_is_ship = Cell::from_u8(own_board_cells[idx]) == Cell::Ship;
        let recorded = Cell::from_u8(cell_u8);
        match recorded {
            Cell::Hit if !actual_is_ship => {
                return Err(AuditFailure::ShotInconsistent {
                    x,
                    y,
                    recorded,
                    actual_is_ship,
                });
            }
            Cell::Miss if actual_is_ship => {
                return Err(AuditFailure::ShotInconsistent {
                    x,
                    y,
                    recorded,
                    actual_is_ship,
                });
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_with_ship_at(idx: usize) -> Vec<u8> {
        let mut b = vec![0u8; 100];
        b[idx] = Cell::Ship.to_u8();
        b
    }

    #[test]
    fn verify_commitment_accepts_matching_hash() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        assert!(verify_commitment(&board, &salt, &expected));
    }

    #[test]
    fn verify_commitment_rejects_tampered_board() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();

        let mut tampered = board.clone();
        tampered[0] = 0;
        assert!(!verify_commitment(&tampered, &salt, &expected));
    }

    #[test]
    fn verify_commitment_rejects_wrong_salt() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        let wrong_salt = [6u8; 16];
        assert!(!verify_commitment(&board, &wrong_salt, &expected));
    }
}
