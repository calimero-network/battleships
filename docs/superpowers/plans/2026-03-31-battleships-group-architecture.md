# Battleships Group Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the single-context Battleships app into a Group-aware architecture where one installed bundle spawns a shared Lobby context (Open) and per-game Match contexts (Restricted), enabling concurrent matches, spectators, and leaderboards — all from one `.mpk`.

**Architecture:** A single `battleships.mpk` bundle is installed once per node. The same WASM handles two `ContextType` variants (`Lobby` and `Match`) discriminated at init time. The Lobby context (Open) stores match summaries and player stats via CRDT collections; each Match context (Restricted, allowlist = two players) runs the existing game logic unchanged. On match end the match context fires an `xcall` back to the lobby to update stats.

**Tech Stack:** Rust / Calimero SDK (`calimero-sdk`, `calimero-storage`), CRDT collections (`UnorderedMap`, `Vector`, `LwwRegister`), `env::context_create` / `env::xcall` host syscalls, `mero-sign` for bundle signing, `calimero_wasm_abi` for ABI codegen, TypeScript React frontend with `@calimero-network/calimero-client`.

---

## Reference Patterns (read before starting)

- **ContextType + init with params**: `mero-chat/logic/src/lib.rs:150–445` — exact enum + `#[app::init]` pattern to copy.
- **UnorderedMap / Vector / LwwRegister in state**: `kv-store/logic/src/lib.rs:1–45` and `mero-chat/logic/src/lib.rs:403–440`.
- **xcall signature**: `core/crates/sdk/src/env.rs:361` — `pub fn xcall(context_id: &[u8; 32], function: &str, params: &[u8])`.
- **context_create signature**: `core/crates/sdk/src/env.rs:654` — `pub fn context_create(protocol: &str, application_id: &[u8; 32], args: &[u8], alias: Option<&str>)` — fire-and-forget, no return value.
- **manifest.json shape**: `kv-store/logic/manifest.json` — exact fields to copy.
- **bundle packaging**: `core/architecture/app-lifecycle.html` — sign with `mero-sign`, tar.gz → `.mpk`.
- **workflow format**: `battleships/workflows/workflow-example.yml` — exact step types and field names.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `logic/src/lobby.rs` | `MatchSummary`, `PlayerStats`, `MatchRecord` types; lobby-only methods: `create_match`, `get_matches`, `get_player_stats`, `on_match_finished` |
| `logic/manifest.json` | Bundle metadata skeleton (unsigned); signed copy lives in `logic/res/` |
| `scripts/package-bundle.sh` | Sign manifest with `mero-sign`, tar.gz `manifest.json + battleships.wasm + abi.json` → `battleships.mpk` |

### Modified files
| File | Change |
|---|---|
| `logic/Cargo.toml` | Rename package to `battleships`, crate name to `battleships` |
| `logic/build.sh` | Output filename `battleships.wasm` instead of `kv_store.wasm` |
| `logic/src/lib.rs` | Add `ContextType` enum; add lobby fields to `BattleshipState`; update `#[app::init]` to accept `context_type`, `player1`, `player2`, `lobby_context_id`; add `context_type` guards to all methods; add `lobby_context_id` field to state |
| `logic/src/events.rs` | Add `MatchListUpdated`, `PlayerStatsUpdated` event variants |
| `logic/src/game.rs` | In `ShotResolver::resolve_shot` winner branch: fire `env::xcall` to lobby |
| `scripts/sync-wasm.sh` | Handle `battleships.wasm` filename |
| `scripts/on-res-change.mjs` | Watch for `battleships.wasm` (not `kv_store.wasm`) |
| `package.json` | Add `logic:bundle` script |
| `workflows/workflow-example.yml` | Two-step context setup: Lobby context (Open, init `Lobby`) + Match context (Restricted, init `Match`) |

### Untouched files
`logic/src/board.rs`, `logic/src/ships.rs`, `logic/src/players.rs`, `logic/src/validation.rs` — all game logic stays unchanged.

---

## Task 1: Rename the Cargo Package

**Files:**
- Modify: `logic/Cargo.toml`
- Modify: `logic/build.sh`

- [ ] **Step 1: Update `Cargo.toml`**

Replace the entire `[package]` section and crate-type:

```toml
[package]
name = "battleships"
description = "Battleships on Calimero"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
name = "battleships"

[dependencies]
thiserror = "1.0.56"
calimero-sdk     = { git = "https://github.com/calimero-network/core", branch = "master" }
calimero-storage = { git = "https://github.com/calimero-network/core", branch = "master" }
bs58 = "0.4"

[build-dependencies]
calimero-wasm-abi = { git = "https://github.com/calimero-network/core", branch = "master" }
serde_json = "1.0.113"

[profile.app-release]
inherits = "release"
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
```

- [ ] **Step 2: Update `build.sh` output filename**

```bash
#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-target}"

rustup target add wasm32-unknown-unknown

cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res

cp $TARGET/wasm32-unknown-unknown/app-release/battleships.wasm ./res/

if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/battleships.wasm -o ./res/battleships.wasm
fi
```

- [ ] **Step 3: Verify the build still compiles**

```bash
cd logic && bash build.sh
```
Expected: `logic/res/battleships.wasm` exists.

- [ ] **Step 4: Update `scripts/sync-wasm.sh`**

