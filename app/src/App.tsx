import React, { useState } from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import {
  CalimeroProvider,
  AppMode,
  EventStreamMode,
} from '@calimero-network/calimero-client';
import { ToastProvider } from '@calimero-network/mero-ui';

import MatchPage from './pages/match';
import Authenticate from './pages/login/Authenticate';

export default function App() {
  const [clientAppId] = useState<string>(
    'Dn4x5upXDUZseBTLX47T5oP7Agrm2hLzhLH1qCf9Nibo',
  );

  return (
    <CalimeroProvider
      clientApplicationId={clientAppId}
      applicationPath={window.location.pathname || '/'}
      mode={AppMode.MultiContext}
      eventStreamMode={EventStreamMode.SSE}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/match" element={<MatchPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </CalimeroProvider>
  );
}
