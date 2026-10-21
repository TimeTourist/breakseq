import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id, Matrix, Pad, Project } from '../model';
import { padPicker } from '../engine';
import { addPad, cloneMatrix, matrixKind, padSteps, renameMatrix } from '../model';
import { useApp, useOpen, useProject, useRun, useSelect } from './context';
import type { PadsPlay } from './ControlsPanel';
import { ControlsPanel, useRunAdding } from './ControlsPanel';
import { DeleteMatrix } from './DeleteMatrix';
import { MatrixKindIcon } from './icons';
import { isTyping, modalOpen } from './isTyping';
import { MatrixGrid } from './MatrixGrid';
import { MatrixList } from './MatrixList';
import type { DropTarget, Dragged, PadsOpen, Placing, Zoom } from './pads';
import { ZOOMS, autoscrollStep, dropCommand, padsOpen, stepSelection } from './pads';
import { RenameInPlace } from './RenameInPlace';
import { matrixInView } from './store';

const ZOOM_LABEL: Record<Zoom, string> = { fit: 'Fit', '1 bar': '1 bar' };

/**
 * Matrices (Magnus beslut): the matrices as a tree on the left, as Samples
 * lists its files, and on the right the matrix shown, its pads as a grid that
 * wraps downward, and the controls for what is selected under it: a hit, a
 * pad or the matrix. The matrix shown is the pinned one, else the one whose
 * row, pad or hit was clicked last; Play and the link row follow it.
 */
export function PadsView({ transport }: { readonly transport: PadsPlay }) {
  const project = useProject();
  const { store } = useApp();
  const focus = useSelect((s) => s.focus);
  const selection = useSelect((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const first = Object.keys(project.matrices)[0] ?? null;
  const inView = matrixInView(focus);
  // With none shown yet (or the one shown gone), the first matrix is. (Claudes val.)
  useEffect(() => {
    if (inView === null && first !== null) store.dispatch({ type: 'show', matrix: first });
  }, [inView, first, store]);
  const open = padsOpen(project, inView ?? first, selection);
  const show = useShow();
  const placing = usePlacing(setError);
  const playPad = usePlayPad();
  const ask = usePadsKeys(open, playPad);
  usePageAutoscroll();
  const matrixPlays = open !== null && transport.played !== null && transport.played.key === `matrix:${open.matrix.id}`;

  if (first === null)
    return (
      <main className="view pads-view">
        <div className="panel stack-tight">
          <p className="muted">No matrices yet. Every sample in Samples gets one.</p>
          <div className="row nav-row">
            <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'samples' })}>
              ← Samples
            </button>
          </div>
        </div>
      </main>
    );

  return (
    <main className="view pads-view">
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="samples-layout">
        <MatrixList open={open} pinned={focus.matrix} placing={placing} show={show} onPlayPad={playPad} onError={setError} />
        {open !== null && (
          <div className="matrix-side stack">
            <MatrixBox
              matrix={open.matrix}
              open={open}
              zoom={zoom}
              onZoom={setZoom}
              playedSeconds={matrixPlays ? transport.played!.seconds : null}
              placing={placing}
              onPlayPad={playPad}
              onError={setError}
              ask={ask.matrix}
            />
            <ControlsPanel open={open} onError={setError} ask={ask.selected} />
          </div>
        )}
      </div>
    </main>
  );
}

/** Shows a matrix in Matrices, with a pad or a hit of it selected, or the matrix itself. */
function useShow() {
  const { store } = useApp();
  const select = useOpen();
  return useCallback(
    (matrixId: Id, pad: Id | null, hit: Id | null) => {
      store.dispatch({ type: 'show', matrix: matrixId });
      select({ matrix: matrixId, pad, hit }, 'pads');
    },
    [store, select],
  );
}

/**
 * Drag in Matrices: what is dragged, and placing it as one undo step. What
 * was placed is selected after: the pad it went to, the moved hit, or the new pad.
 */
