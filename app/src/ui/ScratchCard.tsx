import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import type { ScratchEffect, ScratchMotion, ScratchRecord, StepSize } from '../model';
import {
  MAX_LANE_STEPS,
  MIN_SCRATCH_STEPS,
  SCRATCH_PRESETS,
  SCRATCH_RECORDS,
  STEP_SIZES,
  clearScratch,
  rampScratch,
  randomizeScratch,
  scratchCurve,
  scratchEnd,
  scratchMotion,
  scratchRampsUp,
  scratchSpeeds,
  setScratchLength,
  snapPoint,
  toggleFader,
} from '../model';
import { RECORD_TEXT, scratchSentence, scratchSpeedLabel, scratchSpeedText } from './audioText';
import { TrashIcon } from './icons';

const SIZES: readonly { value: StepSize; label: string; title: string }[] = [
  { value: '1/16', label: '1/16', title: 'Each step lasts 1/16' },
  { value: 'beat', label: 'beat', title: 'Each step lasts 1 beat' },
  { value: 'bar', label: 'bar', title: 'Each step lasts 1 bar' },
];

export interface ScratchCardProps {
  readonly effect: ScratchEffect;
  /** A changed effect; `key` merges changes in a row into one undo step (a drag). */
  readonly onChange: (effect: ScratchEffect, key?: string) => void;
  /** A drag is over: close its undo step. */
  readonly onCommit: () => void;
  readonly onRemove: () => void;
  /** Randomness for Randomize: a drawing tool, so it is kept as the points and cells. */
  readonly rng: () => number;
}

/** The needle lane's drawing: a viewBox of 1000 × LH, the needle from PAD at the top (the end) to LH − PAD at the bottom (the start). */
const LH = 150;
const PAD = 8;
const W = 1000;
const yOf = (p: number) => PAD + (1 - p) * (LH - 2 * PAD);
const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
const f1 = (x: number) => x.toFixed(1);

/** How much of the song the card shows: two bars, or a bar more than the movement, so its loop shows after ↻. */
const viewOf = (effect: ScratchEffect) => {
  const size = STEP_SIZES[effect.step];
  const length = effect.points.length * size;
  return { size, length, total: Math.max(32, Math.ceil((length + 1) / 16) * 16) };
};

/**
 * Scratch, as a card (see Scratch and the sketch): what it records, Step and
 * Length, Start from, Randomize, Ramp and Clear; the needle lane with the
 * smoothed curve the sound follows, the speed under each step, and the
 * crossfader.
 */
