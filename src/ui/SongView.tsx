import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { loopSong, modPreviewSong } from '../engine';
import type { Clip, Id, Mod, Project, SongRow } from '../model';
import { STEPS_PER_BAR, addClip, clipAt, copyClip, isLoopRow, loopIndex, moveClip, pasteClip, removeClip, rerollClip, resizeClip, setSongBars, setSongLoop, setSongLoopOn } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { copies, dropEffectFor } from './dnd';
import { isTyping, modalOpen } from './isTyping';
import { HIT_COLOR, lengthText } from './labels';
import { playOnce } from './LoopsView';
import { previewLoopId } from './ModsView';
import { SongList, songGroups } from './SongList';
import { songPinned } from './store';
import { RerollButton } from './RerollButton';
import { RegionHandle } from './RegionHandle';
import { TARGET_LABELS } from './modLabels';

export const LOOP_MIME = 'application/x-breakseq-loop';
export const MOD_MIME = 'application/x-breakseq-mod';
/** A clip being dragged: its id and the step within it that was grabbed. */
export const CLIP_MIME = 'application/x-breakseq-clip';

/** Width of one 1/16 step on the timeline. */
export const STEP_PX = 10;

/** The lanes, each tinted in its colour and named in its corner. */
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
  /** A click in the ruler: playing jumps to that step. */
  readonly onSeek: (step: number) => void;
}

/** How far the pointer moves in the ruler before a click becomes a drag that marks the loop. */
const DRAG_PX = 4;

