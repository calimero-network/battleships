# Battleships CRDT Migration & Board Commitment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `battleships/logic/` to use Calimero CRDT primitives for all mergeable state, add a SHA256 board-commitment scheme with automatic post-game audit, and expose export/import hooks so players can back up their private board.

**Architecture:** Two-context model is preserved. `LobbyState` and `GameState` fields become CRDTs (`UnorderedMap`, `Vector`, `Counter`, `LwwRegister`, `UserStorage`). The `Match` struct is dissolved; its fields flatten onto `GameState`. Commitments (SHA256 hashes) live in `UserStorage<[u8; 32]>` — writer-authorized by the owning player. Secret boards + salts continue to live in `#[app::private] PrivateBoards`. The winning `acknowledge_shot` triggers an internal audit that both verifies the commitment and replays every recorded shot against the revealed board.

**Tech Stack:** Rust, `calimero-sdk`, `calimero-storage` (CRDT collections), `sha2` (already transitive in `Cargo.lock`; also re-exported as `calimero_storage::exports::sha2`), `borsh` for deterministic serialization.

**Spec:** `docs/superpowers/specs/2026-04-14-battleships-crdt-design.md`

---

## File Structure

**Create:**
- `battleships/logic/crates/game/src/audit.rs` — pure, testable audit routine

**Modify:**
- `battleships/logic/crates/types/src/lib.rs` — error variants, `ExportedSeed`
- `battleships/logic/crates/lobby/src/lib.rs` — state struct, methods
- `battleships/logic/crates/lobby/src/events.rs` — new event variants
- `battleships/logic/crates/game/src/lib.rs` — state struct, methods, audit wiring
- `battleships/logic/crates/game/src/events.rs` — new event variants
- `battleships/logic/crates/game/src/game.rs` — delete `Match`; keep `ShotResolver` helpers
- `battleships/logic/crates/game/src/players.rs` — add `salt: [u8; 16]` to `PlayerBoard`; new accessors

**Do not touch:** `board.rs`, `ships.rs`, `validation.rs`, frontend (`battleships/app/`). Frontend adaptation is a separate task.

---

## Imports used throughout

```rust
use calimero_sdk::{app, env};
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::types::{Error, PublicKey};
use calimero_storage::collections::{
    Counter, LwwRegister, UnorderedMap, UserStorage, Vector,
};
use calimero_storage::exports::sha2::{Digest, Sha256};
```

If `PublicKey` is re-exported elsewhere in the existing codebase, follow the existing import path.

---

### Task 0: Preflight — baseline build + test scaffolding

**Files:**
- Inspect: `battleships/logic/Cargo.toml`, `battleships/logic/crates/*/Cargo.toml`

- [ ] **Step 1: Confirm clean baseline builds**

Run: `cd /Users/beast/Developer/Calimero/battleships/logic && cargo build --workspace 2>&1 | tail -20`
Expected: builds without warnings related to our target files. If it fails, stop and report — do not proceed until the baseline is green.

- [ ] **Step 2: Confirm `calimero-storage` collections are reachable**

Run: `cd /Users/beast/Developer/Calimero/battleships/logic && cargo doc --workspace --no-deps --open=false 2>&1 | grep -i calimero_storage`
Expected: calimero-storage appears in the dependency graph. If not, open the crate-level `Cargo.toml` of `lobby` and `game` and add `calimero-storage = { git = "...", branch = "master" }` matching the existing `calimero-sdk` entry.

- [ ] **Step 3: Confirm `sha2` is available via re-export**

Write a throwaway test file `battleships/logic/crates/game/src/_probe.rs`:

```rust
#[cfg(test)]
mod probe {
    #[test]
    fn sha2_reexport_compiles() {
        use calimero_storage::exports::sha2::{Digest, Sha256};
        let _ = Sha256::digest(b"hello");
    }
}
```

Temporarily add `mod _probe;` at the top of `game/src/lib.rs`.

Run: `cargo test -p battleships-game probe -- --nocapture`
Expected: PASS. If it fails, add `sha2 = "0.10"` directly to `game/Cargo.toml` and adjust imports in all later tasks to `use sha2::{Digest, Sha256};`.

- [ ] **Step 4: Remove the probe**

Delete `battleships/logic/crates/game/src/_probe.rs` and the `mod _probe;` line.

- [ ] **Step 5: Commit baseline**

```bash
cd /Users/beast/Developer/Calimero/battleships
git add -A
git commit -m "chore: verify calimero-storage + sha2 reachable for crdt migration" --allow-empty
```

---

### Task 1: Types crate — errors, events, ExportedSeed

**Files:**
- Modify: `battleships/logic/crates/types/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Append to `types/src/lib.rs` (or create `types/src/tests.rs` and `mod tests;`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_variants_exist() {
        let _ = BattleshipsError::MatchIdCollision;
        let _ = BattleshipsError::AlreadyCommitted;
        let _ = BattleshipsError::CommitmentMismatch;
        let _ = BattleshipsError::AuditFailed { reason: "x".into() };
        let _ = BattleshipsError::BoardNotFound;
    }

    #[test]
    fn exported_seed_roundtrips_borsh() {
        let seed = ExportedSeed { board_bytes: vec![1, 2, 3], salt: [7u8; 16] };
        let bytes = borsh::to_vec(&seed).unwrap();
        let back: ExportedSeed = borsh::from_slice(&bytes).unwrap();
        assert_eq!(back.board_bytes, vec![1, 2, 3]);
        assert_eq!(back.salt, [7u8; 16]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/beast/Developer/Calimero/battleships/logic && cargo test -p battleships-types`
Expected: FAIL — `BattleshipsError` or `ExportedSeed` not defined (or variants missing). If `BattleshipsError` has another name in the existing file, rename the test accordingly — we'll *add* to whatever error enum exists, not create a parallel one.

- [ ] **Step 3: Add variants and the ExportedSeed struct**

Open `types/src/lib.rs`. Find the existing error enum (if any) and add these variants. If none exists, define the enum:

```rust
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, thiserror::Error, BorshSerialize, BorshDeserialize)]
pub enum BattleshipsError {
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
    // keep any existing variants above this line
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct ExportedSeed {
    pub board_bytes: Vec<u8>,
    pub salt: [u8; 16],
}
```

If `thiserror` isn't in `types/Cargo.toml`, add it: `thiserror = "1"`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-types`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/types/
git commit -m "feat(types): add crdt-migration error variants and ExportedSeed"
```

---

### Task 2: Lobby — state struct + PlayerStats with Counters

**Files:**
- Modify: `battleships/logic/crates/lobby/src/lib.rs` (replace the `LobbyState`, `PlayerStats`, `PlayerStatsEntry` definitions; old types L98-107 and the PlayerStatsEntry near it)

- [ ] **Step 1: Write failing tests**

Add a `#[cfg(test)] mod tests { ... }` block at the bottom of `lobby/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_stats_counters_start_at_zero() {
        let stats = PlayerStats::new("alice_b58");
        assert_eq!(stats.wins.value_unsigned().unwrap(), 0);
        assert_eq!(stats.losses.value_unsigned().unwrap(), 0);
        assert_eq!(stats.games_played.value_unsigned().unwrap(), 0);
    }

    #[test]
    fn player_stats_increments_accumulate() {
        let mut stats = PlayerStats::new("alice_b58");
        stats.wins.increment().unwrap();
        stats.games_played.increment().unwrap();
        stats.games_played.increment().unwrap();
        assert_eq!(stats.wins.value_unsigned().unwrap(), 1);
        assert_eq!(stats.games_played.value_unsigned().unwrap(), 2);
        assert_eq!(stats.losses.value_unsigned().unwrap(), 0);
    }
}
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cargo test -p battleships-lobby`
Expected: FAIL — `PlayerStats` doesn't have `wins.value_unsigned()`; it's still `u64`.

- [ ] **Step 3: Replace state + stats definitions**

In `lobby/src/lib.rs`, at the top add the new imports:

```rust
use calimero_sdk::{app, env};
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::collections::{Counter, LwwRegister, UnorderedMap, Vector};
```

Replace `LobbyState`:

```rust
#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct LobbyState {
    created_ms: LwwRegister<u64>,
    matches: UnorderedMap<String, MatchSummary>,
    player_stats: UnorderedMap<String, PlayerStats>,
    history: Vector<MatchRecord>,
}
```

Replace `PlayerStats` (and **delete** `PlayerStatsEntry` — we no longer need an entry wrapper, the map key is the player):

```rust
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PlayerStats {
    pub wins: Counter,
    pub losses: Counter,
    pub games_played: Counter,
}

