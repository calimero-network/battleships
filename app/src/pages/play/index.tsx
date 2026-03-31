import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyToClipboard,
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
} from '@calimero-network/mero-ui';
import { useMero } from '@calimero-network/mero-react';
import { createKvClient, AbiClient } from '../../features/kv/api';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';

export default function PlayPage() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    logout,
    mero,
    nodeUrl,
    contextId,
    contextIdentity,
    connectToNode,
  } = useMero();
  const defaultNodeUrl =
    import.meta.env.VITE_NODE_URL?.trim() || 'http://node1.127.0.0.1.nip.io';
  const { show } = useToast();
  const [api, setApi] = useState<AbiClient | null>(null);
  const [currentContext, setCurrentContext] = useState<{
    applicationId: string;
    contextId: string;
    nodeUrl: string;
  } | null>(null);
  const [matchId, setMatchId] = useState<string>('');
  const [x, setX] = useState<string>('0');
  const [y, setY] = useState<string>('0');
  const loadingRef = useRef<boolean>(false);

  const { isSubscribed: isEventSubscribed } = useGameSubscriptions({
    contextId: currentContext?.contextId || '',
    matchId,
  });

  useEffect(() => {
    if (!isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);
  useEffect(() => {
    if (!mero) return;
    (async () => {
      try {
        const { client, context } = await createKvClient(mero, {
          contextId,
          contextIdentity,
        });
        setApi(client);
        setCurrentContext({
          applicationId: context.applicationId,
          contextId: context.contextId,
          nodeUrl: nodeUrl || defaultNodeUrl,
        });
      } catch (e) {
        console.error(e);
        show({ title: 'Failed to init API', variant: 'error' });
      }
    })();
  }, [contextId, contextIdentity, defaultNodeUrl, mero, nodeUrl, show]);

  const propose = useCallback(async () => {
    if (!api) return;
    if (!matchId) {
      show({ title: 'Set match id first', variant: 'error' });
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      await api.proposeShot({
        match_id: matchId,
        x: parseInt(x || '0', 10),
        y: parseInt(y || '0', 10),
      });
      show({ title: 'Shot proposed', variant: 'success' });
    } catch (e) {
      console.error(e);
      show({
        title: e instanceof Error ? e.message : 'Failed to propose',
        variant: 'error',
      });
    } finally {
      loadingRef.current = false;
    }
  }, [api, matchId, x, y, show]);

  const doLogout = useCallback(() => {
    logout();
    navigate('/');
  }, [logout, navigate]);

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
              <Button variant="primary" onClick={() => connectToNode(defaultNodeUrl)}>
                Connect
              </Button>
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
                maxWidth: '800px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2rem',
              }}
            >
              <Card variant="rounded">
                <CardHeader>
                  <CardTitle>Play</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '1rem',
                    }}
                  >
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: isEventSubscribed ? '#10b981' : '#f59e0b',
                      }}
                    />
                    <Text size="sm" color="muted">
                      {isEventSubscribed ? 'Live Updates' : 'Offline'}
                    </Text>
                  </div>
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
                      type="text"
                      placeholder="Match id"
                      value={matchId}
                      onChange={(e) => setMatchId(e.target.value)}
                    />
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
