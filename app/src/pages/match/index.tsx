import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Grid,
  GridItem,
  Input,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  Menu,
  MenuGroup,
  MenuItem,
  Text,
  useToast,
  CopyToClipboard,
} from '@calimero-network/mero-ui';
import {
  useMero,
} from '@calimero-network/mero-react';
import { createKvClient, AbiClient } from '../../features/kv/api';
import type { ContextRole } from '../../features/kv/api';
import type { MatchSummary } from '../../api/AbiClient';
import type { AllGameEvents } from '../../types/events';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';
import { useBattleshipsLobby } from '../../hooks/useBattleshipsLobby';

export default function MatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAuthenticated,
    logout,
    mero,
    nodeUrl,
    contextIdentity,
    connectToNode,
  } = useMero();
  const defaultNodeUrl =
    import.meta.env.VITE_NODE_URL?.trim() || 'http://node1.127.0.0.1.nip.io';
  const { show } = useToast();

  const lobby = useBattleshipsLobby();

  // View state: 'group-select' | 'lobby' | 'game'
  const [view, setView] = useState<'group-select' | 'lobby' | 'game'>('group-select');

  // Group creation form
  const [newGroupName, setNewGroupName] = useState('');
  const [invitationJson, setInvitationJson] = useState<string | null>(null);
  const [joinInvitationInput, setJoinInvitationInput] = useState('');

  // Lobby API and context
  const [lobbyApi, setLobbyApi] = useState<AbiClient | null>(null);
  const [currentContext, setCurrentContext] = useState<{
    applicationId: string;
    contextId: string;
    nodeUrl: string;
  } | null>(null);

  // Match API client (targets the per-game Match context)
  const [matchApi, setMatchApi] = useState<AbiClient | null>(null);
  const [matchContextId, setMatchContextId] = useState<string | null>(null);

  // Match management
  const [matchId, setMatchId] = useState<string>('');
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
  const [pendingShot, setPendingShot] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Ship placement
  const [grid, setGrid] = useState<boolean[][]>(() =>
    Array.from({ length: 10 }, () => Array(10).fill(false)),
  );
  const [selectedShip, setSelectedShip] = useState<number | null>(null);
  const [shipCounts, setShipCounts] = useState<number[]>([0, 0, 0, 0]);
  const [shipTargets] = useState<number[]>([1, 1, 2, 1]);
  const [isHorizontal, setIsHorizontal] = useState<boolean>(true);
  const [isRemovalMode, setIsRemovalMode] = useState<boolean>(false);

  // Shooting
  const [x, setX] = useState<string>('0');
  const [y, setY] = useState<string>('0');
  const [selectedShotX, setSelectedShotX] = useState<number | null>(null);
  const [selectedShotY, setSelectedShotY] = useState<number | null>(null);

  const loadingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);

  // Transition from group-select to lobby when group + lobby are resolved
  useEffect(() => {
    if (view === 'group-select' && lobby.selectedLobby && lobby.lobbyJoined && lobby.lobbyContextId) {
      setView('lobby');
    }
  }, [view, lobby.selectedLobby, lobby.lobbyJoined, lobby.lobbyContextId]);

  // If URL has match_id + context_id, go straight to game view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlMatchId = params.get('match_id');
    const urlContextId = params.get('context_id');
    if (urlMatchId && urlContextId && location.pathname === '/match') {
      setMatchId(urlMatchId);
      setMatchContextId(urlContextId);
      setView('game');
    }
  }, [location.pathname, location.search]);

  const loadBoards = useCallback(async () => {
    if (!matchApi || !matchId) return;
    try {
      const own = await matchApi.getOwnBoard({ match_id: matchId });
      const shots = await matchApi.getShots({ match_id: matchId });
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
  }, [matchApi, matchId]);

  const loadTurnInfo = useCallback(async () => {
    if (!matchApi || !matchId) return;
    try {
      const turn = await matchApi.getCurrentTurn();
      setCurrentTurn(turn);
    } catch {
      // turn info not yet available
    }
  }, [matchApi, matchId]);

  useEffect(() => {
    if (currentUser && currentTurn) {
      setIsMyTurn(currentUser === currentTurn);
    }
  }, [currentTurn, currentUser]);

  const handleBoardUpdate = useCallback(() => {
    loadBoards();
    loadTurnInfo();
  }, [loadBoards, loadTurnInfo]);

  const handleTurnUpdate = useCallback(() => {
    loadTurnInfo();
  }, [loadTurnInfo]);

  const refreshMatchList = useCallback(async () => {
    if (!lobbyApi) return;
    try {
      const summaries = await lobbyApi.getMatches();
      setMyMatches(summaries);
    } catch {
      // non-critical
    }
  }, [lobbyApi]);

  const handleGameEvent = useCallback(
    (event: AllGameEvents) => {
      if (event.type === 'ShotProposed') {
        if (
          !isMyTurn &&
          typeof event.x === 'number' &&
          typeof event.y === 'number'
        ) {
          setPendingShot({ x: event.x, y: event.y });
        }
      }
      if (
        event.type === 'ShotFired' ||
        event.type === 'MatchEnded' ||
        event.type === 'Winner'
      ) {
        setPendingShot(null);
      }
      if (
        event.type === 'MatchListUpdated' ||
        event.type === 'MatchCreated' ||
        event.type === 'MatchEnded' ||
        event.type === 'Winner'
      ) {
        refreshMatchList();
      }
    },
    [isMyTurn, refreshMatchList],
  );

  const subscriptionContextId = view === 'game' && matchContextId
    ? matchContextId
    : (currentContext?.contextId || '');

  const lobbySubscriptionContextId =
    view === 'game' ? (currentContext?.contextId ?? undefined) : undefined;

  const { isSubscribed: isEventSubscribed } = useGameSubscriptions({
    contextId: subscriptionContextId,
    lobbyContextId: lobbySubscriptionContextId,
    matchId,
    onBoardUpdate: handleBoardUpdate,
    onTurnUpdate: handleTurnUpdate,
    onGameEvent: handleGameEvent,
  });

  // Initialize Lobby API client when lobby context is joined and ready
  useEffect(() => {
    if (!mero || !lobby.lobbyContextId || !lobby.lobbyJoined) return;

    const executorKey = lobby.executorPublicKey ?? contextIdentity;
    if (!executorKey) return;

    (async () => {
      try {
        const { client, context } = await createKvClient(mero, {
          contextId: lobby.lobbyContextId,
          contextIdentity: executorKey,
          role: 'lobby' as ContextRole,
        });
        setLobbyApi(client);
        setCurrentContext({
          applicationId: context.applicationId,
          contextId: context.contextId,
          nodeUrl: nodeUrl || defaultNodeUrl,
        });

        try {
          const summaries = await client.getMatches();
          setMyMatches(summaries);
        } catch {
          // matches not available yet
        }

        setCurrentUser(executorKey);
      } catch (e) {
        console.error('Lobby API init failed:', e);
      }
    })();
  }, [
    contextIdentity,
    defaultNodeUrl,
    lobby.lobbyContextId,
    lobby.lobbyJoined,
    lobby.executorPublicKey,
    mero,
    nodeUrl,
  ]);

  // Initialize Match API client when entering a game with a match context
  useEffect(() => {
    if (!mero || !matchContextId || view !== 'game') {
      setMatchApi(null);
      return;
    }

    const executorKey = lobby.executorPublicKey ?? contextIdentity;

    (async () => {
      try {
        const { client } = await createKvClient(mero, {
          contextId: matchContextId,
          contextIdentity: executorKey,
          role: 'match' as ContextRole,
        });
        setMatchApi(client);
      } catch (e) {
        console.error(e);
        show({ title: 'Failed to initialize match API client', variant: 'error' });
      }
    })();
  }, [
    contextIdentity,
    lobby.executorPublicKey,
    matchContextId,
    mero,
    show,
    view,
  ]);

  const createMatch = useCallback(async () => {
    if (!lobbyApi || !mero || !currentContext) return;
    setCreatingMatch(true);
    try {
      // 1. Create a pending match in the Lobby contract
      const id = await lobbyApi.createMatch({ player2 });
      show({ title: `Match allocated: ${id}`, variant: 'success' });

      // 2. Create the Match context via admin API
      const executorKey = lobby.executorPublicKey ?? contextIdentity;
      const initParams = JSON.stringify({
        context_type: 'Match',
        player1: executorKey,
        player2,
        lobby_context_id: currentContext.contextId,
      });
      const initBytes = Array.from(new TextEncoder().encode(initParams));

      const { contextId: newContextId } = await mero.admin.createContext({
        applicationId: currentContext.applicationId,
        initializationParams: initBytes,
        groupId: lobby.groupId || undefined,
      });

      // 3. Link the Match context back into the Lobby
      await lobbyApi.setMatchContextId({
        match_id: id,
        context_id: newContextId,
      });

      // 4. Refresh the match list
      try {
        const summaries = await lobbyApi.getMatches();
        setMyMatches(summaries);
      } catch {
        // non-critical
      }

      // 5. Navigate to the match with both identifiers
      setMatchId(id);
      setMatchContextId(newContextId);
      setView('game');
      navigate(`/match?match_id=${encodeURIComponent(id)}&context_id=${encodeURIComponent(newContextId)}`, { replace: true });
      show({ title: `Match created and linked`, variant: 'success' });
    } catch (e) {
      console.error('createMatch', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to create match',
        variant: 'error',
      });
    } finally {
      setCreatingMatch(false);
    }
  }, [lobbyApi, mero, currentContext, player2, lobby.executorPublicKey, lobby.groupId, contextIdentity, show, navigate]);

  const openGame = useCallback(
    (id: string, contextId: string) => {
      setMatchId(id);
      setMatchContextId(contextId);
      setView('game');
      navigate(
        `/match?match_id=${encodeURIComponent(id)}&context_id=${encodeURIComponent(contextId)}`,
        { replace: true },
      );
    },
    [navigate],
  );

  useEffect(() => {
    if (view === 'game') {
      loadBoards();
      loadTurnInfo();
    }
  }, [view, loadBoards, loadTurnInfo]);

  const placeShips = useCallback(async () => {
    if (!matchApi) return;
    if (!matchId) {
      show({ title: 'Set match id first', variant: 'error' });
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // convert grid to ship groups using flood fill
      const groups: string[] = [];
      const visited = Array.from({ length: size }, () =>
        Array(size).fill(false),
      );

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (grid[y][x] && !visited[y][x]) {
            const ship = floodFillShip(grid, visited, x, y, size);
            if (ship.length > 0) {
              groups.push(ship.map(([x, y]) => `${x},${y}`).join(';'));
            }
          }
        }
      }

      if (groups.length === 0) {
        show({ title: 'Place ships on the grid', variant: 'error' });
        loadingRef.current = false;
        return;
      }
      await matchApi.placeShips({ match_id: matchId, ships: groups });
      show({ title: 'Ships placed', variant: 'success' });
      await loadBoards();
      await loadTurnInfo();
    } catch (e) {
      console.error('placeShips', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to place ships',
        variant: 'error',
      });
    } finally {
      loadingRef.current = false;
    }
  }, [matchApi, matchId, grid, size, show, loadBoards, loadTurnInfo]);

  const proposeShot = useCallback(
    async (shotX?: number, shotY?: number) => {
      if (!matchApi) return;
      if (!matchId) {
        show({ title: 'Set match id first', variant: 'error' });
        return;
      }
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const finalX = shotX !== undefined ? shotX : parseInt(x || '0', 10);
        const finalY = shotY !== undefined ? shotY : parseInt(y || '0', 10);
        await matchApi.proposeShot({ match_id: matchId, x: finalX, y: finalY });
        show({
          title: `Shot proposed at (${finalX},${finalY})`,
          variant: 'success',
        });
        await loadBoards();
        await loadTurnInfo();
        // Clear selection after successful shot
        setSelectedShotX(null);
        setSelectedShotY(null);
        // Shooter side should not show pending overlay on own board
        setPendingShot(null);
      } catch (e) {
        console.error('proposeShot', e);
        show({
          title: e instanceof Error ? e.message : 'Failed to propose shot',
          variant: 'error',
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [matchApi, matchId, x, y, show, loadBoards, loadTurnInfo],
  );

  const handleShotGridClick = useCallback(
    (clickX: number, clickY: number) => {
      if (!isMyTurn) return;
      setSelectedShotX(clickX);
      setSelectedShotY(clickY);
      setX(clickX.toString());
      setY(clickY.toString());
    },
    [isMyTurn],
  );

  const floodFillShip = (
    grid: boolean[][],
    visited: boolean[][],
    startX: number,
    startY: number,
    size: number,
  ): [number, number][] => {
    const ship: [number, number][] = [];
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (
        x < 0 ||
        x >= size ||
        y < 0 ||
        y >= size ||
        visited[y][x] ||
        !grid[y][x]
      )
        continue;

      visited[y][x] = true;
      ship.push([x, y]);

      // check adjacent cells (4-directional)
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return ship;
  };

  const toggleCell = useCallback(
    (x: number, y: number) => {
      if (isRemovalMode) {
        // remove ship at this position
        if (!grid[y][x]) return;

        // find and remove the entire ship using flood fill
        const visited = Array.from({ length: size }, () =>
          Array(size).fill(false),
        );
        const ship = floodFillShip(grid, visited, x, y, size);

        if (ship.length > 0) {
          // determine ship length and update counts
          const shipLen = ship.length;
          if (shipLen >= 2 && shipLen <= 5) {
            const idx = shipLen - 2;
            setShipCounts((prev) => {
              const next = [...prev];
              next[idx] = Math.max(0, next[idx] - 1);
              return next;
            });
          }

          // remove ship from grid
          setGrid((prev) => {
            const next = prev.map((row) => row.slice());
            ship.forEach(([sx, sy]) => (next[sy][sx] = false));
            return next;
          });
        }
      } else if (selectedShip === null) {
        // single cell toggle
        setGrid((prev) => {
          const next = prev.map((row) => row.slice());
          next[y][x] = !next[y][x];
          return next;
        });
      } else {
        // place ship of selected length
        const shipLen = selectedShip + 2; // 2,3,4,5
        if (shipCounts[selectedShip] >= shipTargets[selectedShip]) {
          show({
            title: `Already placed ${shipTargets[selectedShip]} ship(s) of length ${shipLen}`,
            variant: 'warning',
          });
          return;
        }

        // try placement in selected orientation
        const coords: [number, number][] = [];
        for (let i = 0; i < shipLen; i++) {
          const nx = isHorizontal ? x + i : x;
          const ny = isHorizontal ? y : y + i;
          if (nx >= size || ny >= size || grid[ny][nx]) break;
          coords.push([nx, ny]);
        }

        if (coords.length === shipLen) {
          setGrid((prev) => {
            const next = prev.map((row) => row.slice());
            coords.forEach(([nx, ny]) => (next[ny][nx] = true));
            return next;
          });
          setShipCounts((prev) => {
            const next = [...prev];
            next[selectedShip] += 1;
            return next;
          });
        } else {
          show({
            title: `Cannot place ship of length ${shipLen} here`,
            variant: 'error',
          });
        }
      }
    },
    [
      selectedShip,
      shipCounts,
      shipTargets,
      size,
      show,
      isHorizontal,
      isRemovalMode,
      grid,
    ],
  );

  const renderGrid = useCallback(
    (title: string, editable: boolean) => {
      const current = editable
        ? grid
        : Array.from({ length: size }, (_, y) =>
            Array.from(
              { length: size },
              (_, x) =>
                ownBoard[y * size + x] === 1 || ownBoard[y * size + x] === 2,
            ),
          );
      return (
        <div>
          <div style={{ marginBottom: '0.5rem', color: '#9ca3af' }}>
            {title}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${size}, 28px)`,
              gap: '4px',
            }}
          >
            {current.flatMap((row, y) =>
              row.map((cell, x) => {
                const val = editable
                  ? cell
                    ? 1
                    : 0
                  : ownBoard[y * size + x] || 0;
                const bg =
                  val === 2
                    ? '#ef4444'
                    : val === 3
                      ? '#374151'
                      : val === 1
                        ? '#10b981'
                        : '#1f2937';
                return (
                  <div
                    key={`${x}-${y}`}
                    onClick={() => editable && toggleCell(x, y)}
                    style={{
                      width: 28,
                      height: 28,
                      background: bg,
                      borderRadius: 4,
                      cursor: editable ? 'pointer' : 'default',
                    }}
                  />
                );
              }),
            )}
          </div>
        </div>
      );
    },
    [grid, ownBoard, size, toggleCell],
  );

  const renderOwnBoard = useCallback(() => {
    return (
      <div>
        <div style={{ marginBottom: '0.5rem', color: '#9ca3af' }}>
          Your Board
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${size}, 28px)`,
            gap: '4px',
          }}
        >
          {Array.from({ length: size }, (_, y) =>
            Array.from({ length: size }, (_, x) => {
              const val = ownBoard[y * size + x] || 0;
              let bg = '#1f2937'; // Default empty
              if (val === 1)
                bg = '#10b981'; // Ship (green)
              else if (val === 2)
                bg = '#ef4444'; // Hit ship (red)
              else if (val === 3)
                bg = '#374151'; // Miss (gray)
              else if (val === 4) bg = '#f59e0b'; // Pending shot (yellow from API)

              // Overlay pending shot from event if targeted at us
              if (pendingShot && pendingShot.x === x && pendingShot.y === y) {
                // Do not override a hit; only overlay on empty/ship/miss
                if (val !== 2) {
                  bg = '#f59e0b';
                }
              }

              return (
                <div
                  key={`${x}-${y}`}
                  style={{
                    width: 28,
                    height: 28,
                    background: bg,
                    borderRadius: 4,
                    border: '1px solid #374151',
                  }}
                />
              );
            }),
          )}
        </div>
        <div
          style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}
        >
          Legend: Empty (gray) | Ship (green) | Hit (red) | Miss (dark gray) |
          Pending Shot (yellow)
        </div>
      </div>
    );
  }, [ownBoard, size, pendingShot]);

  const renderShotsBoard = useCallback(() => {
    return (
      <div>
        <div style={{ marginBottom: '0.5rem', color: '#9ca3af' }}>
          Your Shots{' '}
          {isMyTurn ? '(Click to select target!)' : '(Not your turn)'}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${size}, 28px)`,
            gap: '4px',
          }}
        >
          {Array.from({ length: size }, (_, y) =>
            Array.from({ length: size }, (_, x) => {
              const shotValue = shotsBoard[y * size + x] || 0;
              const isSelected = selectedShotX === x && selectedShotY === y;
              const isClickable = isMyTurn && shotValue === 0; // Only allow clicking on empty cells

              let bg = '#1f2937'; // Default empty
              if (shotValue === 4)
                bg = '#f59e0b'; // Pending (yellow)
              else if (shotValue === 2)
                bg = '#ef4444'; // Hit (red)
              else if (shotValue === 3) bg = '#374151'; // Miss (gray)

              if (isSelected) {
                bg = '#3b82f6'; // Selected (blue)
              }

              return (
                <div
                  key={`${x}-${y}`}
                  onClick={() => isClickable && handleShotGridClick(x, y)}
                  style={{
                    width: 28,
                    height: 28,
                    background: bg,
                    borderRadius: 4,
                    cursor: isClickable ? 'pointer' : 'default',
                    border: isSelected
                      ? '2px solid #ffffff'
                      : '1px solid #374151',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    color: 'white',
                    fontWeight: 'bold',
                  }}
                >
                  {isSelected ? '?' : ''}
                </div>
              );
            }),
          )}
        </div>
        <div
          style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}
        >
          Legend: Empty (gray) | Pending (yellow) | Hit (red) | Miss (dark gray)
          | Selected (blue)
        </div>
      </div>
    );
  }, [
    size,
    shotsBoard,
    selectedShotX,
    selectedShotY,
    isMyTurn,
    handleShotGridClick,
  ]);

  const doLogout = useCallback(() => {
    logout();
    navigate('/');
  }, [logout, navigate]);

  const handleCreateLobby = useCallback(async () => {
    const id = await lobby.createLobby(newGroupName || undefined);
    if (id) {
      setNewGroupName('');
      show({ title: 'Lobby created', variant: 'success' });
    } else if (lobby.createLobbyError) {
      show({ title: lobby.createLobbyError.message, variant: 'error' });
    }
  }, [lobby, newGroupName, show]);

  const handleCreateInvitation = useCallback(async () => {
    const result = await lobby.invitePlayer();
    if (result) {
      setInvitationJson(JSON.stringify(result, null, 2));
      show({ title: 'Invitation created', variant: 'success' });
    }
  }, [lobby, show]);

  const handleJoinLobby = useCallback(async () => {
    if (!joinInvitationInput.trim()) {
      show({ title: 'Paste an invitation JSON', variant: 'error' });
      return;
    }
    try {
      const success = await lobby.joinLobby(joinInvitationInput);
      if (success) {
        show({ title: 'Joined lobby', variant: 'success' });
        setJoinInvitationInput('');
      }
    } catch (e) {
      show({
        title: e instanceof Error ? e.message : 'Failed to join lobby',
        variant: 'error',
      });
    }
  }, [joinInvitationInput, lobby, show]);

  const handleEnterLobby = useCallback(() => {
    if (!lobby.lobbyContextId) {
      show({ title: 'No lobby context available', variant: 'error' });
      return;
    }
    setView('lobby');
  }, [lobby, show]);

  const renderNavbar = (extra?: React.ReactNode) => (
    <MeroNavbar variant="elevated" size="md">
      <NavbarBrand text="Battleship" />
      <NavbarMenu align="center">
        {lobby.selectedLobby && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.875rem', color: '#9ca3af' }}>
            <Text size="sm" color="muted">Lobby:</Text>
            <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
              {lobby.lobbyContextId?.slice(0, 12) + '...' || 'Unknown'}
            </Text>
            {currentContext && (
              <>
                <Text size="sm" color="muted">Context:</Text>
                <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                  {currentContext.contextId.slice(0, 8)}...{currentContext.contextId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentContext.contextId}
                  variant="icon"
                  size="small"
                  successMessage="Context ID copied!"
                />
              </>
            )}
            {currentUser && (
              <>
                <Text size="sm" color="muted">Key:</Text>
                <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                  {currentUser.slice(0, 8)}...{currentUser.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentUser}
                  variant="icon"
                  size="small"
                  successMessage="Public Key copied!"
                />
              </>
            )}
          </div>
        )}
        {extra}
      </NavbarMenu>
      <NavbarMenu align="right">
        {isAuthenticated ? (
          <Menu variant="compact" size="md">
            <MenuGroup>
              {lobby.selectedLobby && view !== 'group-select' && (
                <MenuItem onClick={() => {
                  lobby.clearLobby();
                  setView('group-select');
                  setLobbyApi(null);
                  setMatchApi(null);
                  setMatchContextId(null);
                  setMatchId('');
                  setCurrentContext(null);
                  setMyMatches([]);
                  setPlaced(false);
                  setOwnBoard([]);
                  setShotsBoard([]);
                  setCurrentTurn(null);
                  setIsMyTurn(false);
                  setPendingShot(null);
                  navigate('/lobby', { replace: true });
                }}>
                  Switch Lobby
                </MenuItem>
              )}
              <MenuItem onClick={doLogout}>Logout</MenuItem>
            </MenuGroup>
          </Menu>
        ) : (
          <NavbarItem>
            <Button variant="primary" onClick={() => connectToNode(defaultNodeUrl)}>
              Connect
            </Button>
          </NavbarItem>
        )}
      </NavbarMenu>
    </MeroNavbar>
  );

  const pageShell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', backgroundColor: '#111111', color: 'white' }}>
      <Grid columns={1} gap={32} maxWidth="100%" justify="center" align="center" style={{ minHeight: '100vh', padding: '2rem' }}>
        <GridItem>
          <main style={{ width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {children}
          </main>
        </GridItem>
      </Grid>
    </div>
  );

  // Group selection view
  if (view === 'group-select') {
    return (
      <>
        {renderNavbar()}
        {pageShell(
          <>
            <Card variant="rounded">
              <CardHeader>
                <CardTitle>Your Lobbies</CardTitle>
              </CardHeader>
              <CardContent>
                {lobby.lobbiesLoading ? (
                  <Text size="sm" color="muted">Loading lobbies...</Text>
                ) : lobby.lobbies.length === 0 ? (
                  <Text size="sm" color="muted">No lobbies yet. Create one below or join with an invitation.</Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {lobby.lobbies.map((l) => (
                      <div
                        key={l.contextId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.75rem',
                          backgroundColor: lobby.selectedLobby?.contextId === l.contextId ? '#1e3a5f' : '#1f2937',
                          borderRadius: '0.5rem',
                          border: lobby.selectedLobby?.contextId === l.contextId ? '1px solid #3b82f6' : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => lobby.selectLobby(l.contextId)}
                      >
                        <div>
                          <Text size="sm" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {l.contextId.slice(0, 16) + '...'}
                          </Text>
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                            {l.contextId.slice(0, 8)}...{l.contextId.slice(-8)}
                          </div>
                        </div>
                        <Button
                          variant={lobby.selectedLobby?.contextId === l.contextId ? 'primary' : 'secondary'}
                          onClick={(e) => {
                            e.stopPropagation();
                            lobby.selectLobby(l.contextId);
                          }}
                        >
                          {lobby.selectedLobby?.contextId === l.contextId ? 'Selected' : 'Select'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="rounded">
              <CardHeader>
                <CardTitle>Create New Lobby</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleCreateLobby(); }}
                  style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}
                >
                  <Input
                    type="text"
                    placeholder="Lobby name (optional)"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <Button type="submit" variant="success" disabled={lobby.createLobbyLoading}>
                    {lobby.createLobbyLoading ? 'Creating...' : 'Create'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card variant="rounded">
              <CardHeader>
                <CardTitle>Join Lobby via Invitation</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleJoinLobby(); }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
                >
                  <Input
                    type="text"
                    placeholder="Paste invitation JSON here"
                    value={joinInvitationInput}
                    onChange={(e) => setJoinInvitationInput(e.target.value)}
                  />
                  <Button type="submit" variant="primary">Join Lobby</Button>
                </form>
              </CardContent>
            </Card>

            {lobby.selectedLobby && (
              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>Enter Lobby</CardTitle>
                </CardHeader>
                <CardContent>
                  {lobby.groupLoading ? (
                    <Text size="sm" color="muted">Resolving lobby context...</Text>
                  ) : lobby.lobbyContextId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Text size="sm" color="muted">Lobby Context:</Text>
                        <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                          {lobby.lobbyContextId.slice(0, 8)}...{lobby.lobbyContextId.slice(-8)}
                        </Text>
                        <CopyToClipboard
                          text={lobby.lobbyContextId}
                          variant="icon"
                          size="small"
                          successMessage="Lobby context ID copied!"
                        />
                      </div>
                      {lobby.lobbyJoined ? (
                        <Button variant="success" onClick={() => setView('lobby')}>
                          Enter Lobby
                        </Button>
                      ) : (
                        <Button variant="primary" onClick={handleEnterLobby} disabled={lobby.joinLoading}>
                          {lobby.joinLoading ? 'Joining...' : 'Join & Enter Lobby'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <Text size="sm" color="muted">
                        Select a lobby above to enter.
                      </Text>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>,
        )}
      </>
    );
  }

  // Lobby view
  if (view === 'lobby') {
    return (
      <>
        {renderNavbar()}
        {pageShell(
          <>
            {lobby.selectedLobby && (
              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>
                    Battleships Lobby
                    {lobby.isAdmin && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#f59e0b', fontWeight: 'normal' }}>
                        Admin
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text size="sm" color="muted">
                        {lobby.members.length} member{lobby.members.length !== 1 ? 's' : ''}
                      </Text>
                      {lobby.selfIdentity && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Text size="sm" color="muted">You:</Text>
                          <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                            {lobby.selfIdentity.slice(0, 8)}...{lobby.selfIdentity.slice(-8)}
                          </Text>
                        </div>
                      )}
                    </div>

                    {lobby.members.length > 0 && (
                      <details>
                        <summary style={{ cursor: 'pointer', color: '#9ca3af', fontSize: '0.875rem' }}>
                          Members
                        </summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
                          {lobby.members.map((m) => (
                            <div key={m.identity} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
                              <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                                {m.identity.slice(0, 12)}...{m.identity.slice(-8)}
                              </Text>
                              <span style={{
                                fontSize: '0.7rem',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '4px',
                                backgroundColor: m.role === 'Admin' ? '#f59e0b22' : '#374151',
                                color: m.role === 'Admin' ? '#f59e0b' : '#9ca3af',
                              }}>
                                {m.role}
                              </span>
                              {m.identity === lobby.selfIdentity && (
                                <span style={{ fontSize: '0.7rem', color: '#10b981' }}>(you)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {lobby.isAdmin && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={handleCreateInvitation} disabled={lobby.inviteLoading}>
                          {lobby.inviteLoading ? 'Creating...' : 'Invite Player'}
                        </Button>
                      </div>
                    )}

                    {invitationJson && (
                      <div style={{ position: 'relative' }}>
                        <pre style={{
                          backgroundColor: '#1f2937',
                          padding: '0.75rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.75rem',
                          overflowX: 'auto',
                          maxHeight: '200px',
                          color: '#e5e7eb',
                        }}>
                          {invitationJson}
                        </pre>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <CopyToClipboard
                            text={invitationJson}
                            variant="button"
                            size="small"
                            successMessage="Invitation copied!"
                          />
                          <Button variant="secondary" onClick={() => setInvitationJson(null)}>
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card variant="rounded">
              <CardHeader>
                <CardTitle>Create New Match</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createMatch();
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  <Input
                    type="text"
                    placeholder="Player 2 public key (Base58)"
                    value={player2}
                    onChange={(e) => setPlayer2(e.target.value)}
                  />
                  <Button type="submit" variant="success" disabled={creatingMatch}>
                    {creatingMatch ? 'Creating...' : 'Create'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card variant="rounded">
              <CardHeader>
                <CardTitle>My Matches</CardTitle>
              </CardHeader>
              <CardContent>
                {myMatches.length === 0 ? (
                  <div style={{ color: '#9ca3af' }}>
                    No matches yet. Create one above!
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    {myMatches.map((m) => {
                      const statusColor =
                        m.status === 'Active' ? '#10b981'
                        : m.status === 'Finished' ? '#6b7280'
                        : '#f59e0b';
                      const canOpen = m.status === 'Active' && !!m.context_id;
                      return (
                        <div
                          key={m.match_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.75rem',
                            backgroundColor: '#1f2937',
                            borderRadius: '0.5rem',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <Text size="sm" style={{ fontFamily: 'monospace' }}>
                              {m.match_id}
                            </Text>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                              <span style={{
                                fontSize: '0.7rem',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '4px',
                                backgroundColor: `${statusColor}22`,
                                color: statusColor,
                              }}>
                                {m.status}
                              </span>
                              {m.winner && (
                                <Text size="sm" color="muted" style={{ fontSize: '0.75rem' }}>
                                  Winner: {m.winner.slice(0, 8)}...
                                </Text>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="primary"
                            disabled={!canOpen}
                            onClick={() => canOpen && openGame(m.match_id, m.context_id!)}
                          >
                            {canOpen ? 'Open' : m.status === 'Pending' ? 'Pending...' : 'Finished'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>,
        )}
      </>
    );
  }

  // Game view
  return (
    <>
      {renderNavbar(
        <Button variant="secondary" onClick={() => {
          setMatchId('');
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
        }}>
          Back to Lobby
        </Button>,
      )}
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#111111',
          color: 'white',
        }}
      >
        <Grid
          columns={1}
          gap={32}
          maxWidth="100%"
          justify="center"
          align="center"
          style={{ minHeight: '100vh', padding: '2rem' }}
        >
          <GridItem>
            <main
              style={{
                width: '100%',
                maxWidth: '1200px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2rem',
              }}
            >
              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>Match: {matchId}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Text size="sm" color="muted">
                      Status: {placed ? 'Ships placed' : 'Place ships to start'}
                    </Text>
                    {matchContextId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Text size="sm" color="muted">Context:</Text>
                        <Text size="sm" style={{ fontFamily: 'monospace', color: '#e5e7eb' }}>
                          {matchContextId.slice(0, 8)}...{matchContextId.slice(-8)}
                        </Text>
                        <CopyToClipboard
                          text={matchContextId}
                          variant="icon"
                          size="small"
                          successMessage="Match context ID copied!"
                        />
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: isEventSubscribed
                            ? '#10b981'
                            : '#f59e0b',
                        }}
                      />
                      <Text size="sm" color="muted">
                        {isEventSubscribed ? 'Live Updates' : 'Offline'}
                      </Text>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {!placed && (
                <Card variant="rounded">
                  <CardHeader>
                    <CardTitle>Place Your Fleet</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '1rem',
                        alignItems: 'start',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '1rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            {[2, 3, 4, 5].map((len, idx) => (
                              <Button
                                key={len}
                                variant={
                                  selectedShip === idx ? 'primary' : 'secondary'
                                }
                                onClick={() =>
                                  setSelectedShip(
                                    selectedShip === idx ? null : idx,
                                  )
                                }
                                disabled={shipCounts[idx] >= shipTargets[idx]}
                              >
                                {len} ({shipCounts[idx]}/{shipTargets[idx]})
                              </Button>
                            ))}
                            <Button
                              variant={isRemovalMode ? 'error' : 'secondary'}
                              onClick={() => {
                                setIsRemovalMode(!isRemovalMode);
                                setSelectedShip(null);
                              }}
                            >
                              {isRemovalMode ? 'Remove Mode' : 'Remove'}
                            </Button>
                          </div>
                          {selectedShip !== null && (
                            <div
                              style={{
                                display: 'flex',
                                gap: '0.5rem',
                                alignItems: 'center',
                              }}
                            >
                              <Button
                                variant={isHorizontal ? 'primary' : 'secondary'}
                                onClick={() => setIsHorizontal(true)}
                              >
                                →
                              </Button>
                              <Button
                                variant={
                                  !isHorizontal ? 'primary' : 'secondary'
                                }
                                onClick={() => setIsHorizontal(false)}
                              >
                                ↓
                              </Button>
                              <span
                                style={{
                                  fontSize: '0.875rem',
                                  color: '#9ca3af',
                                }}
                              >
                                {isHorizontal ? 'Horizontal' : 'Vertical'}
                              </span>
                            </div>
                          )}
                          <div
                            style={{ fontSize: '0.875rem', color: '#9ca3af' }}
                          >
                            {isRemovalMode
                              ? 'Click ships to remove them'
                              : selectedShip === null
                                ? 'Click cells to toggle'
                                : `Click to place ship of length ${selectedShip + 2} (${isHorizontal ? 'horizontal' : 'vertical'})`}
                          </div>
                          {renderGrid('Click to place ships', true)}
                          <Button
                            type="button"
                            variant="primary"
                            onClick={placeShips}
                            disabled={shipCounts.some(
                              (c, i) => c !== shipTargets[i],
                            )}
                          >
                            Place Fleet
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {placed && (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '2rem',
                    }}
                  >
                    <Card variant="rounded">
                      <CardHeader>
                        <CardTitle>Your Board</CardTitle>
                      </CardHeader>
                      <CardContent>{renderOwnBoard()}</CardContent>
                    </Card>
                    <Card variant="rounded">
                      <CardHeader>
                        <CardTitle>
                          Your Shots
                          {isMyTurn && (
                            <span
                              style={{
                                marginLeft: '0.5rem',
                                fontSize: '0.875rem',
                                color: '#10b981',
                                fontWeight: 'normal',
                              }}
                            >
                              🎯 It's your turn!
                            </span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                          }}
                        >
                          {renderShotsBoard()}

                          {/* Shot Controls */}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '1rem',
                              alignItems: 'center',
                            }}
                          >
                            {selectedShotX !== null &&
                              selectedShotY !== null && (
                                <div
                                  style={{
                                    padding: '0.75rem',
                                    backgroundColor: '#1f2937',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #374151',
                                  }}
                                >
                                  <Text size="sm" style={{ color: '#e5e7eb' }}>
                                    Selected: ({selectedShotX}, {selectedShotY})
                                  </Text>
                                </div>
                              )}

                            <div
                              style={{
                                display: 'flex',
                                gap: '1rem',
                                flexWrap: 'wrap',
                                justifyContent: 'center',
                              }}
                            >
                              <Button
                                variant="success"
                                disabled={
                                  !isMyTurn ||
                                  selectedShotX === null ||
                                  selectedShotY === null
                                }
                                onClick={() =>
                                  selectedShotX !== null &&
                                  selectedShotY !== null &&
                                  proposeShot(selectedShotX, selectedShotY)
                                }
                              >
                                {isMyTurn ? 'Fire Shot!' : 'Not Your Turn'}
                              </Button>
                            </div>

                            <div
                              style={{
                                fontSize: '0.875rem',
                                color: '#9ca3af',
                                textAlign: 'center',
                                maxWidth: '500px',
                              }}
                            >
                              Click on an empty cell above to select your
                              target, then click "Fire Shot!" to take your turn.
                            </div>

                            {/* Fallback text inputs for manual entry */}
                            <details
                              style={{ width: '100%', maxWidth: '400px' }}
                            >
                              <summary
                                style={{
                                  cursor: 'pointer',
                                  color: '#9ca3af',
                                  fontSize: '0.875rem',
                                }}
                              >
                                Manual Entry (Advanced)
                              </summary>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  proposeShot();
                                }}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns:
                                    'repeat(auto-fit, minmax(120px, 1fr))',
                                  gap: '1rem',
                                  marginTop: '1rem',
                                }}
                              >
                                <Input
                                  type="number"
                                  placeholder="X"
                                  value={x}
                                  onChange={(e) => setX(e.target.value)}
                                />
                                <Input
                                  type="number"
                                  placeholder="Y"
                                  value={y}
                                  onChange={(e) => setY(e.target.value)}
                                />
                                <Button
                                  type="submit"
                                  variant="success"
                                  disabled={!isMyTurn}
                                >
                                  Fire Manual Shot
                                </Button>
                              </form>
                            </details>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
