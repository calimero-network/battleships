/**
 * Playwright global setup.
 *
 * Loads app/.env.integration into process.env so workers can read E2E_* vars
 * via getEnv() without per-test plumbing. The file is written by the
 * integration-ci.yml job after merobox boots two nodes and credentials are
 * minted; running the suite locally without it is fine — every integration
 * spec calls envAvailable() and skips when the file is absent.
 *
 * INTEGRATION_MODE=true (set by ci) tells this hook there is no browser-driven
 * auth flow to run; tokens are injected per-test via injectMeroAuth.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { FullConfig } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const envPath = path.join(__dirname, '..', '.env.integration');
  if (!fs.existsSync(envPath)) {
    if (process.env.INTEGRATION_MODE === 'true') {
      throw new Error(
        `INTEGRATION_MODE=true but ${envPath} is missing — ` +
          'check the auth-bootstrap step in integration-ci.yml',
      );
    }
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}
