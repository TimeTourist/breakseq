import { useState } from 'react';
import type { Id, Project } from '../model';
import { setSongBars, setSongCell } from '../model';
import { useProject, useRun } from './context';

export const LOOP_MIME = 'application/x-breakseq-loop';

interface MainCell {
  readonly loopId: Id | null;
  /** The loop that plays in this bar, and which of its bars. */
  readonly plays: { readonly name: string; readonly bar: number } | null;
}

/** What the Main row shows: a loop where one starts, and the running loop's bar after it. */
export function mainCells(project: Project): MainCell[] {
  let running: { name: string; bars: number; start: number } | null = null;
  return project.song.rows.main.map((id, bar) => {
    const loop = id === null ? undefined : project.loops[id];
    if (loop !== undefined) running = { name: loop.name, bars: loop.bars, start: bar };
    return {
      loopId: loop === undefined ? null : loop.id,
      plays: running === null ? null : { name: running.name, bar: ((bar - running.start) % running.bars) + 1 },
    };
  });
}

const DISABLED_LANES = [
  { key: 'F', name: 'Fill', phase: 3 },
  { key: 'A', name: 'Mod A', phase: 4 },
  { key: 'B', name: 'Mod B', phase: 4 },
] as const;

interface SongViewProps {
  readonly playheadBar: number | null;
  readonly rendering: boolean;
  readonly onNewTake: () => void;
}

export function SongView({ playheadBar, rendering, onNewTake }: SongViewProps) {
  const project = useProject();
  const run = useRun();
  const [selected, setSelected] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bars } = project.song;
  const cells = mainCells(project);
  const mains = Object.values(project.loops).filter((l) => l.kind === 'main');
  const columns = { gridTemplateColumns: `130px repeat(${bars}, minmax(44px, 1fr))` };

  const place = (bar: number, loopId: Id | null) => setError(run(setSongCell('main', bar, loopId)));

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>Song</h1>
          <p className="muted">
            Drag a loop onto Main. It loops until the next one starts.{rendering ? ' Rendering…' : ''}
          </p>
        </div>
        <div className="row push">
          <label className="field">
            Bars
            <input
              type="number"
              min={1}
              max={256}
              value={bars}
              onChange={(e) => {
                const value = Math.round(Number(e.target.value));
                if (value >= 1 && value <= 256) run(setSongBars(value));
              }}
            />
          </label>
          <button type="button" onClick={onNewTake}>
            New take
          </button>
          <span className="readout mono" aria-live="off">
            Bar {playheadBar === null ? '–' : playheadBar + 1} / {bars}
          </span>
        </div>
      </div>

      <div className="table-scroll lanes-box">
        <div className="lanes" style={{ minWidth: 130 + bars * 52 }}>
          <div className="lane ruler mono" style={columns}>
            <span className="muted">Bar</span>
            {cells.map((_, bar) => (
              <span key={bar} className={`ruler-cell${bar === playheadBar ? ' now' : ''}${bar % 4 === 0 ? ' downbeat' : ''}`}>
                {bar + 1}
              </span>
            ))}
          </div>

          <div className="lane" style={columns}>
            <div className="lane-name">
              <span className="lane-key main mono">M</span>
              <span className="muted">Main</span>
            </div>
            {cells.map((cell, bar) => {
              const loop = cell.loopId === null ? undefined : project.loops[cell.loopId];
              const label = loop?.name ?? (cell.plays === null ? '' : '·');
              return (
                <button
                  key={bar}
                  type="button"
                  className={`cell${loop !== undefined ? ' start' : cell.plays !== null ? ' running' : ''}${bar === playheadBar ? ' now' : ''}`}
                  aria-label={`Bar ${bar + 1}: ${cell.plays === null ? 'empty' : `${cell.plays.name} bar ${cell.plays.bar}`}`}
                  onClick={() => {
                    if (selected !== null) place(bar, selected);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Delete' || e.key === 'Backspace') && cell.loopId !== null) {
                      e.preventDefault();
                      place(bar, null);
                    }
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(LOOP_MIME)) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData(LOOP_MIME);
                    if (id !== '') {
                      e.preventDefault();
                      place(bar, id);
                    }
                  }}
                >
                  <span className="cell-label">{label}</span>
                  <span className="cell-sub">{cell.plays === null ? '' : `bar ${cell.plays.bar}`}</span>
                </button>
              );
            })}
          </div>

          {DISABLED_LANES.map((lane) => (
            <div key={lane.key} className="lane disabled" style={columns} aria-disabled="true">
              <div className="lane-name">
                <span className="lane-key mono">{lane.key}</span>
                <span className="muted">
                  {lane.name} · phase {lane.phase}
                </span>
              </div>
              {cells.map((_, bar) => (
                <span key={bar} className="cell empty" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel stack">
        <h2 className="label">Drag onto Main</h2>
        {mains.length === 0 ? (
          <p className="muted">No loops yet. Slice a break to get M1.</p>
        ) : (
          <div className="row">
            {mains.map((loop) => (
              <button
                key={loop.id}
                type="button"
                draggable
                className="chip mono"
                aria-pressed={selected === loop.id}
                onClick={() => setSelected(selected === loop.id ? null : loop.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(LOOP_MIME, loop.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                {loop.name}
              </button>
            ))}
            <span className="muted small">
              {selected === null ? 'Or select a loop, then click bars.' : 'Click bars to place. Delete clears a focused bar.'}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