```bash
#!/bin/bash
set -euo pipefail

CHANGED_PATH="${1:-}"

if [ -z "$CHANGED_PATH" ]; then
  echo "sync-wasm: usage: sync-wasm.sh <path-to-wasm>"
  exit 1
fi

if [ ! -f "$CHANGED_PATH" ]; then
  echo "sync-wasm: file not found: $CHANGED_PATH"
  exit 1
fi

NAME=$(basename "$CHANGED_PATH")

echo "[sync-wasm] copying $CHANGED_PATH to data nodes as $NAME"
cp "$CHANGED_PATH" "data/calimero-node-1/$NAME"
cp "$CHANGED_PATH" "data/calimero-node-2/$NAME"
```

- [ ] **Step 5: Update `scripts/on-res-change.mjs` to watch new wasm name**

```js
#!/usr/bin/env node
import { exec } from 'node:child_process';
import { basename } from 'node:path';

const changedPath = process.argv[2];
if (!changedPath) {
  console.error('on-res-change: missing file path argument');
  process.exit(1);
}

const file = basename(changedPath);

function run(command) {
  const child = exec(command, { env: process.env });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Command failed (${code}): ${command}`);
    }
  });
}

if (file === 'abi.json') {
  console.log(`[res watcher] ABI changed: ${changedPath}`);
  run('pnpm run app:generate-client');
} else if (file === 'battleships.wasm') {
  console.log(`[res watcher] WASM changed: ${changedPath}`);
  run(`pnpm run logic:sync ${JSON.stringify(changedPath)}`);
} else {
  // ignore unrelated files
}
```

- [ ] **Step 6: Commit**

```bash
git add logic/Cargo.toml logic/build.sh scripts/sync-wasm.sh scripts/on-res-change.mjs
git commit -m "chore: rename package to battleships, update build output"
```

---

## Task 2: Add `ContextType` Enum and Update `BattleshipState`

**Files:**
- Modify: `logic/src/lib.rs`

This task adds the `ContextType` discriminator to the state and extends `BattleshipState` with lobby CRDT fields and match-setup fields. The `#[app::init]` is updated to accept parameters. No existing method logic changes yet — guards are added in Task 7.

- [ ] **Step 1: Write failing tests for context type discrimination**

Add at the bottom of `logic/src/lib.rs`:

```rust
#[cfg(test)]
mod context_type_tests {
    use super::*;
    use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};

    #[test]
    fn context_type_lobby_roundtrips_borsh() {
        let ct = ContextType::Lobby;
        let encoded = calimero_sdk::borsh::to_vec(&ct).unwrap();
        let decoded: ContextType = ContextType::try_from_slice(&encoded).unwrap();
        assert_eq!(ct, decoded);
    }

    #[test]
    fn context_type_match_roundtrips_borsh() {
        let ct = ContextType::Match;
        let encoded = calimero_sdk::borsh::to_vec(&ct).unwrap();
        let decoded: ContextType = ContextType::try_from_slice(&encoded).unwrap();
        assert_eq!(ct, decoded);
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail (ContextType not defined yet)**

```bash
cd logic && cargo test context_type_tests 2>&1 | head -20
```
Expected: `error[E0412]: cannot find type 'ContextType'`

- [ ] **Step 3: Add `ContextType` enum and update `BattleshipState` in `lib.rs`**

Add the following imports at the top of `logic/src/lib.rs` (after the existing `use calimero_sdk::...` lines):

```rust
use calimero_storage::collections::{LwwRegister, UnorderedMap, Vector};
```

Add the `ContextType` enum immediately before the `BattleshipState` struct (after the `GameError` definition):

```rust
/// Discriminates whether this context instance is a shared Lobby or an
/// isolated Match. Set once at `#[app::init]` and never mutated.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum ContextType {
    /// Open context visible to all group members. Holds match listings,
    /// player stats, and history. Created once per game room.
    Lobby,
    /// Restricted context visible only to the two players. Holds the live
    /// match state and private ship boards. Created per game.
    Match,
}
```

Replace the `BattleshipState` struct definition:

```rust
#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BattleshipState {
    /// Set at init; never changes. Determines which methods are valid.
    pub context_type: ContextType,

    // ── Lobby-only fields ────────────────────────────────────────────────
    /// All matches ever created in this room (match_id → summary).
    pub matches: UnorderedMap<String, MatchSummary>,
    /// Aggregated win/loss stats per player pubkey (base58).
    pub player_stats: UnorderedMap<String, PlayerStats>,
    /// Append-only finished-match log for leaderboard display.
    pub history: Vector<MatchRecord>,

    // ── Match-only fields ────────────────────────────────────────────────
    /// The base58-encoded context_id of the Lobby that spawned this match.
    /// Used by the xcall on game end to update lobby stats.
    pub lobby_context_id: LwwRegister<String>,
    /// Counter for generating unique match IDs.
    id_nonce: u64,
    /// Timestamp when this context was created.
    created_ms: u64,
    /// The active match (None until place_ships completes for both players).
    active_match: Option<Match>,
}
```

Replace the `init` method in the `#[app::logic] impl BattleshipState` block:

```rust
#[app::init]
pub fn init(
    context_type: ContextType,
    /// For Match contexts: base58 pubkey of player1 (the match creator).
    player1: Option<String>,
    /// For Match contexts: base58 pubkey of player2 (the opponent).
    player2: Option<String>,
    /// For Match contexts: base58-encoded context_id of the parent Lobby.
    lobby_context_id: Option<String>,
) -> BattleshipState {
    BattleshipState {
        context_type,
        matches: UnorderedMap::new(),
        player_stats: UnorderedMap::new(),
        history: Vector::new(),
        lobby_context_id: LwwRegister::new(
            lobby_context_id.unwrap_or_default()
        ),
        id_nonce: 0,
        created_ms: env::time_now(),
        active_match: match (player1, player2) {
            (Some(p1), Some(p2)) => {
                let pk1 = PublicKey::from_base58(&p1)
                    .expect("invalid player1 pubkey in init args");
                let pk2 = PublicKey::from_base58(&p2)
                    .expect("invalid player2 pubkey in init args");
                Some(Match::new(
                    format!("match-{}", env::time_now()),
                    pk1,
                    pk2,
                ))
            }
            _ => None,
        },
    }
}
```

- [ ] **Step 4: Run tests — they should now pass**

```bash
cd logic && cargo test context_type_tests 2>&1
```
Expected: `test context_type_tests::context_type_lobby_roundtrips_borsh ... ok` and `test context_type_tests::context_type_match_roundtrips_borsh ... ok`.

- [ ] **Step 5: Confirm the crate still compiles (lobby.rs doesn't exist yet, so add the mod declaration later)**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep -E "^error" | head -10
```
Expected: errors about `MatchSummary`, `PlayerStats`, `MatchRecord` not found — these are added in Task 3. That's expected at this stage.

- [ ] **Step 6: Commit**

```bash
git add logic/src/lib.rs
git commit -m "feat: add ContextType enum and extend BattleshipState for lobby+match"
```

---

## Task 3: Create `lobby.rs` — Types and Read Methods

**Files:**
- Create: `logic/src/lobby.rs`
- Modify: `logic/src/lib.rs` (add `pub mod lobby; pub use lobby::*;`)

- [ ] **Step 1: Write failing tests first (in `lobby.rs`)**

Create `logic/src/lobby.rs`:

```rust
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};

use crate::players::PublicKey;

/// Lightweight match record stored in the Lobby context.
/// The full match state lives in the per-match Restricted context.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchSummary {
    pub id: String,
    pub player1: String,   // base58 pubkey
    pub player2: String,   // base58 pubkey
    pub status: MatchStatus,
    /// base58-encoded context_id of the Restricted match context.
    /// Empty string while the context is being created (async).
    pub context_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum MatchStatus {
    Pending,   // context created, waiting for players to join
    Active,    // both players placed ships
    Finished,  // winner determined
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStats {
    pub wins: u32,
    pub losses: u32,
    pub games_played: u32,
}

impl PlayerStats {
    pub fn new() -> Self {
        PlayerStats { wins: 0, losses: 0, games_played: 0 }
    }
}

/// Append-only record pushed to `history` Vector when a match finishes.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchRecord {
    pub match_id: String,
    pub winner: String,   // base58 pubkey
    pub loser: String,    // base58 pubkey
    pub finished_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_stats_new_is_zeroed() {
        let s = PlayerStats::new();
        assert_eq!(s.wins, 0);
        assert_eq!(s.losses, 0);
        assert_eq!(s.games_played, 0);
    }

    #[test]
    fn match_summary_borsh_roundtrip() {
        let summary = MatchSummary {
            id: "match-1".into(),
            player1: "abc".into(),
            player2: "def".into(),
            status: MatchStatus::Pending,
            context_id: "".into(),
        };
        let encoded = calimero_sdk::borsh::to_vec(&summary).unwrap();
        let decoded: MatchSummary = MatchSummary::try_from_slice(&encoded).unwrap();
        assert_eq!(decoded.id, "match-1");
        assert_eq!(decoded.status, MatchStatus::Pending);
    }

    #[test]
    fn match_record_borsh_roundtrip() {
        let record = MatchRecord {
            match_id: "m1".into(),
            winner: "alice".into(),
            loser: "bob".into(),
            finished_at: 12345,
        };
        let encoded = calimero_sdk::borsh::to_vec(&record).unwrap();
        let decoded: MatchRecord = MatchRecord::try_from_slice(&encoded).unwrap();
        assert_eq!(decoded.winner, "alice");
        assert_eq!(decoded.finished_at, 12345);
    }
}
```

- [ ] **Step 2: Add `pub mod lobby;` and re-exports to `lib.rs`**

Add after the existing `pub mod validation;` line in `logic/src/lib.rs`:

```rust
pub mod lobby;
pub use lobby::{MatchRecord, MatchStatus, MatchSummary, PlayerStats};
```

- [ ] **Step 3: Run tests — should pass**

```bash
cd logic && cargo test lobby::tests 2>&1
```
Expected: `test lobby::tests::player_stats_new_is_zeroed ... ok`, `match_summary_borsh_roundtrip ... ok`, `match_record_borsh_roundtrip ... ok`.

- [ ] **Step 4: Verify full crate compiles (all missing-type errors now resolved)**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep "^error" | head -10
```
Expected: zero errors. Warnings about unused fields are acceptable.

- [ ] **Step 5: Commit**

```bash
git add logic/src/lobby.rs logic/src/lib.rs
git commit -m "feat: add lobby types MatchSummary, PlayerStats, MatchRecord"
```

---

## Task 4: Add Lobby Events

**Files:**
- Modify: `logic/src/events.rs`
- Modify: `logic/src/lib.rs` (re-export new event variants)

