import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import MatchPage from './pages/match';
import Authenticate from './pages/login/Authenticate';

export default function App() {
  const packageName = import.meta.env.VITE_PACKAGE_NAME?.trim() || undefined;
  const registryUrl = import.meta.env.VITE_REGISTRY_URL?.trim() || undefined;

  return (
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={packageName}
      registryUrl={registryUrl}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/match" element={<MatchPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
