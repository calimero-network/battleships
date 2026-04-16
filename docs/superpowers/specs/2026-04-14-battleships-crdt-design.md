# Battleships CRDT State Migration & Board Commitment Scheme

**Status:** Design approved, pending implementation plan
**Date:** 2026-04-14
**Scope:** `battleships/logic/` — lobby and game contracts

## Goals

1. Replace plain collections (`Vec`, `u64`, `Option<T>`) with Calimero CRDT primitives so concurrent writes merge correctly instead of silently diverging.
2. Add a SHA256 board-commitment scheme that prevents mid-game ship movement.
3. Add a post-game shot audit that catches players who lie about hit/miss responses.
4. Preserve the existing two-context architecture (one lobby context, one per-match game context) and the xcall protocol between them.

## Non-goals

- Cross-device / private-state-recovery via encryption. Addressed minimally via export/import hooks; full encrypted-per-user storage is a separate design.
- Turn timeout / stalling enforcement. The design removes the reveal-step as a stalling surface but does not introduce general timeouts.
- Migration of live state. This is a breaking change; data starts fresh.

## Decisions (locked during brainstorming)

| # | Topic | Decision |
|---|---|---|
| 1 | Match ID format | `"{p1_b58}-{p2_b58}-{created_ms}"` |
| 2 | Match struct merge granularity | Fully decomposed into per-field CRDTs on `GameState`; `Match` struct deleted |
| 3 | Commitment storage | `UserStorage<[u8; 32]>` (writer-authorized by `PublicKey`) |
| 4 | `PlayerStats` inner granularity | `Counter` per field, deterministic field names |
| 5 | `MatchSummary` inner granularity | Plain fields (single-writer-per-transition in practice) |
| 6 | Match-ID collision handling | Reject with `Error::MatchIdCollision`; caller retries |
| 7 | Anti-cheat audit | Included; replays every shot against revealed board |
| 8 | Reveal orchestration | Automatic during the winning `acknowledge_shot`; can't declare winner without passing audit |
| 9 | Durability under device switch / storage wipe | Accept as known constraint; expose `export_board_seed` / `import_board_seed` |
| 10 | Existing-state migration | None. Breaking change, fresh start |

## Architecture

### What stays the same

- Two-context model: one lobby context, one per-match game context.
- Cross-context xcall from game → lobby on match finish.
- `#[app::private] PrivateBoards` continues to hold the secret board grids. `UserStorage` is readable by opponents via `get_for_user`, so it cannot hold the secret board — only the commitment hash.
- Top-level method flow: `place_ships` → `propose_shot` → `acknowledge_shot`.

### What changes

| Layer | Before | After |
|---|---|---|
| `LobbyState.matches` | `Vec<MatchSummary>` | `UnorderedMap<String, MatchSummary>` |
| `LobbyState.player_stats` | `Vec<PlayerStatsEntry>` | `UnorderedMap<String, PlayerStats>` |
| `LobbyState.history` | `Vec<MatchRecord>` | `Vector<MatchRecord>` |
| `LobbyState.id_nonce` | `u64` | removed |
| `LobbyState.created_ms` | `u64` | `LwwRegister<u64>` |
| `PlayerStats` | `{wins, losses, games_played: u64}` | `{wins, losses, games_played: Counter}` with `new_with_field_name` for deterministic IDs |
| `GameState` | `{lobby_context_id, active_match: Option<Match>}` | Fields of `Match` flattened directly onto `GameState` as individual CRDTs; `Match` struct deleted |
| `GameState.commitments` | — | `UserStorage<[u8; 32]>` |
| `PlayerBoard` (private) | `{own, ships, placed}` | `{own, ships, placed, salt: [u8; 16]}` |