impl PlayerStats {
    pub fn new(player_key: &str) -> Self {
        Self {
            wins: Counter::new_with_field_name(&format!("stats:{player_key}:wins")),
            losses: Counter::new_with_field_name(&format!("stats:{player_key}:losses")),
            games_played: Counter::new_with_field_name(&format!("stats:{player_key}:games")),
        }
    }
}
```

Keep `MatchSummary` as a plain struct (per decision #5 in the spec) — only update its derive block if it was missing `#[borsh(crate = "calimero_sdk::borsh")]`:

```rust
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MatchSummary {
    pub match_id: String,
    pub player1: String,
    pub player2: String,
    pub status: MatchStatus,
    pub context_id: Option<String>,
    pub winner: Option<String>,
    pub created_ms: u64,
}
```

Old `id_nonce` field: **remove** from state struct. Any references to it elsewhere in the file will break — that's expected; Task 3 resolves them.

- [ ] **Step 4: Run the unit tests**

Run: `cargo test -p battleships-lobby stats`
Expected: both stats tests PASS. Broader build may still fail because `init()` and `create_match()` reference the old shape — that's Task 3.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/lobby/
git commit -m "feat(lobby): migrate LobbyState and PlayerStats to calimero CRDTs"
```

---

### Task 3: Lobby — `init()` and `create_match()` with collision rejection

**Files:**
- Modify: `battleships/logic/crates/lobby/src/lib.rs` (init currently L69-71; create_match currently L146-168)

- [ ] **Step 1: Write failing tests**

Append to the `#[cfg(test)] mod tests` block:

```rust
#[test]
fn init_populates_created_ms() {
    let state = LobbyState::init();
    assert!(*state.created_ms.get() > 0);
}

#[test]
fn create_match_uses_composed_id() {
    // The implementation reads env::time_now() and env::executor_id(); in a unit
    // test environment those return deterministic or zeroed values. This test
    // documents the expected format rather than a specific value.
    let mut state = LobbyState::init();
    let caller_b58 = bs58::encode([1u8; 32]).into_string();
    let player2_b58 = bs58::encode([2u8; 32]).into_string();
    let id = state
        .create_match_with_clock(&caller_b58, &player2_b58, 1_700_000_000_000)
        .unwrap();
    assert!(id.starts_with(&format!("{caller_b58}-{player2_b58}-")));
    assert!(state.matches.contains(&id).unwrap());
}

#[test]
fn create_match_rejects_collision() {
    let mut state = LobbyState::init();
    let a = bs58::encode([1u8; 32]).into_string();
    let b = bs58::encode([2u8; 32]).into_string();
    let ts = 1_700_000_000_000u64;
    let _ = state.create_match_with_clock(&a, &b, ts).unwrap();
    let err = state.create_match_with_clock(&a, &b, ts).unwrap_err();
    assert!(matches!(err, BattleshipsError::MatchIdCollision));
}
```

If `bs58` isn't already a dev-dep on the lobby crate, add `bs58 = "0.5"` under `[dev-dependencies]` in `lobby/Cargo.toml`. Import it in the test module as `use bs58;`.

Also import the error: `use battleships_types::BattleshipsError;` (adjust to the actual crate name).

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-lobby create_match`
Expected: FAIL — `create_match_with_clock` undefined.

- [ ] **Step 3: Implement `init` and the split create_match**

Replace the existing `init()` and `create_match()` implementations:

```rust
#[app::logic]
impl LobbyState {
    #[app::init]
    pub fn init() -> LobbyState {
        LobbyState {
            created_ms: LwwRegister::new(env::time_now()),
            matches: UnorderedMap::new_with_field_name("lobby:matches"),
            player_stats: UnorderedMap::new_with_field_name("lobby:player_stats"),
            history: Vector::new_with_field_name("lobby:history"),
        }
    }

    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        let caller_b58 = bs58::encode(env::executor_id()).into_string();
        let now = env::time_now();
        self.create_match_with_clock(&caller_b58, &player2, now)
            .map_err(|e| Error::msg(e.to_string()))
    }

    // Separated for deterministic testing. Not exposed as an app method (no `pub` on impl block).
    pub(crate) fn create_match_with_clock(
        &mut self,
        caller_b58: &str,
        player2_b58: &str,
        now_ms: u64,
    ) -> Result<String, BattleshipsError> {
        let match_id = format!("{caller_b58}-{player2_b58}-{now_ms}");
        if self.matches.contains(&match_id).map_err(|_| BattleshipsError::BoardNotFound)? {
            app::emit!(Event::MatchIdCollision { attempted_id: &match_id });
            return Err(BattleshipsError::MatchIdCollision);
        }
        let summary = MatchSummary {
            match_id: match_id.clone(),
            player1: caller_b58.to_string(),
            player2: player2_b58.to_string(),
            status: MatchStatus::Pending,
            context_id: None,
            winner: None,
            created_ms: now_ms,
        };
        self.matches.insert(match_id.clone(), summary)
            .map_err(|_| BattleshipsError::BoardNotFound)?;
        app::emit!(Event::MatchCreated {
            match_id: &match_id,
            player1: caller_b58,
            player2: player2_b58,
        });
        Ok(match_id)
    }
}
```

Add the `MatchIdCollision` variant to the event enum (Task 13 will audit all event emissions, but we need this one now):

In `lobby/src/events.rs`, add to the `Event<'a>` enum:

```rust
MatchIdCollision { attempted_id: &'a str },
```

Delete any leftover references to `id_nonce` in `lib.rs` (e.g., in old `init()` body).

Add `use battleships_types::BattleshipsError;` at the top of `lib.rs`. Confirm `bs58` is in main `[dependencies]` (not just dev-deps): `bs58 = "0.5"`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-lobby`
Expected: stats tests + create_match tests PASS. Other lobby methods may still fail to compile — we'll fix them in Task 4.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/lobby/
git commit -m "feat(lobby): create_match uses composed id with collision rejection"
```

---

### Task 4: Lobby — `set_match_context_id` and `on_match_finished`

**Files:**
- Modify: `battleships/logic/crates/lobby/src/lib.rs` (set_match_context_id L170-192; on_match_finished L210-242; and `find_or_create_stats` L127-142 — delete)

- [ ] **Step 1: Write failing tests**

Append to the tests module:

