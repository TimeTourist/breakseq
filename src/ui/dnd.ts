import type { DragEvent } from 'react';
import { useState } from 'react';

/** A placed song cell being dragged: its row, bar and what is in it. */
export const CELL_MIME = 'application/x-breakseq-cell';
/** A loop step being dragged: its index. */
export const STEP_MIME = 'application/x-breakseq-step';

/** Alt (Option) while dropping copies; otherwise a drag moves. */
export const copies = (e: DragEvent) => e.altKey;

/**
 * The drop effect to ask for. It must be one the drag allows, or the browser
 * silently refuses the drop: library chips only allow 'copy'.
 */
export function dropEffectFor(effectAllowed: string, altKey: boolean): 'copy' | 'move' {
  if (effectAllowed === 'copy') return 'copy';
  if (effectAllowed === 'move') return 'move';
  return altKey ? 'copy' : 'move';
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
        e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed, e.altKey);
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
  return { bind, isOver: (key: string) => over === key, clear: () => setOver(null) };
}
