import React, { useEffect, useState } from 'react';
import { Button, Input } from '@calimero-network/mero-ui';

interface LobbyRecord {
  namespaceId: string;
  lobbyContextId: string | null;
  applicationId: string;
  alias?: string | null;
}

interface LobbySelectProps {
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  selectedNamespaceId: string | null;
  lobbyContextId: string | null;
  namespaceId: string | null;
  joinLoading: boolean;
  createLobbyLoading: boolean;
  newLobbyName: string;
  joinInvitationInput: string;
  onNewLobbyNameChange: (v: string) => void;
  onJoinInputChange: (v: string) => void;
  onSelectLobby: (nsId: string) => void;
  onCreateLobby: () => void;
  onJoinLobby: () => void;
  onEnter: () => void;
}

// Stop "Securing channel…" from sticking forever if upstream context
// resolution silently fails (no contexts under the namespace, peer
// unreachable, etc.). After this window we drop the pending state so
// the user can try again instead of needing a page refresh.
const PENDING_ENTER_TIMEOUT_MS = 20_000;

type AddTab = 'create' | 'join';
type ViewMode = 'list' | 'cards';

const LOBBY_INFO_TOOLTIP =
  'Each lobby is a Calimero namespace — a private group bound to one application. ' +
  'Members in the same lobby can challenge each other to matches.';

