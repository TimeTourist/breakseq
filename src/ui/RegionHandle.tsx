interface RegionHandleProps {
  readonly which: 'start' | 'end';
  /** Where it is, as a CSS left: "25%" or "320px". */
  readonly left: string;
  readonly label: string;
  readonly title?: string;
  readonly className?: string;
  /** Dragged to this pointer x; `handle` is the handle itself, to find what it sits in. */
  readonly onDrag: (clientX: number, handle: HTMLElement) => void;
  /** ←/→ pressed: -1 or 1, and whether with Shift. */
  readonly onNudge: (direction: -1 | 1, big: boolean) => void;
  /** The drag or key press has ended: close its undo step. */
  readonly onDone: () => void;
}

/**
 * One end of a region over a waveform or timeline, the same in Trim, Hits and
 * Song: dragged, or focused and moved with ←/→. One drag is one undo step.
 */
export function RegionHandle({ which, left, label, title, className = '', onDrag, onNudge, onDone }: RegionHandleProps) {
  return (
    <button
      type="button"
      className={`trim-handle ${which} ${className}`.trim()}
      style={{ left }}
      aria-label={label}
      title={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.clientX, e.currentTarget);
      }}
      onPointerUp={onDone}
      onKeyDown={(e) => {
        const direction = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (direction === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onNudge(direction, e.shiftKey);
      }}
      onKeyUp={onDone}
    />
  );
}
