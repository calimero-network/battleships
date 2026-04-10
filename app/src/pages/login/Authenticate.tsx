import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@calimero-network/mero-ui';
import { useMero, ConnectButton } from '@calimero-network/mero-react';
import translations from '../../constants/en.global.json';

export default function Authenticate() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/lobby');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="app-bg">
      <div className="page-shell">
        <div className="landing-hero">
          <div className="landing-title fade-in">
            <span>Battleships</span>
          </div>

          <p className="landing-subtitle fade-in fade-in-delay-1">
            {translations.home.demoDescription}
          </p>

          <div className="landing-features fade-in fade-in-delay-2">
            {translations.auth.description.features.map((feature, i) => (
              <div className="landing-feature" key={i}>
                <div className="landing-feature-dot" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          <div className="fade-in fade-in-delay-3" style={{ marginTop: '0.5rem' }}>
            <ConnectButton />
          </div>

          <div className="landing-actions fade-in fade-in-delay-4">
            <Button
              variant="secondary"
              onClick={() =>
                window.open('https://docs.calimero.network', '_blank', 'noopener,noreferrer')
              }
            >
              {translations.home.documentation}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                window.open('https://github.com/calimero-network/battleships', '_blank', 'noopener,noreferrer')
              }
            >
              {translations.home.github}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                window.open('https://calimero.network', '_blank', 'noopener,noreferrer')
              }
            >
              {translations.home.website}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
