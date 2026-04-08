export const SHIP_TARGETS = [1, 2, 1, 1] as const;

export function resolveEffectiveMatchId(
  lobbyMatchId: string,
  runtimeMatchId: string | null,
): string {
  if (runtimeMatchId && runtimeMatchId.trim().length > 0) {
    return runtimeMatchId;
  }
  return lobbyMatchId;
}

function parseShipPoints(ship: string): Array<{ x: number; y: number }> | null {
  const cells = ship.split(';');
  if (cells.length < 2 || cells.length > 5) return null;

  const points = cells.map((cell) => {
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    return { x, y };
  });

  if (points.some(({ x, y }) => Number.isNaN(x) || Number.isNaN(y))) {
    return null;
  }
  return points;
}

function isStraightContiguousShip(ship: string): boolean {
  const points = parseShipPoints(ship);
  if (!points) return false;

  const sameX = points.every(({ x }) => x === points[0].x);
  const sameY = points.every(({ y }) => y === points[0].y);
  if (!(sameX || sameY)) return false;

  if (sameX) {
    const ys = points.map((p) => p.y).sort((a, b) => a - b);
    return ys.every((value, idx) => idx === 0 || value === ys[idx - 1] + 1);
  }

  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  return xs.every((value, idx) => idx === 0 || value === xs[idx - 1] + 1);
}

export function validateFleetPayload(ships: string[]): string | null {
  const counts = [0, 0, 0, 0]; // lengths 2..5
  const cellOwner = new Map<string, number>();

  for (const [shipIdx, ship] of ships.entries()) {
    const length = ship.split(';').length;
    if (length < 2 || length > 5) {
      return 'Ship length must be between 2 and 5';
    }

    if (!isStraightContiguousShip(ship)) {
      return `Invalid ship shape (${ship}). Ships must be straight and contiguous.`;
    }

    const points = parseShipPoints(ship);
    if (!points) return 'Invalid ship coordinates';

    for (const { x, y } of points) {
      const key = `${x},${y}`;
      if (cellOwner.has(key)) {
        return 'Ships cannot overlap each other.';
      }
      cellOwner.set(key, shipIdx);
    }

    counts[length - 2] += 1;
  }

  for (const [key, owner] of cellOwner.entries()) {
    const [xRaw, yRaw] = key.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const neighborOwner = cellOwner.get(`${x + dx},${y + dy}`);
        if (neighborOwner !== undefined && neighborOwner !== owner) {
          return 'Ships cannot be adjacent, including diagonals.';
        }
      }
    }
  }

  for (let i = 0; i < SHIP_TARGETS.length; i += 1) {
    if (counts[i] !== SHIP_TARGETS[i]) {
      return `Fleet must be 1x2, 2x3, 1x4, 1x5 ships.`;
    }
  }

  return null;
}
