import { useRef } from 'react';
import type { Loop } from '../model';
import { STEPS_PER_BAR, setFillWindow } from '../model';
import { useRun, useSeal } from './context';

/** A step index as T<bar> · <step>, 1-based. */
export const stepName = (index: number) =>
  `T${Math.floor(index / STEPS_PER_BAR) + 1} · ${String((index % STEPS_PER_BAR) + 1).padStart(2, '0')}`;

interface FillWindowProps {
  readonly loop: Loop;
  readonly onError: (error: string | null) => void;
}

/** The window as text, with quick settings for common fills. */
export function FillWindow({ loop, onError }: FillWindowProps) {
  const run = useRun();
  const total = loop.steps.length;
  const { start, end } = loop.window;
  const lastBar = total - STEPS_PER_BAR;
  const presets = [
    { label: 'Whole', from: 0, to: total },
    { label: 'Last 1/2', from: lastBar + 8, to: total },
    { label: 'Last 1/4', from: lastBar + 12, to: total },
  ];
  return (
    <section className="row" aria-label="Fill window">
      <div className="row">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="small-button"
            aria-pressed={start === p.from && end === p.to}
            onClick={() => onError(run(setFillWindow(loop.id, p.from, p.to)))}
          >
            {p.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Where a fill takes over, as a row above one bar of its steps: drag the start
 * and end, as when trimming a sample. Outside the window the main shows through.
 */
export function FillWindowStrip({ loop, bar, onError }: FillWindowProps & { readonly bar: number }) {
  const run = useRun();
  const seal = useSeal();
  const strip = useRef<HTMLDivElement>(null);
  const total = loop.steps.length;
  const { start, end } = loop.window;
  const first = bar * STEPS_PER_BAR;
  const set = (from: number, to: number) => onError(run(setFillWindow(loop.id, from, to), `window:${loop.id}`));
  // The window's part of this bar, in steps 0–16 of the bar.
  const from = Math.max(0, Math.min(STEPS_PER_BAR, start - first));
  const to = Math.max(from, Math.min(STEPS_PER_BAR, end - first));

  /** The step boundary (0…total) nearest a pointer position, which may be in another bar. */
  const boundaryAt = (clientX: number) => {
    const rect = strip.current?.getBoundingClientRect();
    if (rect === undefined) return first;
    return Math.max(0, Math.min(total, first + Math.round(((clientX - rect.left) / rect.width) * STEPS_PER_BAR)));
  };

  const handle = (which: 'start' | 'end') => {
    const at = which === 'start' ? start : end;
    const moveTo = (b: number) => (which === 'start' ? set(Math.min(b, end - 1), end) : set(start, Math.max(b, start + 1)));
    return (
      <button
        type="button"
        className={`trim-handle window-handle ${which}`}
        style={{ left: `${((at - first) / STEPS_PER_BAR) * 100}%` }}
        aria-label={which === 'start' ? `Fill starts at ${stepName(start)}` : `Fill ends after ${stepName(end - 1)}`}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(boundaryAt(e.clientX));
        }}
        onPointerUp={seal}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
          if (step === 0) return;
          e.preventDefault();
          moveTo(at + step * (e.shiftKey ? 4 : 1));
        }}
        onKeyUp={seal}
      />
    );
  };

  // Each handle sits in the bar its boundary falls in; an end on a bar line belongs to the bar before it.
  const startHere = start >= first && start < first + STEPS_PER_BAR;
  const endHere = end > first && end <= first + STEPS_PER_BAR;
  return (
    <div className="step-row">
      <span className="mono muted small" title="Drag the handles, or focus one and use ←/→ (Shift: a beat)">
        {bar === 0 ? 'Fill' : ''}
      </span>
      <div className="window-strip" ref={strip}>
        {to > from && (
          <div className="window-fill" style={{ left: `${(from / STEPS_PER_BAR) * 100}%`, width: `${((to - from) / STEPS_PER_BAR) * 100}%` }} />
        )}
        {startHere && handle('start')}
        {endHere && handle('end')}
      </div>
    </div>
  );
}