export default function LobbySelect({
  lobbies, lobbiesLoading, selectedNamespaceId,
  lobbyContextId, namespaceId,
  joinLoading, createLobbyLoading,
  newLobbyName, joinInvitationInput,
  onNewLobbyNameChange, onJoinInputChange,
  onSelectLobby, onCreateLobby, onJoinLobby, onEnter,
}: LobbySelectProps) {
  const [addTab, setAddTab] = useState<AddTab>('create');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // One-click Enter coordination: when a row's Enter button fires, we
  // record which namespace the user wants to enter, call onSelectLobby
  // (which kicks off context resolution upstream), and then watch for
  // the resolved context to land before firing onEnter automatically.
  // No parent API change required.
  const [pendingEnterNs, setPendingEnterNs] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Auto-fire onEnter once the upstream selection has resolved into
  // a usable namespaceId + lobbyContextId for the row the user clicked.
  useEffect(() => {
    if (!pendingEnterNs) return;
    if (selectedNamespaceId !== pendingEnterNs) return;
    if (!namespaceId || !lobbyContextId) return;
    if (namespaceId !== pendingEnterNs) return;
    setPendingEnterNs(null);
    setPendingError(null);
    onEnter();
  }, [pendingEnterNs, selectedNamespaceId, namespaceId, lobbyContextId, onEnter]);

  // Timeout fallback: drop the pending state and surface an error
  // banner if upstream resolution doesn't complete in time, so the
  // user can retry instead of being locked out by a frozen "Securing
  // channel…" row + globally-disabled Enter buttons.
  useEffect(() => {
    if (!pendingEnterNs) return;
    const timer = setTimeout(() => {
      setPendingEnterNs((current) => {
        if (current !== pendingEnterNs) return current;
        setPendingError("Couldn't open that lobby — its context didn't come online in time. Try again or pick another.");
        return null;
      });
    }, PENDING_ENTER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingEnterNs]);

  const handleEnterRow = (nsId: string) => {
    if (pendingEnterNs) return;
    setPendingError(null);
    setPendingEnterNs(nsId);
    onSelectLobby(nsId);
  };

  const isPending = (nsId: string) => pendingEnterNs === nsId;

  return (
    <>
      {/* ============================================================
          Add a Lobby — tabbed deployment panel
          ============================================================ */}
      <div className="naval-card fade-in">
        <div className="naval-card-header">
          <div className="naval-card-title">
            Add a Lobby
            <button
              type="button"
              className="info-icon"
              data-tooltip={LOBBY_INFO_TOOLTIP}
              aria-label="What is a lobby?"
              title="What is a lobby?"
            >
              i
            </button>
          </div>
          <div className="naval-card-subtitle">Deployment terminal · standby</div>
        </div>
        <div className="naval-card-body">
          <div className="tab-rail" role="tablist" aria-label="Lobby creation method">
            <button
              type="button"
              role="tab"
              aria-selected={addTab === 'create'}
              className={`tab-btn ${addTab === 'create' ? 'tab-btn-active' : ''}`}
              onClick={() => setAddTab('create')}
            >
              <span className="tab-glyph" aria-hidden>＋</span>
              Create new
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addTab === 'join'}
              className={`tab-btn ${addTab === 'join' ? 'tab-btn-active' : ''}`}
              onClick={() => setAddTab('join')}
            >
              <span className="tab-glyph" aria-hidden>↧</span>
              Join via invitation
            </button>
          </div>

          {addTab === 'create' ? (
            <div className="tab-content" key="create" role="tabpanel">
              <form
                onSubmit={(e) => { e.preventDefault(); onCreateLobby(); }}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}
              >
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <Input
                      type="text"
                      placeholder="Lobby name (optional)"
                      value={newLobbyName}
                      onChange={(e) => onNewLobbyNameChange(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-deploy"
                    disabled={createLobbyLoading}
                  >
                    {createLobbyLoading ? 'Creating…' : 'Create'}
                  </button>
                </div>
                <span className="console-hint">
                  Names are local labels — the lobby ID is what travels with invitations.
                </span>
              </form>
            </div>
          ) : (
            <div className="tab-content" key="join" role="tabpanel">
              <form
                onSubmit={(e) => { e.preventDefault(); onJoinLobby(); }}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}
              >
                <Input
                  type="text"
                  placeholder="Paste invitation JSON"
                  value={joinInvitationInput}
                  onChange={(e) => onJoinInputChange(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <span className="console-hint">
                    Ask a lobby owner to share an invitation, then paste the full JSON above.
                  </span>
                  <Button type="submit" variant="primary" disabled={joinLoading}>
                    {joinLoading ? 'Joining…' : 'Join'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          Your Lobbies — fleet roster with view toggle + enter
          ============================================================ */}
      <div className="naval-card fade-in fade-in-delay-1">
        <div
          className="naval-card-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}
        >
          <div>
            <div className="naval-card-title">
              Your Lobbies
              <button
                type="button"
                className="info-icon"
                data-tooltip={LOBBY_INFO_TOOLTIP}
                aria-label="What is a lobby?"
                title="What is a lobby?"
              >
                i
              </button>
            </div>
            <div className="naval-card-subtitle">
              {lobbies.length === 0
                ? 'No fleets in port'
                : `${lobbies.length} ${lobbies.length === 1 ? 'fleet' : 'fleets'} ready to deploy`}
            </div>
          </div>

          {lobbies.length > 0 && (
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                aria-pressed={viewMode === 'list'}
                className={`view-toggle-btn ${viewMode === 'list' ? 'view-toggle-btn-active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <span className="view-toggle-icon view-toggle-icon-list" aria-hidden>
                  <span /><span /><span />
                </span>
                List
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'cards'}
                className={`view-toggle-btn ${viewMode === 'cards' ? 'view-toggle-btn-active' : ''}`}
                onClick={() => setViewMode('cards')}
              >
                <span className="view-toggle-icon view-toggle-icon-cards" aria-hidden>
                  <span /><span /><span /><span />
                </span>
                Cards
              </button>
            </div>
          )}
        </div>

        <div className="naval-card-body">
          {pendingError && (
            <div className="lobby-banner-error" role="alert">
              <span className="lobby-banner-error-glyph" aria-hidden>!</span>
              <span>{pendingError}</span>
              <button
                type="button"
                className="lobby-banner-dismiss"
                onClick={() => setPendingError(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {lobbiesLoading ? (
            <div className="lobby-empty">
              <div className="lobby-empty-radar"><span className="lobby-empty-radar-dot" /></div>
              <span className="mono-sm">Scanning for lobbies…</span>
            </div>
          ) : lobbies.length === 0 ? (
            <div className="lobby-empty">
              <div className="lobby-empty-radar" aria-hidden>
                <span className="lobby-empty-radar-dot" />
              </div>
              <div className="lobby-empty-headline">No fleets in port</div>
              <div className="lobby-empty-sub">
                Create a lobby above to set up a private game group, or paste an
                invitation JSON to join one a friend already runs.
              </div>
              <div className="lobby-empty-arrow">↑ Add a lobby above</div>
            </div>
          ) : viewMode === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lobbies.map((l) => {
                const pending = isPending(l.namespaceId);
                const idShort = `${l.namespaceId.slice(0, 8)}…${l.namespaceId.slice(-8)}`;
                const display = l.alias || l.namespaceId.slice(0, 16) + '…';
                return (
                  <div
                    key={l.namespaceId}
                    className={`lobby-row ${pending ? 'lobby-row-pending' : ''}`}
                  >
                    <div className="lobby-row-info">
                      <div className="lobby-row-alias">
                        <span className="lobby-row-alias-dot" aria-hidden />
                        {display}
                      </div>
                      <div className="lobby-row-id">{idShort}</div>
                    </div>
                    {pending ? (
                      <span className="lobby-row-status">
                        <span className="lobby-row-status-spinner" aria-hidden />
                        Securing channel…
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="lobby-row-cta"
                        disabled={!!pendingEnterNs}
                        onClick={() => handleEnterRow(l.namespaceId)}
                      >
                        Enter
                        <span className="lobby-row-cta-arrow" aria-hidden>→</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="lobby-grid">
              {lobbies.map((l, idx) => {
                const pending = isPending(l.namespaceId);
                const idShort = `${l.namespaceId.slice(0, 6)}…${l.namespaceId.slice(-6)}`;
                const display = l.alias || l.namespaceId.slice(0, 12) + '…';
                const coord = `${String.fromCharCode(65 + (idx % 26))}-${String(idx + 1).padStart(2, '0')}`;
                return (
                  <button
                    key={l.namespaceId}
                    type="button"
                    className={`lobby-card-tile ${pending ? 'lobby-card-pending' : ''}`}
                    disabled={!!pendingEnterNs && !pending}
                    onClick={() => handleEnterRow(l.namespaceId)}
                  >
                    <div className="lobby-card-coord">SEC · {coord}</div>
                    <div className="lobby-card-alias">{display}</div>
                    <div className="lobby-card-id">{idShort}</div>
                    <span className="lobby-card-enter" aria-hidden>
                      {pending ? (
                        <>
                          <span className="lobby-row-status-spinner" />
                          Securing
                        </>
                      ) : (
                        <>Enter →</>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