function usePlacing(onError: (error: string | null) => void): Placing {
  const run = useRun();
  const { store } = useApp();
  const select = useOpen();
  const [dragging, setDragging] = useState<Dragged | null>(null);
  return {
    dragging,
    startDrag: setDragging,
    endDrag: () => setDragging(null),
    place: (target: DropTarget) => {
      const error = run(dropCommand(target));
      onError(error);
      if (error !== null) return;
      const now = store.getState().history.present;
      if (target.kind === 'add') select({ pad: target.padId, hit: null }, 'pads');
      else if (target.kind === 'new') select({ pad: now.matrices[target.matrixId]?.pads.at(-1) ?? null, hit: null }, 'pads');
      else if (target.kind === 'movePad') select({ pad: target.padId, hit: null }, 'pads');
      // The new variant opens, as the Variant button opens it.
      else if (target.kind === 'variant') select({ pad: target.padId, hit: now.pads[target.padId]?.members.at(-1) ?? null }, 'pads');
      else select({ pad: target.padId, hit: target.hitId }, 'pads');
    },
  };
}

/** The pad or hit button a key went to in the grid, as what is open: arrows step on from it, not from the selection. */
function keyOrigin(target: EventTarget | null, project: Project, now: PadsOpen): PadsOpen | null {
  const button = target instanceof Element ? target.closest<HTMLElement>('.pad-head, [data-hit]') : null;
  const padId = button?.closest<HTMLElement>('.pad-tile')?.dataset.pad;
  if (button == null || padId === undefined) return null;
  return padsOpen(project, now.matrix.id, { pad: padId, hit: button.dataset.hit ?? null });
}

/** The grid's button for a pad, or a hit of it. */
function timelineButton(padId: Id, hitId: Id | null): HTMLElement | null {
  const column = Array.from(document.querySelectorAll<HTMLElement>('.pad-tile')).find((c) => c.dataset.pad === padId);
  if (column === undefined) return null;
  return hitId === null ? column.querySelector<HTMLElement>('.pad-head') : (Array.from(column.querySelectorAll<HTMLElement>('[data-hit]')).find((b) => b.dataset.hit === hitId) ?? null);
}

/** Whether a key on `target` is the target's own: a field, a slider, a checkbox and the like. */
const ownKeys = (target: EventTarget | null) => isTyping(target) || (target instanceof Element && target.closest('input, [role="slider"]') !== null);

/**
 * Plays a pad as it picks, one pick a time: Top its first hit, Round robin
 * the next in turn (on from the last click or arrow step), Random and No
 * repeat at random from the injected rng. A pad with no hits plays nothing.
 */
export function usePlayPad(): (pad: Pad) => void {
  const project = useProject();
  const { services } = useApp();
  const picker = useRef<ReturnType<typeof padPicker> | null>(null);
  const latest = useRef(project);
  latest.current = project;
  return useCallback(
    (pad: Pad) => {
      picker.current ??= padPicker();
      const hit = picker.current.pick(pad, services.rng());
      if (hit !== undefined) services.player.playHit(latest.current, hit);
    },
    [services],
  );
}

/**
 * The keys of Pads: ←/→ go from pad to pad and ↑/↓ through the pad's hits,
 * each step playing what it selects (a pad one pick, as a click on it does);
 * Enter selects the matrix; Delete or Backspace asks, as the Delete button
 * does, to delete what is selected. Returns the counts that make the Delete
 * buttons ask.
 */
