import { useEffect, useRef, useState } from 'react';
import type { Matrix } from '../model';
import { addPad, cloneMatrix, matrixKind, renameMatrix, trimName } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import type { PadsPlay } from './ControlsPanel';
import { ControlsPanel, useRunAdding } from './ControlsPanel';
import { DeleteMatrix } from './DeleteMatrix';
import { FocusBar } from './FocusBar';
import { InSong, useHeard } from './InSong';
import { MatrixKindIcon } from './icons';
import { isTyping } from './isTyping';
import type { Dragged, DropTarget, PadsOpen, Placing, Zoom } from './pads';
import { dropCommand, padsOpen, stepSelection } from './pads';
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
  const ask = usePadsKeys(open);
  const what = open === null ? null : open.kind === 'pad' && open.pad.members.length === 0 ? null : open.kind;
  const matrixPlays = open !== null && transport.played !== null && transport.played.key === `matrix:${open.matrix.id}`;

  return (
    <main className="view wide pads-view">
      <FocusBar what={what} transport={transport} onError={setError} />
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
          />
          <TakeFromShelf placing={placing} />
          <ControlsPanel open={open} transport={transport} onError={setError} ask={ask.selected} />
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
  const [dragging, setDragging] = useState<Dragged | null>(null);
  const [picked, setPicked] = useState<Dragged | null>(null);
  useEffect(() => {
    if (picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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
      onError(run(dropCommand(what, target)));
    },
  };
}

/** Whether a key on `target` is the target's own: a field, a slider, a checkbox and the like. */
const ownKeys = (target: EventTarget | null) => isTyping(target) || (target instanceof Element && target.closest('input, [role="slider"]') !== null);

/**
 * The keys of Pads: ←/→ go from pad to pad and ↑/↓ through the pad's hits,
 * each step playing what it selects (a pad its first hit); Enter selects the
 * matrix; Delete or Backspace asks, as the Delete button does, to delete what
 * is selected. Returns the counts that make the Delete buttons ask.
 */
function usePadsKeys(open: PadsOpen | null) {
  const project = useProject();
  const { services } = useApp();
  const select = useOpen();
  const [ask, setAsk] = useState({ matrix: 0, selected: 0 });
  // The listener is set up once and reads the latest of these.
  const latest = useRef({ open, project });
  latest.current = { open, project };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { open: now, project: p } = latest.current;
      if (now === null || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || ownKeys(e.target)) return;
      if (document.querySelector('[role="alertdialog"]') !== null) return;
      if (e.key.startsWith('Arrow')) {
        const next = stepSelection(now, e.key);
        if (next === null) return;
        e.preventDefault();
        select(next, 'pads');
        const hit = next.hit ?? p.pads[next.pad]?.members[0];
        if (hit !== undefined) services.player.playHit(p, hit);
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
  }, [select, services]);
  return ask;
}
/**
 * The matrix in focus, on top of its timeline: selecting it shows its config
 * below. Its name, ← Samples to its trim, ♪ Song, + Pad, Clone and Delete.
 */
function MatrixRow({ matrix, selected, onError, ask }: { readonly matrix: Matrix; readonly selected: boolean; readonly onError: (error: string | null) => void; readonly ask: number }) {
  const project = useProject();
  const { store } = useApp();
  const run = useRun();
  const seal = useSeal();
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
      <input
        className="title-input mono grow"
        aria-label="Matrix name"
        value={matrix.name}
        onChange={(e) => onError(run(renameMatrix(matrix.id, e.target.value), `matrix:${matrix.id}:name`))}
        onBlur={seal}
      />
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
