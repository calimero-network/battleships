import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Grid,
  GridItem,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  List,
} from '@calimero-network/mero-ui';
import {
  useCalimero,
  CalimeroConnectButton,
  ConnectionType,
} from '@calimero-network/calimero-client';
import translations from '../../constants/en.global.json';

export default function Authenticate() {
  const navigate = useNavigate();
  const { isAuthenticated } = useCalimero();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/match');
    }
  }, [isAuthenticated, navigate]);

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="KV Store" />
        <NavbarMenu align="right">
          <NavbarItem>
            <CalimeroConnectButton connectionType={ConnectionType.Remote} />
          </NavbarItem>
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
          columns={12}
          gap={16}
          maxWidth="100%"
          justify="center"
          align="center"
          style={{ minHeight: '100vh', padding: '2rem 1rem' }}
        >
          <GridItem colSpan={12} colStart={1}>
            <main
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '80vh',
              }}
            >
              <div style={{ width: '100%', maxWidth: '800px' }}>
                <Card
                  variant="rounded"
                  style={{
                    background:
                      'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
                    border: '1px solid #4b5563',
                    boxShadow:
                      '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  <CardHeader
                    style={{
                      background:
                        'linear-gradient(135deg, #374151 0%, #4b5563 100%)',
                      borderBottom: '1px solid #6b7280',
                      padding: '1.5rem',
                    }}
                  >
                    <CardTitle
                      style={{
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        background:
                          'linear-gradient(135deg, #ffffff 0%, #e5e7eb 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textAlign: 'center',
                        margin: 0,
                      }}
                    >
                      {translations.auth.description.subtitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent style={{ padding: '1.5rem' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div
                        style={{
                          background: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          borderRadius: '8px',
                          padding: '1rem',
                          marginBottom: '1rem',
                        }}
                      >
                        <p
                          style={{
                            color: '#e5e7eb',
                            marginBottom: 0,
                            fontSize: '1rem',
                            lineHeight: '1.5',
                            textAlign: 'center',
                            fontWeight: '500',
                          }}
                        >
                          {translations.home.demoDescription}
                        </p>
                      </div>

                      <div
                        style={{
                          background: 'rgba(16, 185, 129, 0.1)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          borderRadius: '8px',
                          padding: '1rem',
                        }}
                      >
                        <h3
                          style={{
                            color: '#10b981',
                            marginBottom: '1rem',
                            fontSize: '1.1rem',
                            textAlign: 'center',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          ✨ Key Features
                        </h3>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: '0.75rem',
                            maxWidth: '700px',
                            margin: '0 auto',
                          }}
                        >
                          {translations.auth.description.features.map(
                            (feature, index) => (
                              <div
                                key={index}
                                style={{
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '6px',
                                  padding: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                }}
                              >
                                <div
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    background:
                                      'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                    flexShrink: 0,
                                  }}
                                />
                                <span
                                  style={{
                                    color: '#e5e7eb',
                                    fontSize: '0.85rem',
                                    lineHeight: '1.4',
                                    fontWeight: '500',
                                  }}
                                >
                                  {feature}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                        marginTop: '1.5rem',
                        padding: '1rem',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <Button
                        variant="primary"
                        onClick={() =>
                          window.open(
                            'https://docs.calimero.network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                          background:
                            'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)',
                          transition: 'all 0.2s ease-in-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.style.boxShadow =
                            '0 6px 12px -3px rgba(59, 130, 246, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow =
                            '0 4px 6px -1px rgba(59, 130, 246, 0.3)';
                        }}
                      >
                        📚 {translations.home.documentation}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          window.open(
                            'https://github.com/calimero-network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                          background:
                            'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          boxShadow: '0 4px 6px -1px rgba(107, 114, 128, 0.3)',
                          transition: 'all 0.2s ease-in-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.style.boxShadow =
                            '0 6px 12px -3px rgba(107, 114, 128, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow =
                            '0 4px 6px -1px rgba(107, 114, 128, 0.3)';
                        }}
                      >
                        🐙 {translations.home.github}
                      </Button>
                      <Button
                        variant="info"
                        onClick={() =>
                          window.open(
                            'https://calimero.network',
                            '_blank',
                            'noopener,noreferrer',
                          )
                        }
                        style={{
                          minWidth: '140px',
                          minHeight: '2.5rem',
                          background:
                            'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          boxShadow: '0 4px 6px -1px rgba(6, 182, 212, 0.3)',
                          transition: 'all 0.2s ease-in-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.style.boxShadow =
                            '0 6px 12px -3px rgba(6, 182, 212, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow =
                            '0 4px 6px -1px rgba(6, 182, 212, 0.3)';
                        }}
                      >
                        🌐 {translations.home.website}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </main>
          </GridItem>
        </Grid>
      </div>
    </>
  );
}