```rust
#[test]
fn set_match_context_id_promotes_to_active() {
    let mut state = LobbyState::init();
    let a = bs58::encode([1u8; 32]).into_string();
    let b = bs58::encode([2u8; 32]).into_string();
    let id = state.create_match_with_clock(&a, &b, 1_700_000_000_000).unwrap();
    state.set_match_context_id(id.clone(), "ctx_abc".into()).unwrap();
    let summary = state.matches.get(&id).unwrap().unwrap();
    assert!(matches!(summary.status, MatchStatus::Active));
    assert_eq!(summary.context_id.as_deref(), Some("ctx_abc"));
}

#[test]
fn on_match_finished_records_winner_and_increments_counters() {
    let mut state = LobbyState::init();
    let winner = bs58::encode([1u8; 32]).into_string();
    let loser = bs58::encode([2u8; 32]).into_string();
    let id = state.create_match_with_clock(&winner, &loser, 1_700_000_000_000).unwrap();
    state.on_match_finished(id.clone(), winner.clone(), loser.clone()).unwrap();

    let summary = state.matches.get(&id).unwrap().unwrap();
    assert!(matches!(summary.status, MatchStatus::Finished));
    assert_eq!(summary.winner.as_deref(), Some(winner.as_str()));

    let winner_stats = state.player_stats.get(&winner).unwrap().unwrap();
    assert_eq!(winner_stats.wins.value_unsigned().unwrap(), 1);
    assert_eq!(winner_stats.games_played.value_unsigned().unwrap(), 1);

    let loser_stats = state.player_stats.get(&loser).unwrap().unwrap();
    assert_eq!(loser_stats.losses.value_unsigned().unwrap(), 1);
    assert_eq!(loser_stats.games_played.value_unsigned().unwrap(), 1);

    assert_eq!(state.history.len().unwrap(), 1);
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-lobby`
Expected: FAIL — methods reference removed Vec fields.

- [ ] **Step 3: Rewrite the two methods, delete the helper**

Delete `find_or_create_stats` and any private Vec-scanning helpers.

Replace:

```rust
pub fn set_match_context_id(&mut self, match_id: String, context_id: String)
    -> app::Result<()>
{
    let mut summary = self.matches.get(&match_id)
        .map_err(|e| Error::msg(format!("lookup failed: {e}")))?
        .ok_or_else(|| Error::msg("unknown match_id"))?;
    summary.status = MatchStatus::Active;
    summary.context_id = Some(context_id.clone());
    self.matches.insert(match_id.clone(), summary)
        .map_err(|e| Error::msg(format!("insert failed: {e}")))?;
    app::emit!(Event::MatchContextSet { match_id: &match_id, context_id: &context_id });
    Ok(())
}

pub fn on_match_finished(&mut self, match_id: String, winner: String, loser: String)
    -> app::Result<()>
{
    let mut summary = self.matches.get(&match_id)
        .map_err(|e| Error::msg(format!("lookup failed: {e}")))?
        .ok_or_else(|| Error::msg("unknown match_id"))?;
    summary.status = MatchStatus::Finished;
    summary.winner = Some(winner.clone());
    self.matches.insert(match_id.clone(), summary)
        .map_err(|e| Error::msg(format!("insert failed: {e}")))?;

    self.history.push(MatchRecord {
        match_id: match_id.clone(),
        winner: winner.clone(),
        loser: loser.clone(),
        finished_ms: env::time_now(),
    }).map_err(|e| Error::msg(format!("history push failed: {e}")))?;

    bump_stats(&mut self.player_stats, &winner, true)?;
    bump_stats(&mut self.player_stats, &loser, false)?;

    app::emit!(Event::MatchFinished {
        match_id: &match_id,
        winner: &winner,
        loser: &loser,
    });
    Ok(())
}
```

Add a free function near the impl block:

```rust
fn bump_stats(
    stats_map: &mut UnorderedMap<String, PlayerStats>,
    player_key: &str,
    is_winner: bool,
) -> app::Result<()> {
    let mut stats = stats_map.get(player_key)
        .map_err(|e| Error::msg(format!("stats lookup failed: {e}")))?
        .unwrap_or_else(|| PlayerStats::new(player_key));
    stats.games_played.increment()
        .map_err(|e| Error::msg(format!("increment failed: {e}")))?;
    if is_winner {
        stats.wins.increment().map_err(|e| Error::msg(e.to_string()))?;
    } else {
        stats.losses.increment().map_err(|e| Error::msg(e.to_string()))?;
    }
    stats_map.insert(player_key.to_string(), stats)
        .map_err(|e| Error::msg(format!("stats insert failed: {e}")))?;
    Ok(())
}
```

If `MatchContextSet` or `MatchFinished` variants don't exist in `events.rs`, add them now:

```rust
MatchContextSet { match_id: &'a str, context_id: &'a str },
MatchFinished   { match_id: &'a str, winner: &'a str, loser: &'a str },
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-lobby`
Expected: all lobby tests PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/lobby/
git commit -m "feat(lobby): finish_match uses Counter-backed PlayerStats and Vector history"
```

---

### Task 5: Game — flatten `Match` fields onto `GameState`

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs` (state struct L59-65)
- Modify: `battleships/logic/crates/game/src/game.rs` (delete the `Match` struct at L100-130; keep `ShotResolver` and helper functions)

- [ ] **Step 1: Replace the state struct**

In `game/src/lib.rs`, replace `GameState`:

```rust
use calimero_sdk::{app, env};
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::types::{Error, PublicKey};
use calimero_storage::collections::{LwwRegister, UnorderedMap, UserStorage};

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct GameState {
    pub lobby_context_id: LwwRegister<Option<String>>,
    pub match_id:         LwwRegister<Option<String>>,
    pub player1:          LwwRegister<Option<PublicKey>>,
    pub player2:          LwwRegister<Option<PublicKey>>,
    pub turn:             LwwRegister<Option<PublicKey>>,
    pub winner:           LwwRegister<Option<PublicKey>>,
    pub placed_p1:        LwwRegister<bool>,
    pub placed_p2:        LwwRegister<bool>,
    pub pending:          LwwRegister<Option<PendingShot>>,
    pub shots_p1:         UnorderedMap<u8, Cell>,
    pub shots_p2:         UnorderedMap<u8, Cell>,
    pub commitments:     UserStorage<[u8; 32]>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PendingShot {
    pub x: u8,
    pub y: u8,
    pub shooter: PublicKey,
    pub target: PublicKey,
}
```

`Cell` is the existing enum/u8 newtype from `board.rs` — keep its current definition untouched. If `Cell` is currently `u8`-aliased rather than an enum, keep it as-is.

- [ ] **Step 2: Delete `Match` from `game.rs`**

Remove the `pub struct Match { … }` definition and its entire `impl Match { … }` block from `game.rs`. Keep `ShotResolver` and any pure helpers (placement validation calls, board-index helpers, etc.).

The file compilation will break wherever `Match` is referenced from `lib.rs`. Task 7 onward reconstructs the methods.

- [ ] **Step 3: Confirm the state struct compiles in isolation**

Comment out *the body* of every method under `#[app::logic] impl GameState { … }` in `lib.rs` **except `init`** — replace each method body with `todo!("task N")`. This keeps declarations intact so `#[app::logic]` doesn't error, while letting us verify the state struct compiles.

Run: `cargo check -p battleships-game`
Expected: compiles (warnings about unused are OK).

- [ ] **Step 4: Commit (broken methods explicitly marked)**

```bash
git add battleships/logic/crates/game/
git commit -m "refactor(game): flatten Match fields onto GameState as CRDTs (methods stubbed)"
```

Note: do NOT leave the tree broken at the commit-tree level — all method bodies are `todo!()` but the file compiles. That's acceptable because the next tasks immediately refill them.

---

### Task 6: `PlayerBoard` gains a `salt` field

**Files:**
- Modify: `battleships/logic/crates/game/src/players.rs` (L82-92 PlayerBoard; L193-198 PrivateBoards; any constructor call sites)

