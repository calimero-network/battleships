# Lobby-First Flow Design

## Context

The battleships app currently uses a **group-first** pattern: users explicitly create a group, then a lobby context is created inside it, then matches. This requires the user to understand the "group" concept and involves multiple manual steps.

The new **lobby-first** flow leverages core's auto-group creation: creating a context without a `groupId` automatically creates a group. This makes groups invisible to the user — they just create/join lobbies, and groups exist only as infrastructure.

## Requirements

1. User creates a Lobby context (no groupId) -> core auto-creates a group
2. App discovers the groupId via `getContextGroup(lobbyContextId)`
3. To invite a player: `inviteToContext` on the lobby -> when they `joinContext`, core auto-adds them to the group
4. To create a Match: `createContext` with the discovered groupId -> match lives in same group
5. No "group" concept visible in the UI
6. No contract (logic/) changes needed

## Architecture

### New Hook: `useBattleshipsLobby`

Replaces both `useBattleshipsGroup` and `useLobbyContext`. Single hook that owns the entire lobby lifecycle.

**Depends on mero-react hooks:**
- `useContexts(applicationId)` — fetch all user's contexts for the app
- `useCreateContext()` — create lobby context (triggers auto-group)
- `useContextGroup(contextId)` — discover group from lobby context
- `useInviteToContext()` — create context-level invitation
- `useJoinContext()` — join lobby via invitation (auto-adds to group)
- `useGroupMembers(groupId)` — load group members (once group discovered)
- `useMero()` — mero instance, auth, applicationId

**State:**
- `lobbies: LobbyRecord[]` — user's lobby contexts. Discovered by intersecting `useContexts(applicationId)` results with a localStorage set of known lobby context IDs (`battleships:lobbyContextIds`). IDs are added when creating or joining a lobby.
- `selectedLobby: LobbyRecord | null` — active lobby (persisted in localStorage as `battleships:selectedLobbyCtxId`)
- `groupId: string | null` — discovered via `useContextGroup(selectedLobby.contextId)`
- `executorPublicKey: string | null` — resolved from context identity
- `members: GroupMember[]` — from `useGroupMembers(groupId)`
- `selfIdentity: string | null` — from group members response
- `lobbyJoined: boolean` — whether user has joined the selected lobby context

**Operations:**
- `createLobby(name?)` — `createContext({ applicationId, initializationParams: JSON.stringify({context_type:'Lobby'}), alias: name || 'lobby' })`. No groupId. Refetches contexts after.
- `invitePlayer(validForSeconds?)` — `inviteToContext({ contextId: lobbyCtxId, inviterId: executorPk, validForSeconds })`. Returns `SignedOpenInvitation | null`.
- `joinLobby(invitation, newMemberPublicKey)` — `joinContext({ invitation, newMemberPublicKey })`. Core auto-adds to group. Refetches contexts after.
- `selectLobby(contextId)` — pick a lobby from the list, persist to localStorage.
- `clearLobby()` — deselect.

**Interface:**
```typescript
interface LobbyRecord {
  contextId: string;     // hex context ID
  applicationId: string;
  alias?: string;
}

interface UseBattleshipsLobbyReturn {
  // Lobby list
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  lobbiesError: Error | null;
  selectedLobby: LobbyRecord | null;
  selectLobby: (contextId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  // Create lobby
  createLobby: (name?: string) => Promise<string | null>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

  // Group (discovered from lobby context)
  groupId: string | null;
  groupLoading: boolean;

  // Members (from discovered group)
  members: GroupMember[];
  selfIdentity: string | null;
  membersLoading: boolean;

  // Lobby join state
  lobbyJoined: boolean;
  executorPublicKey: string | null;

  // Invitations (context-level)
  invitePlayer: (validForSeconds?: number) => Promise<SignedOpenInvitation | null>;
  inviteLoading: boolean;

  // Join via invitation
  joinLobby: (invitation: SignedOpenInvitation, newMemberPublicKey: string) => Promise<JoinContextResponseData | null>;
  joinLoading: boolean;
}
```

