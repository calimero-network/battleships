/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'build',
  },
  plugins: [nodePolyfills(), react()],
  test: {
    // Playwright specs in e2e/ run under `playwright test`, not vitest,
    // and would crash here. Keep vitest scoped to src.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'build', 'e2e'],
  },
});