export function ScratchCard({ effect, onChange, onCommit, onRemove, rng }: ScratchCardProps) {
  const n = effect.points.length;
  const { size, length, total } = viewOf(effect);
  const speeds = scratchSpeeds(effect);
  const motions = speeds.map(scratchMotion);
  const rampsUp = scratchRampsUp(effect);
  const drag = useRef<{ points: number[]; last: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const xOf = (sixteenths: number) => (sixteenths / total) * W;

  // The curve, step by step as cubic Béziers: the movement coloured by its motion, its loops after ↻ faint, and the jumps back dashed.
  const paths: Record<ScratchMotion | 'ghost' | 'jump', string> = { forward: '', backward: '', held: '', ghost: '', jump: '' };
  for (let r = 0; r * length < total; r++) {
    for (let j = 0; j < n && r * length + j * size < total; j++) {
      const [c0, c1, c2, c3] = scratchCurve(effect, j);
      const x1 = xOf(r * length + j * size);
      const x2 = xOf(r * length + (j + 1) * size);
      const dx = x2 - x1;
      const b = [c0, c0 + c1 / 3, c0 + (2 * c1) / 3 + c2 / 3, c0 + c1 + c2 + c3].map(yOf);
      const d = `M${f1(x1)} ${f1(b[0]!)}C${f1(x1 + dx / 3)} ${f1(b[1]!)} ${f1(x2 - dx / 3)} ${f1(b[2]!)} ${f1(x2)} ${f1(b[3]!)}`;
      paths[r === 0 ? motions[j]! : 'ghost'] += d;
    }
    const x = f1(xOf((r + 1) * length));
    if ((r + 1) * length <= total) paths.jump += `M${x} ${f1(yOf(scratchEnd(effect.points)))}L${x} ${f1(yOf(effect.points[0]!))}`;
  }

  const placeOf = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = r.width > 0 ? ((e.clientX - r.left) / r.width) * total : 0;
    const y = r.height > 0 ? ((e.clientY - r.top) / r.height) * LH : 0;
    return { at, index: Math.max(0, Math.min(n - 1, Math.round(at / size))), value: snapPoint(effect.record, 1 - (y - PAD) / (LH - 2 * PAD)) };
  };
  const paint = (index: number, value: number) => {
    const d = drag.current;
    if (d === null) return;
    const [a, b] = d.last <= index ? [d.last, index] : [index, d.last];
    for (let k = a; k <= b; k++) d.points[k] = value;
    d.last = index;
    setDragging(index);
    onChange({ ...effect, points: [...d.points] }, 'needle');
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { at, index, value } = placeOf(e);
    // After ↻ there is no point to drag: the movement loops there.
    if (at > length - size / 2) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every browser (or test) can capture.
    }
    drag.current = { points: [...effect.points], last: index };
    paint(index, value);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    const { index, value } = placeOf(e);
    paint(index, value);
  };
  const up = () => {
    if (drag.current === null) return;
    drag.current = null;
    setDragging(null);
    onCommit();
  };

  // The fader under every step shown, its cells clickable in the movement and faint after ↻; closed cells shade the lane above.
  const cells: { key: string; style: CSSProperties; open: boolean; i: number; half: number; split: boolean; ghost: boolean }[] = [];
  for (let j = 0; j * size < total; j++) {
    const cell = effect.fader[j % n] ?? [true];
    cell.forEach((open, half) => {
      const left = (j * size + (half * size) / cell.length) / total;
      const width = size / cell.length / total;
      cells.push({ key: `${j}:${half}`, style: { left: `calc(${pct(left)} + 1px)`, width: `calc(${pct(width)} - 2px)` }, open, i: j % n, half, split: cell.length > 1, ghost: j >= n });
    });
  }
  const faderTitle = (c: (typeof cells)[number]) =>
    `Fader, step ${c.i + 1}${c.split ? (c.half === 0 ? ', first half' : ', second half') : ''}: ${c.open ? 'open' : 'closed (muted)'}. Click to ${c.open ? 'close' : 'open'}; Alt-click to ${c.split ? 'join the halves' : 'split it in two'}`;
  const clickFader = (c: (typeof cells)[number]) => (e: MouseEvent) => onChange(toggleFader(effect, c.i, c.half, e.altKey));

  const marks = [];
  for (let k = 0; k < total; k += 4) {
    const bar = k % 16 === 0;
    marks.push(
      <span key={k} className={`lane-mark${bar ? ' bar' : ''}${k >= length ? ' after' : ''}`} style={{ left: `calc(${pct(k / total)} + 3px)` }}>
        {bar ? String(k / 16 + 1) : `${Math.floor(k / 16) + 1}.${(k % 16) / 4 + 1}`}
      </span>,
    );
  }
  const grid: CSSProperties = {
    backgroundSize: `calc(100% * 16 / ${total}) 100%, calc(100% * 4 / ${total}) 100%, calc(100% / ${total}) 100%, 100% calc((100% - ${2 * PAD}px) / ${effect.record})`,
    backgroundPosition: `0 0, 0 0, 0 0, 0 ${PAD}px`,
  };

  return (
    <article className="mod-card" aria-label="Scratch">
      <div className="mod-card-head">
        <h3>Scratch</h3>
        <span className="mod-unit">needle + fader</span>
        <button type="button" className="icon-button small push" aria-label="Remove Scratch" title="Remove Scratch from the mod" onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>
      <p className="mod-card-sentence" aria-live="polite">
        {scratchSentence(effect)}
      </p>
      <div className="mod-card-controls">
        <span className="lane-extra-label">Records the first</span>
        <select
          aria-label="Recorded length"
          className="scratch-record"
          value={effect.record}
          title="Like Tape: what is heard under the start of the clip is recorded, then played by the hand"
          onChange={(e) => onChange({ ...effect, record: Number(e.target.value) as ScratchRecord })}
        >
          {SCRATCH_RECORDS.map((r) => (
            <option key={r} value={r}>
              {RECORD_TEXT[r]}
            </option>
          ))}
        </select>
        <span className="lane-extra-label">under the clip</span>
        <span className="mod-card-sep" aria-hidden="true" />
        <span className="lane-extra-label">Step</span>
        <div className="segmented" role="group" aria-label="Step size">
          {SIZES.map((z) => (
            <button key={z.value} type="button" aria-pressed={effect.step === z.value} title={z.title} onClick={() => onChange({ ...effect, step: z.value })}>
              {z.label}
            </button>
          ))}
        </div>
        <span className="lane-extra-label">Length</span>
        <div className="lane-length" role="group" aria-label="Length">
          <button
            type="button"
            aria-label="One step fewer"
            title={n <= MIN_SCRATCH_STEPS ? 'A movement has at least 2 steps' : 'One step fewer'}
            disabled={n <= MIN_SCRATCH_STEPS}
            onClick={() => onChange(setScratchLength(effect, n - 1))}
          >
            −
          </button>
          <span className="mono">
            {n} {n === 1 ? 'step' : 'steps'}
          </span>
          <button
            type="button"
            aria-label="One step more"
            title={n >= MAX_LANE_STEPS ? 'A movement has at most 16 steps' : 'One step more: a copy of the last'}
            disabled={n >= MAX_LANE_STEPS}
            onClick={() => onChange(setScratchLength(effect, n + 1))}
          >
            +
          </button>
        </div>
      </div>
      <div className="mod-card-controls scratch-tools">
        <span className="lane-extra-label">Start from</span>
        {SCRATCH_PRESETS.map((p) => (
          <button key={p.name} type="button" className="small-button" title={p.does} onClick={() => onChange(p.draw(effect))}>
            {p.name}
          </button>
        ))}
        <span className="mod-card-sep" aria-hidden="true" />
        <button type="button" className="small-button" title="A random hand movement and fader, as if drawn" onClick={() => onChange(randomizeScratch(effect, rng))}>
          🎲 Randomize
        </button>
        <button
          type="button"
          className="small-button"
          title={
            rampsUp
              ? 'One steady forward sweep through the recording (start to end); next press sweeps backward'
              : 'One steady backward sweep through the recording (end to start); next press sweeps forward'
          }
          onClick={() => onChange(rampScratch(effect, rampsUp))}
        >
          {rampsUp ? 'Ramp ↗' : 'Ramp ↘'}
        </button>
        <button type="button" className="small-button" title="Play normally: forward through the recording once at 1×, the fader open; sets Length to fit the recording" onClick={() => onChange(clearScratch(effect))}>
          Clear
        </button>
        <span className="scratch-key push" aria-hidden="true">
          <span className="forward">▸ forward</span>
          <span className="backward">◂ backwards</span>
          <span className="held">– held (silent)</span>
        </span>
      </div>
      <div className="lane-wrap">
        <div className="scratch-grid">
          <span />
          <div className="lane-ruler" aria-hidden="true">
            {marks}
          </div>
          <span className="scratch-axis" aria-hidden="true">
            <span>end</span>
            <span>Needle</span>
            <span>start</span>
          </span>
          <div
            className="lane scratch-needle"
            role="group"
            aria-label="Needle position"
            style={grid}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
          >
            {cells
              .filter((c) => !c.open)
              .map((c) => (
                <span key={c.key} className={`scratch-mute${c.ghost ? ' ghost' : ''}`} style={{ left: c.style.left, width: c.style.width }} />
              ))}
            <svg aria-hidden="true" viewBox={`0 0 ${W} ${LH}`} preserveAspectRatio="none">
              <path className="scratch-ghost" d={paths.ghost || 'M0 0'} />
              <path className="scratch-jump" d={paths.jump || 'M0 0'} />
              <path className="scratch-held" d={paths.held || 'M0 0'} />
              <path className="scratch-forward" d={paths.forward || 'M0 0'} />
              <path className="scratch-backward" d={paths.backward || 'M0 0'} />
            </svg>
            <span className="lane-after" style={{ left: pct(length / total) }} />
            <span className="lane-end" style={{ left: pct(length / total) }} title="The movement ends here and starts again: in Song it loops over the whole clip">
              ↻
            </span>
            {effect.points.map((p, i) => {
              const top = yOf(p) / LH;
              const editing = dragging === i;
              return (
                <span key={i}>
                  <span
                    className={`scratch-point ${motions[i]}${editing ? ' editing' : ''}`}
                    title={`Point ${i + 1}: ${Math.round(p * 100)}% into the recording, then ${scratchSpeedText(speeds[i]!)}`}
                    data-point={i}
                    style={{ left: pct((i * size) / total), top: pct(top) }}
                  />
                  {editing && (
                    <span className={`scratch-bubble ${motions[i]}`} style={{ left: `calc(${pct((i * size) / total)} + 8px)`, top: `calc(${pct(Math.max(top, 0.2))} - 26px)` }}>
                      {Math.round(p * 100)}% · {scratchSpeedText(speeds[i]!)}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <span />
          <div className="scratch-speeds" aria-hidden="true">
            {speeds.map((s, i) => (
              <span key={i} className={motions[i]} title={`Step ${i + 1}: ${scratchSpeedText(s)}`} style={{ left: pct((i * size) / total), width: pct(size / total) }}>
                {scratchSpeedLabel(s)}
              </span>
            ))}
          </div>
          <span className="scratch-axis fader" aria-hidden="true">
            Fader
          </span>
          <div className="scratch-fader" role="group" aria-label="Crossfader">
            {cells.map((c) =>
              c.ghost ? (
                <span key={c.key} className={`scratch-cell ghost${c.open ? ' open' : ''}`} style={c.style} />
              ) : (
                <button key={c.key} type="button" className={`scratch-cell${c.open ? ' open' : ''}`} style={c.style} aria-pressed={c.open} aria-label={faderTitle(c)} title={faderTitle(c)} onClick={clickFader(c)} />
              ),
            )}
          </div>
        </div>
        <p className="muted small">
          Needle: where the hand holds the record, from the start of the recording (bottom) to its end (top), one point per step, smoothed between. Steeper is faster; going down is backwards; flat is the record held still, silent. At ↻ the needle is lifted and jumps back to the first point (dashed): no stroke. Drag a point up or down, or across to paint. Fader: click a cell to open or close it (closed is muted); Alt-click splits it in two halves, or joins them.
        </p>
      </div>
    </article>
  );
}