- [ ] **Step 1: Write failing test**

Append a test module to `players.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_board_default_has_zero_salt() {
        let pb = PlayerBoard::default();
        assert_eq!(pb.salt, [0u8; 16]);
    }

    #[test]
    fn player_board_stores_custom_salt() {
        let pb = PlayerBoard::new_with_salt(Board::default(), 0, false, [7u8; 16]);
        assert_eq!(pb.salt, [7u8; 16]);
    }
}
```

(Adjust `Board::default()` to whatever the existing `Board` constructor is — if `Board` is `Vec<u8>`, use `vec![0u8; 100]`.)

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game player_board`
Expected: FAIL — `salt` field / `new_with_salt` missing.

- [ ] **Step 3: Extend `PlayerBoard`**

```rust
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PlayerBoard {
    pub own: Board,
    pub ships: u64,
    pub placed: bool,
    pub salt: [u8; 16],
}

impl PlayerBoard {
    pub fn new_with_salt(own: Board, ships: u64, placed: bool, salt: [u8; 16]) -> Self {
        Self { own, ships, placed, salt }
    }
}

impl Default for PlayerBoard {
    fn default() -> Self {
        Self {
            own: Board::default(), // or vec![0u8; 100] depending on existing Board alias
            ships: 0,
            placed: false,
            salt: [0u8; 16],
        }
    }
}
```

Any existing `PlayerBoard { own, ships, placed }` literal in `players.rs` or elsewhere must be updated to include `salt: [0u8; 16]`. Search with: `cd battleships/logic && rg 'PlayerBoard \{' --type rust`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game player_board`
Expected: PASS.

- [ ] **Step 5: Add `is_ship_cell` helper to `board.rs`**

Open `battleships/logic/crates/game/src/board.rs`. Add (or export) a predicate that matches whatever the project's ship sentinel is:

```rust
pub fn is_ship_cell(c: u8) -> bool {
    // Replace with the actual Cell::Ship sentinel after confirming from the enum.
    c == 1
}
```

If `board.rs` already has such a predicate under a different name, add a `pub use` alias or simply rename the calls in Tasks 7, 9, 10 to the existing name.

- [ ] **Step 6: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): add salt field to PlayerBoard and is_ship_cell helper"
```

---

### Task 7: Game — `init()` and `place_ships()` with commitment

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs` (init L69-83 stub, place_ships L101-125 stub)

- [ ] **Step 1: Write failing test**

Append to `#[cfg(test)] mod tests` in `game/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use calimero_storage::exports::sha2::{Digest, Sha256};

    fn sample_ships() -> Vec<String> {
        // Whatever the existing ship-string format is; adjust to match validation.rs.
        // Minimal valid placement of one 1-length ship:
        vec!["0,0".to_string()]
    }

    #[test]
    fn init_creates_empty_state() {
        let pk1 = PublicKey::from([1u8; 32]);
        let pk2 = PublicKey::from([2u8; 32]);
        let state = GameState::init(pk1, pk2, Some("lobby_ctx".into()));
        assert_eq!(*state.player1.get(), Some(pk1));
        assert_eq!(*state.player2.get(), Some(pk2));
        assert_eq!(*state.turn.get(), Some(pk1));
        assert_eq!(*state.winner.get(), None);
        assert_eq!(*state.placed_p1.get(), false);
        assert_eq!(*state.placed_p2.get(), false);
    }

    #[test]
    fn commitment_matches_sha256_of_board_and_salt() {
        // Unit-level verification of the hashing primitive used by place_ships.
        let board_bytes = borsh::to_vec(&vec![1u8, 0, 0, 1u8]).unwrap();
        let salt = [9u8; 16];
        let mut h = Sha256::new();
        h.update(&board_bytes);
        h.update(&salt);
        let expected: [u8; 32] = h.finalize().into();
        let got = compute_commitment(&board_bytes, &salt);
        assert_eq!(got, expected);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game commitment`
Expected: FAIL — `compute_commitment` not defined; `GameState::init` signature wrong.

- [ ] **Step 3: Implement init + helpers + place_ships**

Replace the stubbed `init`:

```rust
#[app::logic]
impl GameState {
    #[app::init]
    pub fn init(player1: PublicKey, player2: PublicKey, lobby_context_id: Option<String>)
        -> GameState
    {
        GameState {
            lobby_context_id: LwwRegister::new(lobby_context_id),
            match_id:         LwwRegister::new(None),
            player1:          LwwRegister::new(Some(player1)),
            player2:          LwwRegister::new(Some(player2)),
            turn:             LwwRegister::new(Some(player1)),
            winner:           LwwRegister::new(None),
            placed_p1:        LwwRegister::new(false),
            placed_p2:        LwwRegister::new(false),
            pending:          LwwRegister::new(None),
            shots_p1:         UnorderedMap::new_with_field_name("game:shots_p1"),
            shots_p2:         UnorderedMap::new_with_field_name("game:shots_p2"),
            commitments:     UserStorage::new_with_field_name("game:commitments"),
        }
    }

    pub fn place_ships(&mut self, match_id: String, ships: Vec<String>)
        -> app::Result<()>
    {
        let caller = PublicKey::from(env::executor_id());
        let is_p1 = self.player1.get().as_ref() == Some(&caller);
        let is_p2 = self.player2.get().as_ref() == Some(&caller);
        if !is_p1 && !is_p2 {
            return Err(Error::msg("caller is not a player in this match"));
        }

        if self.commitments.get().map_err(|e| Error::msg(e.to_string()))?.is_some() {
            return Err(Error::msg(BattleshipsError::AlreadyCommitted.to_string()));
        }

        // Validate & construct the board — reuse existing validation.
        let board = crate::validation::ValidationContext::new()
            .ship_placement(&ships)?;

        // Generate salt and compute commitment.
        let mut salt = [0u8; 16];
        env::random_bytes(&mut salt);
        let board_bytes = borsh::to_vec(&board)
            .map_err(|e| Error::msg(format!("serialize board: {e}")))?;
        let commitment = compute_commitment(&board_bytes, &salt);

        // Write commitment to UserStorage (write-authorized by caller).
        self.commitments.insert(commitment)
            .map_err(|e| Error::msg(format!("commitments.insert: {e}")))?;

        // Persist private board + salt.
        let mut priv_boards = PrivateBoards::private_load_or_default()
            .map_err(|e| Error::msg(format!("private_load: {e}")))?;
        {
            let mut m = priv_boards.as_mut();
            let ship_count = count_ship_cells(&board);
            m.boards.insert(
                match_id.clone(),
                PlayerBoard::new_with_salt(board.clone(), ship_count, true, salt),
            ).map_err(|e| Error::msg(format!("private insert: {e}")))?;
        } // drop auto-saves.

        // Flip placed flag on shared state.
        if is_p1 { self.placed_p1.set(true); } else { self.placed_p2.set(true); }

        app::emit!(Event::BoardCommitted {
            match_id: &match_id,
            player: &caller,
            commitment: &commitment,
        });
        app::emit!(Event::ShipsPlaced { match_id: &match_id, player: &caller });

        Ok(())
    }
}

pub(crate) fn compute_commitment(board_bytes: &[u8], salt: &[u8; 16]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    h.finalize().into()
}

fn count_ship_cells(board: &Board) -> u64 {
    // If Cell is a u8 enum, match its Ship variant. If u8-alias, compare to the Ship code.
    // The implementer: inspect board.rs for the ship sentinel value and adjust.
    board.iter().filter(|&&c| is_ship_cell(c)).count() as u64
}

// If `is_ship_cell` is already defined in board.rs or game.rs, delete this duplicate.
fn is_ship_cell(c: u8) -> bool {
    // Placeholder: use the project's actual Cell::Ship sentinel. Find it via:
    //   rg 'Cell::Ship|CELL_SHIP|SHIP_CODE' battleships/logic/crates/game/src/
    // and replace this body with the correct constant comparison.
    c == 1
}
```

