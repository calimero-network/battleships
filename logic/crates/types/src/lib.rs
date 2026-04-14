use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum GameError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(&'static str),
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("already finished")]
    Finished,
    #[error("match id already exists")]
    MatchIdCollision,
    #[error("board commitment already set")]
    AlreadyCommitted,
    #[error("commitment hash does not match revealed board")]
    CommitmentMismatch,
    #[error("audit failed: {reason}")]
    AuditFailed { reason: String },
    #[error("private board not found for this match")]
    BoardNotFound,
}

/// Seed material for exporting a player's private board so it can be re-imported
/// on another node (e.g. after device migration). The salt is required to
/// reconstruct the SHA256 commitment that was published on-chain at placement time.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct ExportedSeed {
    pub board_bytes: Vec<u8>,
    pub salt: [u8; 16],
}

/// Player public key — 32-byte Ed25519 key with base58 encoding.
///
/// Note: `from_executor_id()` lives in each service crate (requires calimero-sdk).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    pub fn from_base58(encoded: &str) -> Result<PublicKey, GameError> {
        let decoded = bs58::decode(encoded)
            .into_vec()
            .map_err(|_| GameError::Invalid("bad base58 key"))?;
        if decoded.len() != 32 {
            return Err(GameError::Invalid("key length"));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&decoded);
        Ok(PublicKey(arr))
    }

    pub fn to_base58(&self) -> String {
        bs58::encode(&self.0).into_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_base58_roundtrip() {
        let key = PublicKey([42u8; 32]);
        let encoded = key.to_base58();
        let decoded = PublicKey::from_base58(&encoded).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn public_key_bad_base58_fails() {
        assert!(PublicKey::from_base58("!!!invalid!!!").is_err());
    }

    #[test]
    fn public_key_wrong_length_fails() {
        let short = bs58::encode(&[1u8; 16]).into_string();
        assert!(PublicKey::from_base58(&short).is_err());
    }

    #[test]
    fn public_key_borsh_roundtrip() {
        let key = PublicKey([7u8; 32]);
        let bytes = borsh::to_vec(&key).unwrap();
        let decoded: PublicKey = borsh::from_slice(&bytes).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn game_error_display() {
        let err = GameError::NotFound("test".into());
        assert!(err.to_string().contains("test"));
        assert!(GameError::Finished.to_string().contains("finished"));
    }

    #[test]
    fn error_variants_exist() {
        let _ = GameError::MatchIdCollision;
        let _ = GameError::AlreadyCommitted;
        let _ = GameError::CommitmentMismatch;
        let _ = GameError::AuditFailed { reason: "x".into() };
        let _ = GameError::BoardNotFound;
    }

    #[test]
    fn exported_seed_roundtrips_borsh() {
        let seed = ExportedSeed {
            board_bytes: vec![1, 2, 3],
            salt: [7u8; 16],
        };
        let bytes = borsh::to_vec(&seed).unwrap();
        let back: ExportedSeed = borsh::from_slice(&bytes).unwrap();
        assert_eq!(back.board_bytes, vec![1, 2, 3]);
        assert_eq!(back.salt, [7u8; 16]);
    }
}
