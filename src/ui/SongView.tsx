import { useState } from 'react';
import type { Id, LoopKind, Project } from '../model';
import { setSongBars, setSongCell } from '../model';
import { useProject, useRun } from './context';

export const LOOP_MIME = 'application/x-breakseq-loop';

interface LaneCell {
  readonly loopId: Id | null;
  /** The loop that covers this bar, and which of its bars. */
  readonly plays: { readonly name: string; readonly bar: number } | null;
  /** A main under a fill: not heard. */
  readonly hidden: boolean;
}

/**
 * What a lane shows. Main: a loop runs until the next one starts. Fill: a loop
 * covers as many bars as it is long, and hides the main under it.
 */
export function laneCells(project: Project, kind: LoopKind): LaneCell[] {
  const fills = kind === 'main' ? laneCells(project, 'fill') : null;
  let running: { name: string; bars: number; start: number } | null = null;
  return project.song.rows[kind].map((id, bar) => {
    const loop = id === null ? undefined : project.loops[id];
    if (loop !== undefined) running = { name: loop.name, bars: loop.bars, start: bar };
    const covers = running !== null && (kind === 'main' || bar - running.start < running.bars);
    return {
      loopId: loop === undefined ? null : loop.id,
      plays: !covers || running === null ? null : { name: running.name, bar: ((bar - running.start) % running.bars) + 1 },
      hidden: fills?.[bar]?.plays != null,
    };
  });
}

/** The Main row, as before fills existed. */
export const mainCells = (project: Project) => laneCells(project, 'main');

const DISABLED_LANES = [
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
  const columns = { gridTemplateColumns: `130px repeat(${bars}, minmax(44px, 1fr))` };
  const loops = Object.values(project.loops);

  const place = (kind: LoopKind, bar: number, loopId: Id | null) => setError(run(setSongCell(kind, bar, loopId)));

  const lane = (kind: LoopKind) => {
    const cells = laneCells(project, kind);
    return (
      <div className="lane" style={columns}>
        <div className="lane-name">
          <span className={`lane-key ${kind} mono`}>{kind === 'main' ? 'M' : 'F'}</span>
          <span className="muted">{kind === 'main' ? 'Main' : 'Fill'}</span>
        </div>
        {cells.map((cell, bar) => {
          const loop = cell.loopId === null ? undefined : project.loops[cell.loopId];
          const label = loop?.name ?? (cell.plays === null ? '' : '·');
          const sub = cell.plays === null ? '' : cell.hidden ? 'hidden' : kind === 'fill' && loop !== undefined ? 'replaces' : `bar ${cell.plays.bar}`;
          const state = loop !== undefined ? ' start' : cell.plays !== null ? ' running' : '';
          return (
            <button
              key={bar}
              type="button"
              className={`cell ${kind}${state}${cell.hidden ? ' hidden' : ''}${bar === playheadBar ? ' now' : ''}`}
              aria-label={`${kind === 'main' ? 'Bar' : 'Fill bar'} ${bar + 1}: ${
                cell.plays === null ? 'empty' : `${cell.plays.name} bar ${cell.plays.bar}${cell.hidden ? ', hidden by fill' : ''}`
              }`}
              onClick={() => {
                if (selected !== null) place(kind, bar, selected);
              }}
              onKeyDown={(e) => {
                if ((e.key === 'Delete' || e.key === 'Backspace') && cell.loopId !== null) {
                  e.preventDefault();
                  place(kind, bar, null);
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(LOOP_MIME)) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(LOOP_MIME);
                if (id !== '') {
                  e.preventDefault();
                  place(kind, bar, id);
                }
              }}
            >
              <span className="cell-label">{label}</span>
              <span className="cell-sub">{sub}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>Song</h1>
          <p className="muted">
            A main loops until the next one starts. A fill replaces it for its length.{rendering ? ' Rendering…' : ''}
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
                if (value >= 1 && value <= 256) run(setSongBars(value), 'song:bars');
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
            {Array.from({ length: bars }, (_, bar) => (
              <span key={bar} className={`ruler-cell${bar === playheadBar ? ' now' : ''}${bar % 4 === 0 ? ' downbeat' : ''}`}>
                {bar + 1}
              </span>
            ))}
          </div>
          {lane('main')}
          {lane('fill')}
          {DISABLED_LANES.map((l) => (
            <div key={l.key} className="lane disabled" style={columns} aria-disabled="true">
              <div className="lane-name">
                <span className="lane-key mono">{l.key}</span>
                <span className="muted">
                  {l.name} · phase {l.phase}
                </span>
              </div>
              {Array.from({ length: bars }, (_, bar) => (
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
        <h2 className="label">Drag onto a lane</h2>
        {loops.length === 0 ? (
          <p className="muted">No loops yet. Slice a break to get M1.</p>
        ) : (
          (['main', 'fill'] as const).map((kind) => (
            <div key={kind} className="row">
              <span className="muted small library-label">{kind === 'main' ? 'Mains' : 'Fills'}</span>
              {loops
                .filter((l) => l.kind === kind)
                .map((loop) => (
                  <button
                    key={loop.id}
                    type="button"
                    draggable
                    className={`chip mono loop-name ${kind}`}
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
            </div>
          ))
        )}
        <span className="muted small">
          {selected === null ? 'Or select a loop, then click bars in its lane.' : 'Click bars to place. Delete clears a focused bar.'}
        </span>
      </section>
    </main>
  );
}