Add these imports near the top of `lib.rs`:

```rust
use battleships_types::BattleshipsError;
use calimero_storage::exports::sha2::{Digest, Sha256};
use crate::players::{PlayerBoard, PrivateBoards};
```

Add event variants to `game/src/events.rs`:

```rust
BoardCommitted { match_id: &'a str, player: &'a PublicKey, commitment: &'a [u8; 32] },
ShipsPlaced    { match_id: &'a str, player: &'a PublicKey },
```

(`ShipsPlaced` likely already exists; leave it.)

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game init commitment`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): place_ships computes SHA256 commitment and stores in UserStorage"
```

---

### Task 8: Game — `propose_shot` with map-backed shot board

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs` (propose_shot L127-145 stub)

- [ ] **Step 1: Write failing test**

Add to the game tests module:

```rust
#[test]
fn propose_shot_records_pending_and_map_entry() {
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);
    state.placed_p1.set(true);
    state.placed_p2.set(true);
    // Simulate caller == pk1 via whatever test hook exists; if env::executor_id() can't be
    // overridden in tests, extract the body to a `propose_shot_inner(caller, ..)` helper
    // and test that directly.
    state.propose_shot_inner(pk1, "m1".into(), 3, 4).unwrap();
    assert_eq!(
        state.pending.get().as_ref().map(|p| (p.x, p.y)),
        Some((3, 4))
    );
    let cell = state.shots_p1.get(&(4 * 10 + 3)).unwrap().unwrap();
    assert_eq!(cell, Cell::Pending);  // or whatever the pending sentinel is
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game propose_shot`
Expected: FAIL — `propose_shot_inner` not defined, map empty.

- [ ] **Step 3: Implement `propose_shot` + inner helper**

In the `#[app::logic] impl GameState` block, replace stub:

```rust
pub fn propose_shot(&mut self, match_id: String, x: u8, y: u8) -> app::Result<()> {
    let caller = PublicKey::from(env::executor_id());
    self.propose_shot_inner(caller, match_id, x, y)
}

pub(crate) fn propose_shot_inner(&mut self, caller: PublicKey, match_id: String, x: u8, y: u8)
    -> app::Result<()>
{
    if x >= 10 || y >= 10 {
        return Err(Error::msg("coordinates out of range"));
    }
    if self.winner.get().is_some() {
        return Err(Error::msg("match already finished"));
    }
    if !*self.placed_p1.get() || !*self.placed_p2.get() {
        return Err(Error::msg("both players must place ships first"));
    }
    if self.pending.get().is_some() {
        return Err(Error::msg("a shot is already pending acknowledgement"));
    }
    if self.turn.get().as_ref() != Some(&caller) {
        return Err(Error::msg("not your turn"));
    }
    let p1 = self.player1.get().ok_or_else(|| Error::msg("player1 unset"))?;
    let p2 = self.player2.get().ok_or_else(|| Error::msg("player2 unset"))?;
    let (shooter, target, shooter_map) = if caller == p1 {
        (p1, p2, &mut self.shots_p1)
    } else {
        (p2, p1, &mut self.shots_p2)
    };
    let key: u8 = y * 10 + x;
    shooter_map.insert(key, Cell::Pending)
        .map_err(|e| Error::msg(format!("shots.insert: {e}")))?;
    self.pending.set(Some(PendingShot { x, y, shooter, target }));

    app::emit!(Event::ShotProposed { match_id: &match_id, shooter: &shooter, x, y });
    Ok(())
}
```

If `Cell::Pending` doesn't exist, use the existing sentinel; if `Cell` is `u8`, replace with the constant. The existing codebase in `board.rs` has cell variants — read that file (offset 1 limit 50) to confirm.

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game propose_shot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): propose_shot writes to shot UnorderedMap + LwwRegister pending"
```

---

### Task 9: Audit module

**Files:**
- Create: `battleships/logic/crates/game/src/audit.rs`
- Modify: `battleships/logic/crates/game/src/lib.rs` (add `mod audit;`)

- [ ] **Step 1: Write failing tests**

Create `audit.rs` with tests first:

```rust
//! Audit routine: verifies commitment hash and replays recorded shots.

use calimero_storage::collections::UnorderedMap;
use calimero_storage::exports::sha2::{Digest, Sha256};

use crate::board::Cell;
use crate::players::PlayerBoard;

#[derive(Debug, Clone, PartialEq)]
pub enum AuditFailure {
    CommitmentMismatch,
    ShotInconsistent { x: u8, y: u8, recorded: Cell, actual_is_ship: bool },
}

impl core::fmt::Display for AuditFailure {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AuditFailure::CommitmentMismatch => write!(f, "commitment_mismatch"),
            AuditFailure::ShotInconsistent { x, y, recorded, actual_is_ship } =>
                write!(f, "shot_inconsistent {{ x={x}, y={y}, recorded={recorded:?}, actual_is_ship={actual_is_ship} }}"),
        }
    }
}

pub fn verify_commitment(board_bytes: &[u8], salt: &[u8; 16], expected: &[u8; 32]) -> bool {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    let got: [u8; 32] = h.finalize().into();
    &got == expected
}

pub fn replay_shots(
    own_board: &[u8],         // flat row-major 10x10
    shots_against_me: &UnorderedMap<u8, Cell>,
) -> Result<(), AuditFailure> {
    let entries = shots_against_me.entries().map_err(|_| AuditFailure::CommitmentMismatch)?;
    for (key, cell) in entries {
        let x = key % 10;
        let y = key / 10;
        let idx = (y as usize) * 10 + (x as usize);
        let is_ship = crate::board::is_ship_cell(own_board[idx]);
        match cell {
            Cell::Hit if !is_ship => return Err(AuditFailure::ShotInconsistent {
                x, y, recorded: cell, actual_is_ship: is_ship,
            }),
            Cell::Miss if is_ship => return Err(AuditFailure::ShotInconsistent {
                x, y, recorded: cell, actual_is_ship: is_ship,
            }),
            _ => { /* Pending cells and consistent Hit/Miss pass through */ }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_board() -> Vec<u8> {
        // 10x10 all empty except ship at (0,0)
        let mut b = vec![0u8; 100];
        b[0] = 1;  // 1 = ship sentinel; adjust to project's real Cell::Ship value
        b
    }

    #[test]
    fn verify_commitment_accepts_matching_hash() {
        let board = sample_board();
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(&salt);
        let expected: [u8; 32] = h.finalize().into();
        assert!(verify_commitment(&board, &salt, &expected));
    }

    #[test]
    fn verify_commitment_rejects_tampered_board() {
        let board = sample_board();
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(&salt);
        let expected: [u8; 32] = h.finalize().into();

        let mut tampered = board.clone();
        tampered[0] = 0;  // move the ship
        assert!(!verify_commitment(&tampered, &salt, &expected));
    }

    // replay_shots tests require a populated UnorderedMap, which needs storage context.
    // These are exercised in Task 10's integration tests for acknowledge_shot.
}
```

Add `pub mod audit;` near the other mod declarations in `game/src/lib.rs`.

(`is_ship_cell` was added to `board.rs` in Task 6; this module re-uses it.)

- [ ] **Step 2: Run tests to confirm compile and pass**

Run: `cargo test -p battleships-game audit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): audit module with commitment verification and shot replay"
```

---

### Task 10: Game — `acknowledge_shot` with inline audit on winning shot

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs` (acknowledge_shot L147-215 stub)

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn acknowledge_shot_records_hit_and_decrements_ships() {
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);
    state.placed_p1.set(true);
    state.placed_p2.set(true);

    // Set up private board for p2 with a ship at (0,0).
    let mut salt = [0u8; 16]; salt[0] = 42;
    let board = {
        let mut b = vec![0u8; 100]; b[0] = 1; b
    };
    // Directly poke private boards for this test.
    {
        let mut priv_boards = PrivateBoards::private_load_or_default().unwrap();
        let mut m = priv_boards.as_mut();
        m.boards.insert("m1".into(),
            PlayerBoard::new_with_salt(board.clone(), 1, true, salt)).unwrap();
    }
    // And a matching commitment under p2's slot.
    let board_bytes = borsh::to_vec(&board).unwrap();
    let commitment = compute_commitment(&board_bytes, &salt);
    // UserStorage writes always go to current executor's slot — in this unit test we
    // simulate p2 as the caller by using the inner helpers (see propose/ack_inner below).
    //
    // Implementer note: if UserStorage cannot be poked cross-executor in-test, extract
    // ack logic to `acknowledge_shot_inner(caller: PublicKey, match_id, commitment_of_target)`
    // and inject the commitment as a parameter.

    state.propose_shot_inner(pk1, "m1".into(), 0, 0).unwrap();

    let outcome = state.acknowledge_shot_inner(pk2, "m1".into(), commitment, board.clone(), salt)
        .unwrap();
    assert!(outcome.hit);
    let cell = state.shots_p1.get(&0u8).unwrap().unwrap();
    assert_eq!(cell, Cell::Hit);  // or project sentinel
    assert_eq!(*state.winner.get(), Some(pk2));  // only ship, so game over
}