## Lobby state

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

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub struct MatchSummary {
    match_id: String,
    player1: String,          // base58 pubkey
    player2: String,
    status: MatchStatus,      // Pending | Active | Finished — plain enum
    context_id: Option<String>,
    winner: Option<String>,
    created_ms: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct PlayerStats {
    wins: Counter,
    losses: Counter,
    games_played: Counter,
}

impl PlayerStats {
    fn new(player_key: &str) -> Self {
        Self {
            wins: Counter::new_with_field_name(format!("stats:{player_key}:wins")),
            losses: Counter::new_with_field_name(format!("stats:{player_key}:losses")),
            games_played: Counter::new_with_field_name(format!("stats:{player_key}:games")),
        }
    }
}
```

### Lobby method changes

**`init()`**
- `created_ms = LwwRegister::new(env::time_now())`
- Collections constructed via `new_with_field_name` for top-level determinism.

**`create_match(player2)`**
- `match_id = format!("{caller_b58}-{player2_b58}-{created_ms}")` where `created_ms = env::time_now()`.
- `if matches.contains(&match_id)?` → `Err(Error::MatchIdCollision)`. Caller retries (new timestamp).
- `matches.insert(match_id.clone(), summary)`.
- Emit `MatchCreated { match_id, player1, player2 }`.

**`set_match_context_id(match_id, context_id)`**
- `matches.get(&match_id)?` → mutate `status` to `Active`, set `context_id`. Reinsert.

**`on_match_finished(match_id, winner_b58, loser_b58)`** (xcall target)
- Mutate summary: `status = Finished`, `winner = Some(winner_b58)`. Reinsert.
- `history.push(MatchRecord { match_id, winner: winner_b58, loser: loser_b58, finished_ms })`.
- For each of winner / loser: `player_stats.get(&key)?` → if None insert fresh `PlayerStats::new(&key)` → `increment()` the appropriate Counters → reinsert.

## Game state (Match decomposed)

```rust
#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct GameState {
    lobby_context_id: LwwRegister<Option<String>>,
    match_id:         LwwRegister<Option<String>>,
    player1:          LwwRegister<Option<PublicKey>>,
    player2:          LwwRegister<Option<PublicKey>>,
    turn:             LwwRegister<Option<PublicKey>>,
    winner:           LwwRegister<Option<PublicKey>>,
    placed_p1:        LwwRegister<bool>,
    placed_p2:        LwwRegister<bool>,
    pending:          LwwRegister<Option<PendingShot>>,
    shots_p1:         UnorderedMap<u8, Cell>,   // key = y * 10 + x
    shots_p2:         UnorderedMap<u8, Cell>,
    commitments:      UserStorage<[u8; 32]>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub struct PendingShot {
    x: u8,
    y: u8,
    shooter: PublicKey,
    target: PublicKey,
}
```

Rationale for the `Option<PublicKey>` wrappers: `LwwRegister` must be default-constructible at struct-init time, before `init()` supplies the players. `None` is the pre-init sentinel.

### Game method changes

**`init(player1, player2, lobby_context_id)`**
- Writes all registers; `turn = Some(player1)`, `winner = None`, `placed_* = false`, `pending = None`.
- Constructs empty `shots_p1`/`shots_p2` maps and empty `commitments` UserStorage.

**`place_ships(match_id, ships)`**
1. Parse coordinates; validate via existing `ValidationContext::ship_placement()`.
2. Enforce write-once: `if commitments.get()?.is_some()` → `Err(Error::AlreadyCommitted)`.
3. Generate salt: `let mut salt = [0u8; 16]; env::random_bytes(&mut salt);`.
4. Load `PrivateBoards`, construct `PlayerBoard { own, ships: count, placed: true, salt }`, store under `match_id`.
5. Compute `commitment = sha256(borsh_serialize(&own) || salt)`.
6. `commitments.insert(commitment)` (UserStorage enforces caller-owns-slot).
7. Set `placed_p1` or `placed_p2` based on caller identity.
8. Emit `BoardCommitted { match_id, player, commitment }`; emit existing `ShipsPlaced`.

**`propose_shot(match_id, x, y)`**
- Guards: `turn.get() == caller`, `winner.get().is_none()`, `placed_p1 && placed_p2`, `pending == None`.
- `pending.set(Some(PendingShot { x, y, shooter, target }))`.
- Insert `Cell::Pending` into shooter's shot map at key `y*10+x`.
- Emit `ShotProposed`.

**`acknowledge_shot(match_id)`**
- Load `pending`; caller must be `pending.target`.
- Load opponent's target board from `PrivateBoards` (the caller is the target, so board is local).
- Resolve via existing `ShotResolver` → `Cell::Hit` or `Cell::Miss`; decrement `ships` if hit.
- Overwrite the shooter's shot map entry at `y*10+x` with `Cell::Hit|Miss`.
- Clear `pending.set(None)`.
- **Winning-shot branch** (`ships == 0` post-resolve):
  1. Run `audit_self(match_id, own_board, salt)` (see §Audit).
  2. If audit passes: `winner.set(Some(caller))`, emit `AuditPassed`, emit `Winner`, `MatchEnded`, xcall `on_match_finished(match_id, winner_b58, loser_b58)`.
  3. If audit fails: `winner.set(Some(caller))` still (we do not block winner declaration on audit), emit `AuditFailed { reason }`, xcall `on_match_finished` with the audit-failed flag. (Lobby records the result; downstream UI can surface the failure.)
- **Non-winning branch**: swap `turn`, emit `ShotFired`.

**`reveal_board(match_id)`** *(new, optional)*
- Caller (typically the loser) submits nothing; their private board + salt are already local.
- Runs the same audit routine: verifies `sha256(own || salt) == commitments.get_for_user(caller)` and replays every shot in `shots_p{caller}` against the revealed board.
- Emits `BoardRevealed { match_id, player }` and `AuditPassed`/`AuditFailed`.
- Purely informational — does not change `winner` or stats.

**`export_board_seed(match_id)`** *(new, view)*
```rust
pub fn export_board_seed(&self, match_id: String)
    -> app::Result<ExportedSeed>;

pub struct ExportedSeed {
    board_bytes: Vec<u8>,   // borsh-serialized own Board
    salt: [u8; 16],
}
```
Frontend persists this off-node (IndexedDB, file download, password manager — UX team's choice).

**`import_board_seed(match_id, board_bytes, salt)`** *(new, mutating)*
- Deserialize `board_bytes` → `Board`.
- Recompute commitment: `sha256(board_bytes || salt)`; compare to `commitments.get_for_user(caller)`.
- If mismatch → `Err(Error::CommitmentMismatch)`.
- If match → load `PrivateBoards`, upsert `PlayerBoard { own, ships: count, placed: true, salt }` under `match_id`.

## Audit routine

Shared internal function, used by both `acknowledge_shot` (winning branch) and `reveal_board`:

```rust
fn audit_self(
    match_id: &str,
    own_board: &Board,
    salt: &[u8; 16],
    commitment: &[u8; 32],
    shots_against_me: &UnorderedMap<u8, Cell>,
) -> Result<(), AuditFailure>;
```

Steps:
1. **Commitment check.** Recompute `sha256(borsh_serialize(own_board) || salt)`; fail if not equal to `commitment`.
2. **Shot replay.** For each `(key, cell)` in `shots_against_me`:
   - `x = key % 10, y = key / 10`.
   - Look up the true cell in `own_board`.
   - If recorded cell is `Cell::Hit` and true cell is not a ship → fail.
   - If recorded cell is `Cell::Miss` and true cell is a ship → fail.
   - `Cell::Pending` is skipped (may remain if the final ack loop is mid-write; code should ensure this is not the case for the auditing player's map, but tolerate it for the opposite map).
3. Return `Ok(())` only if every check passes.

On failure, the caller emits `AuditFailed { reason }` where `reason` is `"commitment_mismatch"` or `"shot_inconsistent { x, y, recorded, actual }"`.

## Events

New, added to existing enum:
```rust
BoardCommitted    { match_id, player, commitment: [u8; 32] },
BoardRevealed     { match_id, player },
AuditPassed       { match_id, player },
AuditFailed       { match_id, player, reason: String },
MatchIdCollision  { attempted_id: String },   // emitted by lobby on failed create_match
```

Existing events (`MatchCreated`, `ShipsPlaced`, `ShotProposed`, `ShotFired`, `Winner`, `MatchEnded`, etc.) retained.

## Errors

New variants in the existing error enum:
```rust
Error::MatchIdCollision,
Error::AlreadyCommitted,
Error::CommitmentMismatch,
Error::AuditFailed { reason: String },
Error::BoardNotFound,   // for export/import when no PrivateBoard exists for match_id
```

## Durability constraint (accepted, documented)

`#[app::private]` storage is **node-local and not synced**. Consequences:

- Tab close with same browser storage intact → fine.
- Clearing site data, switching to incognito, or using a different device mid-match → player's board and salt are gone from their node. They cannot answer shots correctly and cannot pass the audit → effective forfeit.

**Mitigation surface:** `export_board_seed` / `import_board_seed`. The client is expected to prompt the user to back up the seed after `place_ships` succeeds. Frontends that do not implement this UX will expose users to Case 2/3 forfeits.

**Out of scope:** encrypted-per-user shared storage (would move the board into replicated state with opponent-invisible ciphertext). Separate design doc if that becomes a requirement.

## Testing

### Unit

1. **Lobby ID collision**: two concurrent `create_match` with same `(p1, p2, timestamp)` — first wins, second returns `Error::MatchIdCollision`.
2. **Stats Counter merge**: two concurrent `on_match_finished` increments on the same player's stats — both increments preserved after merge.
3. **Shot map add-wins**: two concurrent shot-map inserts at different keys — both present post-merge.
4. **LWW fields**: `turn`, `winner`, `pending` merges respect HLC ordering.
5. **Commitment roundtrip**: `place_ships` stores salt+commitment; audit with same board passes; audit with tampered board fails.
6. **Double commit rejected**: second `place_ships` call for same player returns `AlreadyCommitted`.
7. **Audit replay catches lying ack**: inject a `Cell::Miss` at a coordinate that is a ship in the revealed board → audit returns `AuditFailed` with `shot_inconsistent`.
8. **Export/import roundtrip**: export, drop `PrivateBoards`, import, resume game without error.

### Integration

1. **Write-authorization**: P1 attempts to write P2's `commitments` slot → SDK-level rejection (UserStorage enforces).
2. **Two-node simulated match**: full happy path produces `AuditPassed` on the winning ack.
3. **Cross-context xcall**: game → lobby `on_match_finished` increments Counters and updates `MatchSummary.status`.

## Open implementation-time questions

These do not block the design but must be resolved during the plan:

1. **Exact `Counter::new_with_field_name` API / Mergeable constraints** for Counters nested inside a struct stored in an `UnorderedMap`. Need to verify whether the Counter's field name is sufficient for convergence, or whether the parent map's key must be incorporated.
2. **`env::time_now()` resolution** — if it's whole-millisecond, sub-ms rapid creation will still trigger `MatchIdCollision` occasionally; confirm acceptable in practice.
3. **Borsh serialization stability of `Board`** for the commitment preimage. Need deterministic byte layout; if `Board` is `Vec<u8>` row-major this is already stable, but confirm.

## Affected files (preliminary)

- `battleships/logic/crates/lobby/src/lib.rs` — state struct, methods, events, errors.
- `battleships/logic/crates/game/src/lib.rs` — state struct, methods, events, errors.
- `battleships/logic/crates/game/src/game.rs` — delete `Match` struct; move fields onto `GameState`. `ShotResolver` logic largely retained.
- `battleships/logic/crates/game/src/players.rs` — add `salt` to `PlayerBoard`.
- `battleships/logic/crates/types/` — new enum variants, error variants, `ExportedSeed`.
- `battleships/logic/Cargo.toml` — ensure `sha2` or equivalent dep is present for SHA256; confirm `calimero-storage` exports the CRDT types we use.

Frontend (`battleships/app/`) must adapt to new method signatures and the export/import flow, but that's a separate task in the implementation plan.
