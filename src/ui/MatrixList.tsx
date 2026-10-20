import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { Id, Matrix, Pad } from '../model';
import { matrixKind, moveMatrix } from '../model';
import { useApp, useProject, useRun } from './context';
import { HIT_MIME, PAD_MIME } from './dnd';
import { FoldAllIcon, FoldIcon, MatrixKindIcon, PinIcon } from './icons';
import { InSongMark, useHeard } from './InSong';
import { middleEllipsis } from './labels';
import type { PadsOpen, Placing } from './pads';
import { hitLabel, rowNumber } from './pads';

/** A matrix's row being dragged in the list, to reorder: its id. Only the list takes it. */
const MATRIX_ROW_MIME = 'application/x-breakseq-matrix-row';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface MatrixListProps {
  /** What is open: the matrix the view shows, and the pad or hit selected in it. */
  readonly open: PadsOpen | null;
  /** The pinned matrix, if any. */
  readonly pinned: Id | null;
  readonly placing: Placing;
  /** Shows a matrix, and selects a pad or a hit of it, or the matrix with neither. */
  readonly show: (matrixId: Id, padId: Id | null, hitId: Id | null) => void;
  /** Plays a pad one pick, as it picks. */
  readonly onPlayPad: (pad: Pad) => void;
  readonly onError: (error: string | null) => void;
}

/**
 * The matrices as a tree, as Samples lists its files (Magnus beslut): a
 * matrix with a pin and ▼, its pads under it, and the hits of a pad with more
 * than one under ▸/▼. Several can be open. With no pin the view shows the
 * matrix whose row, pad or hit was clicked last, and a click on a pad or a hit
 * selects and plays it; with a matrix pinned the view keeps to it, and a
 * click on another matrix's pad or hit only plays it, its row only folds. Pads
 * and hits are dragged from here onto the grid, always as copies; a matrix's
 * row is dragged to reorder the list.
 */
