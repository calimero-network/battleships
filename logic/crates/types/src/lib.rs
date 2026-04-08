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
