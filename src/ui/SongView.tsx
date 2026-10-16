import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Clip, Id, Mod, Project, SongRow } from '../model';
import { STEPS_PER_BAR, addClip, clipAt, copyClip, isLoopRow, moveClip, pasteClip, removeClip, resizeClip, setSongBars, setSongLoop, setSongLoopOn } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { copies, dropEffectFor } from './dnd';
import { HIT_COLOR, lengthText } from './labels';
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
  mod.effects.length === 0 ? 'no effect' : mod.effects.map((e) => `${TARGET_LABELS[e.target].toLowerCase()}${e.target === 'tape' ? ` ${lengthText(e.length)}` : ''}`).join(' + ');

const clipName = (project: Project, clip: Clip) =>
  (isLoopRow(clip.row) ? project.loops[clip.ref]?.name : project.mods[clip.ref]?.name) ?? '?';

interface SongViewProps {
  /** Seconds into the take while playing. */
  readonly playheadSeconds: number | null;
  readonly stepSeconds: number;
  readonly rendering: boolean;
  readonly onNewTake: () => void;
  /** A click in the ruler: playing jumps to that step. */
  readonly onSeek: (step: number) => void;
}

/** How far the pointer moves in the ruler before a click becomes a drag that marks the loop. */
const DRAG_PX = 4;

export function SongView({ playheadSeconds, stepSeconds, rendering, onNewTake, onSeek }: SongViewProps) {
  const project = useProject();
  const { store } = useApp();
  const cursor = useSelect((s) => s.songCursor);
  const ruler = useRef<{ x: number; from: number; dragged: boolean } | null>(null);
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
  const songLoop = project.song.loop ?? null;
  const loopText = songLoop === null ? '' : `${position(songLoop.start)} – ${position(songLoop.end)}`;

  /**
   * Ctrl+C copies the selected clip; Ctrl+V pastes it where the playhead is,
   * or at the cursor when stopped; Ctrl+D puts a copy right after it. A pasted
   * copy is selected, so Ctrl+D again lays out the next.
   */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    const key = e.key.toLowerCase();
    const clip = project.song.clips.find((c) => c.id === selected);
    const paste = (from: Clip, at: number) => {
      const before = new Set(project.song.clips.map((c) => c.id));
      const failed = run(pasteClip(from, from.row, at));
      setError(failed);
      if (failed !== null) return;
      const added = store.getState().history.present.song.clips.find((c) => !before.has(c.id) && c.row === from.row && c.start === at);
      if (added !== undefined) setSelected(added.id);
    };
    if (key === 'c' && clip !== undefined) {
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      store.dispatch({ type: 'clipboard', clip });
    } else if (key === 'v') {
      const copied = store.getState().clipboard;
      if (copied === null) return;
      e.preventDefault();
      paste(copied, playheadStep === null ? cursor : Math.floor(playheadStep));
    } else if (key === 'd' && clip !== undefined) {
      e.preventDefault();
      if (clip.start + clip.length >= total) setError('No room after it: the song ends there');
      else paste(clip, clip.start + clip.length);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** A step boundary under the pointer in the ruler. */
  const boundaryAt = (e: { clientX: number }, el: HTMLElement) =>
    Math.max(0, Math.min(total, Math.round((e.clientX - el.getBoundingClientRect().left) / STEP_PX)));

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
      // A drag moves the clip; with Ctrl (or Alt) it copies.
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
        title={`${label} · drag to move (Ctrl: copy), drag an edge to resize, double-click to edit`}
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
                  {pad !== undefined && <span className="clip-tick" style={{ background: HIT_COLOR }} />}
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
            Drop loops and mods on a lane; drag clips to move them (Ctrl: copy) and their edges to resize. A fill takes over
            the main for its length. Click the ruler to play from there; drag in it to mark a loop.{rendering ? ' Rendering…' : ''}
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
          <button
            type="button"
            className="loop-toggle"
            aria-pressed={songLoop?.on === true}
            disabled={songLoop === null}
            title={songLoop === null ? 'Drag in the ruler to mark a loop' : songLoop.on ? `Looping ${loopText}: click to play the whole song` : `Loop ${loopText}`}
            onClick={() => setError(run(setSongLoopOn(songLoop?.on !== true)))}
          >
            Loop{songLoop === null ? '' : ` ${loopText}`}
          </button>
          <button type="button" onClick={onNewTake}>
            New take
          </button>
          <span className="readout mono" aria-live="off">
            {position(playheadStep === null ? cursor : Math.floor(playheadStep))} / {bars}
          </span>
        </div>
      </div>

      <div className="table-scroll timeline-box" onClick={() => setSelected(null)}>
        <div className="timeline" style={{ width }}>
          <div className="timeline-row">
            <div
              className="timeline-ruler"
              style={{ width }}
              aria-label="Ruler: click to play from a step, drag to mark a loop"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                ruler.current = { x: e.clientX, from: boundaryAt(e, e.currentTarget), dragged: false };
              }}
              onPointerMove={(e) => {
                const down = ruler.current;
                if (down === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                if (!down.dragged && Math.abs(e.clientX - down.x) < DRAG_PX) return;
                down.dragged = true;
                const to = boundaryAt(e, e.currentTarget);
                if (to !== down.from) setError(run(setSongLoop(Math.min(down.from, to), Math.max(down.from, to)), 'song:loop'));
              }}
              onPointerUp={(e) => {
                const down = ruler.current;
                ruler.current = null;
                if (down === null) return;
                if (down.dragged) {
                  seal();
                  return;
                }
                const step = Math.min(total - 1, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / STEP_PX));
                store.dispatch({ type: 'songCursor', step: Math.max(0, step) });
                onSeek(Math.max(0, step));
              }}
            >
              {songLoop !== null && (
                <span
                  className={`ruler-loop${songLoop.on ? ' on' : ''}`}
                  style={{ left: songLoop.start * STEP_PX, width: (songLoop.end - songLoop.start) * STEP_PX }}
                  title={`Loop ${loopText}${songLoop.on ? '' : ' (off)'}`}
                />
              )}
              <span className="ruler-cursor" style={{ left: cursor * STEP_PX }} aria-label={`Play starts at ${position(cursor)}`} />
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
                  e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed, copies(e));
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
          {songLoop?.on === true && (
            <span className="timeline-loop" style={{ left: songLoop.start * STEP_PX, width: (songLoop.end - songLoop.start) * STEP_PX }} />
          )}
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
        <span className="muted small">
          Click a clip to select it: Delete removes it, ←/→ moves it a step (Shift: a beat), Ctrl+C copies it, Ctrl+D puts a copy right
          after it. Ctrl+V pastes at the playhead. Space plays and stops.
        </span>
      </section>
    </main>
  );
}
