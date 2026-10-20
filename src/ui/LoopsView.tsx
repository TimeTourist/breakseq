import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Trigger } from '../engine';
import { loopSong, matrixSong } from '../engine';
import type { Id, Loop, LoopKind, Project, Step } from '../model';
import {
  STEPS_PER_BAR,
  baseName,
  cloneLoop,
  createLoop,
  hitSound,
  holds,
  matrixKind,
  matrixOfPad,
  matrixSteps,
  moveLoop,
  moveSteps,
  padSteps,
  pasteSteps,
  placeMatrix,
  renameLoop,
  sampleAudio,
  sequence,
  setLoopKind,
  setStep,
  stepHit,
} from '../model';
import { MATRIX_MIME, PAD_MIME, STEP_MIME, useDropTargets } from './dnd';
import { useApp, useOpen, useProject, useRun, useSelect } from './context';
import { Delete } from './DeleteButton';
import { FoldAllIcon, FoldIcon, MatrixKindIcon, PinIcon } from './icons';
import { InSongMark, useHeard } from './InSong';
import { isTyping, modalOpen } from './isTyping';
import { CHOICE_LABEL, HIT_COLOR, lengthText, middleEllipsis, padLabel, padSilent, shelfGroups } from './labels';
import { LoopLength } from './LoopLength';
import { RenameInPlace } from './RenameInPlace';
import type { Services } from './services';
import type { Selection } from './store';
import { Waveform } from './Waveform';

/** A loop's row being dragged in the list, to reorder it: its id. Only the list takes it. */
const LOOP_ROW_MIME = 'application/x-breakseq-loop-row';

/** Renders a song and plays it once as an audition: beside the transport, cutting any other audition. */
async function playOnce(services: Services, song: Project): Promise<void> {
  const take = await services.renderSong(song, services.rng());
  const buffer = take.full ?? take.buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  services.player.audition({ sampleRate: buffer.sampleRate, channels }, 0, buffer.duration);
}

/** Plays a matrix once as it is laid out in a loop (`matrixSong`). */
export const playMatrixOnce = (services: Services, project: Project, matrixId: Id): Promise<void> => playOnce(services, matrixSong(project, matrixId));

/** The loop open in Loops: the selected one, else the first. */
export function currentLoopId(project: Project, selection: Selection): Id | null {
  if (selection.loop !== null && project.loops[selection.loop] !== undefined) return selection.loop;
  return Object.keys(project.loops)[0] ?? null;
}

interface LoopsViewProps {
  /** The trigger under the playhead while the loop plays. */
  readonly playhead: Trigger | null;
}

/**
 * Loops (Magnus beslut): the loops, by Main and Fill, and the matrices to pin
 * in a list on the left, as Samples and Matrices list theirs; on the right the
 * loop in one box, its steps under its header row, the pads of the pinned
 * matrices under it to place, and the selected step under that.
 */
