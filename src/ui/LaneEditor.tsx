import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { LaneStep, StepEffect } from '../model';
import { LANES, STEP_SIZES, cycleChance, denorm, isDice, moveEdge, nearerEdge, norm, paintSteps, toggleDice } from '../model';
import { dragText, shortValue, stepTitle } from './laneText';
import { TARGET_LABELS } from './modLabels';

/** How much of the song a lane shows: two bars, or a bar more than the lane, so its loop shows after ↻. */
export const laneView = (effect: Pick<StepEffect, 'step' | 'lane'>) => {
  const size = STEP_SIZES[effect.step];
  const length = effect.lane.length * size;
  return { size, length, total: Math.max(32, Math.ceil((length + 1) / 16) * 16) };
};

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/** Where a step's bar goes, as parts of the lane's height: from the zero line (or the bottom) to its value, or its band. */
function shapeOf(effect: StepEffect, step: LaneStep): { bottom: number; height: number; kind: 'value' | 'band' | 'off' } {
  const range = LANES[effect.target];
  if (range.onOff === true) {
    if (isDice(step)) return { bottom: 0, height: 0.82, kind: 'band' };
    return step.v >= 0.5 ? { bottom: 0, height: 0.82, kind: 'value' } : { bottom: 0, height: 0, kind: 'off' };
  }
  if (isDice(step)) {
    const lo = norm(effect.target, step.lo);
    return { bottom: lo, height: norm(effect.target, step.hi) - lo, kind: 'band' };
  }
  const base = range.bipolar === true ? norm(effect.target, range.zero) : 0;
  const n = norm(effect.target, step.v);
  return { bottom: Math.min(n, base), height: Math.abs(n - base), kind: 'value' };
}

function StepShape({ effect, step, ghost }: { effect: StepEffect; step: LaneStep; ghost?: boolean }) {
  const { bottom, height, kind } = shapeOf(effect, step);
  const style: CSSProperties = { bottom: pct(bottom), height: kind === 'off' ? undefined : `max(${kind === 'band' ? 4 : 2}px, ${pct(height)})` };
  return <span className={`lane-shape ${kind}${ghost === true ? ' ghost' : ''}`} style={style} />;
}

type Drag =
  | { readonly mode: 'paint'; readonly lane: LaneStep[]; last: number; readonly start: number }
  | { readonly mode: 'toggle'; readonly lane: LaneStep[]; last: number; readonly start: number; readonly value: number }
  | { readonly mode: 'lo' | 'hi'; readonly lane: LaneStep[]; readonly start: number };

interface LaneEditorProps {
  readonly effect: StepEffect;
  /** The lane drawn so far in a drag, or changed by a click; `done` when the drag or click is over. */
  readonly onChange: (lane: readonly LaneStep[], done: boolean) => void;
}

/**
 * A lane to draw in (see Stegrader): drag up or down on a step to set it, and
 * across steps to paint them (dice steps are not painted over); on a dice step
 * a drag moves the nearer edge of its band. 🎲 on a step makes it a dice step,
 * or fixed again; its chance under it steps 100, 75, 50, 25 %. After ↻ the lane
 * shows faint, as it goes on over a clip.
 */