function usePadsKeys(open: PadsOpen | null, playPad: (pad: Pad) => void) {
  const project = useProject();
  const { services } = useApp();
  const select = useOpen();
  const [ask, setAsk] = useState({ matrix: 0, selected: 0 });
  // The listener is set up once and reads the latest of these.
  const latest = useRef({ open, project, select, playPad });
  latest.current = { open, project, select, playPad };
  // After a step, focus goes to the newly selected button once it shows (roving tabindex).
  const focusNext = useRef<{ pad: Id; hit: Id | null } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    timelineButton(next.pad, next.hit)?.focus();
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { open: now, project: p, select, playPad: play } = latest.current;
      if (now === null || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || ownKeys(e.target)) return;
      if (modalOpen()) return;
      if (e.key.startsWith('Arrow')) {
        const next = stepSelection(keyOrigin(e.target, p, now) ?? now, e.key);
        if (next === null) return;
        e.preventDefault();
        focusNext.current = next;
        select(next, 'pads');
        const pad = p.pads[next.pad];
        if (next.hit !== null) services.player.playHit(p, next.hit);
        else if (pad !== undefined) play(pad);
      } else if (e.key === 'Enter') {
        // A focused button's Enter is its own.
        if (e.target instanceof Element && e.target.closest('button, a, summary, [role="button"]') !== null) return;
        e.preventDefault();
        select({ matrix: now.matrix.id, pad: null, hit: null }, 'pads');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setAsk((a) => (now.kind === 'matrix' ? { ...a, matrix: a.matrix + 1 } : { ...a, selected: a.selected + 1 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [services]);
  return ask;
}

interface MatrixBoxProps {
  readonly matrix: Matrix;
  readonly open: PadsOpen;
  readonly zoom: Zoom;
  readonly onZoom: (zoom: Zoom) => void;
  readonly playedSeconds: number | null;
  readonly placing: Placing;
  readonly onPlayPad: (pad: Pad) => void;
  readonly onError: (error: string | null) => void;
  /** Asks to delete the matrix each time this changes (the Delete key). */
  readonly ask: number;
}

/**
 * The matrix shown, in one box (Magnus beslut): a header row with its kind,
 * Rename, + Pad, Clone, Delete, its size and Fit | 1 bar, over the grid of its
 * pads. A click in the box off a pad, a hit or a control selects the matrix.
 */
function MatrixBox({ matrix, open, zoom, onZoom, playedSeconds, placing, onPlayPad, onError, ask }: MatrixBoxProps) {
  const project = useProject();
  const { store } = useApp();
  const run = useRun();
  const select = useOpen();
  const adding = useRunAdding(onError);
  const kind = matrixKind(matrix);
  const steps = matrix.pads.reduce((sum, id) => sum + (project.pads[id] === undefined ? 0 : padSteps(project, project.pads[id])), 0);
  return (
    <section
      className={`panel matrix-box${open.kind === 'matrix' ? ' current' : ''}`}
      aria-label="Matrix"
      onClick={(e) => {
        // Off a pad, a hit or a control, a click selects the matrix. (Magnus beslut)
        if (e.target instanceof Element && e.target.closest('button, input, select, label, a, .pad-tile') !== null) return;
        if (open.kind !== 'matrix') select({ matrix: matrix.id, pad: null, hit: null }, 'pads');
      }}
    >
      <div className="box-head">
        <span className="kind-chip" title={kind === 'break' ? 'A break: its pads are slices in order' : 'A one-shot: one pad'}>
          <MatrixKindIcon kind={kind} />
          {kind === 'break' ? 'break' : 'one-shot'}
        </span>
        <RenameInPlace key={matrix.id} name={matrix.name} what="matrix" onRename={(name) => run(renameMatrix(matrix.id, name))} onError={onError} />
        <button type="button" title="An empty pad last in the matrix" onClick={() => adding(addPad(matrix.id), 'pads', (id) => select({ pad: id, hit: null }, 'pads'))}>
          + Pad
        </button>
        <button
          type="button"
          title="A copy of the whole matrix, with its own pads and hits, to change apart from this one"
          onClick={() =>
            adding(cloneMatrix(matrix.id), 'matrices', (id) => {
              // The copy shows; a pin moves to it. (Claudes val.)
              store.dispatch({ type: 'show', matrix: id });
              select({ matrix: id, pad: null, hit: null }, 'pads');
            })
          }
        >
          Clone
        </button>
        <DeleteMatrix matrix={matrix} onError={onError} ask={ask} icon onDeleted={() => select({ matrix: null, pad: null, hit: null }, 'pads')} />
        <span className="muted small mono push">
          {matrix.pads.length} pad{matrix.pads.length === 1 ? '' : 's'} · {steps} step{steps === 1 ? '' : 's'}
        </span>
        <div className="segmented" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => onZoom(z)}>
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
      </div>
      <MatrixGrid matrix={matrix} open={open} zoom={zoom} playedSeconds={playedSeconds} placing={placing} onPlayPad={onPlayPad} />
    </section>
  );
}

/**
 * While something is dragged in Matrices, the pointer near the top of the
 * window (just under the sticky header) or its bottom scrolls the page, so a
 * grid scrolled out of view comes back to drop on.
 */
function usePageAutoscroll() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const top = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0;
      const by = autoscrollStep(e.clientY, top, window.innerHeight);
      if (by !== 0) window.scrollBy({ top: by });
    };
    document.addEventListener('dragover', onDragOver);
    return () => document.removeEventListener('dragover', onDragOver);
  }, []);
}
