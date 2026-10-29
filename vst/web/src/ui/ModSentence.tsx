import { useEffect, useState } from 'react';
import type { ModRate, ShufflePick, StackPick, SwapEffect, TapeCurve, TapeEffect, TempoEffect, TempoShape } from '../model';
import { MAX_TAPE_SPEED, MAX_TAPE_STEPS } from '../model';
import { musicalLength } from './labels';
import { Slider } from './Slider';

/**
 * Swap, Tempo (slip) and Tape keep their controls, on a card (Magnus beslut):
 * each reads as a sentence whose words are its controls.
 */

const RATES: readonly { value: ModRate; label: string }[] = [
  { value: 'step', label: '1/16' },
  { value: 'beat', label: 'beat' },
  { value: 'bar', label: 'bar' },
];

/** How each of Tempo's forms reads in its sentence: "Tempo goes through 1/3 in turn". */
const SHAPE_WORDS: Record<TempoShape['kind'], string> = {
  list: 'goes through',
  cycle: 'steps through',
  ramp: 'ramps',
  random: 'sometimes jumps',
};

/** A select in the running text of a sentence. */
function Choice<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; group?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const groups = [...new Set(options.map((o) => o.group))];
  const render = (list: typeof options) =>
    list.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  return (
    <select className="word" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {groups.map((g) =>
        g === undefined ? (
          render(options.filter((o) => o.group === undefined))
        ) : (
          <optgroup key={g} label={g}>
            {render(options.filter((o) => o.group === g))}
          </optgroup>
        ),
      )}
    </select>
  );
}

/** A number in the running text of a sentence; changes as you type, one undo step until you leave it. */
function Amount({ label, value, onChange, onCommit, min, max, step = 'any', suffix }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  suffix?: string;
}) {
  return (
    <span className="word-group">
      <input
        className="word number mono"
        type="number"
        aria-label={label}
        value={Math.round(value * 1000) / 1000}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
        }}
        onBlur={onCommit}
      />
      {suffix}
    </span>
  );
}