#[test]
fn acknowledge_shot_audit_fails_on_lying_ack() {
    // Seed a shot map where (0,0) is recorded Miss but the board says ship at (0,0).
    // The audit should flag shot_inconsistent.
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);
    state.placed_p1.set(true); state.placed_p2.set(true);

    // Populate shots_p1 with a Miss at (0,0) — simulating a past lie.
    state.shots_p1.insert(0u8, Cell::Miss).unwrap();

    let salt = [11u8; 16];
    let board = { let mut b = vec![0u8; 100]; b[0] = 1; b };

    // With a winning-shot path triggered, audit should catch the lie.
    // (Simplification: call the audit routine directly.)
    let replay = crate::audit::replay_shots(&board, &state.shots_p1);
    assert!(matches!(replay, Err(crate::audit::AuditFailure::ShotInconsistent { x: 0, y: 0, .. })));
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game acknowledge_shot`
Expected: FAIL — `acknowledge_shot_inner` missing.

- [ ] **Step 3: Implement `acknowledge_shot`**

```rust
#[derive(Debug, Clone)]
pub struct AckOutcome {
    pub hit: bool,
    pub winner: Option<PublicKey>,
    pub audit_passed: Option<bool>, // None if no audit was run (non-winning shot)
}

pub fn acknowledge_shot(&mut self, match_id: String) -> app::Result<AckOutcome> {
    let caller = PublicKey::from(env::executor_id());

    // Load caller's commitment + private board + salt.
    let commitment = self.commitments.get_for_user(&caller)
        .map_err(|e| Error::msg(format!("commitments.get: {e}")))?
        .ok_or_else(|| Error::msg("no commitment found for caller"))?;

    let priv_boards = PrivateBoards::private_load_or_default()
        .map_err(|e| Error::msg(format!("private_load: {e}")))?;
    let pb = priv_boards.boards.get(&match_id)
        .map_err(|e| Error::msg(format!("private get: {e}")))?
        .ok_or_else(|| Error::msg(BattleshipsError::BoardNotFound.to_string()))?;

    self.acknowledge_shot_inner(caller, match_id, commitment, pb.own.clone(), pb.salt)
}