export function SongView({ playheadSeconds, stepSeconds, onSeek }: SongViewProps) {
  const project = useProject();
  const { store, services } = useApp();
  const focus = useSelect((s) => s.focus);
  const cursor = useSelect((s) => s.songCursor);
  const ruler = useRef<{ x: number; from: number; dragged: boolean } | null>(null);
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const [chip, setChip] = useState<{ ref: Id; loop: boolean } | null>(null);
  const selected = useSelect((s) => s.selection.clip ?? null);
  const setSelected = (clip: Id | null) => store.dispatch({ type: 'select', selection: { clip } });
  const [hover, setHover] = useState<{ row: SongRow; step: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resizing = useRef(false);
  const { bars } = project.song;
  const total = bars * STEPS_PER_BAR;
  const width = total * STEP_PX;
  const loops = Object.values(project.loops);
  const mods = Object.values(project.mods);
  /** The shelf: what is pinned in the list, by Main, Fill and Mods. */
  const shelf = songGroups(project, focus).filter((g) => g.loops.length + g.mods.length > 0);
  const report = (e: unknown) => setError(`Could not play it: ${e instanceof Error ? e.message : String(e)}`);
  const play = {
    loop: (id: Id) => void playOnce(services, loopSong(project, id)).catch(report),
    // A mod plays on its loop under Plays on in Mods; without a loop there is nothing to hear it on.
    mod: (id: Id) => {
      const loop = previewLoopId(project, store.getState().selection);
      if (loop !== null) void playOnce(services, modPreviewSong(project, id, loop)).catch(report);
    },
  };
  const playheadStep = playheadSeconds === null ? null : playheadSeconds / stepSeconds;
  const songLoop = project.song.loop ?? null;
  /** The loop region always shows: with none marked, the whole song, off. */
  const region = songLoop ?? { start: 0, end: total, on: false };
  const loopText = `${position(region.start)} – ${position(region.end)}`;

  /**
   * Ctrl+C copies the selected clip; Ctrl+V pastes it where the playhead is,
   * or at the cursor when stopped; Ctrl+D puts a copy right after it. A pasted
   * copy is selected, so Ctrl+D again lays out the next.
   */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (isTyping(e.target) || modalOpen()) return;
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

  /** One end of the loop, dragged or moved with ←/→ like Trim's handles; one drag is one undo step. */
  const loopHandle = (which: 'start' | 'end') => {
    const { start, end, on } = region;
    const set = (to: number) =>
      setError(
        run(
          which === 'start' ? setSongLoop(Math.max(0, Math.min(to, end - 1)), end, on) : setSongLoop(start, Math.min(total, Math.max(to, start + 1)), on),
          'song:loop',
        ),
      );
    return (
      <RegionHandle
        which={which}
        className={`loop-handle${on ? '' : ' off'}`}
        left={`${(which === 'start' ? start : end) * STEP_PX}px`}
        label={`Loop ${which} at ${position(which === 'start' ? start : end)}`}
        title="Drag to move this end of the loop, or focus it and use ←/→ (Shift: a beat)"
        onDrag={(x, handle) => {
          const el = handle.closest('.ruler-loop-strip') as HTMLElement | null;
          if (el !== null) set(boundaryAt({ clientX: x }, el));
        }}
        onNudge={(direction, big) => set((which === 'start' ? start : end) + direction * (big ? 4 : 1))}
        onDone={seal}
      />
    );
  };

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
    // Where in its content the clip starts: a loop's offset is kept unwrapped (the random choices follow it), shown within the loop.
    const from = loop === undefined || loop.steps.length === 0 ? clip.offset : loopIndex(clip, clip.start, loop.steps.length);
    const label = `${name}, ${position(clip.start)}, ${lengthText(clip.length)}${from > 0 && loop !== undefined ? `, from ${position(from)}` : ''}`;
    return (
      <div
        key={clip.id}
        role="button"
        tabIndex={0}
        className={`clip ${clip.row}${loop?.kind === 'fill' ? ' tag-fill' : ''}${selected === clip.id ? ' selected' : ''}${from > 0 ? ' trimmed' : ''}`}
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
              const index = loopIndex(clip, clip.start + i, loop.steps.length);
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
          {from > 0 && loop !== undefined && <span className="clip-from"> from {position(from)}</span>}
          {mod !== undefined && <span className="clip-from"> {effectsText(mod)}</span>}
        </span>
        {selected === clip.id && (
          // On the selected clip: only it rolls anew. Not a drag handle.
          <span className="clip-reroll" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <RerollButton
              command={rerollClip(clip.id)}
              label="Reroll this clip"
              title={`Reroll this clip of ${name}: new random choices for only this clip; its copies keep theirs.`}
              onError={setError}
            />
          </span>
        )}
        <span className="clip-edge start" aria-hidden="true" {...edge(clip, 'start')} />
        <span className="clip-edge end" aria-hidden="true" {...edge(clip, 'end')} />
      </div>
    );
  };

  return (
    <main className="view song-view">
      <div className="samples-layout">
        <SongList project={project} onPlayLoop={play.loop} onPlayMod={play.mod} />
        <div className="matrix-side stack">
          <section className="panel stack-tight song-box" aria-label="Song">
            <div className="row song-top">
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
                aria-pressed={region.on}
                title={region.on ? `Looping ${loopText}: click to play the whole song` : `Loop ${loopText}`}
                onClick={() => setError(run(setSongLoopOn(!region.on)))}
              >
                Loop {loopText}
              </button>
              <span className="readout mono push" aria-live="off">
                {position(playheadStep === null ? cursor : Math.floor(playheadStep))} / {bars}
              </span>
            </div>

            <div className="table-scroll timeline-box" onClick={() => setSelected(null)}>
              <div className="song-timeline" style={{ width }}>
                <div className="timeline-ruler" style={{ width }} onClick={(e) => e.stopPropagation()}>
                  {/* Upper strip: the loop region, marked by a drag; its handles sit here. */}
                  <div
                    className="ruler-loop-strip"
                    aria-label="Loop region: drag to mark it"
                    title={`Loop ${loopText}${region.on ? '' : ' (off)'} · drag here to mark a new loop`}
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
                    onPointerUp={() => {
                      const down = ruler.current;
                      ruler.current = null;
                      // A click without a drag does nothing here: where Play starts is set in the strip below.
                      if (down?.dragged === true) seal();
                    }}
                  >
                    <span className={`ruler-loop${region.on ? ' on' : ''}`} style={{ left: region.start * STEP_PX, width: (region.end - region.start) * STEP_PX }} />
                    {loopHandle('start')}
                    {loopHandle('end')}
                  </div>
                  {/* Lower strip, with the bar numbers: where Play starts. */}
                  <div
                    className="ruler-start-strip"
                    aria-label="Start point: click to play from a step"
                    title="Click to play from here"
                    onPointerUp={(e) => {
                      const step = Math.min(total - 1, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / STEP_PX));
                      store.dispatch({ type: 'songCursor', step: Math.max(0, step) });
                      onSeek(Math.max(0, step));
                    }}
                  >
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
                        // A chip taken off the shelf (unpinned) places nothing.
                        if (chip === null || chip.loop !== isLoopRow(row) || !songPinned(focus, chip.ref)) return;
                        setError(run(addClip(row, chip.ref, stepAt(e, e.currentTarget))));
                      }}
                    >
                      <span className="lane-label small" aria-hidden="true">
                        {name}
                      </span>
                      {hover?.row === row && <span className="drop-marker" style={{ left: hover.step * STEP_PX }} />}
                      {project.song.clips.filter((c) => c.row === row).map(clipView)}
                    </div>
                  </div>
                ))}
                {/* As in Trim: what is outside the loop is shaded while it is on, and its ends are lines over the lanes. */}
                {region.on && (
                  <>
                    <span className="region-shade song-shade" style={{ left: 0, width: region.start * STEP_PX }} />
                    <span className="region-shade song-shade" style={{ left: region.end * STEP_PX, width: (total - region.end) * STEP_PX }} />
                  </>
                )}
                {[region.start, region.end].map((at, i) => (
                  <span key={i} className={`loop-line${region.on ? '' : ' off'}`} style={{ left: at * STEP_PX }} aria-hidden="true" />
                ))}
                {playheadStep !== null && <span className="playhead" style={{ left: playheadStep * STEP_PX }} />}
              </div>
            </div>
            <p className="muted small">
              Drag clips to move them (Ctrl: copy) and their edges to resize; a fill takes over the main for its length. Click a clip to select it: Delete removes it,
              ←/→ moves it a step (Shift: a beat), Ctrl+C copies it, Ctrl+D puts a copy right after it, Ctrl+V pastes at the playhead. Click the lower strip of the
              ruler, with the bar numbers, to play from there; drag in its upper strip to mark a loop, and the loop's handles to move its ends. Space plays and stops.
            </p>
          </section>

          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <section className="panel stack-tight" aria-label="Loops and mods">
            <div className="sound-head">
              <h2 className="label">Loops and mods</h2>
              <span className="muted small">The pinned loops and mods. Drag one onto a lane, or select it and click a lane; double-click it to edit.</span>
            </div>
            {(loops.length === 0 || mods.length === 0) && (
              <p className="muted small row">
                {loops.length === 0 && (
                  <span>
                    No loops yet.{' '}
                    <button type="button" className="link-text small" onClick={() => open({}, 'loops')}>
                      ← Loops
                    </button>
                  </span>
                )}
                {mods.length === 0 && (
                  <span>
                    No mods yet.{' '}
                    <button type="button" className="link-text small" onClick={() => open({}, 'mods')}>
                      ← Mods
                    </button>
                  </span>
                )}
              </p>
            )}
            {shelf.length === 0 && loops.length + mods.length > 0 && <p className="muted small">Pin a loop or mod in the list to use it here.</p>}
            {/* TODO(spec): the mod presets (Crazy, Rnd) get a fixed group of their own on the shelf (Listan och hyllan i Song); no such presets exist as objects yet. */}
            {shelf.map((group) => (
              <div key={group.name} className="shelf-group" role="group" aria-label={group.name}>
                <span className="muted small shelf-label">{group.name}</span>
                <div className="row">
                  {group.loops.map((loop) => (
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
                  {group.mods.map((mod) => (
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
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
