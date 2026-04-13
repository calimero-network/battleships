import React from 'react';
import { Button, Input, CopyToClipboard } from '@calimero-network/mero-ui';

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
  lobbyJoined: boolean;
  groupLoading: boolean;
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

export default function LobbySelect({
  lobbies, lobbiesLoading, selectedNamespaceId,
  lobbyContextId, namespaceId, lobbyJoined, groupLoading, joinLoading,
  createLobbyLoading, newLobbyName, joinInvitationInput,
  onNewLobbyNameChange, onJoinInputChange,
  onSelectLobby, onCreateLobby, onJoinLobby, onEnter,
}: LobbySelectProps) {
  return (
    <>
      {/* Namespace list */}
      <div className="naval-card fade-in">
        <div className="naval-card-header">
          <div className="naval-card-title">Your Namespaces</div>
        </div>
        <div className="naval-card-body">
          {lobbiesLoading ? (
            <span className="mono-sm">Loading namespaces...</span>
          ) : lobbies.length === 0 ? (
            <span className="mono-sm">No namespaces yet. Create one or join with an invitation.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lobbies.map((l) => {
                const selected = selectedNamespaceId === l.namespaceId;
                return (
                  <div
                    key={l.namespaceId}
                    className={`ns-item ${selected ? 'ns-item-selected' : ''}`}
                    onClick={() => onSelectLobby(l.namespaceId)}
                  >
                    <div>
                      <div className="mono" style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {l.alias || l.namespaceId.slice(0, 16) + '...'}
                      </div>
                      <div className="mono-sm" style={{ fontSize: '0.7rem', marginTop: '0.15rem' }}>
                        {l.namespaceId.slice(0, 8)}...{l.namespaceId.slice(-8)}
                      </div>
                    </div>
                    <Button
                      variant={selected ? 'primary' : 'secondary'}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onSelectLobby(l.namespaceId);
                      }}
                    >
                      {selected ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create */}
      <div className="naval-card fade-in fade-in-delay-1">
        <div className="naval-card-header">
          <div className="naval-card-title">Create Namespace</div>
        </div>
        <div className="naval-card-body">
          <form
            onSubmit={(e) => { e.preventDefault(); onCreateLobby(); }}
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
          >
            <Input
              type="text"
              placeholder="Namespace name (optional)"
              value={newLobbyName}
              onChange={(e) => onNewLobbyNameChange(e.target.value)}
            />
            <button type="submit" className="btn-deploy" disabled={createLobbyLoading}>
              {createLobbyLoading ? 'Creating...' : 'Create'}
            </button>
          </form>
        </div>
      </div>

      {/* Join */}
      <div className="naval-card fade-in fade-in-delay-2">
        <div className="naval-card-header">
          <div className="naval-card-title">Join via Invitation</div>
        </div>
        <div className="naval-card-body">
          <form
            onSubmit={(e) => { e.preventDefault(); onJoinLobby(); }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <Input
              type="text"
              placeholder="Paste invitation JSON"
              value={joinInvitationInput}
              onChange={(e) => onJoinInputChange(e.target.value)}
            />
            <Button type="submit" variant="primary">Join</Button>
          </form>
        </div>
      </div>

      {/* Enter selected namespace */}
      {selectedNamespaceId && (
        <div className="naval-card fade-in fade-in-delay-3">
          <div className="naval-card-header">
            <div className="naval-card-title">Enter Namespace</div>
          </div>
          <div className="naval-card-body">
            {groupLoading ? (
              <span className="mono-sm">Resolving context...</span>
            ) : lobbyContextId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {namespaceId && (
                  <div className="info-pair">
                    <span className="info-label">NS</span>
                    <span className="info-value">
                      {namespaceId.slice(0, 8)}...{namespaceId.slice(-8)}
                    </span>
                    <CopyToClipboard text={namespaceId} variant="icon" size="small" successMessage="Copied!" />
                  </div>
                )}
                <div className="info-pair">
                  <span className="info-label">CTX</span>
                  <span className="info-value">
                    {lobbyContextId.slice(0, 8)}...{lobbyContextId.slice(-8)}
                  </span>
                  <CopyToClipboard text={lobbyContextId} variant="icon" size="small" successMessage="Copied!" />
                </div>
                {lobbyJoined ? (
                  <button className="btn-deploy" onClick={onEnter}>Enter</button>
                ) : (
                  <Button variant="primary" onClick={onEnter} disabled={joinLoading}>
                    {joinLoading ? 'Joining...' : 'Join & Enter'}
                  </Button>
                )}
              </div>
            ) : (
              <span className="mono-sm">Resolving namespace context...</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
