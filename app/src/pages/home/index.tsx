import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Button,
  Input,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  Grid,
  GridItem,
  Menu,
  MenuItem,
  MenuGroup,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  useToast,
  CopyToClipboard,
  Text,
} from '@calimero-network/mero-ui';
import { useNavigate } from 'react-router-dom';
import {
  useCalimero,
  CalimeroConnectButton,
  ConnectionType,
} from '@calimero-network/calimero-client';
import { createKvClient, AbiClient } from '../../features/kv/api';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';

type BoardView = { size: number; own: number[]; shots: number[] };

export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated, logout, app, appUrl } = useCalimero();
  const { show } = useToast();

  // Match form / selection
  const [matchId, setMatchId] = useState<string>('');
  const [player2, setPlayer2] = useState<string>('');

  // Placement / play form
  const [me, setMe] = useState<string>('');
  const [shipsCsv, setShipsCsv] = useState<string>(
    '0,0;0,1;0,2|3,3;4,3;5,3;6,3',
  );
  const [targetX, setTargetX] = useState<string>('1');
  const [targetY, setTargetY] = useState<string>('1');

  // Data
  const [api, setApi] = useState<AbiClient | null>(null);
  const [currentContext, setCurrentContext] = useState<{
    applicationId: string;
    contextId: string;
    nodeUrl: string;
  } | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const loadingRef = useRef<boolean>(false);

  // Game event subscriptions
  const { isSubscribed: isEventSubscribed } = useGameSubscriptions({
    contextId: currentContext?.contextId || '',
    matchId,
    onBoardUpdate: () => {
      // Auto-refresh board when events occur
      refreshBoard();
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!app) return;
    const initializeApi = async () => {
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
        // fetch active match id if any
        try {
          const activeId = await client.getActiveMatchId();
          if (activeId) {
            setMatchId(activeId);
          }
        } catch (e) {
          // ignore if method not available yet or no active match
        }
      } catch (error) {
        console.error('Failed to create API client:', error);
        window.alert('Failed to initialize API client');
      }
    };
    initializeApi();
  }, [app, appUrl]);

  const refreshBoard = useCallback(async () => {
    if (loadingRef.current || !api) return;
    if (!matchId) {
      show({ title: 'Set Active match id first', variant: 'error' });
      return;
    }
    loadingRef.current = true;
    try {
      const own = await api.getOwnBoard({ match_id: matchId });
      const shots = await api.getShots({ match_id: matchId });
      setBoard({
        size: own.size,
        own: own.board.toArray(),
        shots: shots.shots.toArray(),
      });
    } catch (e) {
      console.error('refreshBoard error', e);
      show({ title: 'Failed to load board', variant: 'error' });
    } finally {
      loadingRef.current = false;
    }
  }, [api, me, matchId, show]);

  const createMatch = useCallback(async () => {
    if (!api) return;
    try {
      const id = await api.createMatch({ player2 });
      setMatchId(id);
      show({ title: `Match created: ${id}`, variant: 'success' });
      await refreshBoard();
    } catch (e) {
      console.error('createMatch', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to create match',
        variant: 'error',
      });
    }
  }, [api, player2, refreshBoard, show]);

  const placeShips = useCallback(async () => {
    if (!api) return;
    try {
      // shipsCsv format: groups separated by |, positions in group separated by ;, coords x,y
      const groups = shipsCsv
        .split('|')
        .map((g) => g.trim())
        .filter(Boolean)
        .map((g) => g);
      await api.placeShips({ match_id: matchId, ships: groups });
      show({ title: 'Ships placed', variant: 'success' });
      await refreshBoard();
    } catch (e) {
      console.error('placeShips', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to place ships',
        variant: 'error',
      });
    }
  }, [api, shipsCsv, matchId, refreshBoard, show]);

  const propose = useCallback(async () => {
    if (!api) return;
    try {
      const x = parseInt(targetX || '0', 10);
      const y = parseInt(targetY || '0', 10);
      await api.proposeShot({ match_id: matchId, x, y });
      show({ title: `Shot proposed at (${x},${y})`, variant: 'success' });
      await refreshBoard();
    } catch (e) {
      console.error('propose', e);
      show({
        title: e instanceof Error ? e.message : 'Failed to propose shot',
        variant: 'error',
      });
    }
  }, [api, targetX, targetY, matchId, refreshBoard, show]);

  const agreeEnd = useCallback(async () => {
    show({ title: 'End flow not implemented in contract', variant: 'warning' });
  }, [show]);

  useEffect(() => {
    if (isAuthenticated && api) {
      refreshBoard();
    }
  }, [isAuthenticated, api, refreshBoard]);

  const doLogout = useCallback(() => {
    logout();
    navigate('/');
  }, [logout, navigate]);

  const renderBoard = (
    cells: number[] | undefined,
    size: number | undefined,
    title: string,
  ) => {
    if (!cells || !size) {
      return <div style={{ color: '#aaa', padding: '1rem' }}>No board</div>;
    }
    return (
      <div>
        <div style={{ marginBottom: '0.5rem', color: '#9ca3af' }}>{title}</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${size}, 28px)`,
            gap: '4px',
          }}
        >
          {cells.map((v, i) => {
            const bg =
              v === 4
                ? '#f59e0b'
                : v === 2
                  ? '#ef4444'
                  : v === 3
                    ? '#374151'
                    : v === 1
                      ? '#10b981'
                      : '#1f2937';
            return (
              <div
                key={i}
                style={{
                  width: 28,
                  height: 28,
                  background: bg,
                  borderRadius: 4,
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };

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
                  App ID:
                </Text>
                <Text
                  size="sm"
                  style={{ fontFamily: 'monospace', color: '#e5e7eb' }}
                >
                  {currentContext.applicationId.slice(0, 8)}...
                  {currentContext.applicationId.slice(-8)}
                </Text>
                <CopyToClipboard
                  text={currentContext.applicationId}
                  variant="icon"
                  size="small"
                  successMessage="Application ID copied!"
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
                  <CardTitle>Create Match</CardTitle>
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
                      placeholder="Active match id (optional)"
                      value={matchId}
                      onChange={(e) => setMatchId(e.target.value)}
                    />
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
                  <CardTitle>Place Ships</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      placeShips();
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
                      placeholder="Me (optional label)"
                      value={me}
                      onChange={(e) => setMe(e.target.value)}
                    />
                    <Input
                      type="text"
                      placeholder="Ships CSV groups (| separated)"
                      value={shipsCsv}
                      onChange={(e) => setShipsCsv(e.target.value)}
                    />
                    <Button type="submit" variant="primary">
                      Place
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={refreshBoard}
                    >
                      Refresh
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>Match Controls</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '1rem',
                    }}
                  >
                    <Button type="button" variant="warning" onClick={agreeEnd}>
                      Agree End
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={refreshBoard}
                    >
                      Refresh
                    </Button>
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
                  <CardContent>
                    {renderBoard(
                      board?.own,
                      board?.size,
                      'Own (green=ship, red=hit, gray=miss)',
                    )}
                  </CardContent>
                </Card>
                <Card variant="rounded">
                  <CardHeader>
                    <CardTitle>Your Shots</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderBoard(
                      board?.shots,
                      board?.size,
                      'Shots (yellow=pending, red=hit, gray=miss)',
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>Fire</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      propose();
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '1rem',
                    }}
                  >
                    <Input
                      type="number"
                      placeholder="X"
                      value={targetX}
                      onChange={(e) => setTargetX(e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Y"
                      value={targetY}
                      onChange={(e) => setTargetY(e.target.value)}
                    />
                    <Button type="submit" variant="success">
                      Propose Shot
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
