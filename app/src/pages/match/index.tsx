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
  CalimeroConnectButton,
  ConnectionType,
  useCalimero,
} from '@calimero-network/calimero-client';
import { createKvClient, AbiClient } from '../../features/kv/api';
import type { AllGameEvents } from '../../types/events';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';

export default function MatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, logout, app, appUrl } = useCalimero();
  const { show } = useToast();

  // View state
  const [view, setView] = useState<'lobby' | 'game'>('lobby');

  // API and context
  const [api, setApi] = useState<AbiClient | null>(null);
  const [currentContext, setCurrentContext] = useState<{
    applicationId: string;
    contextId: string;
    nodeUrl: string;
  } | null>(null);

  // Match management
  const [matchId, setMatchId] = useState<string>('');
  const [player2, setPlayer2] = useState<string>('');
  const [myMatches, setMyMatches] = useState<string[]>([]);

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
  const [shipCounts, setShipCounts] = useState<number[]>([0, 0, 0, 0]); // [2,3,4,5] lengths
  const [shipTargets] = useState<number[]>([1, 1, 2, 1]); // [2,3,4,5] required counts
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

  const loadBoards = useCallback(async () => {
    if (!api || !matchId) return;
    try {
      const own = await api.getOwnBoard({ match_id: matchId });
      const shots = await api.getShots({ match_id: matchId });
      setSize(own.size);
      const ownArr = own.board.toArray();
      const shotsArr = shots.shots.toArray();
      setOwnBoard(ownArr);
      setShotsBoard(shotsArr);
      const anyShip = ownArr.some((v) => v === 1 || v === 2 || v === 3);
      setPlaced(anyShip);
    } catch (e) {
      // ignore
    }
  }, [api, matchId]);

  const loadTurnInfo = useCallback(async () => {
    if (!api || !matchId) return;
    try {
      const turn = await api.getCurrentTurn();
      setCurrentTurn(turn);
    } catch (e) {
      console.error('Failed to load turn info:', e);
    }
  }, [api, matchId]);

  // Update isMyTurn whenever currentTurn or currentUser changes
  useEffect(() => {
    if (currentUser && currentTurn) {
      setIsMyTurn(currentUser === currentTurn);
    }
  }, [currentTurn, currentUser]);

  // Game event subscriptions
  const { isSubscribed: isEventSubscribed, events: gameEvents } =
    useGameSubscriptions({
      contextId: currentContext?.contextId || '',
      matchId,
      onBoardUpdate: () => {
        // Auto-refresh board when events occur
        loadBoards();
        loadTurnInfo();
      },
      onTurnUpdate: () => {
        // Auto-refresh turn info when shots are fired
        loadTurnInfo();
      },
      onGameEvent: (event: AllGameEvents) => {
        if (event.type === 'ShotProposed') {
          // If it's not our turn, we are the target → overlay pending on our board
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
      },
    });

  useEffect(() => {
    if (!app) return;
    (async () => {
      try {
        const client = await createKvClient(app);
        setApi(client);
        const contexts = await app.fetchContexts();
        if (contexts.length > 0) {
          const context = contexts[0];
          setCurrentContext({
            applicationId: context.applicationId,
            contextId: context.contextId,
            nodeUrl: appUrl || 'http://node1.127.0.0.1.nip.io',
          });
        }
        // pick match_id from URL if present
        const params = new URLSearchParams(location.search);
        const mid = params.get('match_id');
        if (mid) {
          setMatchId(mid);
          setView('game');
        }
        // fetch my matches
        try {
          const ids = await client.getMatches();
          setMyMatches(ids);
        } catch (_) {}
        // fetch current user and debug app object
        try {
          // Debug: log app object to see what's available
          console.log('App object:', app);
          console.log('App keys:', Object.keys(app || {}));

          const user = await client.getCurrentUser();
          setCurrentUser(user);
        } catch (e) {
          console.error('Failed to get current user:', e);
        }
      } catch (e) {
        console.error(e);
        show({ title: 'Failed to initialize API client', variant: 'error' });
      }
    })();
  }, [app, appUrl, show, location.search]);

  const createMatch = useCallback(async () => {
    if (!api) return;
    try {
      const id = await api.createMatch({ player2 });
      setMatchId(id);
      setView('game');
      // Update URL with match_id so refresh works
      navigate(`/match?match_id=${id}`, { replace: true });
      show({ title: `Match created: ${id}`, variant: 'success' });
    } catch (e) {
      console.error('createMatch', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to create match',
        variant: 'error',
      });
    }
  }, [api, player2, show, navigate]);

  const openGame = useCallback(
    (id: string) => {
      setMatchId(id);
      setView('game');
      // Update URL with match_id so refresh works
      navigate(`/match?match_id=${id}`, { replace: true });
      loadBoards();
    },
    [loadBoards, navigate],
  );

  useEffect(() => {
    if (view === 'game') {
      loadBoards();
      loadTurnInfo();
    }
  }, [view, loadBoards, loadTurnInfo]);

  const placeShips = useCallback(async () => {
    if (!api) return;
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
      await api.placeShips({ match_id: matchId, ships: groups });
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
  }, [api, matchId, grid, size, show, loadBoards, loadTurnInfo]);

  const proposeShot = useCallback(
    async (shotX?: number, shotY?: number) => {
      if (!api) return;
      if (!matchId) {
        show({ title: 'Set match id first', variant: 'error' });
        return;
      }
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const finalX = shotX !== undefined ? shotX : parseInt(x || '0', 10);
        const finalY = shotY !== undefined ? shotY : parseInt(y || '0', 10);
        await api.proposeShot({ match_id: matchId, x: finalX, y: finalY });
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
    [api, matchId, x, y, show, loadBoards, loadTurnInfo],
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

  // Lobby view
  if (view === 'lobby') {
    return (
      <>
        <MeroNavbar variant="elevated" size="md">
          <NavbarBrand text="Battleship" />
          <NavbarMenu align="center">
            {currentContext && (
              <div
                style={{
                  display: 'flex',
                  gap: '1.5rem',
                  alignItems: 'center',
                  fontSize: '0.875rem',
                  color: '#9ca3af',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Text size="sm" color="muted">
                    Node:
                  </Text>
                  <Text
                    size="sm"
                    style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                  >
                    {currentContext.nodeUrl
                      .replace('http://', '')
                      .replace('https://', '')}
                  </Text>
                  <CopyToClipboard
                    text={currentContext.nodeUrl}
                    variant="icon"
                    size="small"
                    successMessage="Node URL copied!"
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Text size="sm" color="muted">
                    Context ID:
                  </Text>
                  <Text
                    size="sm"
                    style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                  >
                    {currentContext.contextId.slice(0, 8)}...
                    {currentContext.contextId.slice(-8)}
                  </Text>
                  <CopyToClipboard
                    text={currentContext.contextId}
                    variant="icon"
                    size="small"
                    successMessage="Context ID copied!"
                  />
                </div>
                {currentUser && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Text size="sm" color="muted">
                      Public Key:
                    </Text>
                    <Text
                      size="sm"
                      style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                    >
                      {currentUser.slice(0, 8)}...{currentUser.slice(-8)}
                    </Text>
                    <CopyToClipboard
                      text={currentUser}
                      variant="icon"
                      size="small"
                      successMessage="Public Key copied!"
                    />
                  </div>
                )}
              </div>
            )}
          </NavbarMenu>
          <NavbarMenu align="right">
            {isAuthenticated ? (
              <Menu variant="compact" size="md">
                <MenuGroup>
                  <MenuItem onClick={doLogout}>Logout</MenuItem>
                </MenuGroup>
              </Menu>
            ) : (
              <NavbarItem>
                <CalimeroConnectButton
                  connectionType={{
                    type: ConnectionType.Custom,
                    url: 'http://node1.127.0.0.1.nip.io',
                  }}
                />
              </NavbarItem>
            )}
          </NavbarMenu>
        </MeroNavbar>
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
                  maxWidth: '1000px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2rem',
                }}
              >
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
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '1rem',
                      }}
                    >
                      <Input
                        type="text"
                        placeholder="Player 2 public key (Base58)"
                        value={player2}
                        onChange={(e) => setPlayer2(e.target.value)}
                      />
                      <Button type="submit" variant="success">
                        Create
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
                        {myMatches.map((id) => (
                          <div
                            key={id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.75rem',
                              backgroundColor: '#1f2937',
                              borderRadius: '0.5rem',
                            }}
                          >
                            <div>
                              <Text
                                size="sm"
                                style={{ fontFamily: 'monospace' }}
                              >
                                {id}
                              </Text>
                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: '#9ca3af',
                                }}
                              >
                                Click to open
                              </div>
                            </div>
                            <Button
                              variant="primary"
                              onClick={() => openGame(id)}
                            >
                              Open
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </main>
            </GridItem>
          </Grid>
        </div>
      </>
    );
  }

  // Game view
  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="Battleship" />
        <NavbarMenu align="left">
          <Button variant="secondary" onClick={() => setView('lobby')}>
            ← Back to Lobby
          </Button>
        </NavbarMenu>
        <NavbarMenu align="center">
          {currentContext && (
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                alignItems: 'center',
                fontSize: '0.875rem',
                color: '#9ca3af',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Text size="sm" color="muted">
                  Node:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {currentContext.nodeUrl
                    .replace('http://', '')
                    .replace('https://', '')}
                </Text>
                <CopyToClipboard
                  text={currentContext.nodeUrl}
                  variant="icon"
                  size="small"
                  successMessage="Node URL copied!"
                />
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Text size="sm" color="muted">
                  Context ID:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {currentContext.contextId.slice(0, 8)}...
                  {currentContext.contextId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentContext.contextId}
                  variant="icon"
                  size="small"
                  successMessage="Context ID copied!"
                />
              </div>
              {currentUser && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Text size="sm" color="muted">
                    Public Key:
                  </Text>
                  <Text
                    size="sm"
                    style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                  >
                    {currentUser.slice(0, 8)}...{currentUser.slice(-8)}
                  </Text>
                  <CopyToClipboard
                    text={currentUser}
                    variant="icon"
                    size="small"
                    successMessage="Public Key copied!"
                  />
                </div>
              )}
            </div>
          )}
        </NavbarMenu>
        <NavbarMenu align="right">
          {isAuthenticated ? (
            <Menu variant="compact" size="md">
              <MenuGroup>
                <MenuItem onClick={doLogout}>Logout</MenuItem>
              </MenuGroup>
            </Menu>
          ) : (
            <NavbarItem>
              <CalimeroConnectButton
                connectionType={{
                  type: ConnectionType.Custom,
                  url: 'http://node1.127.0.0.1.nip.io',
                }}
              />
            </NavbarItem>
          )}
        </NavbarMenu>
      </MeroNavbar>
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
                    }}
                  >
                    <Text size="sm" color="muted">
                      Status: {placed ? 'Ships placed' : 'Place ships to start'}
                    </Text>
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
