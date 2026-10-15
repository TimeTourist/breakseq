import { useState } from 'react';
import type { Id, Loop, LoopKind, Project } from '../model';
import { STEPS_PER_BAR, setSongBars, setSongCell } from '../model';
import { useProject, useRun } from './context';
import { TARGET_LABELS } from './modText';

export const LOOP_MIME = 'application/x-breakseq-loop';
export const MOD_MIME = 'application/x-breakseq-mod';

interface LaneCell {
  readonly loopId: Id | null;
  /** The loop that covers this bar, and which of its bars. */
  readonly plays: { readonly name: string; readonly bar: number } | null;
  /**
   * The steps of this bar a fill plays, start inclusive and end exclusive (0–16).
   * In the Main lane: the steps a fill covers over it. Null when no fill is there.
   */
  readonly fillSteps: { readonly from: number; readonly to: number } | null;
}

/**
 * What a lane shows. Main: a loop runs until the next one starts. Fill: a loop
 * covers as many bars as it is long, and plays the steps in its window.
 */
export function laneCells(project: Project, kind: LoopKind): LaneCell[] {
  const fills = kind === 'main' ? laneCells(project, 'fill') : null;
  let running: { loop: Loop; start: number } | null = null;
  return project.song.rows[kind].map((id, bar) => {
    const loop = id === null ? undefined : project.loops[id];
    if (loop !== undefined) running = { loop, start: bar };
    const covers = running !== null && (kind === 'main' || bar - running.start < running.loop.bars);
    const loopBar = running === null ? 0 : (bar - running.start) % running.loop.bars;
    let fillSteps: LaneCell['fillSteps'] = null;
    if (kind === 'fill' && covers && running !== null) {
      const offset = loopBar * STEPS_PER_BAR;
      const from = Math.max(0, Math.min(STEPS_PER_BAR, running.loop.window.start - offset));
      const to = Math.max(from, Math.min(STEPS_PER_BAR, running.loop.window.end - offset));
      fillSteps = { from, to };
    } else if (kind === 'main') {
      fillSteps = fills?.[bar]?.fillSteps ?? null;
    }
    return {
      loopId: loop === undefined ? null : loop.id,
      plays: !covers || running === null ? null : { name: running.loop.name, bar: loopBar + 1 },
      fillSteps,
    };
  });
}

/** The Main row, as before fills existed. */
export const mainCells = (project: Project) => laneCells(project, 'main');

type Coverage = 'none' | 'part' | 'all';
const coverage = (steps: LaneCell['fillSteps']): Coverage =>
  steps === null || steps.to <= steps.from ? 'none' : steps.from === 0 && steps.to === STEPS_PER_BAR ? 'all' : 'part';

/** Steps as 1-based numbers: "9–16". */
const stepRange = (steps: { from: number; to: number }) => `${steps.from + 1}–${steps.to}`;

/** A partly covered cell is shaded over the steps the fill plays. */
function spanStyle(kind: LoopKind, steps: { from: number; to: number }) {
  const color = kind === 'fill' ? 'rgb(95 168 238 / 0.32)' : 'rgb(12 13 15 / 0.7)';
  const [a, b] = [(steps.from / STEPS_PER_BAR) * 100, (steps.to / STEPS_PER_BAR) * 100];
  return { backgroundImage: `linear-gradient(to right, transparent ${a}%, ${color} ${a}%, ${color} ${b}%, transparent ${b}%)` };
}


interface SongViewProps {
  readonly playheadBar: number | null;
  readonly rendering: boolean;
  readonly onNewTake: () => void;
}

