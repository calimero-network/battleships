import React from 'react';
import {
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
  Button,
  CopyToClipboard,
} from '@calimero-network/mero-ui';
import { ConnectButton } from '@calimero-network/mero-react';

interface NavBarProps {
  namespaceName?: string | null;
  namespaceId?: string | null;
  contextId?: string | null;
  currentUser?: string | null;
  onLogout: () => void;
  onBack?: () => void;
  extra?: React.ReactNode;
}

function truncate(s: string) {
  if (s.length <= 16) return s;
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

export default function NavBar({
  namespaceName, namespaceId, contextId, currentUser, onLogout, onBack, extra,
}: NavBarProps) {
  return (
    <MeroNavbar variant="elevated" size="md">
      {onBack ? (
        <NavbarItem>
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              padding: '0.35rem 0.5rem',
              borderRadius: '6px',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <span style={{ fontSize: '1rem' }}>&larr;</span>
            Back
          </button>
        </NavbarItem>
      ) : null}
      <NavbarBrand text="Battleships" />
      <NavbarMenu align="center">
        {namespaceId && (
          <div className="info-row">
            {namespaceName && (
              <div className="info-pair">
                <span className="info-label">NS</span>
                <span className="info-value">{namespaceName}</span>
              </div>
            )}
            {contextId && (
              <div className="info-pair">
                <span className="info-label">CTX</span>
                <span className="info-value">{truncate(contextId)}</span>
                <CopyToClipboard
                  text={contextId}
                  variant="icon"
                  size="small"
                  successMessage="Copied!"
                />
              </div>
            )}
            {currentUser && (
              <div className="info-pair">
                <span className="info-label">KEY</span>
                <span className="info-value">{truncate(currentUser)}</span>
                <CopyToClipboard
                  text={currentUser}
                  variant="icon"
                  size="small"
                  successMessage="Copied!"
                />
              </div>
            )}
          </div>
        )}
        {extra}
      </NavbarMenu>
      <NavbarMenu align="right">
        <NavbarItem>
          <ConnectButton />
        </NavbarItem>
        <NavbarItem>
          <Button variant="secondary" onClick={onLogout}>
            Logout
          </Button>
        </NavbarItem>
      </NavbarMenu>
    </MeroNavbar>
  );
}