export function MatrixList({ open, pinned, placing, show, onPlayPad, onError }: MatrixListProps) {
  const project = useProject();
  const run = useRun();
  const { services, store } = useApp();
  const heard = useHeard();
  const matrices = Object.values(project.matrices);
  const shown = open?.matrix.id ?? null;
  /** Matrices unfolded: the one shown at first, then as unfolded. The view's choice, not saved. (Claudes val.) */
  const [unfolded, setUnfolded] = useState<ReadonlySet<Id>>(() => new Set(shown === null ? [] : [shown]));
  /** Pads with several hits whose hits show: folded at first. (Claudes val.) */
  const [padsOpen, setPadsOpen] = useState<ReadonlySet<Id>>(new Set());
  /** The matrix row a dragged row is over, which it goes before. */
  const [rowOver, setRowOver] = useState<Id | null>(null);
  const [rowDragged, setRowDragged] = useState<Id | null>(null);
  // A matrix shown from elsewhere (a link in the row under the tabs, Clone) unfolds.
  useEffect(() => {
    if (shown !== null) setUnfolded((was) => (was.has(shown) ? was : new Set([...was, shown])));
  }, [shown]);
  const allFolded = matrices.every((m) => !unfolded.has(m.id));
  const toggle = (set: ReadonlySet<Id>, id: Id): ReadonlySet<Id> => (set.has(id) ? new Set([...set].filter((x) => x !== id)) : new Set([...set, id]));
  const isOpen = (id: Id) => unfolded.has(id);

  /** A pad or hit row's drag: onto the grid, as a copy. */
  const dragFrom = (mime: string, id: Id, dragged: Parameters<Placing['startDrag']>[0]) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(mime, id);
      e.dataTransfer.effectAllowed = 'copy';
      placing.startDrag(dragged);
    },
    onDragEnd: placing.endDrag,
  });
  /** A matrix row's drag: onto another row, to go before it. */
  const reorder = (matrix: Matrix) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(MATRIX_ROW_MIME, matrix.id);
      e.dataTransfer.effectAllowed = 'move';
      setRowDragged(matrix.id);
    },
    onDragEnd: () => {
      setRowDragged(null);
      setRowOver(null);
    },
    onDragOver: (e: DragEvent) => {
      if (rowDragged === null || rowDragged === matrix.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (rowOver !== matrix.id) setRowOver(matrix.id);
    },
    onDragLeave: () => setRowOver((was) => (was === matrix.id ? null : was)),
    onDrop: (e: DragEvent) => {
      const from = rowDragged;
      setRowDragged(null);
      setRowOver(null);
      if (from === null || from === matrix.id) return;
      e.preventDefault();
      const order = Object.keys(project.matrices).filter((id) => id !== from);
      onError(run(moveMatrix(from, order.indexOf(matrix.id))));
    },
  });

  return (
    <section className="panel file-list matrix-list" aria-label="Matrices">
      <div className="file-list-head">
        <span className="label">Matrices</span>
        <span className="muted small drop-hint">· drag to the grid to copy</span>
        {matrices.length > 0 && (
          <button
            type="button"
            className="icon-button small push"
            aria-label={allFolded ? 'Expand all' : 'Collapse all'}
            title={allFolded ? 'Expand all' : 'Collapse all'}
            onClick={() => setUnfolded(allFolded ? new Set(matrices.map((m) => m.id)) : new Set())}
          >
            <FoldAllIcon folded={allFolded} />
          </button>
        )}
      </div>
      {matrices.map((matrix) => {
        const unfoldedNow = isOpen(matrix.id);
        const kind = matrixKind(matrix);
        // Another matrix is pinned: clicks here only play, and its row only folds. (Claudes val.)
        const locked = pinned !== null && pinned !== matrix.id;
        const isPinned = pinned === matrix.id;
        return (
          <div key={matrix.id} className="file-group" role="group" aria-label={matrix.name}>
            <div className={`file-row matrix-tree-row${rowOver === matrix.id ? ' drop-before' : ''}${rowDragged === matrix.id ? ' dragged' : ''}`} title="Drag to reorder" {...reorder(matrix)}>
              <span className="grip" aria-hidden="true">
                ⋮⋮
              </span>
              <button
                type="button"
                className={`icon-button small pin${isPinned ? ' pinned' : ''}`}
                aria-pressed={isPinned}
                aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${matrix.name}`}
                title={isPinned ? 'Pinned: this matrix stays in view and clicks elsewhere only play. Click to unpin' : 'Pin: keep this matrix in view; clicks elsewhere only play'}
                onClick={() => {
                  store.dispatch({ type: 'focus', matrix: isPinned ? null : matrix.id });
                  if (!isPinned) {
                    setUnfolded((was) => new Set([...was, matrix.id]));
                    if (open?.matrix.id !== matrix.id) show(matrix.id, null, null);
                  }
                }}
              >
                <PinIcon />
              </button>
              <button
                type="button"
                className="icon-button small fold"
                aria-expanded={unfoldedNow}
                aria-label={`${unfoldedNow ? 'Hide' : 'Show'} the pads of ${matrix.name}`}
                onClick={() => setUnfolded((was) => toggle(was, matrix.id))}
              >
                <FoldIcon folded={!unfoldedNow} />
              </button>
              <button
                type="button"
                className={`matrix-pick${matrix.id === shown ? ' shown' : ''}`}
                aria-current={open?.kind === 'matrix' && matrix.id === shown ? 'true' : undefined}
                aria-label={`Matrix ${matrix.name}`}
                title={`${matrix.name}: click for the matrix`}
                onClick={() => {
                  if (locked) {
                    setUnfolded((was) => toggle(was, matrix.id));
                    return;
                  }
                  setUnfolded((was) => new Set([...was, matrix.id]));
                  show(matrix.id, null, null);
                }}
              >
                <MatrixKindIcon kind={kind} />
                <span className="mono file-name">{middleEllipsis(matrix.name)}</span>
              </button>
              {!unfoldedNow && <span className="muted small">{plural(matrix.pads.length, 'pad')}</span>}
            </div>
            {unfoldedNow &&
              matrix.pads.map((padId, row) => {
                const pad = project.pads[padId];
                if (pad === undefined) return null;
                const many = pad.members.length > 1;
                const hitsShow = many && padsOpen.has(pad.id);
                const padSelected = open !== null && open.kind === 'pad' && open.pad.id === pad.id;
                const first = pad.members[0] === undefined ? undefined : project.hits[pad.members[0]];
                const what = pad.members.length === 0 ? 'empty' : many ? plural(pad.members.length, 'hit') : `1 hit · ${first === undefined ? '' : middleEllipsis(hitLabel(project, pad.id, row, first))}`;
                return (
                  <div key={pad.id} className="pad-group">
                    <div className={`sample-row pad-row${padSelected ? ' selected' : ''}`}>
                      {many ? (
                        <button
                          type="button"
                          className="icon-button small fold"
                          aria-expanded={hitsShow}
                          aria-label={`${hitsShow ? 'Hide' : 'Show'} the hits of ${pad.name}`}
                          onClick={() => setPadsOpen((was) => toggle(was, pad.id))}
                        >
                          <FoldIcon folded={!hitsShow} />
                        </button>
                      ) : (
                        <span className="fold-space" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="sample-pick"
                        aria-pressed={padSelected}
                        aria-label={`Pad ${pad.name}`}
                        title="Click to select and hear the pad · drag it onto the grid to copy its hits"
                        {...dragFrom(PAD_MIME, pad.id, { kind: 'pad', padId: pad.id, from: 'list' })}
                        onClick={() => {
                          if (!locked) show(matrix.id, pad.id, null);
                          onPlayPad(pad);
                        }}
                      >
                        <span className="mono faint">{rowNumber(row)}</span>
                        <span className="grow ellipsis">{what}</span>
                        <InSongMark heard={heard.pads.has(pad.id)} />
                      </button>
                    </div>
                    {hitsShow &&
                      pad.members.map((hitId, i) => {
                        const hit = project.hits[hitId];
                        if (hit === undefined) return null;
                        const hitSelected = open !== null && open.kind === 'hit' && open.hit.id === hitId;
                        return (
                          <div key={hitId} className={`sample-row hit-row${hitSelected ? ' selected' : ''}`}>
                            <button
                              type="button"
                              className="sample-pick"
                              aria-pressed={hitSelected}
                              aria-label={`Hit ${i + 1} ${hit.name}`}
                              title="Click to select and hear the hit · drag it onto the grid to copy it"
                              {...dragFrom(HIT_MIME, hitId, { kind: 'hit', hitId, from: 'list' })}
                              onClick={() => {
                                if (!locked) show(matrix.id, pad.id, hitId);
                                services.player.playHit(project, hitId);
                              }}
                            >
                              <span className="faint">hit {i + 1}</span>
                              <span className="mono grow ellipsis">{middleEllipsis(hitLabel(project, pad.id, row, hit))}</span>
                              <InSongMark heard={heard.hits.has(hitId)} />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}
    </section>
  );
}
