//! # Game Module (post-Match-dissolution placeholder)
//!
//! The `Match` struct and `ShotResolver` that used to live here have been
//! removed as part of Task 5 of the CRDT migration. Match fields are now
//! flattened directly onto `GameState` (see `lib.rs`), each wrapped in a
//! Calimero CRDT primitive so concurrent writes merge cleanly.
//!
//! The shot-resolution logic that `ShotResolver` encapsulated is re-introduced
//! in Task 10, directly against the new flattened state.
