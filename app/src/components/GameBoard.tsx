import React from 'react';

const COL_LABELS = 'ABCDEFGHIJ';

interface GameBoardProps {
  size: number;
  board: number[];
  label: string;
  /** If set, overlay a pending-shot marker at this coordinate */
  pendingShot?: { x: number; y: number } | null;
}

/**
 * Read-only board showing the player's own ships, hits, misses, and pending shots.
 * Cell values: 0=empty, 1=ship, 2=hit, 3=miss, 4=pending
 */
export default function GameBoard({ size, board, label, pendingShot }: GameBoardProps) {
  const cellClass = (val: number, x: number, y: number): string => {
    if (pendingShot && pendingShot.x === x && pendingShot.y === y && val !== 2) {
      return 'cell cell-pending';
    }
    switch (val) {
      case 1: return 'cell cell-ship';
      case 2: return 'cell cell-hit';
      case 3: return 'cell cell-miss';
      case 4: return 'cell cell-pending';
      default: return 'cell cell-empty';
    }
  };

  return (
    <div className="board-container">
      <div className="board-label">{label}</div>
      <div className="board-grid-wrapper">
        <div className="coord-row">
          {Array.from({ length: size }, (_, i) => (
            <div className="coord-label" key={i}>{COL_LABELS[i] || i}</div>
          ))}
        </div>
        {Array.from({ length: size }, (_, y) => (
          <div className="board-row" key={y}>
            <div className="row-label">{y + 1}</div>
            {Array.from({ length: size }, (_, x) => {
              const val = board[y * size + x] || 0;
              return <div key={`${x}-${y}`} className={cellClass(val, x, y)} />;
            })}
          </div>
        ))}
      </div>
      <div className="board-legend">
        <LegendItem color="var(--grid-cell)" text="Water" />
        <LegendItem color="#1a6b4a" text="Ship" />
        <LegendItem color="#8b1a1a" text="Hit" />
        <LegendItem color="var(--miss-blue-dim)" text="Miss" />
        <LegendItem color="rgba(251, 191, 36, 0.4)" text="Incoming" />
      </div>
    </div>
  );
}

function LegendItem({ color, text }: { color: string; text: string }) {
  return (
    <div className="legend-item">
      <div className="legend-swatch" style={{ background: color }} />
      {text}
    </div>
  );
}
