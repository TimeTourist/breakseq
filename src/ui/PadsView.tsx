import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id, Matrix, Pad, Project } from '../model';
import { padPicker } from '../engine';
import { addPad, cloneMatrix, matrixKind, renameMatrix, trimName } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import type { PadsPlay } from './ControlsPanel';
import { ControlsPanel, useRunAdding } from './ControlsPanel';
import { DeleteMatrix } from './DeleteMatrix';
import { FocusBar } from './FocusBar';
import { InSong, useHeard } from './InSong';
import { MatrixKindIcon } from './icons';
import { isTyping, modalOpen } from './isTyping';
import type { Dragged, DropTarget, PadsOpen, Placing, Zoom } from './pads';
import { autoscrollStep, dropCommand, padsOpen, replacedWith, stepSelection } from './pads';
import { TakeFromShelf } from './TakeFromShelf';
import { Timeline } from './Timeline';

/**
 * Pads: where all that is heard is shaped (decision 3, layout B). The focus
 * bar on top; the matrix in focus as its row and a timeline of its pads; the
 * shelf of the matrices taken from; and the controls for what is selected
 * underneath: a hit, a pad or the matrix.
 */
export function PadsView({ transport }: { readonly transport: PadsPlay }) {
  const project = useProject();
  const focus = useSelect((s) => s.focus);
  const selection = useSelect((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const open = padsOpen(project, focus.matrix, selection);
  const placing = usePlacing(setError);
  const playPad = usePlayPad();
  const ask = usePadsKeys(open, playPad);
  usePageAutoscroll();
  const matrixPlays = open !== null && transport.played !== null && transport.played.key === `matrix:${open.matrix.id}`;

  return (
    <main className="view wide pads-view">
      <FocusBar title="Pads" transport={transport} />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open === null ? (
        <NoFocus />
      ) : (
        <>
          <MatrixRow matrix={open.matrix} selected={open.kind === 'matrix'} onError={setError} ask={ask.matrix} />
          <Timeline
            matrix={open.matrix}
            open={open}
            zoom={zoom}
            onZoom={setZoom}
            playedSeconds={matrixPlays ? transport.played!.seconds : null}
            onError={setError}
            placing={placing}
            onPlayPad={playPad}
          />
          <TakeFromShelf placing={placing} />
          <ControlsPanel open={open} onError={setError} ask={ask.selected} />
        </>
      )}
    </main>
  );
}

/** Pads with no matrix in focus: choose one above, or slice a sample in Samples to get one. */
function NoFocus() {
  const project = useProject();
  const { store } = useApp();
  const none = Object.keys(project.matrices).length === 0;
  return (
    <div className="panel stack-tight">
      <p className="muted">{none ? 'No matrices yet. Every sample in Samples gets one; or make one with + New matrix.' : 'Choose a matrix to work on, under Focus above.'}</p>
      {none && (
        <div className="row nav-row">
          <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'samples' })}>
            ← Samples
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Drag and tap to place: what is dragged, what is picked by a tap, and
 * placing either as one undo step. A pick goes after it is placed, on
 * Escape, or on a tap anywhere but a pad, a hit or the shelf.
 */
function usePlacing(onError: (error: string | null) => void): Placing {
  const run = useRun();
  const { store } = useApp();
  const select = useOpen();
  const [dragging, setDragging] = useState<Dragged | null>(null);
  const [picked, setPicked] = useState<Dragged | null>(null);
  useEffect(() => {
    if (picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape in a dialog is the dialog's.
      if (e.key !== 'Escape' || modalOpen()) return;
      e.preventDefault();
      setPicked(null);
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.pad-column, .take-from-shelf') !== null)) setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [picked]);
  return {
    dragging,
    picked,
    startDrag: setDragging,
    endDrag: () => setDragging(null),
    pick: setPicked,
    place: (what: Dragged, target: DropTarget) => {
      setPicked(null);
      const before = store.getState().history.present;
      const error = run(dropCommand(what, target));
      onError(error);
      // A replaced hit is gone: its copy is selected, so the controls stay on a hit.
      const copy = error === null ? replacedWith(before, store.getState().history.present, target) : null;
      if (copy !== null) select({ pad: target.padId, hit: copy }, 'pads');
    },
  };
}

/** The pad or hit button a key went to in the timeline, as what is open: arrows step on from it, not from the selection. */
function keyOrigin(target: EventTarget | null, project: Project, now: PadsOpen): PadsOpen | null {
  const button = target instanceof Element ? target.closest<HTMLElement>('.pad-head, [data-hit]') : null;
  const padId = button?.closest<HTMLElement>('.pad-column')?.dataset.pad;
  if (button == null || padId === undefined) return null;
  return padsOpen(project, now.matrix.id, { pad: padId, hit: button.dataset.hit ?? null });
}

/** The timeline's button for a pad, or a hit of it. */
function timelineButton(padId: Id, hitId: Id | null): HTMLElement | null {
  const column = Array.from(document.querySelectorAll<HTMLElement>('.pad-column')).find((c) => c.dataset.pad === padId);
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
      picker.current ??= padPicker(services.rng());
      const hit = picker.current(pad);
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

/**
 * The matrix's name: renamed as it is typed, but a name typed empty is only a
 * draft until blur or Enter, which commit it; only then does it fail.
 */
function MatrixName({ matrix, onError }: { readonly matrix: Matrix; readonly onError: (error: string | null) => void }) {
  const run = useRun();
  const seal = useSeal();
  const [draft, setDraft] = useState<string | null>(null);
  const mergeKey = `matrix:${matrix.id}:name`;
  const commit = () => {
    // A name that is not empty is in already.
    if (draft !== null && draft.trim() === '') onError(run(renameMatrix(matrix.id, draft), mergeKey));
    setDraft(null);
    seal();
  };
  return (
    <input
      className="title-input mono grow"
      aria-label="Matrix name"
      value={draft ?? matrix.name}
      onChange={(e) => {
        const name = e.target.value;
        setDraft(name);
        onError(name.trim() === '' ? null : run(renameMatrix(matrix.id, name), mergeKey));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      onBlur={commit}
    />
  );
}

/**
 * The matrix in focus, on top of its timeline: selecting it shows its config
 * below. Its name, ← Samples to its trim, ♪ Song, + Pad, Clone and Delete.
 */
function MatrixRow({ matrix, selected, onError, ask }: { readonly matrix: Matrix; readonly selected: boolean; readonly onError: (error: string | null) => void; readonly ask: number }) {
  const project = useProject();
  const { store } = useApp();
  const select = useOpen();
  const heard = useHeard();
  const adding = useRunAdding(onError);
  const sample = matrix.sampleId === null ? undefined : project.samples[matrix.sampleId];
  const toSamples = () => {
    if (sample === undefined) return;
    store.dispatch({ type: 'sliceTarget', sampleId: sample.id });
    store.dispatch({ type: 'view', view: 'samples' });
  };
  const kind = matrixKind(matrix);
  return (
    <section className={`matrix-row row${selected ? ' current' : ''}`} aria-label="Matrix">
      <button
        type="button"
        className="matrix-select"
        aria-label={`Matrix ${matrix.name}`}
        aria-current={selected ? 'true' : undefined}
        title="The matrix: its config applies to every pad"
        onClick={() => select({ matrix: matrix.id, pad: null, hit: null }, 'pads')}
      >
        <MatrixKindIcon kind={kind} />
        <span className="small muted">{kind === 'break' ? 'break' : 'one-shot'}</span>
      </button>
      <MatrixName key={matrix.id} matrix={matrix} onError={onError} />
      <InSong heard={heard.matrices.has(matrix.id)} />
      {sample !== undefined && (
        <button type="button" className="link-text small" title={`Open ${trimName(sample)} in Samples`} onClick={toSamples}>
          ← Samples
        </button>
      )}
      <div className="row push nowrap">
        <button type="button" title="An empty pad last in the matrix" onClick={() => adding(addPad(matrix.id), 'pads', (id) => select({ pad: id, hit: null }, 'pads'))}>
          + Pad
        </button>
        <button
          type="button"
          title="A copy of the whole matrix, with its own pads and hits, to change apart from this one"
          onClick={() =>
            adding(cloneMatrix(matrix.id), 'matrices', (id) => {
              store.dispatch({ type: 'focus', matrix: id });
              select({ matrix: id, pad: null, hit: null }, 'pads');
            })
          }
        >
          Clone
        </button>
        <DeleteMatrix matrix={matrix} onError={onError} ask={ask} onDeleted={() => select({ matrix: null, pad: null, hit: null }, 'pads')} />
      </div>
    </section>
  );
}

/**
 * While something is dragged in Pads, the pointer near the top of the window
 * (just under the sticky header) or its bottom scrolls the page, so a timeline
 * scrolled out of view comes back to drop on, as the timeline's box scrolls sideways.
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
