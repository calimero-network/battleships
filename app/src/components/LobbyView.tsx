import React, { useMemo, useState } from 'react';
import { Button, Input, CopyToClipboard } from '@calimero-network/mero-ui';
import type { MatchSummary, MatchRecord, PlayerStatsView } from '../api/lobby/LobbyClient';

interface GroupMember {
  identity: string;
  role: string;
}

type HistoryFilter = 'all' | 'mine';

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

  // Player record + match history (lobby-wide, sourced from getPlayerStats /
  // getHistory on the lobby context — see useBattleshipsLobby + match page).
  playerStats: PlayerStatsView | null;
  history: MatchRecord[];
  currentUser: string | null;
}

const formatKey = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;
const formatTs = (ms: number) => new Date(ms).toLocaleString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function LobbyView({
  lobbyAlias, isAdmin, members, selfIdentity, executorPublicKey,
  inviteLoading, invitationJson, onCreateInvitation, onDismissInvitation,
  player2, creatingMatch, onPlayer2Change, onCreateMatch,
  matches, onOpenGame,
  playerStats, history, currentUser,
}: LobbyViewProps) {
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  // Newest first, then optionally restricted to matches involving the
  // current user. Memoized so a re-render from sibling state changes
  // (e.g. invite toast) doesn't re-sort the array.
  const filteredHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => b.finished_ms - a.finished_ms);
    if (historyFilter === 'mine' && currentUser) {
      return sorted.filter((r) => r.winner === currentUser || r.loser === currentUser);
    }
    return sorted;
  }, [history, historyFilter, currentUser]);

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

      {/* Your Record */}
      <div className="naval-card fade-in fade-in-delay-2">
        <div className="naval-card-header">
          <div className="naval-card-title">Your Record</div>
        </div>
        <div className="naval-card-body">
          {playerStats ? (
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div className="info-pair">
                <span className="info-label">Wins</span>
                <span className="info-value">{playerStats.wins}</span>
              </div>
              <div className="info-pair">
                <span className="info-label">Losses</span>
                <span className="info-value">{playerStats.losses}</span>
              </div>
              <div className="info-pair">
                <span className="info-label">Games</span>
                <span className="info-value">{playerStats.games_played}</span>
              </div>
            </div>
          ) : (
            <span className="mono-sm">No matches finished yet.</span>
          )}
        </div>
      </div>

      {/* Match history — lobby-wide, with All / Mine filter */}
      <div className="naval-card fade-in fade-in-delay-2">
        <div className="naval-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="naval-card-title">Match History</div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              type="button"
              className={`status-pill ${historyFilter === 'all' ? 'status-active' : 'status-pending'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setHistoryFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`status-pill ${historyFilter === 'mine' ? 'status-active' : 'status-pending'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setHistoryFilter('mine')}
              disabled={!currentUser}
              title={!currentUser ? 'Connect to filter by your matches' : undefined}
            >
              Mine
            </button>
          </div>
        </div>
        <div className="naval-card-body">
          {filteredHistory.length === 0 ? (
            <span className="mono-sm">
              {historyFilter === 'mine'
                ? "You haven't completed any matches in this lobby yet."
                : 'No completed matches in this lobby yet.'}
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {filteredHistory.map((r) => {
                const youWon = currentUser && r.winner === currentUser;
                const youLost = currentUser && r.loser === currentUser;
                const involvedYou = youWon || youLost;
                return (
                  <div key={r.match_id} className="match-item">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className="match-id">{r.match_id}</span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="status-pill status-finished">
                          {youWon ? 'You won' : youLost ? 'You lost' : 'Finished'}
                        </span>
                        <span className="mono-sm" style={{ fontSize: '0.7rem' }}>
                          {formatKey(r.winner)} beat {formatKey(r.loser)}
                        </span>
                        <span className="mono-sm" style={{ fontSize: '0.7rem', opacity: 0.75 }}>
                          {formatTs(r.finished_ms)}
                        </span>
                      </div>
                    </div>
                    {involvedYou && (
                      <span className="mono-sm" style={{ fontSize: '0.65rem', color: 'var(--sonar-green)' }}>
                        (you)
                      </span>
                    )}
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
