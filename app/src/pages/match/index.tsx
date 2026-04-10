import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  CopyToClipboard,
  useToast,
} from '@calimero-network/mero-ui';
import {
  useMero,
} from '@calimero-network/mero-react';
import { createLobbyClient, createGameClient, LobbyClient, GameClient } from '../../features/kv/api';
import type { ContextRole } from '../../features/kv/api';
import type { MatchSummary } from '../../api/lobby/LobbyClient';
import type { AllGameEvents } from '../../types/events';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';
import { useBattleshipsLobby } from '../../hooks/useBattleshipsLobby';
import { resolveEffectiveMatchId, SHIP_TARGETS, validateFleetPayload } from './config';

import NavBar from '../../components/NavBar';
import LobbySelect from '../../components/LobbySelect';
import LobbyView from '../../components/LobbyView';
import GameBoard from '../../components/GameBoard';
import ShotGrid from '../../components/ShotGrid';
import PlacementGrid from '../../components/PlacementGrid';
import ShipSelector from '../../components/ShipSelector';

export default function MatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAuthenticated,
    logout,
    mero,
    nodeUrl,
    contextIdentity,
  } = useMero();
  const defaultNodeUrl =
    import.meta.env.VITE_NODE_URL?.trim() || 'http://node1.127.0.0.1.nip.io';
  const { show } = useToast();

  const lobby = useBattleshipsLobby();

  // View state
  const [view, setView] = useState<'lobby-select' | 'lobby' | 'game'>('lobby-select');

  // Lobby creation form
  const [newLobbyName, setNewLobbyName] = useState('');
  const [invitationJson, setInvitationJson] = useState<string | null>(null);
  const [joinInvitationInput, setJoinInvitationInput] = useState('');

  // Lobby API and context
  const [lobbyApi, setLobbyApi] = useState<LobbyClient | null>(null);
  const [currentContext, setCurrentContext] = useState<{
    applicationId: string;
    contextId: string;
    nodeUrl: string;
  } | null>(null);

  // Match API client
  const [matchApi, setMatchApi] = useState<GameClient | null>(null);
  const [matchContextId, setMatchContextId] = useState<string | null>(null);

  // Match management
  const [matchId, setMatchId] = useState<string>('');
  const [runtimeMatchId, setRuntimeMatchId] = useState<string | null>(null);
  const [player2, setPlayer2] = useState<string>('');
  const [myMatches, setMyMatches] = useState<MatchSummary[]>([]);
  const [creatingMatch, setCreatingMatch] = useState(false);

  // Game state
  const [size, setSize] = useState<number>(10);
  const [ownBoard, setOwnBoard] = useState<number[]>([]);
  const [shotsBoard, setShotsBoard] = useState<number[]>([]);
  const [placed, setPlaced] = useState<boolean>(false);
  const [currentTurn, setCurrentTurn] = useState<string | null>(null);
  const [isMyTurn, setIsMyTurn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [pendingShot, setPendingShot] = useState<{ x: number; y: number } | null>(null);

  // Ship placement
  const [grid, setGrid] = useState<boolean[][]>(() =>
    Array.from({ length: 10 }, () => Array(10).fill(false)),
  );
  const [selectedShip, setSelectedShip] = useState<number | null>(null);
  const [shipCounts, setShipCounts] = useState<number[]>([0, 0, 0, 0]);
  const [shipTargets] = useState<number[]>([...SHIP_TARGETS]);
  const [isHorizontal, setIsHorizontal] = useState<boolean>(true);
  const [isRemovalMode, setIsRemovalMode] = useState<boolean>(false);

  // Shooting
  const [selectedShotX, setSelectedShotX] = useState<number | null>(null);
  const [selectedShotY, setSelectedShotY] = useState<number | null>(null);

  const loadingRef = useRef<boolean>(false);
  const effectiveMatchId = resolveEffectiveMatchId(matchId, runtimeMatchId);
  const [matchApiReady, setMatchApiReady] = useState(false);

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

  const isUninitializedError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return message.includes('Uninitialized');
  };

  const ensureMatchContextReady = useCallback(
    async (client: GameClient, attempts = 10, delayMs = 400): Promise<void> => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          await client.getActiveMatchId();
          return;
        } catch (error) {
          if (!isUninitializedError(error)) throw error;
          if (attempt === attempts - 1) throw error;
          await sleep(delayMs);
        }
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Navigation & auth
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (view === 'lobby-select' && lobby.selectedLobby && lobby.lobbyJoined && lobby.lobbyContextId) {
      setView('lobby');
    }
  }, [view, lobby.selectedLobby, lobby.lobbyJoined, lobby.lobbyContextId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlMatchId = params.get('match_id');
    const urlContextId = params.get('context_id');
    if (urlMatchId && urlContextId && location.pathname === '/match') {
      setMatchId(urlMatchId);
      setRuntimeMatchId(null);
      setMatchContextId(urlContextId);
      setView('game');
    }
  }, [location.pathname, location.search]);

  // ---------------------------------------------------------------------------
  // Board & turn loading
  // ---------------------------------------------------------------------------

  const loadBoards = useCallback(async () => {
    if (!matchApi || !effectiveMatchId) return;
    try {
      const own = await matchApi.getOwnBoard({ match_id: effectiveMatchId });
      const shots = await matchApi.getShots({ match_id: effectiveMatchId });
      setSize(own.size);
      const ownArr = own.board.toArray();
      const shotsArr = shots.shots.toArray();
      setOwnBoard(ownArr);
      setShotsBoard(shotsArr);
      const anyShip = ownArr.some((v) => v === 1 || v === 2 || v === 3);
      setPlaced(anyShip);
    } catch {
      // board not yet available
    }
  }, [matchApi, effectiveMatchId]);

  const loadTurnInfo = useCallback(async () => {
    if (!matchApi || !effectiveMatchId) return;
    try {
      const turn = await matchApi.getCurrentTurn();
      setCurrentTurn(turn);
    } catch {
      // turn info not yet available
    }
  }, [matchApi, effectiveMatchId]);

  useEffect(() => {
    if (currentUser && currentTurn) {
      setIsMyTurn(currentUser === currentTurn);
    }
  }, [currentTurn, currentUser]);

  const handleBoardUpdate = useCallback(() => { loadBoards(); loadTurnInfo(); }, [loadBoards, loadTurnInfo]);
  const handleTurnUpdate = useCallback(() => { loadTurnInfo(); }, [loadTurnInfo]);

  const refreshMatchList = useCallback(async () => {
    if (!lobbyApi) return;
    try {
      const summaries = await lobbyApi.getMatches();
      setMyMatches(summaries);
    } catch { /* non-critical */ }
  }, [lobbyApi]);

  const handleGameEvent = useCallback(
    (event: AllGameEvents) => {
      if (event.type === 'ShotProposed' && !isMyTurn && typeof event.x === 'number' && typeof event.y === 'number') {
        setPendingShot({ x: event.x, y: event.y });
      }
      if (event.type === 'ShotFired' || event.type === 'MatchEnded' || event.type === 'Winner') {
        setPendingShot(null);
      }
      if (event.type === 'MatchListUpdated' || event.type === 'MatchCreated' || event.type === 'MatchEnded' || event.type === 'Winner') {
        refreshMatchList();
      }
    },
    [isMyTurn, refreshMatchList],
  );

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  const subscriptionContextId = view === 'game' && matchContextId
    ? matchContextId
    : (currentContext?.contextId || '');

  const lobbySubscriptionContextId =
    view === 'game' ? (currentContext?.contextId ?? undefined) : undefined;

  const { isSubscribed: isEventSubscribed } = useGameSubscriptions({
    contextId: subscriptionContextId,
    lobbyContextId: lobbySubscriptionContextId,
    matchId: effectiveMatchId,
    onBoardUpdate: handleBoardUpdate,
    onTurnUpdate: handleTurnUpdate,
    onGameEvent: handleGameEvent,
  });

  // ---------------------------------------------------------------------------
  // Lobby API init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!mero || !lobby.lobbyContextId) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Resolve executor identity: prefer lobby hook's key, then try context API, then auth fallback
        let executorKey = lobby.executorPublicKey;
        if (!executorKey) {
          try {
            const { identities } = await mero.admin.getContextIdentitiesOwned(lobby.lobbyContextId);
            if (identities.length > 0) executorKey = identities[0];
          } catch {
            // context identity lookup failed
          }
        }
        if (!executorKey) executorKey = contextIdentity;
        if (!executorKey || cancelled) return;

        const { client, context } = await createLobbyClient(mero, {
          contextId: lobby.lobbyContextId,
          contextIdentity: executorKey,
          role: 'lobby' as ContextRole,
        });
        if (cancelled) return;
        setLobbyApi(client);
        setCurrentContext({
          applicationId: context.applicationId,
          contextId: context.contextId,
          nodeUrl: nodeUrl || defaultNodeUrl,
        });
        try { const summaries = await client.getMatches(); if (!cancelled) setMyMatches(summaries); } catch { /* noop */ }
        if (!cancelled) setCurrentUser(executorKey);
      } catch (e) {
        console.error('Lobby API init failed:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [contextIdentity, defaultNodeUrl, lobby.lobbyContextId, lobby.executorPublicKey, mero, nodeUrl]);

  // ---------------------------------------------------------------------------
  // Match API init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!mero || !matchContextId || view !== 'game') {
      setMatchApi(null);
      setMatchApiReady(false);
      return;
    }
    const executorKey = lobby.executorPublicKey ?? contextIdentity;
    let cancelled = false;
    setMatchApiReady(false);

    (async () => {
      try {
        const { client } = await createGameClient(mero, {
          contextId: matchContextId,
          contextIdentity: executorKey,
          role: 'match' as ContextRole,
        });
        await ensureMatchContextReady(client);
        if (!cancelled) { setMatchApi(client); setMatchApiReady(true); }
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        const missingContextLocally = message.includes('The requested context is not available on this node.');
        if (missingContextLocally && lobby.groupId) {
          try {
            await mero.admin.joinContext(matchContextId);
            const { client } = await createGameClient(mero, {
              contextId: matchContextId,
              contextIdentity: executorKey,
              role: 'match' as ContextRole,
            });
            await ensureMatchContextReady(client);
            if (!cancelled) { setMatchApi(client); setMatchApiReady(true); }
            return;
          } catch (joinErr) {
            console.error('joinContext fallback failed:', joinErr);
          }
        } else {
          console.error(e);
        }
        if (!cancelled) { setMatchApi(null); setMatchApiReady(false); show({ title: 'Failed to initialize match API client', variant: 'error' }); }
      }
    })();

    return () => { cancelled = true; };
  }, [contextIdentity, lobby.executorPublicKey, lobby.groupId, matchContextId, mero, show, view, ensureMatchContextReady]);

  // Fetch runtime match ID
  useEffect(() => {
    if (!matchApi || view !== 'game') { setRuntimeMatchId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const activeId = await matchApi.getActiveMatchId();
        if (!cancelled) { setRuntimeMatchId(typeof activeId === 'string' && activeId.trim().length > 0 ? activeId : null); }
      } catch { if (!cancelled) setRuntimeMatchId(null); }
    })();
    return () => { cancelled = true; };
  }, [matchApi, view]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const createMatch = useCallback(async () => {
    if (!lobbyApi || !mero || !currentContext || !lobby.namespaceId) {
      console.warn('[createMatch] blocked:', { lobbyApi: !!lobbyApi, mero: !!mero, currentContext: !!currentContext, namespaceId: lobby.namespaceId });
      show({ title: 'Lobby not ready yet — please wait a moment', variant: 'warning' });
      return;
    }
    setCreatingMatch(true);
    try {
      const id = await lobbyApi.createMatch({ player2 });
      show({ title: `Match allocated: ${id}`, variant: 'success' });

      const { groupId: matchSubgroupId } = await mero.admin.createGroupInNamespace(lobby.namespaceId, { alias: `match-${id}` });
      await mero.admin.addGroupMembers(matchSubgroupId, { members: [{ identity: player2, role: 'Member' }] });

      const executorKey = lobby.executorPublicKey ?? contextIdentity;
      const initParams = JSON.stringify({ player1: executorKey, player2, lobby_context_id: currentContext.contextId });
      const initBytes = Array.from(new TextEncoder().encode(initParams));

      const { contextId: newContextId } = await mero.admin.createContext({
        applicationId: currentContext.applicationId,
        initializationParams: initBytes,
        groupId: matchSubgroupId,
        serviceName: 'game',
      });

      await lobbyApi.setMatchContextId({ match_id: id, context_id: newContextId });
      try { const summaries = await lobbyApi.getMatches(); setMyMatches(summaries); } catch { /* noop */ }

      setMatchId(id);
      setRuntimeMatchId(null);
      setMatchContextId(newContextId);
      setView('game');
      navigate(`/match?match_id=${encodeURIComponent(id)}&context_id=${encodeURIComponent(newContextId)}`, { replace: true });
      show({ title: 'Match created', variant: 'success' });
    } catch (e) {
      console.error('createMatch', e);
      show({ title: e instanceof Error ? e.message : 'Failed to create match', variant: 'error' });
    } finally {
      setCreatingMatch(false);
    }
  }, [lobbyApi, mero, currentContext, player2, lobby.executorPublicKey, lobby.namespaceId, contextIdentity, show, navigate]);

  const openGame = useCallback((id: string, contextId: string) => {
    setMatchId(id);
    setRuntimeMatchId(null);
    setMatchContextId(contextId);
    setView('game');
    navigate(`/match?match_id=${encodeURIComponent(id)}&context_id=${encodeURIComponent(contextId)}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (view === 'game') { loadBoards(); loadTurnInfo(); }
  }, [view, loadBoards, loadTurnInfo]);

  // ---------------------------------------------------------------------------
  // Ship placement logic
  // ---------------------------------------------------------------------------

  const floodFillShip = (
    g: boolean[][], visited: boolean[][], startX: number, startY: number, sz: number,
  ): [number, number][] => {
    const ship: [number, number][] = [];
    const stack: [number, number][] = [[startX, startY]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= sz || cy < 0 || cy >= sz || visited[cy][cx] || !g[cy][cx]) continue;
      visited[cy][cx] = true;
      ship.push([cx, cy]);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return ship;
  };

  const toggleCell = useCallback(
    (x: number, y: number) => {
      if (isRemovalMode) {
        if (!grid[y][x]) return;
        const visited = Array.from({ length: size }, () => Array(size).fill(false));
        const ship = floodFillShip(grid, visited, x, y, size);
        if (ship.length > 0) {
          const shipLen = ship.length;
          if (shipLen >= 2 && shipLen <= 5) {
            const idx = shipLen - 2;
            setShipCounts((prev) => { const next = [...prev]; next[idx] = Math.max(0, next[idx] - 1); return next; });
          }
          setGrid((prev) => { const next = prev.map((row) => row.slice()); ship.forEach(([sx, sy]) => (next[sy][sx] = false)); return next; });
        }
      } else if (selectedShip === null) {
        show({ title: 'Select a ship length first', variant: 'warning' });
      } else {
        const shipLen = selectedShip + 2;
        if (shipCounts[selectedShip] >= shipTargets[selectedShip]) {
          show({ title: `Already placed ${shipTargets[selectedShip]} ship(s) of length ${shipLen}`, variant: 'warning' });
          return;
        }
        const coords: [number, number][] = [];
        for (let i = 0; i < shipLen; i++) {
          const nx = isHorizontal ? x + i : x;
          const ny = isHorizontal ? y : y + i;
          if (nx >= size || ny >= size || grid[ny][nx]) break;
          coords.push([nx, ny]);
        }
        if (coords.length === shipLen) {
          const coordsSet = new Set(coords.map(([nx, ny]) => `${nx},${ny}`));
          const hasAdjacentExisting = coords.some(([nx, ny]) =>
            [[nx+1,ny],[nx-1,ny],[nx,ny+1],[nx,ny-1],[nx+1,ny+1],[nx+1,ny-1],[nx-1,ny+1],[nx-1,ny-1]].some(([ax, ay]) => {
              if (ax < 0 || ay < 0 || ax >= size || ay >= size) return false;
              if (coordsSet.has(`${ax},${ay}`)) return false;
              return grid[ay][ax];
            }),
          );
          if (hasAdjacentExisting) { show({ title: 'Ships cannot touch each other', variant: 'error' }); return; }
          setGrid((prev) => { const next = prev.map((row) => row.slice()); coords.forEach(([nx, ny]) => (next[ny][nx] = true)); return next; });
          setShipCounts((prev) => { const next = [...prev]; next[selectedShip] += 1; return next; });
        } else {
          show({ title: `Cannot place ship of length ${shipLen} here`, variant: 'error' });
        }
      }
    },
    [selectedShip, shipCounts, shipTargets, size, show, isHorizontal, isRemovalMode, grid],
  );

  const placeShips = useCallback(async () => {
    if (!matchApi || !matchApiReady) { show({ title: 'Match context is still syncing', variant: 'warning' }); return; }
    if (!effectiveMatchId) { show({ title: 'Set match id first', variant: 'error' }); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const groups: string[] = [];
      const visited = Array.from({ length: size }, () => Array(size).fill(false));
      for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
          if (grid[yy][xx] && !visited[yy][xx]) {
            const ship = floodFillShip(grid, visited, xx, yy, size);
            if (ship.length > 0) groups.push(ship.map(([sx, sy]) => `${sx},${sy}`).join(';'));
          }
        }
      }
      if (groups.length === 0) { show({ title: 'Place ships on the grid', variant: 'error' }); loadingRef.current = false; return; }
      const fleetError = validateFleetPayload(groups);
      if (fleetError) { show({ title: fleetError, variant: 'error' }); loadingRef.current = false; return; }
      await ensureMatchContextReady(matchApi);
      await matchApi.placeShips({ match_id: effectiveMatchId, ships: groups });
      show({ title: 'Fleet deployed', variant: 'success' });
      await loadBoards();
      await loadTurnInfo();
    } catch (e) {
      console.error('placeShips', e);
      show({ title: e instanceof Error ? e.message : 'Failed to place ships', variant: 'error' });
    } finally {
      loadingRef.current = false;
    }
  }, [matchApi, matchApiReady, effectiveMatchId, grid, size, show, loadBoards, loadTurnInfo, ensureMatchContextReady]);

  // ---------------------------------------------------------------------------
  // Shooting logic
  // ---------------------------------------------------------------------------

  const handleShotGridClick = useCallback((clickX: number, clickY: number) => {
    if (!isMyTurn) return;
    setSelectedShotX(clickX);
    setSelectedShotY(clickY);
  }, [isMyTurn]);

  const proposeShot = useCallback(async (shotX?: number, shotY?: number) => {
    if (!matchApi || !matchApiReady) { show({ title: 'Match context is still syncing', variant: 'warning' }); return; }
    if (!effectiveMatchId) { show({ title: 'Set match id first', variant: 'error' }); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const finalX = shotX !== undefined ? shotX : 0;
      const finalY = shotY !== undefined ? shotY : 0;
      await ensureMatchContextReady(matchApi);
      await matchApi.proposeShot({ match_id: effectiveMatchId, x: finalX, y: finalY });
      show({ title: `Shot fired at (${finalX}, ${finalY})`, variant: 'success' });
      await loadBoards();
      await loadTurnInfo();
      setSelectedShotX(null);
      setSelectedShotY(null);
      setPendingShot(null);
    } catch (e) {
      console.error('proposeShot', e);
      show({ title: e instanceof Error ? e.message : 'Failed to fire shot', variant: 'error' });
    } finally {
      loadingRef.current = false;
    }
  }, [matchApi, matchApiReady, effectiveMatchId, show, loadBoards, loadTurnInfo, ensureMatchContextReady]);

  // ---------------------------------------------------------------------------
  // Lobby actions
  // ---------------------------------------------------------------------------

  const doLogout = useCallback(() => { logout(); navigate('/'); }, [logout, navigate]);

  const handleCreateLobby = useCallback(async () => {
    const id = await lobby.createLobby(newLobbyName || undefined);
    if (id) { setNewLobbyName(''); show({ title: 'Namespace created', variant: 'success' }); }
    else if (lobby.createLobbyError) { show({ title: lobby.createLobbyError.message, variant: 'error' }); }
  }, [lobby, newLobbyName, show]);

  const handleCreateInvitation = useCallback(async () => {
    const result = await lobby.invitePlayer();
    if (result) { setInvitationJson(JSON.stringify(result, null, 2)); show({ title: 'Invitation created', variant: 'success' }); }
  }, [lobby, show]);

  const handleJoinLobby = useCallback(async () => {
    if (!joinInvitationInput.trim()) { show({ title: 'Paste an invitation JSON', variant: 'error' }); return; }
    try {
      const success = await lobby.joinLobby(joinInvitationInput);
      if (success) { show({ title: 'Joined namespace', variant: 'success' }); setJoinInvitationInput(''); }
    } catch (e) { show({ title: e instanceof Error ? e.message : 'Failed to join', variant: 'error' }); }
  }, [joinInvitationInput, lobby, show]);

  const handleEnterLobby = useCallback(() => {
    if (!lobby.lobbyContextId) { show({ title: 'No namespace context available', variant: 'error' }); return; }
    setView('lobby');
  }, [lobby, show]);

  const resetToLobby = useCallback(() => {
    setMatchId('');
    setRuntimeMatchId(null);
    setMatchContextId(null);
    setMatchApi(null);
    setPlaced(false);
    setOwnBoard([]);
    setShotsBoard([]);
    setCurrentTurn(null);
    setIsMyTurn(false);
    setPendingShot(null);
    setSelectedShotX(null);
    setSelectedShotY(null);
    setGrid(Array.from({ length: 10 }, () => Array(10).fill(false)));
    setShipCounts([0, 0, 0, 0]);
    setView('lobby');
    navigate('/lobby', { replace: true });
  }, [navigate]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  const navProps = {
    namespaceName: lobby.selectedLobby?.alias,
    namespaceId: lobby.namespaceId,
    contextId: currentContext?.contextId || null,
    currentUser,
    onLogout: doLogout,
  };

  // --- Lobby Select ---
  if (view === 'lobby-select') {
    return (
      <div className="app-bg">
        <NavBar {...navProps} />
        <div className="page-shell">
          <div className="page-content">
            <LobbySelect
              lobbies={lobby.lobbies}
              lobbiesLoading={lobby.lobbiesLoading}
              selectedNamespaceId={lobby.selectedLobby?.namespaceId || null}
              lobbyContextId={lobby.lobbyContextId}
              namespaceId={lobby.namespaceId}
              lobbyJoined={lobby.lobbyJoined}
              groupLoading={lobby.groupLoading}
              joinLoading={lobby.joinLoading}
              createLobbyLoading={lobby.createLobbyLoading}
              newLobbyName={newLobbyName}
              joinInvitationInput={joinInvitationInput}
              onNewLobbyNameChange={setNewLobbyName}
              onJoinInputChange={setJoinInvitationInput}
              onSelectLobby={lobby.selectLobby}
              onCreateLobby={handleCreateLobby}
              onJoinLobby={handleJoinLobby}
              onEnter={handleEnterLobby}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Lobby ---
  if (view === 'lobby') {
    return (
      <div className="app-bg">
        <NavBar {...navProps} />
        <div className="page-shell">
          <div className="page-content">
            <LobbyView
              lobbyAlias={lobby.selectedLobby?.alias}
              isAdmin={lobby.isAdmin}
              members={lobby.members}
              selfIdentity={lobby.selfIdentity}
              executorPublicKey={lobby.executorPublicKey}
              inviteLoading={lobby.inviteLoading}
              invitationJson={invitationJson}
              onCreateInvitation={handleCreateInvitation}
              onDismissInvitation={() => setInvitationJson(null)}
              player2={player2}
              creatingMatch={creatingMatch}
              onPlayer2Change={setPlayer2}
              onCreateMatch={createMatch}
              matches={myMatches}
              onOpenGame={openGame}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Game ---
  return (
    <div className="app-bg">
      <NavBar {...navProps} extra={
        <Button variant="secondary" onClick={resetToLobby}>Back to Lobby</Button>
      } />
      <div className="page-shell">
        <div className="page-content page-content-wide">
          {/* Match header */}
          <div className="naval-card fade-in">
            <div className="naval-card-header">
              <div className="naval-card-title">
                Match
                <span className="mono-sm" style={{ fontSize: '0.75rem' }}>
                  {effectiveMatchId}
                </span>
              </div>
            </div>
            <div className="naval-card-body">
              <div className="info-row">
                <span className="mono-sm">
                  {placed ? 'Fleet deployed' : 'Deploy your fleet to begin'}
                </span>
                {matchContextId && (
                  <div className="info-pair">
                    <span className="info-label">CTX</span>
                    <span className="info-value">
                      {matchContextId.slice(0, 6)}...{matchContextId.slice(-6)}
                    </span>
                    <CopyToClipboard text={matchContextId} variant="icon" size="small" successMessage="Copied!" />
                  </div>
                )}
                <span className={`badge ${isEventSubscribed ? 'badge-live' : 'badge-offline'}`}>
                  {isEventSubscribed ? 'Live' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Ship placement */}
          {!placed && (
            <div className="naval-card fade-in fade-in-delay-1">
              <div className="naval-card-header">
                <div className="naval-card-title">Deploy Fleet</div>
              </div>
              <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <ShipSelector
                  selectedShip={selectedShip}
                  shipCounts={shipCounts}
                  shipTargets={shipTargets}
                  isHorizontal={isHorizontal}
                  isRemovalMode={isRemovalMode}
                  onSelectShip={(idx) => { setSelectedShip(idx); setIsRemovalMode(false); }}
                  onSetHorizontal={setIsHorizontal}
                  onToggleRemoval={() => { setIsRemovalMode(!isRemovalMode); setSelectedShip(null); }}
                />
                <PlacementGrid size={size} grid={grid} onCellClick={toggleCell} />
                <button
                  className="btn-deploy"
                  onClick={placeShips}
                  disabled={!matchApiReady || shipCounts.some((c, i) => c !== shipTargets[i])}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Deploy Fleet
                </button>
              </div>
            </div>
          )}

          {/* Active game boards */}
          {placed && (
            <div className="boards-grid fade-in fade-in-delay-1">
              <div className="naval-card">
                <div className="naval-card-header">
                  <div className="naval-card-title">Your Waters</div>
                </div>
                <div className="naval-card-body">
                  <GameBoard
                    size={size}
                    board={ownBoard}
                    label="Defense Grid"
                    pendingShot={pendingShot}
                  />
                </div>
              </div>

              <div className="naval-card">
                <div className="naval-card-header">
                  <div className="naval-card-title">
                    Enemy Waters
                    {isMyTurn && <span className="badge badge-live">Your Turn</span>}
                  </div>
                </div>
                <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <ShotGrid
                    size={size}
                    shots={shotsBoard}
                    isMyTurn={isMyTurn}
                    selectedX={selectedShotX}
                    selectedY={selectedShotY}
                    onCellClick={handleShotGridClick}
                  />

                  {selectedShotX !== null && selectedShotY !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div className="info-pair">
                        <span className="info-label">Target</span>
                        <span className="mono" style={{ color: 'var(--select-cyan)', fontWeight: 700 }}>
                          {'ABCDEFGHIJ'[selectedShotX]}{selectedShotY + 1}
                        </span>
                      </div>
                      <button
                        className="btn-fire"
                        disabled={!matchApiReady || !isMyTurn}
                        onClick={() => proposeShot(selectedShotX, selectedShotY)}
                      >
                        Fire
                      </button>
                    </div>
                  )}

                  {!isMyTurn && placed && (
                    <span className="mono-sm">Waiting for opponent...</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