pub(crate) fn acknowledge_shot_inner(
    &mut self,
    caller: PublicKey,
    match_id: String,
    commitment: [u8; 32],
    own_board: Vec<u8>,
    salt: [u8; 16],
) -> app::Result<AckOutcome> {
    let pending = self.pending.get().clone()
        .ok_or_else(|| Error::msg("no pending shot"))?;
    if pending.target != caller {
        return Err(Error::msg("not your shot to acknowledge"));
    }
    let p1 = self.player1.get().ok_or_else(|| Error::msg("player1 unset"))?;
    let shooter_map = if pending.shooter == p1 { &mut self.shots_p1 } else { &mut self.shots_p2 };
    let key: u8 = pending.y * 10 + pending.x;
    let idx = (pending.y as usize) * 10 + (pending.x as usize);
    let hit = crate::board::is_ship_cell(own_board[idx]);
    let resolved = if hit { Cell::Hit } else { Cell::Miss };
    shooter_map.insert(key, resolved)
        .map_err(|e| Error::msg(format!("shots.insert: {e}")))?;
    self.pending.set(None);

    // Count remaining ships after this hit.
    let mut priv_boards = PrivateBoards::private_load_or_default()
        .map_err(|e| Error::msg(format!("private_load: {e}")))?;
    let new_ship_count = {
        let mut m = priv_boards.as_mut();
        let mut pb = m.boards.get(&match_id)
            .map_err(|e| Error::msg(e.to_string()))?
            .unwrap_or_default();
        if hit { pb.ships = pb.ships.saturating_sub(1); }
        let remaining = pb.ships;
        m.boards.insert(match_id.clone(), pb)
            .map_err(|e| Error::msg(e.to_string()))?;
        remaining
    };

    let mut audit_passed = None;
    if new_ship_count == 0 {
        // Winning shot — run audit.
        let board_bytes = borsh::to_vec(&own_board)
            .map_err(|e| Error::msg(format!("serialize board: {e}")))?;
        let mut ok = crate::audit::verify_commitment(&board_bytes, &salt, &commitment);
        if ok {
            ok = crate::audit::replay_shots(&own_board, shooter_map).is_ok();
        }
        audit_passed = Some(ok);

        let winner = pending.shooter;
        self.winner.set(Some(winner));

        if ok {
            app::emit!(Event::AuditPassed { match_id: &match_id, player: &caller });
        } else {
            app::emit!(Event::AuditFailed {
                match_id: &match_id, player: &caller, reason: "commit_or_replay_failed",
            });
        }

        // xcall lobby
        if let Some(lobby_ctx) = self.lobby_context_id.get().as_ref() {
            if let Ok(ctx_bytes) = bs58::decode(lobby_ctx).into_vec() {
                if ctx_bytes.len() == 32 {
                    let mut ctx_arr = [0u8; 32];
                    ctx_arr.copy_from_slice(&ctx_bytes);
                    let loser = if winner == p1 { self.player2.get().unwrap() } else { p1 };
                    let params = borsh::to_vec(&(
                        match_id.clone(),
                        bs58::encode(winner.as_bytes()).into_string(),
                        bs58::encode(loser.as_bytes()).into_string(),
                    )).unwrap_or_default();
                    env::xcall(&ctx_arr, "on_match_finished", &params);
                }
            }
        }

        app::emit!(Event::Winner { match_id: &match_id, winner: &winner });
        app::emit!(Event::MatchEnded { match_id: &match_id });
    } else {
        // Swap turn.
        let p2 = self.player2.get().ok_or_else(|| Error::msg("player2 unset"))?;
        let next = if *self.turn.get() == Some(p1) { p2 } else { p1 };
        self.turn.set(Some(next));
    }

    app::emit!(Event::ShotFired {
        match_id: &match_id,
        shooter: &pending.shooter,
        x: pending.x, y: pending.y, hit,
    });

    Ok(AckOutcome { hit, winner: *self.winner.get(), audit_passed })
}
```

Add event variants to `game/src/events.rs`:

```rust
AuditPassed { match_id: &'a str, player: &'a PublicKey },
AuditFailed { match_id: &'a str, player: &'a PublicKey, reason: &'a str },
MatchEnded  { match_id: &'a str },
// Winner, ShotFired, ShotProposed likely already exist; leave them.
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game acknowledge_shot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): acknowledge_shot runs inline audit on winning shot"
```

---

### Task 11: `reveal_board` (optional post-game loser reveal)

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs`

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn reveal_board_emits_audit_passed_for_honest_loser() {
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);

    // Set up: p1 lost, has a valid commitment and an honest shot history.
    let salt = [3u8; 16];
    let board = { let mut b = vec![0u8; 100]; b[0] = 1; b };
    let board_bytes = borsh::to_vec(&board).unwrap();
    let commitment = compute_commitment(&board_bytes, &salt);

    // Empty shots_p2 (nothing recorded against p1 yet) → replay trivially passes.
    let result = state.reveal_board_inner(pk1, "m1".into(), commitment, board, salt);
    assert!(result.is_ok());
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game reveal_board`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
pub fn reveal_board(&mut self, match_id: String) -> app::Result<()> {
    let caller = PublicKey::from(env::executor_id());
    let commitment = self.commitments.get_for_user(&caller)
        .map_err(|e| Error::msg(e.to_string()))?
        .ok_or_else(|| Error::msg("no commitment"))?;
    let priv_boards = PrivateBoards::private_load_or_default()
        .map_err(|e| Error::msg(e.to_string()))?;
    let pb = priv_boards.boards.get(&match_id)
        .map_err(|e| Error::msg(e.to_string()))?
        .ok_or_else(|| Error::msg(BattleshipsError::BoardNotFound.to_string()))?;
    self.reveal_board_inner(caller, match_id, commitment, pb.own.clone(), pb.salt)
}

pub(crate) fn reveal_board_inner(
    &self,
    caller: PublicKey,
    match_id: String,
    commitment: [u8; 32],
    own_board: Vec<u8>,
    salt: [u8; 16],
) -> app::Result<()> {
    let board_bytes = borsh::to_vec(&own_board)
        .map_err(|e| Error::msg(e.to_string()))?;
    if !crate::audit::verify_commitment(&board_bytes, &salt, &commitment) {
        app::emit!(Event::AuditFailed {
            match_id: &match_id, player: &caller, reason: "commitment_mismatch",
        });
        return Err(Error::msg(BattleshipsError::CommitmentMismatch.to_string()));
    }
    // Replay shots taken against the revealing player.
    let p1 = self.player1.get().ok_or_else(|| Error::msg("p1 unset"))?;
    let shots_against_me = if caller == p1 { &self.shots_p2 } else { &self.shots_p1 };
    if let Err(failure) = crate::audit::replay_shots(&own_board, shots_against_me) {
        let reason = failure.to_string();
        app::emit!(Event::AuditFailed { match_id: &match_id, player: &caller, reason: &reason });
        return Err(Error::msg(BattleshipsError::AuditFailed { reason }.to_string()));
    }
    app::emit!(Event::BoardRevealed { match_id: &match_id, player: &caller });
    app::emit!(Event::AuditPassed { match_id: &match_id, player: &caller });
    Ok(())
}
```

Add `BoardRevealed` variant to events:

```rust
BoardRevealed { match_id: &'a str, player: &'a PublicKey },
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game reveal_board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): reveal_board for symmetric post-match proof"
```

---

### Task 12: `export_board_seed` / `import_board_seed`

**Files:**
- Modify: `battleships/logic/crates/game/src/lib.rs`
- (`ExportedSeed` lives in the types crate, added in Task 1.)

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn export_import_roundtrip() {
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);

    let salt = [9u8; 16];
    let board = { let mut b = vec![0u8; 100]; b[0] = 1; b };
    let board_bytes = borsh::to_vec(&board).unwrap();
    let commitment = compute_commitment(&board_bytes, &salt);

    // Seed: commitment for pk1 is set, private board exists.
    state.commitments.insert(commitment).unwrap();  // executor is pk1 in test env
    {
        let mut priv_boards = PrivateBoards::private_load_or_default().unwrap();
        let mut m = priv_boards.as_mut();
        m.boards.insert("m1".into(),
            PlayerBoard::new_with_salt(board.clone(), 1, true, salt)).unwrap();
    }

    // Export.
    let seed = state.export_board_seed("m1".into()).unwrap();
    assert_eq!(seed.salt, salt);
    let decoded: Vec<u8> = borsh::from_slice(&seed.board_bytes).unwrap();
    assert_eq!(decoded, board);

    // Wipe private storage, then import.
    {
        let mut priv_boards = PrivateBoards::private_load_or_default().unwrap();
        let mut m = priv_boards.as_mut();
        m.boards.remove(&"m1".to_string()).unwrap();
    }
    state.import_board_seed("m1".into(), seed.board_bytes, seed.salt).unwrap();

    // Verify private board was rehydrated.
    let priv_boards = PrivateBoards::private_load_or_default().unwrap();
    let pb = priv_boards.boards.get(&"m1".to_string()).unwrap().unwrap();
    assert_eq!(pb.own, board);
    assert_eq!(pb.salt, salt);
}

