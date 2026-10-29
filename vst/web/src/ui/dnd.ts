import type { DragEvent } from 'react';
import { useState } from 'react';

/** A placed song cell being dragged: its row, bar and what is in it. */
export const CELL_MIME = 'application/x-breakseq-cell';
/** A loop step being dragged: its index. */
export const STEP_MIME = 'application/x-breakseq-step';
/** A hit being dragged: its id. Dropped on a pad or matrix it is copied there. */
export const HIT_MIME = 'application/x-breakseq-hit';
/** A pad being dragged: its id. */
export const PAD_MIME = 'application/x-breakseq-pad';
/** A matrix being dragged: its id. */
export const MATRIX_MIME = 'application/x-breakseq-matrix';

/**
 * Ctrl while dropping copies; otherwise a drag moves. Alt (Option) copies too,
 * as on a Mac, though on Linux Alt+drag moves the browser's window instead.
 */
export const copies = (e: Pick<DragEvent, 'ctrlKey' | 'altKey'>) => e.ctrlKey || e.altKey;

/**
 * The drop effect to ask for. It must be one the drag allows, or the browser
 * silently refuses the drop: library chips only allow 'copy'.
 */
export function dropEffectFor(effectAllowed: string, copy: boolean): 'copy' | 'move' {
  if (effectAllowed === 'copy') return 'copy';
  if (effectAllowed === 'move') return 'move';
  return copy ? 'copy' : 'move';
}

/**
 * Drop targets that light up while something they accept is dragged over them.
 * `bind(key, accepts, onDrop)` gives the handlers, and `isOver(key)` whether to highlight.
 */
export function useDropTargets() {
  const [over, setOver] = useState<string | null>(null);
  const bind = (key: string, accepts: readonly string[], onDrop: (e: DragEvent, type: string) => void) => {
    const type = (e: DragEvent) => accepts.find((t) => e.dataTransfer.types.includes(t));
    return {
      onDragOver: (e: DragEvent) => {
        if (type(e) === undefined) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed, copies(e));
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver((current) => (current === key ? null : current)),
      onDrop: (e: DragEvent) => {
        setOver(null);
        const t = type(e);
        if (t === undefined) return;
        e.preventDefault();
        onDrop(e, t);
      },
    };
  };
  return { bind, over, isOver: (key: string) => over === key, clear: () => setOver(null) };
}
