import type { DragEvent } from 'react';
import { useRef } from 'react';
import type { PointerEvent } from 'react';
import { baseName, matrixKind } from '../model';
import { useApp, useProject, useSelect } from './context';
import { HIT_MIME, MATRIX_MIME } from './dnd';
import { MatrixKindIcon } from './icons';
import { middleEllipsis } from './labels';
import type { Dragged, Placing } from './pads';
import { autoscrollStep, hitLabel, sameDragged } from './pads';

/**
 * The matrices taken from, under the timeline (decision 3), each with all
 * its hits as one and its hits pad by pad. Drag one onto a pad or a hit; or
 * tap it (which plays a hit) and then a pad or a hit. The shelf scrolls in
 * its own box, also while dragging near its edge.
 */
export function TakeFromShelf({ placing }: { readonly placing: Placing }) {
  const project = useProject();
  const { services } = useApp();
  const takeFrom = useSelect((s) => s.focus.takeFrom);
  const box = useRef<HTMLElement>(null);
  // The pointer of the last press: only a finger or a pen picks (decision 8).
  const pointer = useRef('');
  const matrices = takeFrom.flatMap((id) => (project.matrices[id] === undefined ? [] : [project.matrices[id]]));
  if (matrices.length === 0) return null;

  const picked = placing.picked;
  const pickedName =
    picked === null ? null : picked.kind === 'hit' ? (project.hits[picked.hitId]?.name ?? null) : `all hits of ${project.matrices[picked.matrixId]?.name ?? ''}`;
  /**
   * A chip that drags `dragged`. A click plays a hit; a tap with a finger or
   * pen also picks it, or drops the pick when it is picked already. A mouse
   * click or Enter only plays.
   */
  const chip = (dragged: Dragged, mime: string, id: string) => ({
    draggable: true,
    'aria-pressed': sameDragged(placing.picked, dragged),
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(mime, id);
      e.dataTransfer.effectAllowed = 'copy';
      placing.startDrag(dragged);
    },
    onDragEnd: placing.endDrag,
    onPointerDown: (e: PointerEvent) => {
      pointer.current = e.pointerType;
    },
    onClick: () => {
      const touch = pointer.current === 'touch' || pointer.current === 'pen';
      pointer.current = '';
      if (dragged.kind === 'hit') services.player.playHit(project, dragged.hitId);
      if (touch) placing.pick(sameDragged(placing.picked, dragged) ? null : dragged);
    },
  });
  const autoscroll = (e: DragEvent) => {
    const element = box.current;
    if (element === null || placing.dragging === null) return;
    const rect = element.getBoundingClientRect();
    element.scrollTop += autoscrollStep(e.clientY, rect.top, rect.bottom);
  };

  return (
    <section className="take-from-shelf stack-tight" aria-label="Take from shelf" ref={box} onDragOver={autoscroll}>
      {pickedName !== null && (
        <p className="pick-note row" role="status" aria-label="Picked">
          <span className="grow">
            <span className="mono">{middleEllipsis(pickedName, 32)}</span> picked: tap a pad to add it, or a hit to replace it · Esc cancels
          </span>
          <button type="button" className="small" onClick={() => placing.pick(null)}>
            Cancel
          </button>
        </p>
      )}
      {matrices.map((m) => (
        <div key={m.id} className="shelf-matrix stack-tight" role="group" aria-label={m.name}>
          <div className="row shelf-head">
            <MatrixKindIcon kind={matrixKind(m)} />
            <span className="mono ellipsis" title={m.name}>
              {middleEllipsis(m.name, 24)}
            </span>
            <button type="button" className="chip all-hits" aria-label={`All hits of ${m.name}`} title="Drag, or tap then a pad: a copy of each of its hits, added last" {...chip({ kind: 'matrix', matrixId: m.id }, MATRIX_MIME, m.id)}>
              All hits
            </button>
          </div>
          <div className="shelf-hits">
            {m.pads.flatMap((padId, row) =>
              (project.pads[padId]?.members ?? []).map((hitId) => {
                const hit = project.hits[hitId];
                if (hit === undefined) return null;
                // A one-shot's hit by its name, not as row 01.
                const label = m.pads.length === 1 ? baseName(hit.name) : hitLabel(project, padId, row, hit);
                return (
                  <button
                    key={hitId}
                    type="button"
                    className="hit-chip mono"
                    aria-label={label === hit.name ? hit.name : `${label}, ${hit.name}`}
                    title={`${hit.name} · click plays it; drag it, or tap it and then a pad (add) or a hit (replace)`}
                    {...chip({ kind: 'hit', hitId }, HIT_MIME, hitId)}
                  >
                    {middleEllipsis(label, 16)}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