export function SongView({ playheadBar, rendering, onNewTake }: SongViewProps) {
  const project = useProject();
  const run = useRun();
  const [selected, setSelected] = useState<Id | null>(null);
  const [selectedMod, setSelectedMod] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bars } = project.song;
  const columns = { gridTemplateColumns: `130px repeat(${bars}, minmax(44px, 1fr))` };
  const loops = Object.values(project.loops);

  const place = (kind: LoopKind, bar: number, loopId: Id | null) => setError(run(setSongCell(kind, bar, loopId)));
  const placeMod = (row: 'modA' | 'modB', bar: number, modId: Id | null) => setError(run(setSongCell(row, bar, modId)));

  /** A mod lane: a mod acts in the bars it is placed in; the same mod in adjacent bars is one run. */
  const modLane = (row: 'modA' | 'modB') => (
    <div className="lane" style={columns}>
      <div className="lane-name">
        <span className="lane-key mod mono">{row === 'modA' ? 'A' : 'B'}</span>
        <span className="muted">{row === 'modA' ? 'Mod A' : 'Mod B'}</span>
      </div>
      {project.song.rows[row].map((id, bar) => {
        const mod = id === null ? undefined : project.mods[id];
        const continues = id !== null && project.song.rows[row][bar - 1] === id;
        return (
          <button
            key={bar}
            type="button"
            className={`cell mod${mod !== undefined ? (continues ? ' running' : ' start') : ''}${bar === playheadBar ? ' now' : ''}`}
            aria-label={`${row === 'modA' ? 'Mod A' : 'Mod B'} bar ${bar + 1}: ${mod === undefined ? 'empty' : mod.name}`}
            title={mod?.name}
            onClick={() => {
              if (selectedMod !== null) placeMod(row, bar, selectedMod);
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace') && id !== null) {
                e.preventDefault();
                placeMod(row, bar, null);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(MOD_MIME)) e.preventDefault();
            }}
            onDrop={(e) => {
              const dropped = e.dataTransfer.getData(MOD_MIME);
              if (dropped !== '') {
                e.preventDefault();
                placeMod(row, bar, dropped);
              }
            }}
          >
            <span className="cell-label ellipsis">{mod === undefined ? '' : continues ? '·' : mod.name}</span>
            <span className="cell-sub">{mod === undefined ? '' : TARGET_LABELS[mod.target].split(' ')[0]!.toLowerCase()}</span>
          </button>
        );
      })}
    </div>
  );

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
          const covered = coverage(cell.fillSteps);
          const hidden = kind === 'main' && covered === 'all';
          const partial = covered === 'part';
          const silent = kind === 'fill' && cell.plays !== null && covered === 'none';
          const sub =
            cell.plays === null
              ? ''
              : hidden
                ? 'hidden'
                : partial
                  ? kind === 'fill'
                    ? `steps ${stepRange(cell.fillSteps!)}`
                    : `bar ${cell.plays.bar} · partly`
                  : silent
                    ? 'main plays'
                    : kind === 'fill' && loop !== undefined
                      ? 'replaces'
                      : `bar ${cell.plays.bar}`;
          const state = loop !== undefined ? ' start' : cell.plays !== null ? ' running' : '';
          const detail = partial
            ? kind === 'main'
              ? `, fill over steps ${stepRange(cell.fillSteps!)}`
              : `, plays steps ${stepRange(cell.fillSteps!)}`
            : silent
              ? ', main plays'
              : hidden
                ? ', hidden by fill'
                : '';
          return (
            <button
              key={bar}
              type="button"
              className={`cell ${kind}${state}${hidden ? ' hidden' : ''}${partial ? ' partial' : ''}${silent ? ' silent' : ''}${bar === playheadBar ? ' now' : ''}`}
              style={partial ? spanStyle(kind, cell.fillSteps!) : undefined}
              aria-label={`${kind === 'main' ? 'Bar' : 'Fill bar'} ${bar + 1}: ${
                cell.plays === null ? 'empty' : `${cell.plays.name} bar ${cell.plays.bar}${detail}`
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
          {modLane('modA')}
          {modLane('modB')}
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
                    onClick={() => {
                      setSelected(selected === loop.id ? null : loop.id);
                      setSelectedMod(null);
                    }}
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
        <div className="row">
          <span className="muted small library-label">Mods</span>
          {Object.values(project.mods).length === 0 && <span className="muted small">None yet: make them in Mods.</span>}
          {Object.values(project.mods).map((mod) => (
            <button
              key={mod.id}
              type="button"
              draggable
              className="chip mod-chip"
              aria-pressed={selectedMod === mod.id}
              onClick={() => {
                setSelectedMod(selectedMod === mod.id ? null : mod.id);
                setSelected(null);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(MOD_MIME, mod.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              {mod.name}
            </button>
          ))}
        </div>
        <span className="muted small">
          {selected === null && selectedMod === null
            ? 'Or select a loop or mod, then click bars in its lane.'
            : 'Click bars to place. Delete clears a focused bar.'}
        </span>
      </section>
    </main>
  );
}
