import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState } from 'react';
import type { Clip, Id, Mod, Project, SongRow } from '../model';
import { STEPS_PER_BAR, addClip, clipAt, copyClip, isLoopRow, moveClip, removeClip, resizeClip, setSongBars } from '../model';
import { useOpen, useProject, useRun, useSeal } from './context';
import { copies } from './dnd';
import { hitColor, lengthText } from './labels';
import { TARGET_LABELS } from './modText';

export const LOOP_MIME = 'application/x-breakseq-loop';
export const MOD_MIME = 'application/x-breakseq-mod';
/** A clip being dragged: its id and the step within it that was grabbed. */
export const CLIP_MIME = 'application/x-breakseq-clip';

/** Width of one 1/16 step on the timeline. */
export const STEP_PX = 10;

/** The lanes, each tinted in its colour instead of a label beside it. */
const ROWS: readonly { row: SongRow; name: string }[] = [
  { row: 'main', name: 'Main' },
  { row: 'fill', name: 'Fill' },
  { row: 'modA', name: 'Mod A' },
  { row: 'modB', name: 'Mod B' },
];

/** A step as bar.beat.sixteenth, 1-based. */
export const position = (step: number) =>
  `${Math.floor(step / STEPS_PER_BAR) + 1}.${Math.floor((step % STEPS_PER_BAR) / 4) + 1}.${(step % 4) + 1}`;

/** A mod's effects in a clip: "pitch + ratchet", "tape 2/16". */
const effectsText = (mod: Mod) =>
  mod.effects.map((e) => `${TARGET_LABELS[e.target].toLowerCase()}${e.target === 'tape' ? ` ${lengthText(e.length)}` : ''}`).join(' + ');

const clipName = (project: Project, clip: Clip) =>
  (isLoopRow(clip.row) ? project.loops[clip.ref]?.name : project.mods[clip.ref]?.name) ?? '?';

interface SongViewProps {
  /** Seconds into the take while playing. */
  readonly playheadSeconds: number | null;
  readonly stepSeconds: number;
  readonly rendering: boolean;
  readonly onNewTake: () => void;
}