const fractions: [number, string][] = [
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [1 / 2, '1/2'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [3 / 2, '3/2'],
];

/** Tempo values as they are typed: 1/3 1/2 2. */
export const formatTempo = (values: readonly number[]) =>
  values.map((v) => fractions.find(([f]) => Math.abs(f - v) < 1e-6)?.[1] ?? String(Math.round(v * 1000) / 1000)).join(' ');

/** Reads typed tempo values: speeds above 0, as numbers or fractions. */
export function parseTempo(text: string): { readonly ok: true; readonly values: number[] } | { readonly ok: false; readonly error: string } {
  const values: number[] = [];
  for (const word of text.split(/[\s,]+/).filter((w) => w !== '')) {
    const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(word);
    const value = fraction !== null ? Number(fraction[1]) / Number(fraction[2]) : Number(word);
    if (!Number.isFinite(value)) return { ok: false, error: `${word} is not a number` };
    if (!(value > 0)) return { ok: false, error: 'Tempo is a speed above 0, e.g. 1/3' };
    values.push(value);
  }
  return { ok: true, values };
}

interface TempoSentenceProps {
  readonly effect: TempoEffect;
  readonly onChange: (effect: TempoEffect, key?: string) => void;
  readonly onCommit: () => void;
}

/** "Every bar: Tempo goes through 1/3 in turn." Every part is its control. */
export function TempoSentence({ effect, onChange, onCommit }: TempoSentenceProps) {
  const { shape } = effect;
  const change = (patch: Partial<TempoEffect>, key?: string) => onChange({ ...effect, ...patch }, key);
  const setShape = (next: TempoShape, key?: string) => change({ shape: next }, key);
  const shownValues = shape.kind === 'list' || shape.kind === 'cycle' ? formatTempo(shape.values) : '';
  const [text, setText] = useState(shownValues);
  const [problem, setProblem] = useState<string | null>(null);
  // Follow the effect when it changes from elsewhere (undo).
  useEffect(() => {
    setText(shownValues);
    setProblem(null);
  }, [shownValues]);

  const typeValues = (value: string) => {
    setText(value);
    const parsed = parseTempo(value);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    if (shape.kind === 'list' || shape.kind === 'cycle') change({ shape: { kind: shape.kind, values: parsed.values } }, 'values');
  };
  const setKind = (kind: TempoShape['kind']) => {
    const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : [1 / 3];
    setShape(kind === 'list' || kind === 'cycle' ? { kind, values } : kind === 'ramp' ? { kind, from: 1 / 3, to: 1 } : { kind, min: 1 / 3, max: 1, chance: 50, whole: false });
  };
  const valuesInput = (
    <input className="word values mono" aria-label="Values" placeholder="speed, e.g. 1/3 1/2 2" value={text} size={Math.max(8, text.length + 1)} onChange={(e) => typeValues(e.target.value)} onBlur={onCommit} />
  );
  return (
    <div className="stack-tight">
      <p className="sentence">
        Every <Choice label="Rate" value={effect.rate} options={RATES} onChange={(rate) => change({ rate })} />: Tempo{' '}
        <Choice label="Shape" value={shape.kind} options={(Object.keys(SHAPE_WORDS) as TempoShape['kind'][]).map((k) => ({ value: k, label: SHAPE_WORDS[k] }))} onChange={setKind} />{' '}
        {shape.kind === 'list' && <>{valuesInput} in turn.</>}
        {shape.kind === 'cycle' && <>{valuesInput}, one further each time it plays a step.</>}
        {shape.kind === 'ramp' && (
          <>
            from <Amount label="From" value={shape.from} min={0.01} onChange={(v) => setShape({ ...shape, from: v }, 'from')} onCommit={onCommit} /> to{' '}
            <Amount label="To" value={shape.to} min={0.01} onChange={(v) => setShape({ ...shape, to: v }, 'to')} onCommit={onCommit} /> over the clip.
          </>
        )}
        {shape.kind === 'random' && (
          <>
            <Amount label="Chance" value={shape.chance} min={0} max={100} step={1} suffix="%" onChange={(v) => setShape({ ...shape, chance: v }, 'chance')} onCommit={onCommit} /> of the time
            to anything from <Amount label="Min" value={shape.min} min={0.01} onChange={(v) => setShape({ ...shape, min: v }, 'min')} onCommit={onCommit} /> to{' '}
            <Amount label="Max" value={shape.max} min={0.01} onChange={(v) => setShape({ ...shape, max: v }, 'max')} onCommit={onCommit} />.
          </>
        )}
      </p>
      <p className="muted small">The layer plays at this speed while the main clock goes on; after the clip everything is back where it would have been. Pitch does not change.</p>
      {problem !== null && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

const STACK_PICKS: readonly { value: StackPick; label: string }[] = [
  { value: 'random', label: 'at random' },
  { value: 'roundRobin', label: 'round robin' },
  { value: 'topDown', label: 'layer by layer, top down' },
  { value: 'bottomUp', label: 'layer by layer, bottom up' },
];

const SHUFFLE_PICKS: readonly { value: ShufflePick['kind']; label: string }[] = [
  { value: 'deck', label: 'like a deck' },
  { value: 'random', label: 'freely' },
  { value: 'reverse', label: 'in reverse' },
  { value: 'rotate', label: 'rotated' },
];

interface SwapSentenceProps {
  readonly effect: SwapEffect;
  readonly onChange: (effect: SwapEffect, key?: string) => void;
  readonly onCommit: () => void;
}

/**
 * "Every 1/16: Swap from the stack — at random." or "Swap by shuffling the
 * clip — like a deck." Every part is its control.
 */
export function SwapSentence({ effect, onChange, onCommit }: SwapSentenceProps) {
  const { mode } = effect;
  const change = (patch: Partial<SwapEffect>, key?: string) => onChange({ ...effect, ...patch }, key);
  const setMode = (kind: SwapEffect['mode']['kind']) =>
    change({ mode: kind === 'stack' ? { kind, pick: 'random' } : { kind, pick: { kind: 'deck' } } });
  const setShuffle = (kind: ShufflePick['kind']) => change({ mode: { kind: 'shuffle', pick: kind === 'rotate' ? { kind, by: 1 } : { kind } } });
  return (
    <div className="stack-tight">
      <p className="sentence">
        {mode.kind === 'stack' && (
          <>
            Every <Choice label="Rate" value={effect.rate} options={RATES} onChange={(rate) => change({ rate })} />:{' '}
          </>
        )}
        Swap{' '}
        <Choice
          label="Swap mode"
          value={mode.kind}
          options={[
            { value: 'stack', label: 'from the stack' },
            { value: 'shuffle', label: 'by shuffling the clip' },
          ]}
          onChange={setMode}
        />{' '}
        —{' '}
        {mode.kind === 'stack' ? (
          <>
            <Choice label="Stack pick" value={mode.pick} options={STACK_PICKS} onChange={(pick) => change({ mode: { kind: 'stack', pick } })} />.
          </>
        ) : (
          <>
            <Choice label="Shuffle pick" value={mode.pick.kind} options={SHUFFLE_PICKS} onChange={setShuffle} />
            {mode.pick.kind === 'rotate' && (
              <>
                {' '}
                by{' '}
                <Amount
                  label="Rotate by"
                  value={mode.pick.by}
                  min={1}
                  max={15}
                  step={1}
                  suffix={mode.pick.by === 1 ? ' hit' : ' hits'}
                  onChange={(by) => change({ mode: { kind: 'shuffle', pick: { kind: 'rotate', by } } }, 'rotate')}
                  onCommit={onCommit}
                />
              </>
            )}
            .
          </>
        )}
      </p>
      <p className="muted small">
        {mode.kind === 'stack'
          ? 'The stack is everything under the playhead: the Fill and the Main under it, and every hit in their pads. Only steps with a hit change.'
          : 'The hits played under the clip, dealt out again to the same steps: the rhythm stays as it is.'}
      </p>
    </div>
  );
}

const DIRECTIONS: readonly { value: TapeEffect['direction']; label: string }[] = [
  { value: 'forward', label: 'forwards' },
  { value: 'reverse', label: 'backwards' },
  { value: 'pingpong', label: 'back and forth' },
];

const CURVES: readonly { value: TapeCurve; label: string }[] = [
  { value: 'linear', label: 'evenly' },
  { value: 'softStart', label: 'starting gently' },
  { value: 'softEnd', label: 'ending gently' },
  { value: 'hardStart', label: 'starting hard' },
  { value: 'hardEnd', label: 'ending hard' },
];

/** Lengths to pick from: every 1/16 within a bar, then whole bars. */
const lengths = (max: number) =>
  [...Array.from({ length: 16 }, (_, i) => i + 1), 32, 48, 64, 128].filter((n) => n <= max).map((n) => ({ value: String(n), label: musicalLength(n) }));

interface TapeSentenceProps {
  readonly tape: TapeEffect;
  readonly onChange: (tape: TapeEffect, key?: string) => void;
  readonly onCommit: () => void;
}

/** "Record the first 2/16 of the clip and play it back and forth. Speed goes from 1× to 0.25× over the whole clip, evenly." */
export function TapeSentence({ tape, onChange, onCommit }: TapeSentenceProps) {
  const change = (patch: Partial<TapeEffect>, key?: string) => onChange({ ...tape, ...patch }, key);
  const repeatOptions = lengths(MAX_TAPE_STEPS);
  const rampOptions = [{ value: 'clip', label: 'the whole clip' }, ...lengths(128)];
  // A length typed elsewhere (or saved) that is not in the list still shows.
  const withOwn = (options: { value: string; label: string }[], steps: number | null) =>
    steps === null || options.some((o) => o.value === String(steps)) ? options : [...options, { value: String(steps), label: musicalLength(steps) }];
  return (
    <div className="stack-tight">
      <p className="sentence">
        Record the first{' '}
        <Choice label="Repeat" value={String(tape.length)} options={withOwn(repeatOptions, tape.length)} onChange={(v) => change({ length: Number(v) })} /> of the clip and
        play it <Choice label="Tape direction" value={tape.direction} options={DIRECTIONS} onChange={(direction) => change({ direction })} />. Speed goes from{' '}
        <Amount label="From" value={tape.speed.from} min={0} max={MAX_TAPE_SPEED} step={0.05} suffix="×" onChange={(v) => change({ speed: { ...tape.speed, from: v } }, 'from')} onCommit={onCommit} />{' '}
        to <Amount label="To" value={tape.speed.to} min={0} max={MAX_TAPE_SPEED} step={0.05} suffix="×" onChange={(v) => change({ speed: { ...tape.speed, to: v } }, 'to')} onCommit={onCommit} />{' '}
        over{' '}
        <Choice
          label="Ramp over"
          value={tape.rampOver === null ? 'clip' : String(tape.rampOver)}
          options={withOwn(rampOptions, tape.rampOver)}
          onChange={(v) => change({ rampOver: v === 'clip' ? null : Number(v) })}
        />
        , <Choice label="Curve" value={tape.curve} options={CURVES} onChange={(curve) => change({ curve })} />
        {tape.rampOver === null ? '' : ', then holds'}.
      </p>
      <p className="muted small">Like tape: slower is lower and longer, and quieter below 1×, so 0× is silent. The song&apos;s tempo never changes.</p>
      <div className="row tape-wobble">
        <Slider label="Wow" value={tape.wow} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(wow) => change({ wow }, 'wow')} onCommit={onCommit} />
        <Slider
          label="Flutter"
          value={tape.flutter}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(flutter) => change({ flutter }, 'flutter')}
          onCommit={onCommit}
        />
      </div>
      <p className="muted small">Wow sways the speed slowly, flutter makes it flicker. Each take sways a little differently.</p>
    </div>
  );
}