#[test]
fn import_rejects_commitment_mismatch() {
    let pk1 = PublicKey::from([1u8; 32]);
    let pk2 = PublicKey::from([2u8; 32]);
    let mut state = GameState::init(pk1, pk2, None);

    let honest_salt = [1u8; 16];
    let honest_board = { let mut b = vec![0u8; 100]; b[0] = 1; b };
    let honest_commitment = compute_commitment(
        &borsh::to_vec(&honest_board).unwrap(), &honest_salt);
    state.commitments.insert(honest_commitment).unwrap();

    // Attempt to import a different board with a forged salt.
    let liar_board = { let mut b = vec![0u8; 100]; b[5] = 1; b };
    let liar_salt = [2u8; 16];
    let err = state.import_board_seed("m1".into(),
        borsh::to_vec(&liar_board).unwrap(), liar_salt);
    assert!(err.is_err());
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cargo test -p battleships-game export`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
pub fn export_board_seed(&self, match_id: String)
    -> app::Result<battleships_types::ExportedSeed>
{
    let priv_boards = PrivateBoards::private_load_or_default()
        .map_err(|e| Error::msg(e.to_string()))?;
    let pb = priv_boards.boards.get(&match_id)
        .map_err(|e| Error::msg(e.to_string()))?
        .ok_or_else(|| Error::msg(BattleshipsError::BoardNotFound.to_string()))?;
    Ok(battleships_types::ExportedSeed {
        board_bytes: borsh::to_vec(&pb.own).map_err(|e| Error::msg(e.to_string()))?,
        salt: pb.salt,
    })
}

pub fn import_board_seed(
    &mut self,
    match_id: String,
    board_bytes: Vec<u8>,
    salt: [u8; 16],
) -> app::Result<()> {
    let caller = PublicKey::from(env::executor_id());
    let expected = self.commitments.get_for_user(&caller)
        .map_err(|e| Error::msg(e.to_string()))?
        .ok_or_else(|| Error::msg("no commitment for caller"))?;
    if !crate::audit::verify_commitment(&board_bytes, &salt, &expected) {
        return Err(Error::msg(BattleshipsError::CommitmentMismatch.to_string()));
    }
    let board: Vec<u8> = borsh::from_slice(&board_bytes)
        .map_err(|e| Error::msg(e.to_string()))?;
    let ship_count = count_ship_cells(&board);
    let mut priv_boards = PrivateBoards::private_load_or_default()
        .map_err(|e| Error::msg(e.to_string()))?;
    {
        let mut m = priv_boards.as_mut();
        m.boards.insert(match_id,
            PlayerBoard::new_with_salt(board, ship_count, true, salt))
            .map_err(|e| Error::msg(e.to_string()))?;
    }
    Ok(())
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p battleships-game export`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add battleships/logic/crates/game/
git commit -m "feat(game): export_board_seed and import_board_seed for cross-device durability"
```

---

### Task 13: End-to-end smoke test — two-node simulated match

**Files:**
- Create: `battleships/logic/crates/game/tests/e2e_crdt.rs`

- [ ] **Step 1: Write the test**

```rust
// Integration test exercising the full place → fire → ack flow including the audit path.
use battleships_game::{GameState, compute_commitment};
use battleships_game::audit::{verify_commitment, replay_shots};
use battleships_game::players::{PlayerBoard, PrivateBoards};
use calimero_sdk::types::PublicKey;

#[test]
fn happy_path_yields_audit_passed() {
    let p1 = PublicKey::from([0xA1; 32]);
    let p2 = PublicKey::from([0xA2; 32]);
    let mut g = GameState::init(p1, p2, None);
    g.placed_p1.set(true);
    g.placed_p2.set(true);

    // Minimal 1-ship board at (0,0) for p2.
    let salt = [42u8; 16];
    let board = { let mut b = vec![0u8; 100]; b[0] = 1; b };
    let commitment = compute_commitment(&borsh::to_vec(&board).unwrap(), &salt);

    // p1 proposes (0,0); p2 acks.
    g.propose_shot_inner(p1, "mmm".into(), 0, 0).unwrap();
    let outcome = g.acknowledge_shot_inner(p2, "mmm".into(), commitment, board.clone(), salt)
        .unwrap();
    assert!(outcome.hit);
    assert_eq!(*g.winner.get(), Some(p2));
    assert_eq!(outcome.audit_passed, Some(true));
}

#[test]
fn lying_ack_flagged_as_audit_failed() {
    let p1 = PublicKey::from([0xA1; 32]);
    let p2 = PublicKey::from([0xA2; 32]);
    let mut g = GameState::init(p1, p2, None);
    g.placed_p1.set(true);
    g.placed_p2.set(true);

    // Inject an earlier Miss at (5,5) into shots_p1. p2's real board has a ship at (5,5).
    g.shots_p1.insert(55u8, battleships_game::board::Cell::Miss).unwrap();

    // p2's real board (used for the winning ack) shows the truth.
    let salt = [7u8; 16];
    let board = {
        let mut b = vec![0u8; 100];
        b[55] = 1;  // ship at (5,5)
        b[0]  = 1;  // another ship at (0,0); this is the one p1 will sink
        b
    };
    let commitment = compute_commitment(&borsh::to_vec(&board).unwrap(), &salt);

    // p1 sinks the (0,0) ship but still needs one more hit to win — instead, set ships=1
    // so this ack wins and triggers audit immediately.
    {
        let mut priv_boards = PrivateBoards::private_load_or_default().unwrap();
        let mut m = priv_boards.as_mut();
        m.boards.insert("mmm".into(),
            PlayerBoard::new_with_salt(board.clone(), 1, true, salt)).unwrap();
    }
    g.propose_shot_inner(p1, "mmm".into(), 0, 0).unwrap();
    let outcome = g.acknowledge_shot_inner(p2, "mmm".into(), commitment, board, salt).unwrap();
    assert_eq!(outcome.audit_passed, Some(false));
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p battleships-game --test e2e_crdt`
Expected: both tests PASS.

- [ ] **Step 3: Full test suite check**

Run: `cd battleships/logic && cargo test --workspace`
Expected: all tests PASS, no warnings introduced.

- [ ] **Step 4: Commit**

```bash
git add battleships/logic/crates/game/tests/
git commit -m "test(game): end-to-end CRDT + audit smoke tests"
```

---

### Task 14: Final audit — emit/event coverage + lints

**Files:**
- Modify: any `events.rs` / method where an event is missing.

- [ ] **Step 1: Grep for every event variant and confirm emit sites**

Run:
```
cd battleships/logic
rg 'Event::' crates/game/src/ crates/lobby/src/ --type rust
```
Expected: every variant declared in `events.rs` appears in at least one `app::emit!` call.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy --workspace -- -D warnings`
Expected: no warnings. Fix any that appear (typically unused imports, needless clones).

- [ ] **Step 3: Run full build + test**

Run: `cargo build --workspace --release && cargo test --workspace`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(battleships): finalize crdt migration with clippy clean"
```

---

## Open implementation-time flags (pre-approved decisions; confirm on-the-fly)

- **`Cell` sentinel values.** The plan uses `Cell::Hit | Cell::Miss | Cell::Pending | Cell::Ship` symbolically. If `Cell` is a `u8` alias, replace with the existing constants from `board.rs`. Do this once, consistently.
- **`is_ship_cell(u8) -> bool`** — replace the placeholder body in `board.rs` with a match against whatever the real Ship sentinel is.
- **`env::time_now()` resolution.** If whole-millisecond, two matches created within the same millisecond by the same pair will hit `MatchIdCollision`. This is the deliberate behavior per the spec.
- **`PublicKey::from([u8; 32])`** — if the SDK's `PublicKey` doesn't have a direct `From<[u8; 32]>` impl, use whatever the idiomatic constructor is in the existing battleships code (e.g., `PublicKey::new(bytes)`).
- **`UserStorage` in tests.** In unit tests the "current executor" is fixed (often zeroed). Helper methods ending in `_inner` accept an explicit caller and commitment to keep tests deterministic without needing a custom env harness.
- **`xcall` encoding.** The payload format is a Borsh-encoded tuple matching `on_match_finished(match_id, winner, loser)` — all three are `String`. Verify that the lobby side (`Task 4`) accepts Borsh-decoded `(String, String, String)` when invoked via xcall; if the existing convention is JSON or positional args, adapt both sides consistently.

## Self-review notes

- All spec sections (Lobby state §2, Game state §3, Audit §4, Events/Errors/Export §5, Testing §6) are covered by at least one task: Task 1 (errors/ExportedSeed), Tasks 2-4 (Lobby), Tasks 5-8 (Game state + methods), Task 9 (Audit module), Task 10 (Audit wiring), Task 11 (Reveal), Task 12 (Export/Import), Task 13 (E2E tests), Task 14 (event coverage).
- No `TBD`/`TODO` placeholders remain. Open items are flagged as "on-the-fly decisions" with concrete fallback instructions.
- Types used in later tasks (`PendingShot`, `AckOutcome`, `ExportedSeed`, `BattleshipsError`, `PlayerBoard::new_with_salt`, `compute_commitment`, `audit::verify_commitment`, `audit::replay_shots`) are all defined in earlier tasks.
- Name consistency: `compute_commitment` defined in Task 7 and reused in Tasks 12-13. `is_ship_cell` defined in Task 6 (step 5) in `board.rs` and reused in Tasks 7, 9, 10. `PlayerBoard::new_with_salt` defined in Task 6 and reused in Tasks 7, 12, 13. `audit::verify_commitment` / `audit::replay_shots` defined in Task 9 and reused in Tasks 10-12. No dangling references remain.
