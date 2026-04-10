import React from 'react';
import { Button, Input, CopyToClipboard } from '@calimero-network/mero-ui';
import type { MatchSummary } from '../api/lobby/LobbyClient';

interface GroupMember {
  identity: string;
  role: string;
}

interface LobbyViewProps {
  lobbyAlias?: string | null;
  isAdmin: boolean;
  members: GroupMember[];
  selfIdentity: string | null;
  executorPublicKey: string | null;

  // Invitation
  inviteLoading: boolean;
  invitationJson: string | null;
  onCreateInvitation: () => void;
  onDismissInvitation: () => void;

  // Match creation
  player2: string;
  creatingMatch: boolean;
  onPlayer2Change: (v: string) => void;
  onCreateMatch: () => void;

  // Match list
  matches: MatchSummary[];
  onOpenGame: (matchId: string, contextId: string) => void;
}

export default function LobbyView({
  lobbyAlias, isAdmin, members, selfIdentity, executorPublicKey,
  inviteLoading, invitationJson, onCreateInvitation, onDismissInvitation,
  player2, creatingMatch, onPlayer2Change, onCreateMatch,
  matches, onOpenGame,
}: LobbyViewProps) {
  return (
    <>
      {/* Lobby info */}
      <div className="naval-card fade-in">
        <div className="naval-card-header">
          <div className="naval-card-title">
            {lobbyAlias || 'Lobby'}
            {isAdmin && <span className="badge badge-admin">Admin</span>}
          </div>
        </div>
        <div className="naval-card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="mono-sm">
              {members.length} member{members.length !== 1 ? 's' : ''} online
            </span>

            {members.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                  Members
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
                  {members.map((m) => (
                    <div key={m.identity} className="member-row">
                      <span className="mono-sm" style={{ fontSize: '0.75rem' }}>
                        {m.identity.slice(0, 12)}...{m.identity.slice(-8)}
                      </span>
                      <CopyToClipboard text={m.identity} variant="icon" size="small" successMessage="Copied!" />
                      <span className={`member-role ${m.role === 'Admin' ? 'role-admin' : 'role-member'}`}>
                        {m.role}
                      </span>
                      {m.identity === selfIdentity && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--sonar-green)' }}>(you)</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {executorPublicKey && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div className="info-pair">
                  <span className="info-label">Your Key</span>
                  <span className="mono-sm" style={{ fontSize: '0.72rem' }}>
                    {executorPublicKey.slice(0, 12)}...{executorPublicKey.slice(-8)}
                  </span>
                  <CopyToClipboard text={executorPublicKey} variant="icon" size="small" successMessage="Key copied!" />
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Share this key with opponents for match creation
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={onCreateInvitation} disabled={inviteLoading}>
                {inviteLoading ? 'Creating...' : 'Invite Player'}
              </Button>
            </div>

            {invitationJson && (
              <div>
                <pre className="invite-code">{invitationJson}</pre>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <CopyToClipboard text={invitationJson} variant="button" size="small" successMessage="Copied!" />
                  <Button variant="secondary" onClick={onDismissInvitation}>Dismiss</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create match */}
      <div className="naval-card fade-in fade-in-delay-1">
        <div className="naval-card-header">
          <div className="naval-card-title">New Match</div>
        </div>
        <div className="naval-card-body">
          <form
            onSubmit={(e) => { e.preventDefault(); onCreateMatch(); }}
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
          >
            <Input
              type="text"
              placeholder="Opponent's executor public key"
              value={player2}
              onChange={(e) => onPlayer2Change(e.target.value)}
            />
            <button type="submit" className="btn-deploy" disabled={creatingMatch}>
              {creatingMatch ? 'Creating...' : 'Challenge'}
            </button>
          </form>
        </div>
      </div>

      {/* Match list */}
      <div className="naval-card fade-in fade-in-delay-2">
        <div className="naval-card-header">
          <div className="naval-card-title">Matches</div>
        </div>
        <div className="naval-card-body">
          {matches.length === 0 ? (
            <span className="mono-sm">No matches yet. Challenge an opponent above.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {matches.map((m) => {
                const canOpen = m.status === 'Active' && !!m.context_id;
                return (
                  <div key={m.match_id} className="match-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className="match-id">{m.match_id}</span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className={`status-pill ${
                          m.status === 'Active' ? 'status-active' :
                          m.status === 'Finished' ? 'status-finished' :
                          'status-pending'
                        }`}>
                          {m.status}
                        </span>
                        {m.winner && (
                          <span className="mono-sm" style={{ fontSize: '0.7rem' }}>
                            Winner: {m.winner.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      disabled={!canOpen}
                      onClick={() => canOpen && onOpenGame(m.match_id, m.context_id!)}
                    >
                      {canOpen ? 'Open' : m.status === 'Pending' ? 'Pending' : 'Ended'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
