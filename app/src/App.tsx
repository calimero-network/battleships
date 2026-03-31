import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppMode, MeroProvider } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import MatchPage from './pages/match';
import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';
import PlayPage from './pages/play';

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
            <Route path="/home" element={<HomePage />} />
            <Route path="/match" element={<MatchPage />} />
            <Route path="/play" element={<PlayPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