export function SongView({ playheadSeconds, stepSeconds, rendering, onNewTake }: SongViewProps) {
  const project = useProject();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const [chip, setChip] = useState<{ ref: Id; loop: boolean } | null>(null);
  const [selected, setSelected] = useState<Id | null>(null);
  const [hover, setHover] = useState<{ row: SongRow; step: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resizing = useRef(false);
  const { bars } = project.song;
  const total = bars * STEPS_PER_BAR;
  const width = total * STEP_PX;
  const loops = Object.values(project.loops);
  const mods = Object.values(project.mods);
  const playheadStep = playheadSeconds === null ? null : playheadSeconds / stepSeconds;

  const stepAt = (e: { clientX: number }, lane: HTMLElement) =>
    Math.max(0, Math.min(total - 1, Math.floor((e.clientX - lane.getBoundingClientRect().left) / STEP_PX)));

  /** What a lane accepts: library chips of its kind, and clips. */
  const accepts = (row: SongRow, e: DragEvent) =>
    e.dataTransfer.types.includes(CLIP_MIME) || e.dataTransfer.types.includes(isLoopRow(row) ? LOOP_MIME : MOD_MIME);

  const onDrop = (row: SongRow, e: DragEvent<HTMLDivElement>) => {
    setHover(null);
    if (!accepts(row, e)) return;
    e.preventDefault();
    const step = stepAt(e, e.currentTarget);
    if (e.dataTransfer.types.includes(CLIP_MIME)) {
      const { id, grab } = JSON.parse(e.dataTransfer.getData(CLIP_MIME)) as { id: Id; grab: number };
      const start = Math.max(0, step - grab);
      // A drag moves the clip; with Alt it copies.
      setError(run(copies(e) ? copyClip(id, row, start) : moveClip(id, row, start)));
      return;
    }
    setError(run(addClip(row, e.dataTransfer.getData(isLoopRow(row) ? LOOP_MIME : MOD_MIME), step)));
  };

  /** Drags one edge of a clip, snapping to steps; the whole drag is one undo step. */
  const edge = (clip: Clip, which: 'start' | 'end') => ({
    onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      resizing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLSpanElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const lane = e.currentTarget.closest('.timeline-lane') as HTMLElement | null;
      if (lane === null) return;
      const boundary = Math.round((e.clientX - lane.getBoundingClientRect().left) / STEP_PX);
      setError(run(resizeClip(clip.id, which, boundary), `clip:${clip.id}:${which}`));
    },
    onPointerUp: () => {
      resizing.current = false;
      seal();
    },
  });

  const clipView = (clip: Clip) => {
    const loop = isLoopRow(clip.row) ? project.loops[clip.ref] : undefined;
    const mod = isLoopRow(clip.row) ? undefined : project.mods[clip.ref];
    const name = clipName(project, clip);
    const label = `${name}, ${position(clip.start)}, ${lengthText(clip.length)}${clip.offset > 0 && loop !== undefined ? `, from ${position(clip.offset)}` : ''}`;
    return (
      <div
        key={clip.id}
        role="button"
        tabIndex={0}
        className={`clip ${clip.row}${loop?.kind === 'fill' ? ' tag-fill' : ''}${selected === clip.id ? ' selected' : ''}${clip.offset > 0 ? ' trimmed' : ''}`}
        style={{ left: clip.start * STEP_PX, width: clip.length * STEP_PX }}
        aria-label={label}
        title={`${label} · drag to move (Alt: copy), drag an edge to resize, double-click to edit`}
        draggable
        onDragStart={(e) => {
          if (resizing.current) {
            e.preventDefault();
            return;
          }
          const grab = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / STEP_PX);
          e.dataTransfer.setData(CLIP_MIME, JSON.stringify({ id: clip.id, grab: Number.isFinite(grab) ? Math.max(0, grab) : 0 }));
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(clip.id);
        }}
        onDoubleClick={() => {
          if (loop !== undefined) open({ loop: loop.id, step: null }, 'loops');
          // Try on the loop the mod acts on where it starts: a fill there, otherwise the main.
          else if (mod !== undefined) open({ mod: mod.id, previewLoop: (clipAt(project, 'fill', clip.start) ?? clipAt(project, 'main', clip.start))?.ref ?? null }, 'mods');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            setSelected(null);
            setError(run(removeClip(clip.id)));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const by = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 4 : 1);
            setError(run(moveClip(clip.id, clip.row, clip.start + by), `clip:${clip.id}:move`));
          }
        }}
        onKeyUp={seal}
      >
        {loop !== undefined && (
          <span className="clip-pattern" aria-hidden="true">
            {Array.from({ length: clip.length }, (_, i) => {
              const index = (clip.offset + i) % loop.steps.length;
              const cell = loop.steps[index];
              const pad = cell?.padId == null ? undefined : project.pads[cell.padId];
              const restart = index === 0 && i > 0;
              if (pad === undefined && !restart) return null;
              return (
                <span key={i} className={`clip-step${restart ? ' restart' : ''}`} style={{ left: i * STEP_PX }}>
                  {pad !== undefined && <span className="clip-tick" style={{ background: hitColor(project, cell?.memberId ?? pad.members[0]) }} />}
                </span>
              );
            })}
          </span>
        )}
        <span className="clip-label">
          {name}
          {clip.offset > 0 && loop !== undefined && <span className="clip-from"> from {position(clip.offset)}</span>}
          {mod !== undefined && <span className="clip-from"> {effectsText(mod)}</span>}
        </span>
        <span className="clip-edge start" aria-hidden="true" {...edge(clip, 'start')} />
        <span className="clip-edge end" aria-hidden="true" {...edge(clip, 'end')} />
      </div>
    );
  };

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>Song</h1>
          <p className="muted">
            Drop loops and mods on a lane; drag clips to move them (Alt: copy) and their edges to resize. A fill takes over
            the main for its length.{rendering ? ' Rendering…' : ''}
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
              onBlur={seal}
            />
          </label>
          <button type="button" onClick={onNewTake}>
            New take
          </button>
          <span className="readout mono" aria-live="off">
            {playheadStep === null ? '–' : position(Math.floor(playheadStep))} / {bars}
          </span>
        </div>
      </div>

      <div className="table-scroll timeline-box" onClick={() => setSelected(null)}>
        <div className="timeline" style={{ width }}>
          <div className="timeline-row">
            <div className="timeline-ruler" style={{ width }}>
              {Array.from({ length: bars }, (_, bar) => (
                <span key={bar} className="ruler-bar mono" style={{ left: bar * STEPS_PER_BAR * STEP_PX }}>
                  {bar + 1}
                </span>
              ))}
            </div>
          </div>
          {ROWS.map(({ row, name }) => (
            <div key={row} className="timeline-row">
              <div
                className={`timeline-lane ${row}`}
                style={{ width }}
                aria-label={`${name} lane`}
                title={name}
                onDragOver={(e) => {
                  if (!accepts(row, e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : e.altKey ? 'copy' : 'move';
                  const step = stepAt(e, e.currentTarget);
                  if (hover?.row !== row || hover.step !== step) setHover({ row, step });
                }}
                onDragLeave={() => setHover(null)}
                onDrop={(e) => onDrop(row, e)}
                onClick={(e) => {
                  if (chip === null || chip.loop !== isLoopRow(row)) return;
                  setError(run(addClip(row, chip.ref, stepAt(e, e.currentTarget))));
                }}
              >
                {hover?.row === row && <span className="drop-marker" style={{ left: hover.step * STEP_PX }} />}
                {project.song.clips.filter((c) => c.row === row).map(clipView)}
              </div>
            </div>
          ))}
          {playheadStep !== null && <span className="timeline-playhead" style={{ left: playheadStep * STEP_PX }} />}
        </div>
      </div>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel stack">
        <h2 className="label">Drag onto a lane, or select and click a lane</h2>
        <div className="row">
          <span className="muted small library-label">Loops</span>
          {loops.length === 0 && <span className="muted small">No loops yet. Slice a break to get M1.</span>}
          {loops.map((loop) => (
            <button
              key={loop.id}
              type="button"
              draggable
              className={`chip mono loop-name ${loop.kind}`}
              title="Drag onto Main or Fill · double-click to edit"
              aria-pressed={chip?.ref === loop.id}
              onClick={() => setChip(chip?.ref === loop.id ? null : { ref: loop.id, loop: true })}
              onDoubleClick={() => open({ loop: loop.id, step: null }, 'loops')}
              onDragStart={(e) => {
                e.dataTransfer.setData(LOOP_MIME, loop.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              {loop.name}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="muted small library-label">Mods</span>
          {mods.length === 0 && <span className="muted small">None yet: make them in Mods.</span>}
          {mods.map((mod) => (
            <button
              key={mod.id}
              type="button"
              draggable
              className="chip mod-chip"
              title="Drag onto Mod A or Mod B · double-click to edit"
              aria-pressed={chip?.ref === mod.id}
              onClick={() => setChip(chip?.ref === mod.id ? null : { ref: mod.id, loop: false })}
              onDoubleClick={() => open({ mod: mod.id }, 'mods')}
              onDragStart={(e) => {
                e.dataTransfer.setData(MOD_MIME, mod.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              {mod.name}
            </button>
          ))}
        </div>
        <span className="muted small">Click a clip to select it: Delete removes it, ←/→ moves it a step (Shift: a beat).</span>
      </section>
    </main>
  );
}
