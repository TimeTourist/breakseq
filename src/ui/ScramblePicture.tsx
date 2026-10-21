import type { CSSProperties } from 'react';
import type { ScramblePicture as Picture } from '../engine';

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
/** A colour per cell of the song, the same wherever the cell plays. */
const colour = (cell: number) => `hsl(${Math.round((cell * 137.508) % 360)} 30% ${32 + ((cell * 7) % 17)}%)`;

/**
 * Where each cell comes from (see Mods som samplar det som hörs, and the
 * sketch): on top the song Play renders, cut in cells, with Take from dashed;
 * below the clip's cells, each swapped cell with an arrow from the cell it
 * plays, blue and ◂ when it plays backwards. Faint cells play as heard.
 */
export function ScramblePicture({ picture, onReroll }: { readonly picture: Picture | null; readonly onReroll: () => void }) {
  const swapped = picture?.cells.filter((c) => c.from !== null).length ?? 0;
  return (
    <div className="scramble-picture">
      <div className="scramble-picture-head">
        <span className="label">Where each cell comes from</span>
        <span className="mono small muted">{picture === null ? 'Make a loop in Loops to see it' : `${swapped} of ${picture.cells.length} cells swapped`}</span>
        <button type="button" className="small-button push" title="Reroll: every cell picks again (undo brings the previous roll back)" onClick={onReroll}>
          🎲 Reroll
        </button>
      </div>
      {picture !== null && <Cells picture={picture} />}
      <p className="muted small">
        Top: the song cut in cells; the dashed box is Take from. Bottom: the clip’s cells; each swapped cell plays the one its arrow comes from, ◂ and a blue arrow reversed. Faint cells play as heard. The lane above sets each step’s chance to swap.
      </p>
    </div>
  );
}

function Cells({ picture }: { readonly picture: Picture }) {
  const n = picture.songCells;
  const cellStyle = (index: number, top: number, from: number, faint: boolean): CSSProperties => ({
    top,
    left: `calc(${pct(index / n)} + 1px)`,
    width: `calc(${pct(1 / n)} - 2px)`,
    background: colour(from),
    opacity: faint ? 0.3 : 1,
  });
  const x = (index: number) => (((index + 0.5) / n) * 1000).toFixed(1);
  const arrow = (from: number, to: number) => {
    const a = x(from);
    const b = x(to);
    return `M${a} 56C${a} 100 ${b} 76 ${b} 118M${(+b - 5).toFixed(1)} 110L${b} 118L${(+b + 5).toFixed(1)} 110`;
  };
  const forward = picture.cells.filter((c) => c.from !== null && !c.reversed).map((c) => arrow(c.from!, c.cell));
  const backward = picture.cells.filter((c) => c.from !== null && c.reversed).map((c) => arrow(c.from!, c.cell));
  const cellsPerBar = 16 / picture.cell;
  return (
    <div className="scramble-cells" role="img" aria-label={`The song in ${n} cells; the clip’s cells and where each comes from`}>
      {Array.from({ length: picture.bars }, (_, b) => (
        <span key={b} className="scramble-bar" style={{ left: `calc(${pct((b * cellsPerBar) / n)} + 4px)` }}>
          bar {b + 1}
        </span>
      ))}
      <span className="scramble-range" title="Take from: the cells a swapped cell can come from" style={{ left: pct(picture.range.start / n), width: pct((picture.range.end - picture.range.start) / n) }} />
      <span className="scramble-clip" title="The clip" style={{ left: pct(picture.clip.start / n), width: pct((picture.clip.end - picture.clip.start) / n) }} />
      <span className="scramble-clip-label" style={{ left: `calc(${pct(picture.clip.start / n)} + 4px)` }}>
        clip
      </span>
      {Array.from({ length: n }, (_, i) => {
        const inRange = i >= picture.range.start && i < picture.range.end;
        return <span key={i} className="scramble-cell" title={`Song cell ${i + 1}${inRange ? ', in Take from' : ', outside Take from'}`} style={cellStyle(i, 18, i, !inRange)} />;
      })}
      <svg aria-hidden="true" viewBox="0 0 1000 172" preserveAspectRatio="none">
        <path d={forward.join('') || 'M0 0'} className="scramble-arrow" vectorEffect="non-scaling-stroke" />
        <path d={backward.join('') || 'M0 0'} className="scramble-arrow back" vectorEffect="non-scaling-stroke" />
      </svg>
      {picture.cells.map((c) => (
        <span
          key={c.cell}
          className={`scramble-cell${c.reversed ? ' reversed' : ''}`}
          title={`Clip cell ${c.cell - picture.clip.start + 1}: ${c.from === null ? 'as heard' : `plays song cell ${c.from + 1}${c.reversed ? ', reversed' : ''}`}`}
          style={cellStyle(c.cell, 120, c.from ?? c.cell, c.from === null)}
        >
          {c.reversed ? '◂' : ''}
        </span>
      ))}
    </div>
  );
}