export function LaneEditor({ effect, onChange }: LaneEditorProps) {
  const { size, length, total } = laneView(effect);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const range = LANES[effect.target];
  const name = TARGET_LABELS[effect.target];

  const placeOf = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    const y = r.height > 0 ? (e.clientY - r.top) / r.height : 0;
    return { index: Math.floor((x * total) / size), value: denorm(effect, 1 - y) };
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { index, value } = placeOf(e);
    const step = effect.lane[index];
    if (step === undefined) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every browser (or test) can capture.
    }
    const lane = [...effect.lane];
    if (range.onOff === true) {
      if (isDice(step)) return;
      drag.current = { mode: 'toggle', lane, last: index, start: index, value: step.v >= 0.5 ? 0 : 1 };
    } else if (isDice(step)) {
      drag.current = { mode: nearerEdge(effect.target, step, value), lane, start: index };
    } else {
      drag.current = { mode: 'paint', lane, last: index, start: index };
    }
    apply(index, value);
  };

  const apply = (index: number, value: number) => {
    const d = drag.current;
    if (d === null) return;
    let next: LaneStep[];
    if (d.mode === 'paint' || d.mode === 'toggle') {
      const at = Math.max(0, Math.min(d.lane.length - 1, index));
      next = paintSteps(d.lane, d.last, at, d.mode === 'toggle' ? d.value : value);
      d.last = at;
      setDragging(at);
    } else {
      next = moveEdge(d.lane, d.start, d.mode, value);
      setDragging(d.start);
    }
    drag.current = { ...d, lane: next };
    onChange(next, false);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    const { index, value } = placeOf(e);
    apply(index, value);
  };

  const up = () => {
    const d = drag.current;
    if (d === null) return;
    drag.current = null;
    setDragging(null);
    onChange(d.lane, true);
  };

  const stop = (e: PointerEvent) => e.stopPropagation();
  const ghosts = [];
  for (let j = effect.lane.length; j * size < total; j++) {
    const step = effect.lane[j % effect.lane.length]!;
    const width = Math.min(size, total - j * size);
    ghosts.push(
      <div key={j} className={`lane-ghost${j % effect.lane.length === 0 ? ' restart' : ''}`} style={{ left: `calc(${pct((j * size) / total)} + 1px)`, width: `calc(${pct(width / total)} - 2px)` }}>
        <StepShape effect={effect} step={step} ghost />
      </div>,
    );
  }
  const marks = [];
  for (let k = 0; k < total; k += 4) {
    const bar = k % 16 === 0;
    marks.push(
      <span key={k} className={`lane-mark${bar ? ' bar' : ''}${k >= length ? ' after' : ''}`} style={{ left: `calc(${pct(k / total)} + 3px)` }}>
        {bar ? String(k / 16 + 1) : `${Math.floor(k / 16) + 1}.${(k % 16) / 4 + 1}`}
      </span>,
    );
  }
  const grid: CSSProperties = { backgroundSize: `calc(100% * 16 / ${total}) 100%, calc(100% * 4 / ${total}) 100%, calc(100% / ${total}) 100%` };
  const zero = range.bipolar === true ? norm(effect.target, range.zero) : null;
  const narrow = effect.step === '1/16';

  return (
    <div className="lane-wrap">
      <div className="lane-ruler" aria-hidden="true">
        {marks}
      </div>
      <div
        className="lane"
        role="group"
        aria-label={`${name} steps`}
        data-target={effect.target}
        style={grid}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      >
        {zero !== null && <span className="lane-zero" style={{ bottom: pct(zero) }} />}
        {ghosts}
        <span className="lane-after" style={{ left: pct(length / total) }} />
        <span className="lane-end" style={{ left: pct(length / total) }} title="The lane ends here and starts again: in Song it loops over the whole clip">
          ↻
        </span>
        {effect.lane.map((step, i) => {
          const editing = dragging === i;
          const top = isDice(step) ? norm(effect.target, step.hi) : range.onOff === true ? 0.82 : Math.max(norm(effect.target, step.v), zero ?? 0);
          return (
            <div
              key={i}
              className={`lane-step${editing ? ' editing' : ''}${isDice(step) ? ' dice' : ''}`}
              title={stepTitle(effect, step, i)}
              data-step={i}
              style={{ left: `calc(${pct((i * size) / total)} + 1px)`, width: `calc(${pct(size / total)} - 2px)` }}
            >
              <StepShape effect={effect} step={step} />
              {isDice(step) && (
                <button
                  type="button"
                  className="lane-chance"
                  aria-label={`Step ${i + 1} chance ${step.chance}%`}
                  title="Chance it does anything on a pass: click for 100 / 75 / 50 / 25 %"
                  onPointerDown={stop}
                  onClick={() => onChange(cycleChance(effect.lane, i), true)}
                >
                  {step.chance}%
                </button>
              )}
              <button
                type="button"
                className="lane-dice"
                aria-label={isDice(step) ? `Fix step ${i + 1}` : `Make step ${i + 1} a dice step`}
                title={isDice(step) ? `Step ${i + 1} is a dice step: click to fix it in the middle of its band` : `Make step ${i + 1} a dice step: a new value every pass`}
                aria-pressed={isDice(step)}
                onPointerDown={stop}
                onClick={() => onChange(toggleDice(effect, i), true)}
              >
                🎲
              </button>
              {editing && (
                <span className="lane-bubble" style={{ bottom: `calc(${pct(Math.min(top, 0.8))} + 6px)` }}>
                  {dragText(effect, step)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="lane-values" aria-hidden="true">
        {effect.lane.map((step, i) => (
          <span key={i} className={dragging === i ? 'editing' : undefined} style={{ left: pct((i * size) / total), width: pct(size / total) }}>
            {isDice(step) ? (narrow || range.onOff === true ? '🎲' : `${shortValue(effect, step.lo)}…${shortValue(effect, step.hi)}`) : shortValue(effect, step.v)}
          </span>
        ))}
      </div>
    </div>
  );
}
