import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@calimero-network/mero-ui';
import {
  CalimeroConnectButton,
  ConnectionType,
  useCalimero,
} from '@calimero-network/calimero-client';
import { createKvClient, AbiClient } from '../../features/kv/api';

export default function PlayPage() {
  const navigate = useNavigate();
  const { isAuthenticated, logout, app } = useCalimero();
  const { show } = useToast();
  const [api, setApi] = useState<AbiClient | null>(null);
  const [matchId, setMatchId] = useState<string>('');
  const [x, setX] = useState<string>('0');
  const [y, setY] = useState<string>('0');
  const loadingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAuthenticated) navigate('/');
  }, [isAuthenticated, navigate]);
  useEffect(() => {
    if (!app) return;
    (async () => {
      try {
        setApi(await createKvClient(app));
      } catch (e) {
        console.error(e);
        show({ title: 'Failed to init API', variant: 'error' });
      }
    })();
  }, [app, show]);

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
