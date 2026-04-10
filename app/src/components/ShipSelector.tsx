import React from 'react';

interface ShipSelectorProps {
  selectedShip: number | null;
  shipCounts: number[];
  shipTargets: number[];
  isHorizontal: boolean;
  isRemovalMode: boolean;
  onSelectShip: (idx: number | null) => void;
  onSetHorizontal: (h: boolean) => void;
  onToggleRemoval: () => void;
}

/**
 * Ship length selector with orientation toggle and removal mode.
 * Ship index maps to length: idx 0 = length 2, idx 1 = length 3, etc.
 */
export default function ShipSelector({
  selectedShip, shipCounts, shipTargets,
  isHorizontal, isRemovalMode,
  onSelectShip, onSetHorizontal, onToggleRemoval,
}: ShipSelectorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="ship-selector">
        {[2, 3, 4, 5].map((len, idx) => {
          const active = selectedShip === idx;
          const full = shipCounts[idx] >= shipTargets[idx];
          return (
            <button
              key={len}
              className={`ship-btn ${active ? 'ship-btn-active' : ''}`}
              disabled={full}
              onClick={() => onSelectShip(active ? null : idx)}
            >
              <span className="ship-dots">
                {Array.from({ length: len }, (_, i) => (
                  <span className="ship-dot" key={i} />
                ))}
              </span>
              <span>{shipCounts[idx]}/{shipTargets[idx]}</span>
            </button>
          );
        })}
        <button
          className={`ship-btn ship-btn-remove ${isRemovalMode ? 'ship-btn-active' : ''}`}
          onClick={onToggleRemoval}
        >
          Remove
        </button>
      </div>

      {selectedShip !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="orient-toggle">
            <button
              className={`orient-btn ${isHorizontal ? 'orient-btn-active' : ''}`}
              onClick={() => onSetHorizontal(true)}
            >
              Horiz
            </button>
            <button
              className={`orient-btn ${!isHorizontal ? 'orient-btn-active' : ''}`}
              onClick={() => onSetHorizontal(false)}
            >
              Vert
            </button>
          </div>
          <span className="mono-sm">
            Placing {selectedShip + 2}-cell ship {isHorizontal ? 'horizontally' : 'vertically'}
          </span>
        </div>
      )}

      {isRemovalMode && (
        <span className="mono-sm" style={{ color: 'var(--fire-amber)' }}>
          Click a ship to remove it
        </span>
      )}
    </div>
  );
}
