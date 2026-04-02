# Battleships Group Improvements

## Purpose

This document records the follow-up improvements identified after reviewing the completed Battleships backend changes and the corresponding frontend planning work for the group-aware architecture.

It complements:

- `battleships/docs/superpowers/plans/2026-03-31-battleships-group-architecture.md`
- `battleships/docs/superpowers/plans/2026-03-31-battleships-group-client-plan.md`

## Backend Improvements

### Critical

- `battleships/logic/src/lib.rs`: make `on_match_finished()` validate that `match_id` exists before mutating stats or history.
  - Current behavior can update player stats and append history even if the match summary is missing.
  - Expected behavior is to reject or safely ignore unknown matches without side effects.

- `battleships/logic/src/lib.rs`: add a real test for unknown-match handling.
  - The current test coverage around this path is misleading because it does not actually exercise `on_match_finished()`.
  - Add a test that calls `on_match_finished()` directly and asserts that stats, history, and events are unchanged for an unknown `match_id`.

### Important

- `battleships/logic/src/lib.rs`: make `on_match_finished()` idempotent.
  - If the same match finish callback is delivered more than once, the function should not increment stats or append duplicate history rows twice.
  - A finished match should transition once and then no-op on repeats.

- `battleships/logic/src/lib.rs`: make Match initialization fail loudly or defensively when required init arguments are missing.
  - A `ContextType::Match` context should not be allowed to come up with `active_match: None` unless that state is explicitly intended and handled.
  - Prefer validating `player1`, `player2`, and `lobby_context_id` at init time.

- `battleships/logic/src/lib.rs`: improve observability when `lobby_context_id` is malformed.
  - Today a bad base58 or wrong-length context id can silently skip the `xcall`.
  - Add clearer error handling, logging, or defensive state validation so match completion failures are diagnosable.

- `battleships/logic/res/abi.json`: confirm nullability/optional behavior for methods returning `Option`.
  - In particular, verify generated client handling for `get_player_stats()`, `get_active_match_id()`, and `get_current_turn()`.
  - Make sure downstream codegen reflects optional values correctly.

### Lower Priority

- `battleships/logic/src/game.rs` and nearby modules: consider cleaning up decorative banner comments if those files are being touched again.
  - This is not a functional issue, but it would improve consistency with workspace rules.

## Frontend Improvements

### Important

- `battleships/app`: enforce the canonical frontend model explicitly everywhere:
  - one Battleships group
  - one canonical open Lobby context inside that group
  - many Match contexts inside that same group

- `battleships/app`: ensure Lobby resolution does not silently fall back to the wrong context.
  - If the canonical Lobby cannot be resolved confidently, the app should show an explicit error or recovery path.
  - It should not bind Lobby behavior to an arbitrary first context.

- `battleships/app`: keep route state explicit for Match navigation.
  - Match pages should continue to rely on explicit `match_id` and `context_id` rather than implicit global context state.
  - Refreshing a Match route must reopen the correct Match context.

### Planning and Process

- `battleships/docs/superpowers/plans/2026-03-31-battleships-group-client-plan.md`: reconcile the repo plan with the implemented direction.
  - The plan should clearly distinguish required work from optional/general-purpose enhancements.
  - It should also reflect that Battleships uses direct admin API context creation and explicit Lobby linking.

- `.cursor/plans/battleships_frontend_6be70e79.plan.md`: keep the generated frontend plan in sync with the actual implementation status.
  - Any stale code anchors or outdated assumptions should be refreshed when the next milestone is completed.

## Cross-Layer Follow-Ups

- Confirm whether Match context creation must carry explicit group information in the admin API request path.
  - If group-scoped context creation is required by the platform, `mero-js` request parity must include the necessary fields.
  - Frontend and backend assumptions should stay aligned on this point.

- Confirm the expected lifecycle for Match completion callbacks.
  - If `xcall` retries or duplicate deliveries are possible, backend idempotency is mandatory.
  - If duplicates are impossible by contract, document that assumption clearly.

- Keep the architecture narrative aligned with the actual creation flow:
  - `create_match()` creates a pending Lobby record
  - client creates the Match context through admin API
  - client links it via `set_match_context_id()`
  - Match reports finish state back through `xcall`

## Recommended Order

1. Fix `on_match_finished()` correctness and test coverage in `battleships/logic/src/lib.rs`.
2. Confirm ABI/client nullability behavior for optional Lobby and Match getters.
3. Tighten frontend canonical Lobby resolution so the wrong context cannot be chosen silently.
4. Reconcile the repo plans with the implemented architecture and frontend flow.
5. Validate group-aware Match context creation fields across `mero-js`, frontend, and backend assumptions.

## Done Well So Far

- The backend architecture has been corrected to use admin API Match context creation instead of contract-side `env::context_create`.
- The frontend planning now explicitly models `group -> canonical open Lobby -> Match contexts`.
- The overall product flow is coherent:
  - create or select group
  - enter canonical Lobby
  - create pending match
  - create Match context through admin API
  - link Match context into Lobby state
  - play Match
  - report completion back to Lobby
