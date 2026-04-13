import React from 'react';

const COL_LABELS = 'ABCDEFGHIJ';

interface ShotGridProps {
  size: number;
  shots: number[];
  isMyTurn: boolean;
  selectedX: number | null;
  selectedY: number | null;
  onCellClick: (x: number, y: number) => void;
}

/**
 * Interactive shots grid — the opponent's board from your perspective.
 * Click empty cells to select a target when it's your turn.
 * Cell values: 0=empty, 2=hit, 3=miss, 4=pending
 */
export default function ShotGrid({
  size, shots, isMyTurn, selectedX, selectedY, onCellClick,
}: ShotGridProps) {
  const cellClass = (val: number, x: number, y: number): string => {
    const isSelected = selectedX === x && selectedY === y;
    if (isSelected) return 'cell cell-selected';
    switch (val) {
      case 2: return 'cell cell-hit';
      case 3: return 'cell cell-miss';
      case 4: return 'cell cell-pending';
      default: return `cell cell-empty${isMyTurn && val === 0 ? ' cell-clickable' : ''}`;
    }
  };

  return (
    <div className="board-container">
      <div className="board-label">
        Shots Fired
        {isMyTurn && (
          <span className="turn-indicator turn-yours" style={{ marginLeft: '0.75rem' }}>
            <span className="turn-dot" />
            Your Turn
          </span>
        )}
        {!isMyTurn && (
          <span className="turn-indicator turn-theirs" style={{ marginLeft: '0.75rem' }}>
            <span className="turn-dot" />
            Waiting
          </span>
        )}
      </div>
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
              const val = shots[y * size + x] || 0;
              const clickable = isMyTurn && val === 0;
              return (
                <div
                  key={`${x}-${y}`}
                  className={cellClass(val, x, y)}
                  onClick={() => clickable && onCellClick(x, y)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="board-legend">
        <LegendItem color="var(--grid-cell)" text="Unknown" />
        <LegendItem color="#8b1a1a" text="Hit" />
        <LegendItem color="var(--miss-blue-dim)" text="Miss" />
        <LegendItem color="rgba(34, 211, 238, 0.3)" text="Selected" />
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