### Match Creation Change

In `match/index.tsx`, the `createMatch` callback adds the discovered `groupId`:

```typescript
// Before (standalone match context):
const { contextId } = await mero.admin.createContext({
  applicationId: currentContext.applicationId,
  initializationParams: initBytes,
});

// After (match context in lobby's group):
const { contextId } = await mero.admin.createContext({
  applicationId: currentContext.applicationId,
  initializationParams: initBytes,
  groupId: lobby.groupId,  // match lives in same group
});
```

### Invitation Flow Change

**Creating invitation (host):**
```
Old: createGroupInvitation(groupId) -> group invitation JSON
New: inviteToContext({ contextId: lobbyCtxId, inviterId, validForSeconds: 86400 }) -> context invitation JSON
```

**Accepting invitation (joiner):**
```
Old: parse JSON -> extract group_id -> syncGroup(hex) -> sleep(2000) -> joinGroup(parsed) -> refetchGroups -> select group -> join lobby context
New: parse JSON -> joinContext({ invitation: parsed, newMemberPublicKey }) -> refetchLobbies -> select lobby
```

The joiner flow drops from 6 steps to 3. No syncGroup, no joinGroup, no sleep.

### View Changes

The three-view state machine stays but the first view changes:

| View | Before | After |
|------|--------|-------|
| First | `group-select` — list groups, create group, join group | `lobby-select` — list lobbies, create lobby, join lobby |
| Second | `lobby` — members, matches, create match | `lobby` — same (unchanged) |
| Third | `game` — ship placement, shooting | `game` — same (unchanged) |

UI text changes:
- "Your Groups" -> "Your Lobbies"
- "Create Group" -> "Create Lobby"
- "Join Group via Invitation" -> "Join Lobby via Invitation"
- "Create Invitation" -> "Invite Player"
- Group alias display -> Lobby alias display

### Lobby Discovery

The `useContexts(applicationId)` hook returns `ApplicationContextRecord[]` which has `{ contextId, applicationId }` but no alias. To identify which contexts are lobbies, the hook maintains a localStorage set `battleships:lobbyContextIds` (JSON array of hex context IDs). IDs are added when:
- `createLobby()` succeeds — the new context ID is added
- `joinLobby()` succeeds — the joined context ID is added

On mount, the hook intersects `useContexts` results with the stored set to build the lobby list. This replaces the current approach of fetching groups -> selecting group -> fetching group contexts -> finding lobby context by alias.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useBattleshipsLobby.ts` | **Create** | New lobby-first hook replacing useBattleshipsGroup + useLobbyContext |
| `src/hooks/useBattleshipsGroup.ts` | **Delete** | Replaced by useBattleshipsLobby |
| `src/hooks/useLobbyContext.ts` | **Delete** | Logic folded into useBattleshipsLobby |
| `src/pages/match/index.tsx` | **Modify** | Replace hook usage, update createMatch (add groupId), update invitation UI, rename group-select to lobby-select |

## No Changes

- `battleships/logic/` (Rust contract) — no changes
- `src/api/AbiClient.ts` — unchanged
- `src/features/kv/api/` — unchanged
- `src/hooks/useGameSubscriptions.ts` — unchanged
- `src/pages/home/`, `src/pages/login/`, `src/pages/play/` — unchanged
- `src/App.tsx` — routing unchanged
- Game view (boards, ships, shooting) — unchanged

## Edge Cases

1. **Lobby creation fails after context auto-creates group:** The lobby context is the source of truth. If creation fails, the user retries. The orphaned group (if any) is harmless.
2. **getContextGroup returns null:** This shouldn't happen for a lobby context that was auto-grouped, but if it does, show an error and let the user retry.
3. **joinContext fails:** Show error. The user can retry. If it fails because they're already a member, treat as success (check error message for "already").
4. **Multiple lobbies per user:** Supported. User selects which lobby to enter from the list.
5. **hexToBase58 conversion:** The existing utility in useLobbyContext.ts is moved into useBattleshipsLobby.ts or a shared util.