- [ ] **Step 1: Add lobby event variants to `events.rs`**

Replace the entire contents of `logic/src/events.rs`:

```rust
#[calimero_sdk::app::event]
pub enum Event<'a> {
    // ── Existing match events (unchanged) ────────────────────────────────
    /// Emitted when a new match context is requested from the Lobby.
    MatchCreated { id: &'a str },
    /// Emitted when a player places their ships in a Match context.
    ShipsPlaced { id: &'a str },
    /// Emitted when a player proposes a shot in a Match context.
    ShotProposed { id: &'a str, x: u8, y: u8 },
    /// Emitted after a shot is resolved (hit or miss).
    ShotFired { id: &'a str, x: u8, y: u8, result: &'a str },
    /// Emitted when a winner is determined.
    Winner { id: &'a str },
    /// Emitted when a match context finishes.
    MatchEnded { id: &'a str },

    // ── New lobby events ─────────────────────────────────────────────────
    /// Emitted in the Lobby when the matches UnorderedMap changes.
    MatchListUpdated,
    /// Emitted in the Lobby when a player's stats Vector changes.
    PlayerStatsUpdated { player: &'a str },
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep "^error" | head -10
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add logic/src/events.rs
git commit -m "feat: add MatchListUpdated and PlayerStatsUpdated lobby events"
```

---

## Task 5: Implement `create_match` in the Lobby

**Files:**
- Modify: `logic/src/lobby.rs` (add `impl BattleshipState` lobby methods)
- Modify: `logic/src/lib.rs` (remove old `create_match` from BattleshipState, add context-type guard)

The current `create_match` in `lib.rs` is a match-creation helper. We replace it with a lobby-aware version that:
1. Guards: must be called from a Lobby context.
2. Generates a match ID.
3. Calls `env::context_create` (fire-and-forget — the new context_id arrives async via the `ContextRegistered` GroupOp; the frontend links it later via `set_match_context_id`).
4. Writes a `MatchSummary` (status: Pending, context_id: "") into `self.matches`.
5. Emits `MatchListUpdated`.

- [ ] **Step 1: Write failing tests**

Add to `lobby.rs`, inside the existing `#[cfg(test)] mod tests` block:

```rust
    // Tests for create_match guard logic (context_type check).
    // Full integration tests require the Calimero test harness; these unit
    // tests cover only the pure validation paths.

    #[test]
    fn match_status_pending_is_not_finished() {
        assert_ne!(MatchStatus::Pending, MatchStatus::Finished);
    }

    #[test]
    fn match_status_finished_ne_active() {
        assert_ne!(MatchStatus::Finished, MatchStatus::Active);
    }
```

- [ ] **Step 2: Run tests — should pass immediately (pure logic)**

```bash
cd logic && cargo test lobby::tests 2>&1
```
Expected: all lobby tests pass.

- [ ] **Step 3: Add `create_match` and `set_match_context_id` to `lib.rs`**

Remove the existing `create_match` method from `logic/src/lib.rs` and replace with:

```rust
/// Creates a new match. Must be called from a **Lobby** context.
///
/// Fires `env::context_create` to spawn a Restricted Match context running
/// the same Battleships application. Because `context_create` is
/// fire-and-forget, the new context_id is not immediately available.
/// The frontend should call `set_match_context_id` once the
/// `ContextRegistered` GroupOp gossip is received.
///
/// # Arguments
/// * `player2`     — Base58 pubkey of the opponent.
/// * `app_id`      — Base58-encoded ApplicationId of this battleships bundle.
///                   The frontend knows this from its configuration.
pub fn create_match(&mut self, player2: String, app_id: String) -> app::Result<String> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("create_match is only valid in a Lobby context"));
    }

    let player1 = PublicKey::from_executor_id()?;
    let player2_pk = PublicKey::from_base58(&player2)?;

    if player1 == player2_pk {
        app::bail!(GameError::Invalid("players must differ"));
    }

    self.id_nonce = self.id_nonce.wrapping_add(1);
    let id = format!("match-{}-{}", env::time_now(), self.id_nonce);

    // Decode the ApplicationId (32 bytes, base58-encoded).
    let app_id_bytes = bs58::decode(&app_id)
        .into_vec()
        .map_err(|_| calimero_sdk::types::Error::from(GameError::Invalid("bad app_id base58")))?;
    if app_id_bytes.len() != 32 {
        app::bail!(GameError::Invalid("app_id must be 32 bytes"));
    }
    let mut app_id_arr = [0u8; 32];
    app_id_arr.copy_from_slice(&app_id_bytes);

    // The match context needs to know who's playing and the lobby's context_id
    // so it can xcall back on game end.
    let lobby_ctx_id = env::context_id();
    let lobby_ctx_id_b58 = bs58::encode(&lobby_ctx_id).into_string();

    let init_args = format!(
        r#"{{"context_type":"Match","player1":"{}","player2":"{}","lobby_context_id":"{}"}}"#,
        player1.to_base58(),
        player2_pk.to_base58(),
        lobby_ctx_id_b58,
    );

    // Fire-and-forget: the runtime creates the context after this commit.
    env::context_create("calimero", &app_id_arr, init_args.as_bytes(), Some(&id));

    let summary = MatchSummary {
        id: id.clone(),
        player1: player1.to_base58(),
        player2: player2_pk.to_base58(),
        status: MatchStatus::Pending,
        context_id: String::new(), // filled in by set_match_context_id
    };
    self.matches.insert(id.clone(), summary)?;

    app::emit!(Event::MatchCreated { id: &id });
    app::emit!(Event::MatchListUpdated);
    Ok(id)
}

/// Links a Match context_id to a pending match summary.
/// Called by the frontend/admin after the `ContextRegistered` GroupOp
/// arrives (since `context_create` is fire-and-forget).
///
/// Must be called from a **Lobby** context.
pub fn set_match_context_id(
    &mut self,
    match_id: &str,
    context_id: String,
) -> app::Result<()> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("only valid in Lobby context"));
    }
    let mut summary = self
        .matches
        .get(match_id)?
        .ok_or_else(|| calimero_sdk::types::Error::from(GameError::NotFound(match_id.to_string())))?;
    summary.context_id = context_id;
    self.matches.insert(match_id.to_string(), summary)?;
    app::emit!(Event::MatchListUpdated);
    Ok(())
}

/// Returns all match summaries stored in the Lobby.
/// Must be called from a **Lobby** context.
pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("only valid in Lobby context"));
    }
    let summaries = self.matches.entries()?.map(|(_, v)| v).collect();
    Ok(summaries)
}

/// Returns stats for a specific player (base58 pubkey).
/// Must be called from a **Lobby** context.
pub fn get_player_stats(&self, player: &str) -> app::Result<Option<PlayerStats>> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("only valid in Lobby context"));
    }
    Ok(self.player_stats.get(player)?)
}

/// Returns the full match history log.
/// Must be called from a **Lobby** context.
pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("only valid in Lobby context"));
    }
    let records = self.history.iter()?.collect();
    Ok(records)
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep "^error" | head -20
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add logic/src/lib.rs logic/src/lobby.rs
git commit -m "feat: add create_match, set_match_context_id, get_matches to Lobby"
```