export function LoopsView({ playhead }: LoopsViewProps) {
  const project = useProject();
  const { services } = useApp();
  const selection = useSelect((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  const loopId = currentLoopId(project, selection);
  const loop = loopId === null ? undefined : project.loops[loopId];
  const report = (e: unknown) => setError(`Could not play it: ${e instanceof Error ? e.message : String(e)}`);
  const play = {
    loop: (id: Id) => playOnce(services, loopSong(project, id)).catch(report),
    matrix: (id: Id) => playMatrixOnce(services, project, id).catch(report),
  };

  return (
    <main className="view loops-view">
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="samples-layout">
        <LoopsList loopId={loopId} onPlayLoop={play.loop} onPlayMatrix={play.matrix} onError={setError} />
        <div className="matrix-side stack">
          {loop === undefined ? (
            <section className="panel stack-tight">
              <p className="muted">No loops yet. Slice a sample to get its loop, or make one with + New loop.</p>
            </section>
          ) : (
            <LoopEditor key={loop.id} loop={loop} playhead={playhead} onPlayMatrix={play.matrix} onError={setError} />
          )}
        </div>
      </div>
    </main>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const KINDS: readonly LoopKind[] = ['main', 'fill'];

/**
 * The list (Magnus beslut): LOOPS, grouped in Main and Fill, each row dragged
 * freely, also to the other group, which changes its tag; and MATRICES, one
 * row each with its pin, which puts its pads in the shelf. A click on a loop
 * selects and plays it; a click on a matrix only plays it once.
 */
function LoopsList({
  loopId,
  onPlayLoop,
  onPlayMatrix,
  onError,
}: {
  readonly loopId: Id | null;
  readonly onPlayLoop: (id: Id) => void;
  readonly onPlayMatrix: (id: Id) => void;
  readonly onError: (error: string | null) => void;
}) {
  const project = useProject();
  const { store } = useApp();
  const run = useRun();
  const open = useOpen();
  const heard = useHeard();
  const pins = useSelect((s) => s.focus.loopPins);
  /** Groups folded: the view's choice, not saved. (Claudes val.) */
  const [folded, setFolded] = useState<ReadonlySet<LoopKind>>(new Set());
  const [dragged, setDragged] = useState<Id | null>(null);
  /** Where a dragged loop goes: before a loop, or last in a group. */
  const [over, setOver] = useState<{ readonly before: Id | null; readonly kind: LoopKind } | null>(null);
  const loops = Object.values(project.loops);
  const allFolded = KINDS.every((k) => folded.has(k));

  /** A new main loop of 4 bars, as one was before, selected. (Claudes val.) */
  const newLoop = () => {
    const before = store.getState().history.present.loops;
    const failed = run(createLoop(null, 'main', 4));
    onError(failed);
    if (failed !== null) return;
    const id = Object.keys(store.getState().history.present.loops).find((k) => !(k in before));
    if (id !== undefined) open({ loop: id, step: null }, 'loops');
  };
  /** Drop handlers for a place in the list: before a loop, or last in a group. */
  const dropAt = (before: Id | null, kind: LoopKind) => ({
    onDragOver: (e: DragEvent) => {
      if (dragged === null || before === dragged) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (over?.before !== before || over.kind !== kind) setOver({ before, kind });
    },
    onDrop: (e: DragEvent) => {
      const id = dragged;
      setDragged(null);
      setOver(null);
      if (id === null || before === id) return;
      e.preventDefault();
      e.stopPropagation();
      const rest = Object.keys(project.loops).filter((x) => x !== id);
      const lastOfKind = rest.reduce((at, x, i) => (project.loops[x]!.kind === kind ? i + 1 : at), 0);
      onError(run(moveLoop(id, before === null ? lastOfKind : rest.indexOf(before), kind)));
    },
  });

  return (
    <section className="panel file-list matrix-list loops-list" aria-label="Loops">
      <div className="file-list-head">
        <span className="label">Loops</span>
        <button type="button" title="A new main loop, selected" onClick={newLoop}>
          + New loop
        </button>
        <button
          type="button"
          className="icon-button small push"
          aria-label={allFolded ? 'Expand all' : 'Collapse all'}
          title={allFolded ? 'Expand all' : 'Collapse all'}
          onClick={() => setFolded(allFolded ? new Set() : new Set(KINDS))}
        >
          <FoldAllIcon folded={allFolded} />
        </button>
      </div>
      {KINDS.map((kind) => {
        const group = loops.filter((l) => l.kind === kind);
        const isFolded = folded.has(kind);
        const label = kind === 'main' ? 'Main' : 'Fill';
        return (
          <div key={kind} className="file-group" role="group" aria-label={label}>
            <div className={`file-row${over?.before === null && over.kind === kind ? ' drop-last' : ''}`} {...dropAt(null, kind)}>
              <button
                type="button"
                className="icon-button small fold"
                aria-expanded={!isFolded}
                aria-label={`${isFolded ? 'Show' : 'Hide'} the ${label} loops`}
                onClick={() => setFolded((was) => (was.has(kind) ? new Set([...was].filter((k) => k !== kind)) : new Set([...was, kind])))}
              >
                <FoldIcon folded={isFolded} />
              </button>
              <span className="label grow">{label}</span>
              {isFolded && <span className="muted small">{plural(group.length, 'loop')}</span>}
            </div>
            {!isFolded &&
              group.map((l) => (
                <div key={l.id} className={`sample-row loop-row${l.id === loopId ? ' selected' : ''}${over?.before === l.id ? ' drop-before' : ''}`} {...dropAt(l.id, kind)}>
                  <button
                    type="button"
                    className="sample-pick"
                    aria-pressed={l.id === loopId}
                    aria-label={`Loop ${l.name}`}
                    title="Click: select and hear it · drag to reorder, also to the other group"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LOOP_ROW_MIME, l.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragged(l.id);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setOver(null);
                    }}
                    onClick={() => {
                      open({ loop: l.id, step: null }, 'loops');
                      onPlayLoop(l.id);
                    }}
                  >
                    <span className="grip" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className={`mono grow ellipsis loop-name ${l.kind}`} title={l.name}>
                      {middleEllipsis(l.name)}
                    </span>
                    <span className="mono faint small">{lengthText(l.steps.length)}</span>
                    <InSongMark heard={heard.loops.has(l.id)} />
                  </button>
                </div>
              ))}
          </div>
        );
      })}

      <div className="file-list-head list-section">
        <span className="label">Matrices</span>
        <span className="muted small drop-hint">· pin to use in the shelf</span>
      </div>
      {Object.values(project.matrices).map((m) => {
        const pinned = pins.includes(m.id);
        return (
          <div key={m.id} className="sample-row matrix-pin-row">
            <button
              type="button"
              className={`icon-button small pin${pinned ? ' pinned' : ''}`}
              aria-pressed={pinned}
              aria-label={`${pinned ? 'Unpin' : 'Pin'} ${m.name}`}
              title={pinned ? 'Pinned: its pads are in the shelf below. Click to unpin' : 'Pin: show its pads in the shelf below'}
              onClick={() => store.dispatch({ type: 'loopPin', matrix: m.id, on: !pinned })}
            >
              <PinIcon />
            </button>
            <button type="button" className="sample-pick" aria-label={`Hear ${m.name}`} title="Click: hear it once, as it is laid out" onClick={() => onPlayMatrix(m.id)}>
              <MatrixKindIcon kind={matrixKind(m)} />
              <span className="mono grow ellipsis" title={m.name}>
                {middleEllipsis(m.name)}
              </span>
              <span className="faint small">{plural(m.pads.length, 'pad')}</span>
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** What a step shows: its pad, the hit it plays and how many steps its pad takes. */
function stepSound(project: Project, step: Step | undefined) {
  const pad = step?.padId == null ? undefined : project.pads[step.padId];
  const hit = stepHit(project, step);
  const sound = hit === undefined ? null : hitSound(project, hit);
  const audio = sound === null ? undefined : sampleAudio(project, sound.sample);
  return { pad, hit, sound, audio, length: pad === undefined ? 0 : Math.max(1, padSteps(project, pad)) };
}

/**
 * The loop (Magnus beslut): one box with a header row (Main|Fill, Length,
 * Rename, Clone, Clear, Delete, how many steps are filled), its steps, the
 * shelf of the pinned matrices' pads, and the selected step. A pad longer
 * than a step is one tile over its own steps; a faint bar shows where its hit
 * holds on to the next. Steps dragged move; Ctrl+C and Ctrl+V copy a block.
 */
function LoopEditor({
  loop,
  playhead,
  onPlayMatrix,
  onError,
}: {
  readonly loop: Loop;
  readonly playhead: Trigger | null;
  readonly onPlayMatrix: (id: Id) => void;
  readonly onError: (error: string | null) => void;
}) {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const pins = useSelect((s) => s.focus.loopPins);
  const [shelfPad, setShelfPad] = useState<Id | null>(null);
  const [shelfMatrix, setShelfMatrix] = useState<Id | null>(null);
  const drops = useDropTargets();
  /** How many steps what is dragged from the shelf takes, to show where it lands. */
  const [dragSteps, setDragSteps] = useState<number | null>(null);
  // The other end of a Shift-click range; the selected step is the first end.
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  /** Steps copied with Ctrl+C, for Ctrl+V: the view's, not saved. (Claudes val.) */
  const clip = useRef<readonly Step[] | null>(null);
  const held = holds(loop.steps.map((s) => s.padId != null));
  const silent = new Set(Object.values(project.pads).filter((p) => padSilent(project, p)).map((p) => p.id));
  // The pinned matrices, in the order Matrices lists them.
  const groups = shelfGroups(project, Object.keys(project.matrices).filter((id) => pins.includes(id)));
  const selectedStep = selection.step !== null && selection.step < loop.steps.length ? selection.step : null;
  const step = selectedStep === null ? undefined : loop.steps[selectedStep];
  const stepPad = step?.padId == null ? undefined : project.pads[step.padId];
  const range =
    selectedStep === null || rangeEnd === null || rangeEnd >= loop.steps.length ? null : { from: Math.min(selectedStep, rangeEnd), to: Math.max(selectedStep, rangeEnd) };
  const inRange = (index: number) => (range === null ? index === selectedStep : index >= range.from && index <= range.to);
  const overStep = drops.over?.startsWith('step:') === true ? Number(drops.over.slice('step:'.length)) : null;
  const landing = dragSteps === null || overStep === null ? null : { start: overStep, length: Math.min(dragSteps, loop.steps.length - overStep) };

  const select = (index: number | null) => open({ step: index }, 'loops');
  const place = (index: number, padId: Id | null) => onError(run(setStep(loop.id, index, { padId })));
  /** Empties the selected steps: the range, or the one step. */
  const clearSelected = () => {
    const [from, to] = range === null ? [selectedStep, selectedStep] : [range.from, range.to];
    if (from === null || to === null) return;
    onError(run(sequence(...Array.from({ length: to - from + 1 }, (_, i) => setStep(loop.id, from + i, { padId: null })))));
  };

  // Ctrl+C copies the selected steps and Ctrl+V lays them out from the selected step, over what is there (Magnus beslut).
  const latest = useRef({ loop, range, selectedStep, run, onError, select });
  latest.current = { loop, range, selectedStep, run, onError, select };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = latest.current;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target) || modalOpen() || now.selectedStep === null) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const [from, to] = now.range === null ? [now.selectedStep, now.selectedStep] : [now.range.from, now.range.to];
        clip.current = now.loop.steps.slice(from, to + 1);
        e.preventDefault();
      } else if (key === 'v' && clip.current !== null) {
        e.preventDefault();
        now.onError(now.run(pasteSteps(now.loop.id, now.selectedStep, clip.current)));
        setRangeEnd(clip.current.length > 1 ? Math.min(now.loop.steps.length - 1, now.selectedStep + clip.current.length - 1) : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** A pad or a whole matrix from the shelf (a copy), or steps moved within the loop. */
  const dropOnStep = (index: number) =>
    drops.bind(`step:${index}`, [PAD_MIME, MATRIX_MIME, STEP_MIME], (e, type) => {
      if (type === PAD_MIME) {
        place(index, e.dataTransfer.getData(PAD_MIME));
      } else if (type === MATRIX_MIME) {
        onError(run(placeMatrix(loop.id, e.dataTransfer.getData(MATRIX_MIME), index)));
      } else {
        // A block of steps, grabbed at one of them: that one lands here. Always a move (Magnus beslut).
        const { from, count, grab } = JSON.parse(e.dataTransfer.getData(STEP_MIME)) as { from: number; count: number; grab: number };
        const to = index - grab;
        if (to === from) return;
        const failed = run(moveSteps(loop.id, from, count, to, false));
        onError(failed);
        if (failed === null) {
          select(Math.max(0, to));
          setRangeEnd(count > 1 ? Math.min(loop.steps.length - 1, to + count - 1) : null);
        }
        return;
      }
      setRangeEnd(null);
      select(index);
    });
  const clickStep = (index: number, shift: boolean, sound: ReturnType<typeof stepSound>) => {
    // Shift-click selects every step from the selected one to here.
    if (shift && selectedStep !== null && shelfPad === null && shelfMatrix === null) {
      setRangeEnd(index === selectedStep ? null : index);
      return;
    }
    setRangeEnd(null);
    if (shelfPad !== null) place(index, shelfPad);
    else if (shelfMatrix !== null) onError(run(placeMatrix(loop.id, shelfMatrix, index)));
    // A click hears what is on the step. (Claudes val, as a click hears a pad or a hit in Matrices.)
    else if (sound.hit !== undefined) services.player.playHit(project, sound.hit.id);
    select(index);
  };
  const openPad = (padId: Id) => {
    const matrixId = matrixOfPad(project, padId)?.id ?? null;
    if (matrixId !== null) store.dispatch({ type: 'focus', matrix: matrixId });
    open({ pad: padId, hit: null, matrix: matrixId }, 'pads');
  };
  const filled = loop.steps.filter((s) => s.padId != null).length;

  /** The steps of bar `bar` as tiles: a pad over its own steps (up to the next hit and the bar's end), an empty step on its own. */
  const tiles = (bar: number) => {
    const out: { index: number; span: number; sound: ReturnType<typeof stepSound> }[] = [];
    const end = Math.min(loop.steps.length, (bar + 1) * STEPS_PER_BAR);
    for (let i = bar * STEPS_PER_BAR; i < end; ) {
      const sound = stepSound(project, loop.steps[i]);
      let span = 1;
      if (sound.pad !== undefined) while (span < sound.length && i + span < end && loop.steps[i + span]?.padId == null) span++;
      out.push({ index: i, span, sound });
      i += span;
    }
    return out;
  };

  return (
    <>
      <section
        className={`panel loop-box${selectedStep === null ? ' current' : ''}`}
        aria-label="Loop"
        onClick={(e) => {
          // Off a step or a control, a click selects the loop. (Magnus beslut)
          if (e.target instanceof Element && e.target.closest('button, input, select, label, a') !== null) return;
          setRangeEnd(null);
          select(null);
        }}
      >
        <div className="box-head">
          <div className="segmented" role="group" aria-label="Tag as">
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={loop.kind === k} onClick={() => onError(run(setLoopKind(loop.id, k)))}>
                {k === 'main' ? 'Main' : 'Fill'}
              </button>
            ))}
          </div>
          <LoopLength loop={loop} onError={onError} />
          <RenameInPlace key={loop.id} name={loop.name} what="loop" onRename={(name) => run(renameLoop(loop.id, name))} onError={onError} />
          <button
            type="button"
            title="A copy of the loop, to make a variation or a fill from; the copy is selected"
            onClick={() => {
              const before = store.getState().history.present.loops;
              const failed = run(cloneLoop(loop.id));
              onError(failed);
              const id = failed === null ? Object.keys(store.getState().history.present.loops).find((k) => !(k in before)) : undefined;
              if (id !== undefined) open({ loop: id, step: null }, 'loops');
            }}
          >
            Clone
          </button>
          <button type="button" disabled={range === null && step?.padId == null} onClick={clearSelected}>
            {range === null ? 'Clear step' : `Clear ${range.to - range.from + 1} steps`}
          </button>
          <Delete kind="loop" id={loop.id} name={loop.name} onError={onError} icon onDeleted={() => open({ loop: null, step: null }, 'loops')} />
          <span className="muted small mono push">
            {filled} of {loop.steps.length} steps
          </span>
        </div>

        <div className="table-scroll steps-box">
          <div className="steps">
            <div className="step-row mono muted small">
              <span />
              {Array.from({ length: STEPS_PER_BAR }, (_, s) => (
                <span key={s} className={`step-num${s % 4 === 0 ? ' downbeat' : ''}`}>
                  {String(s + 1).padStart(2, '0')}
                </span>
              ))}
            </div>
            {Array.from({ length: Math.ceil(loop.steps.length / STEPS_PER_BAR) }, (_, bar) => (
              <div key={bar} className="step-row">
                <span className="mono muted small">T{bar + 1}</span>
                {tiles(bar).map(({ index, span, sound }) => {
                  const s = index - bar * STEPS_PER_BAR;
                  const cell = loop.steps[index];
                  const pad = sound.pad;
                  const memberIndex = pad === undefined || cell?.memberId == null ? 0 : Math.max(0, pad.members.indexOf(cell.memberId));
                  // Play renders the loop over several passes: each pass lights the same steps.
                  const at = playhead === null ? null : (playhead.bar * STEPS_PER_BAR + playhead.step) % loop.steps.length;
                  const now = at !== null && at >= index && at < index + span;
                  return (
                    <button
                      key={index}
                      type="button"
                      style={{ gridColumn: `${s + 2} / span ${span}`, gridRow: 1, ...(pad === undefined ? {} : { color: HIT_COLOR }) }}
                      className={`step${pad !== undefined ? ' filled' : ''}${span > 1 ? ' wide' : ''}${pad !== undefined && silent.has(pad.id) ? ' silent' : ''}${inRange(index) ? ' selected' : ''}${now ? ' now' : ''}${s % 4 === 0 ? ' downbeat' : ''}${drops.isOver(`step:${index}`) ? ' drop-over' : ''}`}
                      draggable={pad !== undefined || (range !== null && inRange(index))}
                      onDragStart={(e) => {
                        const block = range !== null && inRange(index) ? range : { from: index, to: index };
                        e.dataTransfer.setData(STEP_MIME, JSON.stringify({ from: block.from, count: block.to - block.from + 1, grab: index - block.from }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={drops.clear}
                      {...dropOnStep(index)}
                      aria-label={`Bar ${bar + 1}, step ${s + 1}: ${pad === undefined ? 'empty' : cell?.memberId == null && pad.choice !== 'top' ? `${pad.name}, ${CHOICE_LABEL[pad.choice].toLowerCase()}` : `${pad.name}, member ${memberIndex + 1}`}`}
                      title={pad === undefined ? 'Empty: drag a pad here, or pick one in the shelf and click' : `${pad.name}${span > 1 ? ` · ${span} steps` : ''} · double-click to edit it in Matrices`}
                      onClick={(e) => clickStep(index, e.shiftKey, sound)}
                      onDoubleClick={() => {
                        if (pad !== undefined) openPad(pad.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault();
                          if (range !== null && inRange(index)) clearSelected();
                          else if (pad !== undefined) place(index, null);
                        }
                      }}
                    >
                      <span className="cell-label">{pad === undefined ? '' : padLabel(pad)}</span>
                      {sound.audio !== undefined && sound.sound !== null && sound.sound.region.end > sound.sound.region.start && (
                        <span className="step-wave" aria-hidden="true">
                          <Waveform audio={sound.audio} offset={sound.sound.sample.offset + sound.sound.region.start} duration={sound.sound.region.end - sound.sound.region.start} height={12} />
                        </span>
                      )}
                      <span className="cell-sub">
                        {pad === undefined ? '' : `${pad.members.length > 1 ? `${memberIndex + 1}/${pad.members.length}` : ''}${cell?.ignoreMods === true ? ' ⊘' : ''}`}
                      </span>
                    </button>
                  );
                })}
                {/* Where a hit holds on past its own pad's steps, to the next hit: a faint bar. */}
                {held.flatMap((h) => {
                  const own = stepSound(project, loop.steps[h.start]).length;
                  const start = Math.max(h.start + own, bar * STEPS_PER_BAR);
                  const end = Math.min(h.start + h.length, (bar + 1) * STEPS_PER_BAR);
                  return end > start ? [<span key={`hold-${h.start}`} className="hold-tail" style={{ gridColumn: `${start - bar * STEPS_PER_BAR + 2} / span ${end - start}`, gridRow: 1 }} aria-hidden="true" />] : [];
                })}
                {landing !== null &&
                  landing.start + landing.length > bar * STEPS_PER_BAR &&
                  landing.start < (bar + 1) * STEPS_PER_BAR && (
                    <span
                      key="landing"
                      className="hold landing"
                      style={{
                        gridColumn: `${Math.max(landing.start, bar * STEPS_PER_BAR) - bar * STEPS_PER_BAR + 2} / span ${Math.min(landing.start + landing.length, (bar + 1) * STEPS_PER_BAR) - Math.max(landing.start, bar * STEPS_PER_BAR)}`,
                        gridRow: 1,
                      }}
                      aria-hidden="true"
                    />
                  )}
              </div>
            ))}
          </div>
        </div>
        <p className="muted small">
          Click a step to select it and hear it; Shift-click selects a block. Ctrl+C copies the selected steps and Ctrl+V lays them out from the selected step, over what is
          there. Drag a step to move it. A pad takes its own steps; the faint bar is where its hit holds on to the next.
        </p>
      </section>

      <section className="panel stack-tight" aria-label="Pads to use">
        <div className="sound-head">
          <span className="label">Pads to use</span>
          <span className="muted small">The pinned matrices. Drag a pad onto a step, or select it and click steps.</span>
        </div>
        {groups.length === 0 && <p className="muted small">Pin a matrix in the list to use its pads here.</p>}
        {groups.map((group) => (
          <div key={group.matrixId} className="shelf-group">
            <span className="muted small shelf-label ellipsis row nowrap" title={group.name}>
              <MatrixKindIcon kind={group.kind} /> {group.name}
            </span>
            <div className="row">
              <button
                type="button"
                draggable
                className="chip parent-chip"
                aria-pressed={shelfMatrix === group.matrixId}
                aria-label={`Matrix ${group.name}: lay out all its pads`}
                title="The whole matrix: a click hears it once and picks it; it lays out its pads one after another from the step. Double-click to edit it in Matrices"
                onDoubleClick={() => {
                  store.dispatch({ type: 'focus', matrix: group.matrixId });
                  open({ matrix: group.matrixId, pad: null, hit: null }, 'pads');
                }}
                onClick={() => {
                  setShelfMatrix(shelfMatrix === group.matrixId ? null : group.matrixId);
                  onPlayMatrix(group.matrixId);
                  setShelfPad(null);
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(MATRIX_MIME, group.matrixId);
                  e.dataTransfer.effectAllowed = 'copy';
                  setDragSteps(matrixSteps(project, group.matrixId));
                }}
                onDragEnd={() => {
                  setDragSteps(null);
                  drops.clear();
                }}
              >
                ▸ all <span className="chip-steps">{lengthText(matrixSteps(project, group.matrixId))}</span>
              </button>
              {group.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  draggable
                  className={`chip mono${silent.has(p.id) ? ' silent' : ''}`}
                  onDoubleClick={() => openPad(p.id)}
                  aria-pressed={shelfPad === p.id}
                  aria-label={`Pad ${p.name}`}
                  title={silent.has(p.id) ? `${p.name}: silent, its sample has fewer slices` : `${p.name} · ${lengthText(Math.max(1, padSteps(project, p)))} · double-click to edit it in Matrices`}
                  onClick={() => {
                    setShelfPad(shelfPad === p.id ? null : p.id);
                    setShelfMatrix(null);
                    if (p.members[0] !== undefined) services.player.playHit(project, p.members[0]);
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PAD_MIME, p.id);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragSteps(Math.max(1, padSteps(project, p)));
                  }}
                  onDragEnd={() => {
                    setDragSteps(null);
                    drops.clear();
                  }}
                >
                  {padLabel(p)}
                  {padSteps(project, p) > 0 && <span className="chip-steps"> ·{padSteps(project, p)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {selectedStep !== null && step !== undefined && (
        <section className="panel stack" aria-label="Step">
          <div className="box-head">
            <span className="label">Step</span>
            <span className="mono">{stepPad === undefined ? 'Empty: drag a pad here from the shelf' : `${stepPad.name}`}</span>
            {stepPad !== undefined && (
              <button
                type="button"
                className="loop-toggle"
                aria-pressed={step.ignoreMods}
                title="This step is not changed by mods"
                onClick={() => onError(run(setStep(loop.id, selectedStep, { ignoreMods: !step.ignoreMods })))}
              >
                Ignore mods
              </button>
            )}
            {stepPad !== undefined && (
              <button type="button" className="icon-button small" aria-label="Clear step" title="Empty the step" onClick={() => place(selectedStep, null)}>
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
          {stepPad !== undefined && (
            <section className="stack-tight" aria-label="Member on this step">
              <span className="label">Plays</span>
              <div className="segmented member-choice">
                <button type="button" aria-pressed={step.memberId === null} onClick={() => onError(run(setStep(loop.id, selectedStep, { memberId: null })))}>
                  The pad picks · {CHOICE_LABEL[stepPad.choice]}
                </button>
                {stepPad.members.map((hitId, i) => (
                  <button key={hitId} type="button" aria-pressed={step.memberId === hitId} onClick={() => onError(run(setStep(loop.id, selectedStep, { memberId: hitId })))}>
                    <span className="mono">
                      {i + 1} {baseName(project.hits[hitId]?.name ?? '')}
                    </span>
                  </button>
                ))}
              </div>
              {stepPad.members.length === 0 && <p className="muted small">The pad is empty and plays nothing.</p>}
              <p className="muted small">A member chosen here is locked on this step. A step lock goes first, then a mod, then the pad’s own choice.</p>
            </section>
          )}
        </section>
      )}
    </>
  );
}
