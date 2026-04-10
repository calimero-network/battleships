import React from 'react';

const COL_LABELS = 'ABCDEFGHIJ';

interface PlacementGridProps {
  size: number;
  grid: boolean[][];
  onCellClick: (x: number, y: number) => void;
}

/**
 * Editable ship placement grid. Cells are either occupied (true) or empty (false).
 */
export default function PlacementGrid({ size, grid, onCellClick }: PlacementGridProps) {
  return (
    <div className="board-container">
      <div className="board-label">Place Your Fleet</div>
      <div className="board-grid-wrapper">
        <div className="coord-row">
          {Array.from({ length: size }, (_, i) => (
            <div className="coord-label" key={i}>{COL_LABELS[i] || i}</div>
          ))}
        </div>
        {Array.from({ length: size }, (_, y) => (
          <div className="board-row" key={y}>
            <div className="row-label">{y + 1}</div>
            {Array.from({ length: size }, (_, x) => (
              <div
                key={`${x}-${y}`}
                className={`cell cell-editable ${grid[y][x] ? 'cell-ship' : 'cell-empty'}`}
                onClick={() => onCellClick(x, y)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