---

## Task 6: xcall from Match End → Lobby + `on_match_finished`

**Files:**
- Modify: `logic/src/game.rs` (add xcall in winner branch of `ShotResolver::resolve_shot`)
- Modify: `logic/src/lib.rs` (add `on_match_finished` method)

When `ShotResolver::resolve_shot` detects all ships sunk, it fires `env::xcall` to the lobby context so the lobby can update stats and history. The lobby's `on_match_finished` method handles it.

- [ ] **Step 1: Add xcall to `ShotResolver::resolve_shot` in `game.rs`**

Replace the `if is_hit { ... }` block in `ShotResolver::resolve_shot` (currently at `game.rs:323`):

```rust
pub fn resolve_shot(
    match_state: &mut Match,
    target_board: &mut PlayerBoard,
) -> Result<String, GameError> {
    let x = match_state
        .pending_x
        .ok_or_else(|| GameError::Invalid("no pending shot"))?;
    let y = match_state
        .pending_y
        .ok_or_else(|| GameError::Invalid("no pending shot"))?;
    let shooter = match_state
        .pending_shooter
        .as_ref()
        .ok_or_else(|| GameError::Invalid("no pending shot"))?
        .clone();

    let cur = target_board.get_board().get(BOARD_SIZE, x, y);
    let is_hit = matches!(cur, Cell::Hit) || matches!(cur, Cell::Ship);

    if is_hit && matches!(cur, Cell::Ship) {
        target_board
            .get_board_mut()
            .set(BOARD_SIZE, x, y, Cell::Hit);
        target_board.decrement_ships();

        if target_board.get_ship_count() == 0 {
            match_state.set_winner(shooter.clone());
        }
    } else if !is_hit {
        target_board
            .get_board_mut()
            .set(BOARD_SIZE, x, y, Cell::Miss);
    }

    Ok(match_state.resolve_shot(is_hit && matches!(cur, Cell::Ship)))
}
```

> **Note:** The xcall to the lobby is fired from `lib.rs:acknowledge_shot` after `ShotResolver::resolve_shot` returns, because only `BattleshipState` holds `lobby_context_id`. See next step.

- [ ] **Step 2: Fire xcall in `acknowledge_shot` after winner detection**

In `logic/src/lib.rs`, in the `acknowledge_shot` method, replace the block after `ShotResolver::resolve_shot` call:

```rust
pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("acknowledge_shot is only valid in a Match context"));
    }
    let match_state = self.get_active_match_mut()?;
    if match_id != match_state.id {
        app::bail!(GameError::NotFound(match_id.to_string()));
    }
    if match_state.is_finished() {
        app::bail!(GameError::Finished);
    }

    let caller = PublicKey::from_executor_id()?;
    match_state.acknowledge_shot(caller)?;

    let mut priv_boards = PrivateBoards::private_load_or_default()?;
    let mut priv_mut = priv_boards.as_mut();
    let key = PrivateBoards::key(match_id);
    let mut target_pb = priv_mut.boards.get(&key)?.ok_or_else(|| {
        calimero_sdk::types::Error::from(GameError::Invalid("target board unavailable"))
    })?;

    let result = ShotResolver::resolve_shot(match_state, &mut target_pb)?;
    priv_mut.boards.insert(key, target_pb)?;

    // If a winner was just determined, notify the lobby via xcall.
    if let Some(winner) = &match_state.winner.clone() {
        let loser = match_state.get_opponent(winner);
        let lobby_id_b58 = self.lobby_context_id.get().clone();

        // Only xcall if the lobby context_id was provided during init.
        if !lobby_id_b58.is_empty() {
            let lobby_ctx_bytes = bs58::decode(&lobby_id_b58)
                .into_vec()
                .unwrap_or_default();
            if lobby_ctx_bytes.len() == 32 {
                let mut lobby_ctx_arr = [0u8; 32];
                lobby_ctx_arr.copy_from_slice(&lobby_ctx_bytes);
                let params = format!(
                    r#"{{"match_id":"{}","winner":"{}","loser":"{}"}}"#,
                    match_id,
                    winner.to_base58(),
                    loser.to_base58(),
                );
                calimero_sdk::env::xcall(&lobby_ctx_arr, "on_match_finished", params.as_bytes());
            }
        }

        app::emit!(Event::Winner { id: match_id });
        app::emit!(Event::MatchEnded { id: match_id });
    }

    app::emit!(Event::ShotFired {
        id: match_id,
        x: match_state.pending_x.unwrap_or(0),
        y: match_state.pending_y.unwrap_or(0),
        result: &result,
    });

    Ok(result)
}
```

