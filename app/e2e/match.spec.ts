/**
 * Two-player full-game playthrough against live merod nodes.
 *
 * Drives the entire battleships flow through the UI in two isolated browser
 * contexts — one authed against node-1 (P1), one against node-2 (P2).
 * P1 challenges P2 from the lobby, both deploy fleets, then 33 turns are
 * played from a deterministic shot script that ends with P1 winning.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { envAvailable, getEnv, type NodeEnv } from './helpers/rpc-client';
import { injectMeroAuth } from './helpers/node-client';

const SHIP_PLACEMENTS_P1 = [
  { len: 2, x: 0, y: 0 },
  { len: 3, x: 0, y: 2 },
  { len: 3, x: 0, y: 4 },
  { len: 4, x: 0, y: 6 },
  { len: 5, x: 0, y: 8 },
] as const;

const SHIP_PLACEMENTS_P2 = [
  { len: 2, x: 8, y: 0 },
  { len: 3, x: 7, y: 2 },
  { len: 3, x: 7, y: 4 },
  { len: 4, x: 6, y: 6 },
  { len: 5, x: 5, y: 8 },
] as const;

type Turn = { player: 'p1' | 'p2'; x: number; y: number };

const TURNS: Turn[] = [
  { player: 'p1', x: 8, y: 0 }, // 1
  { player: 'p2', x: 0, y: 0 }, // 2
  { player: 'p1', x: 9, y: 0 }, // 3
  { player: 'p2', x: 1, y: 0 }, // 4
  { player: 'p1', x: 5, y: 8 }, // 5
  { player: 'p2', x: 5, y: 5 }, // 6 miss
  { player: 'p1', x: 7, y: 2 }, // 7
  { player: 'p2', x: 0, y: 2 }, // 8
  { player: 'p1', x: 6, y: 8 }, // 9
  { player: 'p2', x: 3, y: 3 }, // 10 miss
  { player: 'p1', x: 7, y: 4 }, // 11
  { player: 'p2', x: 1, y: 2 }, // 12
  { player: 'p1', x: 8, y: 2 }, // 13
  { player: 'p2', x: 2, y: 2 }, // 14
  { player: 'p1', x: 9, y: 2 }, // 15
  { player: 'p2', x: 5, y: 3 }, // 16 miss
  { player: 'p1', x: 6, y: 6 }, // 17
  { player: 'p2', x: 0, y: 4 }, // 18
  { player: 'p1', x: 7, y: 8 }, // 19
  { player: 'p2', x: 1, y: 4 }, // 20
  { player: 'p1', x: 8, y: 4 }, // 21
  { player: 'p2', x: 7, y: 7 }, // 22 miss
  { player: 'p1', x: 7, y: 6 }, // 23
  { player: 'p2', x: 0, y: 6 }, // 24
  { player: 'p1', x: 8, y: 6 }, // 25
  { player: 'p2', x: 1, y: 6 }, // 26
  { player: 'p1', x: 9, y: 4 }, // 27
  { player: 'p2', x: 9, y: 9 }, // 28 miss
  { player: 'p1', x: 8, y: 8 }, // 29
  { player: 'p2', x: 0, y: 8 }, // 30
  { player: 'p1', x: 9, y: 6 }, // 31
  { player: 'p2', x: 1, y: 8 }, // 32
  { player: 'p1', x: 9, y: 8 }, // 33 — P1 winning hit
];

test.describe('Match (full game playthrough)', () => {
  test.skip(!envAvailable(), 'integration env not available');

  test('two players play a complete game and P1 wins', async ({ browser }) => {
    test.setTimeout(300_000);

    const env = getEnv();

    const p1Ctx = await browser.newContext();
    const p2Ctx = await browser.newContext();

    await seedAuth(p1Ctx, env.node1);
    await seedAuth(p2Ctx, env.node2);

    const p1 = await p1Ctx.newPage();
    const p2 = await p2Ctx.newPage();

    try {
      await openLobby(p1, env.namespaceId);
      await openLobby(p2, env.namespaceId);

      await expect(p1.getByText(/2 members online/i)).toBeVisible({ timeout: 30_000 });
      await expect(p2.getByText(/2 members online/i)).toBeVisible({ timeout: 30_000 });

      await challengeOpponent(p1, env.node2.memberKey);

      await openMatchOnP2(p2);

      await waitForGameView(p1);
      await waitForGameView(p2);

      await placeFleet(p1, SHIP_PLACEMENTS_P1);
      await placeFleet(p2, SHIP_PLACEMENTS_P2);

      await waitForBoardsReady(p1);
      await waitForBoardsReady(p2);

      for (const turn of TURNS) {
        const actor = turn.player === 'p1' ? p1 : p2;
        await waitForMyTurn(actor);
        await fireShot(actor, turn.x, turn.y);
      }

      await expect(p1.getByText('🏆 You won this match.')).toBeVisible({ timeout: 60_000 });
      await expect(p1.getByText('Victory')).toBeVisible();
      await expect(p2.getByText('Match over.')).toBeVisible({ timeout: 60_000 });
      await expect(p2.getByText('Defeat')).toBeVisible();
    } finally {
      await p1Ctx.close();
      await p2Ctx.close();
    }
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

async function seedAuth(ctx: BrowserContext, node: NodeEnv): Promise<void> {
  const env = getEnv();
  await injectMeroAuth(ctx, {
    nodeUrl: node.url,
    accessToken: node.accessToken,
    refreshToken: node.refreshToken,
    memberKey: node.memberKey,
    applicationId: env.applicationId,
    lobbyContextId: env.lobbyContextId,
    namespaceId: env.namespaceId,
  });
}

async function openLobby(page: Page, namespaceId: string): Promise<void> {
  await page.goto(`/lobby?id=${encodeURIComponent(namespaceId)}`);
  await expect(page.getByText('Lobby').first()).toBeVisible({ timeout: 60_000 });
}

async function challengeOpponent(p1: Page, opponentKey: string): Promise<void> {
  const input = p1.getByPlaceholder(/Opponent's executor public key/i);
  await input.fill(opponentKey);
  await p1.getByRole('button', { name: 'Challenge' }).click();
}

async function openMatchOnP2(p2: Page): Promise<void> {
  // The Open button only renders once MatchListUpdated/MatchCreated has
  // synced from node-1 and the match has status=Active with a context_id.
  const openButton = p2.getByRole('button', { name: 'Open' }).first();
  await openButton.waitFor({ timeout: 90_000 });
  await openButton.click();
}

async function waitForGameView(page: Page): Promise<void> {
  await page.waitForURL(/\/match\?/, { timeout: 60_000 });
  // matchApiReady gates Deploy Fleet; this loader card appears while we wait.
  await expect(
    page.getByText('Deploy Fleet').or(page.getByText('Joining match…')),
  ).toBeVisible({ timeout: 60_000 });
}

async function placeFleet(
  page: Page,
  placements: ReadonlyArray<{ len: number; x: number; y: number }>,
): Promise<void> {
  // Wait out the joiner-side sync loader before clicking the placement grid.
  await page.locator('.placement-grid').waitFor({ timeout: 60_000 });

  let lastSelectedLen: number | null = null;
  for (const ship of placements) {
    if (ship.len !== lastSelectedLen) {
      await page.locator(`.ship-btn[data-ship-len="${ship.len}"]`).click();
      lastSelectedLen = ship.len;
    }
    await page
      .locator(`.placement-grid .cell[data-x="${ship.x}"][data-y="${ship.y}"]`)
      .click();
  }

  const deploy = page.getByRole('button', { name: 'Deploy Fleet' });
  await expect(deploy).toBeEnabled({ timeout: 5_000 });
  await deploy.click();
}

async function waitForBoardsReady(page: Page): Promise<void> {
  await page.locator('.shot-grid').waitFor({ timeout: 60_000 });
  await expect(page.getByText('Your Waters')).toBeVisible();
}

async function waitForMyTurn(page: Page): Promise<void> {
  // The shot grid only renders .cell-clickable cells when isMyTurn === true.
  await page.locator('.shot-grid .cell-clickable').first().waitFor({ timeout: 60_000 });
}

async function fireShot(page: Page, x: number, y: number): Promise<void> {
  const cell = page.locator(`.shot-grid .cell[data-x="${x}"][data-y="${y}"]`);
  await expect(cell).toHaveClass(/cell-clickable/, { timeout: 30_000 });
  await cell.click();
  await page.getByRole('button', { name: 'Fire' }).click();

  // Pending → resolved (hit or miss) within sync timeout.
  await expect(cell).toHaveClass(/cell-(hit|miss)/, { timeout: 30_000 });
}