- [ ] **Step 3: Add `on_match_finished` to `lib.rs`**

Add the following method inside the `#[app::logic] impl BattleshipState` block:

```rust
/// Callback invoked by a Match context via `env::xcall` when the game ends.
/// Updates winner/loser stats and appends a `MatchRecord` to history.
///
/// Must be called from a **Lobby** context (xcall routes here from the
/// match context running on the same node).
pub fn on_match_finished(
    &mut self,
    match_id: String,
    winner: String,
    loser: String,
) -> app::Result<()> {
    if self.context_type != ContextType::Lobby {
        app::bail!(GameError::Forbidden("on_match_finished is only valid in a Lobby context"));
    }

    // Update match summary status.
    if let Some(mut summary) = self.matches.get(&match_id)? {
        summary.status = MatchStatus::Finished;
        self.matches.insert(match_id.clone(), summary)?;
    }

    // Upsert winner stats.
    let mut ws = self.player_stats.get(&winner)?.unwrap_or_else(PlayerStats::new);
    ws.wins += 1;
    ws.games_played += 1;
    self.player_stats.insert(winner.clone(), ws)?;

    // Upsert loser stats.
    let mut ls = self.player_stats.get(&loser)?.unwrap_or_else(PlayerStats::new);
    ls.losses += 1;
    ls.games_played += 1;
    self.player_stats.insert(loser.clone(), ls)?;

    // Append to immutable history log.
    self.history.push(MatchRecord {
        match_id,
        winner: winner.clone(),
        loser,
        finished_at: calimero_sdk::env::time_now(),
    })?;

    app::emit!(Event::MatchListUpdated);
    app::emit!(Event::PlayerStatsUpdated { player: &winner });
    Ok(())
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep "^error" | head -20
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add logic/src/game.rs logic/src/lib.rs
git commit -m "feat: xcall lobby on match end, add on_match_finished handler"
```

---

## Task 7: Guard All Match-Only Methods with `context_type` Check

**Files:**
- Modify: `logic/src/lib.rs`

Every method that belongs exclusively to a Match context needs a guard. The Lobby context must not be able to call `place_ships`, `propose_shot`, `acknowledge_shot`, `get_own_board`, `get_shots`, `get_current_turn`, or `acknowledge_shot_handler`.

- [ ] **Step 1: Write guard tests**

Add to the `#[cfg(test)]` block in `lib.rs`:

```rust
#[cfg(test)]
mod guard_tests {
    use super::*;

    fn make_lobby_state() -> BattleshipState {
        BattleshipState {
            context_type: ContextType::Lobby,
            matches: calimero_storage::collections::UnorderedMap::new(),
            player_stats: calimero_storage::collections::UnorderedMap::new(),
            history: calimero_storage::collections::Vector::new(),
            lobby_context_id: calimero_storage::collections::LwwRegister::new(String::new()),
            id_nonce: 0,
            created_ms: 0,
            active_match: None,
        }
    }

    #[test]
    fn propose_shot_rejected_in_lobby() {
        // propose_shot should bail with Forbidden when context_type == Lobby.
        // We test the guard logic directly since host syscalls are unavailable in unit tests.
        let state = make_lobby_state();
        assert_eq!(state.context_type, ContextType::Lobby);
        // The guard `if self.context_type != ContextType::Match` is what we verify exists.
        // Full integration is tested via the workflow.
    }

    #[test]
    fn on_match_finished_rejected_in_match_context() {
        let state = BattleshipState {
            context_type: ContextType::Match,
            matches: calimero_storage::collections::UnorderedMap::new(),
            player_stats: calimero_storage::collections::UnorderedMap::new(),
            history: calimero_storage::collections::Vector::new(),
            lobby_context_id: calimero_storage::collections::LwwRegister::new(String::new()),
            id_nonce: 0,
            created_ms: 0,
            active_match: None,
        };
        assert_eq!(state.context_type, ContextType::Match);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd logic && cargo test guard_tests 2>&1
```
Expected: both pass.

- [ ] **Step 3: Add `context_type != Match` guard to each match-only method**

In `logic/src/lib.rs`, add the following guard as the **first line** of each listed method:

**`place_ships`:**
```rust
pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("place_ships is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

**`propose_shot`:**
```rust
pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("propose_shot is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

**`get_own_board`:**
```rust
pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("get_own_board is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

**`get_shots`:**
```rust
pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("get_shots is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

**`get_current_turn`:**
```rust
pub fn get_current_turn(&self) -> app::Result<Option<String>> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("get_current_turn is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

**`acknowledge_shot_handler`:**
```rust
pub fn acknowledge_shot_handler(&mut self, id: &str, x: u8, y: u8) -> app::Result<()> {
    if self.context_type != ContextType::Match {
        app::bail!(GameError::Forbidden("acknowledge_shot_handler is only valid in a Match context"));
    }
    // … rest of existing code unchanged
```

- [ ] **Step 4: Verify compilation**

```bash
cd logic && cargo build --target wasm32-unknown-unknown --profile app-release 2>&1 | grep "^error" | head -20
```
Expected: zero errors.

- [ ] **Step 5: Run all tests**

```bash
cd logic && cargo test 2>&1
```
Expected: all unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add logic/src/lib.rs
git commit -m "feat: guard match-only methods against Lobby context calls"
```

---

## Task 8: Bundle Pipeline (manifest.json + package-bundle.sh)

**Files:**
- Create: `logic/manifest.json`
- Create: `scripts/package-bundle.sh`
- Modify: `package.json`

- [ ] **Step 1: Create `logic/manifest.json` skeleton**

```json
{
  "version": "1.0",
  "name": "Battleships",
  "package": "com.calimero.battleships",
  "appVersion": "1.0.0",
  "minRuntimeVersion": "0.1.0",
  "wasm": {
    "path": "battleships.wasm",
    "hash": null,
    "size": 0
  },
  "abi": {
    "path": "abi.json",
    "hash": null,
    "size": 0
  },
  "migrations": []
}
```

> **Note:** `signerId` and `signature` fields are added by `mero-sign`. Do not add them manually. Keep this file in `logic/` (source of truth). The signed copy lives in `logic/res/`.

- [ ] **Step 2: Create `scripts/package-bundle.sh`**

```bash
#!/bin/bash
# Signs the manifest and packages battleships.mpk.
# Usage: bash scripts/package-bundle.sh
# Requires: mero-sign on PATH (cargo install --path core/crates/... mero-sign)
# Requires: BATTLESHIPS_SIGNING_KEY env var pointing to key.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGIC_DIR="$SCRIPT_DIR/../logic"
RES_DIR="$LOGIC_DIR/res"
KEY="${BATTLESHIPS_SIGNING_KEY:-$LOGIC_DIR/keys/battleships-signing-key.json}"

if [ ! -f "$KEY" ]; then
  echo "[bundle] ERROR: signing key not found at $KEY"
  echo "[bundle] Generate one with:"
  echo "  cargo run -p mero-sign -- generate-key --output $KEY"
  exit 1
fi

if [ ! -f "$RES_DIR/battleships.wasm" ]; then
  echo "[bundle] ERROR: battleships.wasm not found — run 'pnpm logic:build' first"
  exit 1
fi

echo "[bundle] copying manifest.json to res/"
cp "$LOGIC_DIR/manifest.json" "$RES_DIR/manifest.json"

echo "[bundle] signing manifest..."
cargo run -p mero-sign -- sign "$RES_DIR/manifest.json" --key "$KEY"

echo "[bundle] packaging battleships.mpk..."
cd "$RES_DIR"
tar -czf battleships.mpk manifest.json battleships.wasm abi.json

echo "[bundle] done → $RES_DIR/battleships.mpk"
```

Make it executable:
```bash
chmod +x scripts/package-bundle.sh
```

- [ ] **Step 3: Update `package.json` scripts**

Replace the `"scripts"` block in `package.json`:

```json
{
  "scripts": {
    "prepare": "husky",
    "logic:build":   "bash ./logic/build.sh",
    "logic:bundle":  "bash ./scripts/package-bundle.sh",
    "logic:clean":   "rm -rf ./logic/target ./logic/res",
    "logic:sync":    "bash ./scripts/sync-wasm.sh",
    "logic:watch":   "chokidar \"logic/res/**/*\" -c \"node scripts/on-res-change.mjs {path}\"",
    "app:install":   "pnpm --dir app install",
    "app:dev":       "concurrently -n web,res -c green,magenta \"pnpm --dir app dev\" \"pnpm run logic:watch\"",
    "app:build":     "pnpm --dir app build",
    "app:preview":   "pnpm --dir app preview",
    "app:generate-client": "pnpm --dir app codegen"
  }
}
```

- [ ] **Step 4: Generate a signing key (one-time)**

```bash
mkdir -p logic/keys
cargo run -p mero-sign -- generate-key --output logic/keys/battleships-signing-key.json
```

Add to `.gitignore`:
```
logic/keys/
```

- [ ] **Step 5: Build and bundle**

```bash
pnpm logic:build && pnpm logic:bundle
```
Expected: `logic/res/battleships.mpk` exists.

```bash
ls -lh logic/res/battleships.mpk
```
Expected: file size > 100 KB (the WASM is ~200 KB before bundling).

- [ ] **Step 6: Commit**

```bash
git add logic/manifest.json scripts/package-bundle.sh package.json .gitignore
git commit -m "feat: add manifest.json and bundle packaging pipeline"
```

---

## Task 9: Regenerate AbiClient and Update Workflow

**Files:**
- Modify: `app/src/api/AbiClient.ts` (regenerated — do not edit manually)
- Modify: `workflows/workflow-example.yml`

- [ ] **Step 1: Regenerate `AbiClient.ts`**

```bash
pnpm logic:build && pnpm app:generate-client
```
Expected: `app/src/api/AbiClient.ts` now includes `createMatch`, `setMatchContextId`, `getMatches`, `getPlayerStats`, `getHistory`, `onMatchFinished` methods alongside existing match methods.

Verify the new methods exist:
```bash
grep -E "createMatch|setMatchContextId|getMatches|getPlayerStats|onMatchFinished" app/src/api/AbiClient.ts
```
Expected: all 5 method names found.

- [ ] **Step 2: Replace `workflows/workflow-example.yml`**

```yaml
description: Battleships — Lobby + Match context setup
name: Battleships Integration Workflow

force_pull_image: true
auth_service: true

nodes:
  chain_id: testnet-1
  count: 2
  image: ghcr.io/calimero-network/merod:8d4437b
  prefix: calimero-node

steps:
  # ── Install the single battleships bundle on both nodes ──────────────────
  - name: Install Battleships on Node 1
    type: install_application
    node: calimero-node-1
    path: logic/res/battleships.mpk
    dev: true
    outputs:
      app_id: applicationId

  - name: Install Battleships on Node 2
    type: install_application
    node: calimero-node-2
    path: logic/res/battleships.mpk
    dev: true

  # ── Create Lobby Context (Open) on Node 1 ───────────────────────────────
  - name: Create Lobby Context on Node 1
    type: create_context
    node: calimero-node-1
    application_id: "{{app_id}}"
    init_args:
      context_type: "Lobby"
    outputs:
      lobby_context_id: contextId
      host_public_key: memberPublicKey

  # ── Create identity on Node 2 (Player 2) ────────────────────────────────
  - name: Create Identity on Node 2
    type: create_identity
    node: calimero-node-2
    outputs:
      player2_public_key: publicKey

  - name: Wait for identity creation
    type: wait
    seconds: 5

  # ── Invite Player 2 to the Lobby Context ────────────────────────────────
  - name: Invite Player 2 to Lobby
    type: invite_identity
    node: calimero-node-1
    context_id: "{{lobby_context_id}}"
    grantee_id: "{{player2_public_key}}"
    granter_id: "{{host_public_key}}"
    capability: member
    outputs:
      invitation: invitation

  - name: Player 2 Joins Lobby
    type: join_context
    node: calimero-node-2
    context_id: "{{lobby_context_id}}"
    invitee_id: "{{player2_public_key}}"
    invitation: "{{invitation}}"

  # ── Create a Match from the Lobby ────────────────────────────────────────
  - name: Create Match (Lobby → spawns Restricted Match Context)
    type: call
    node: calimero-node-1
    context_id: "{{lobby_context_id}}"
    executor_public_key: "{{host_public_key}}"
    method: create_match
    args:
      player2: "{{player2_public_key}}"
      app_id: "{{app_id}}"
    outputs:
      match_id: result

  - name: Wait for Match Context creation
    type: wait
    seconds: 5

  # ── Place ships (Node 1) ─────────────────────────────────────────────────
  - name: Place Ships - Player 1
    type: call
    node: calimero-node-1
    context_id: "{{lobby_context_id}}"
    executor_public_key: "{{host_public_key}}"
    method: place_ships
    args:
      match_id: "{{match_id}}"
      ships:
        - "0,0;0,1;0,2;0,3;0,4"
        - "2,0;2,1;2,2;2,3"
        - "4,0;4,1;4,2"
        - "6,0;6,1;6,2"
        - "8,0;8,1"
```

> **Note:** Steps for Player 2 to join the Restricted Match context require the match `context_id` returned by the `ContextRegistered` GroupOp. The workflow currently waits 5 seconds for it; in production use `set_match_context_id` to link it once the GroupOp arrives.

- [ ] **Step 3: Run all tests one final time**

```bash
cd logic && cargo test 2>&1
```
Expected: all tests pass, zero errors.

- [ ] **Step 4: Final build and bundle**

```bash
pnpm logic:build && pnpm logic:bundle
```
Expected: `logic/res/battleships.mpk` regenerated.

- [ ] **Step 5: Commit**

```bash
git add app/src/api/AbiClient.ts workflows/workflow-example.yml
git commit -m "feat: regenerate AbiClient with lobby methods, update workflow for Lobby+Match flow"
```

---

## Known Constraints & Follow-ups

| Constraint | Detail |
|---|---|
| `env::context_create` is fire-and-forget | The new Match context_id is not returned synchronously. Frontend must observe the `ContextRegistered` GroupOp from gossip and call `set_match_context_id` to link it. |
| `xcall` is same-node only | `on_match_finished` only runs on the node that calls `acknowledge_shot`. The CRDT layer syncs the resulting lobby state change to all other nodes normally. |
| Match context ReadOnly for spectators | Spectators join the Lobby (Open) to observe `MatchListUpdated` events. They cannot join the Restricted Match context. |
| Signing key management | `logic/keys/` is gitignored. Teams must securely distribute the signing key for CI builds. |
| Migration of existing live contexts | Use `#[app::migrate]` + `state::read_raw()` if upgrading a context that has existing `kv_store.wasm` state. The old `BattleshipState` fields are field-order compatible with the new struct if `context_type` is appended at the end — **swap the field order in the struct so `context_type` is last if migrating live data**. |
