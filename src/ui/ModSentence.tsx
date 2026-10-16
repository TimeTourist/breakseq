import { useEffect, useState } from 'react';
import type { EffectTarget, ModRate, ModShape, ShufflePick, StackPick, StepEffect, StepTarget, SwapEffect, TapeCurve, TapeEffect } from '../model';
import { MAX_TAPE_SPEED, MAX_TAPE_STEPS, MOD_TARGETS } from '../model';
import { musicalLength } from './labels';
import { TARGET_LABELS, VALUE_HINTS, formatValues, parseValues } from './modText';
import { Slider } from './Slider';

/** Targets that pick one thing out of two: no ramp, and Random picks between them. */
const PICKS = new Set<StepTarget>(['direction']);

const RATES: readonly { value: ModRate; label: string }[] = [
  { value: 'step', label: '1/16' },
  { value: 'beat', label: 'beat' },
  { value: 'bar', label: 'bar' },
];

/** How each shape reads in the sentence: "Pitch goes through 0 3 5 7". */
const SHAPE_WORDS: Record<ModShape['kind'], string> = {
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

/** Every target an effect can switch to: its own, and those the mod does not have yet. Tape last. */
const targetOptions = (own: EffectTarget, taken: readonly EffectTarget[]) =>
  [...MOD_TARGETS, 'tape' as const].filter((t) => t === own || !taken.includes(t)).map((t) => ({ value: t, label: TARGET_LABELS[t] }));

interface StepSentenceProps {
  readonly effect: StepEffect;
  /** Targets other effects of the mod have: this one cannot take them. */
  readonly taken: readonly EffectTarget[];
  readonly onChange: (effect: StepEffect, key?: string) => void;
  /** Swaps the effect for a new one on another target, Tape too. */
  readonly onTarget: (target: EffectTarget) => void;
  readonly onCommit: () => void;
}

/** "Every beat: Pitch goes through 0 3 5 7 in turn." Every part is its control. */
export function StepSentence({ effect, taken, onChange, onTarget, onCommit }: StepSentenceProps) {
  const { shape, target } = effect;
  const picks = PICKS.has(target);
  const change = (patch: Partial<StepEffect>, key?: string) => onChange({ ...effect, ...patch }, key);
  const setShape = (next: ModShape, key?: string) => change({ shape: next }, key);

  const shownValues = shape.kind === 'list' || shape.kind === 'cycle' ? formatValues(effect, shape.values) : '';
  const [text, setText] = useState(shownValues);
  const [problem, setProblem] = useState<string | null>(null);
  // Follow the effect when it changes from elsewhere (undo, another effect).
  useEffect(() => {
    setText(shownValues);
    setProblem(null);
  }, [shownValues]);

  const typeValues = (value: string) => {
    setText(value);
    const parsed = parseValues(target, value);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    if (shape.kind === 'list' || shape.kind === 'cycle') {
      change({ shape: { kind: shape.kind, values: parsed.values } }, 'values');
    }
  };

  const setKind = (kind: ModShape['kind']) => {
    const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : [];
    const range = target === 'direction' || target === 'dist' ? { min: 0, max: 1 } : target === 'filter' ? { min: 200, max: 8000 } : target === 'pan' ? { min: -100, max: 100 } : { min: 1, max: 4 };
    // Pitch rolls whole semitones unless you choose otherwise.
    setShape(kind === 'list' || kind === 'cycle' ? { kind, values } : kind === 'ramp' ? (target === 'stretch' ? { kind, from: 1, to: 4 } : target === 'dist' ? { kind, from: 0, to: 1 } : target === 'filter' ? { kind, from: 200, to: 8000 } : target === 'pan' ? { kind, from: -100, to: 100 } : { kind, from: 0, to: 12 }) : { kind, ...range, chance: 50, whole: target === 'pitch' });
  };


  const valuesInput = (
    <input
      className="word values mono"
      aria-label="Values"
      placeholder={VALUE_HINTS[target]}
      value={text}
      size={Math.max(8, text.length + 1)}
      onChange={(e) => typeValues(e.target.value)}
      onBlur={onCommit}
    />
  );

  return (
    <div className="stack-tight">
      <p className="sentence">
        Every <Choice label="Rate" value={effect.rate} options={RATES} onChange={(rate) => change({ rate })} />:{' '}
        <Choice<EffectTarget>
          label="Target"
          value={target}
          options={targetOptions(target, taken)}
          onChange={onTarget}
        />{' '}
        <Choice
          label="Shape"
          value={shape.kind}
          options={(Object.keys(SHAPE_WORDS) as ModShape['kind'][]).filter((k) => !(k === 'ramp' && picks)).map((k) => ({ value: k, label: SHAPE_WORDS[k] }))}
          onChange={setKind}
        />{' '}
        {shape.kind === 'list' && <>{valuesInput} in turn.</>}
        {shape.kind === 'cycle' && (
          <>
            {valuesInput} {shape.values.length === 0 && target === 'padMember' ? 'the pad’s members' : ''}, one further each time it hits.
          </>
        )}
        {shape.kind === 'ramp' && (
          <>
            from <Amount label="From" value={shape.from} onChange={(v) => setShape({ ...shape, from: v }, 'from')} onCommit={onCommit} /> to{' '}
            <Amount label="To" value={shape.to} onChange={(v) => setShape({ ...shape, to: v }, 'to')} onCommit={onCommit} /> over the clip.
          </>
        )}
        {shape.kind === 'random' && (
          <>
            <Amount label="Chance" value={shape.chance} min={0} max={100} step={1} suffix="%" onChange={(v) => setShape({ ...shape, chance: v }, 'chance')} onCommit={onCommit} /> of the
            time{' '}
            {picks ? (
              <>to forward or backwards, at random.</>
            ) : (
              <>
                to anything from <Amount label="Min" value={shape.min} onChange={(v) => setShape({ ...shape, min: v }, 'min')} onCommit={onCommit} /> to{' '}
                <Amount label="Max" value={shape.max} onChange={(v) => setShape({ ...shape, max: v }, 'max')} onCommit={onCommit} />
                {target === 'pitch' && (
                  <>
                    {' '}
                    <Choice
                      label="Pitch steps"
                      value={shape.whole ? 'whole' : 'free'}
                      options={[
                        { value: 'whole', label: 'in semitones' },
                        { value: 'free', label: 'freely' },
                      ]}
                      onChange={(v) => setShape({ ...shape, whole: v === 'whole' })}
                    />
                  </>
                )}
                .
              </>
            )}
          </>
        )}
      </p>
      {(shape.kind === 'list' || shape.kind === 'cycle') && <p className="muted small">Values: {VALUE_HINTS[target]}.</p>}
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
  readonly taken: readonly EffectTarget[];
  readonly onChange: (effect: SwapEffect, key?: string) => void;
  readonly onTarget: (target: EffectTarget) => void;
  readonly onCommit: () => void;
}

/**
 * "Every 1/16: Swap from the stack — at random." or "Swap by shuffling the
 * clip — like a deck." Every part is its control.
 */
export function SwapSentence({ effect, taken, onChange, onTarget, onCommit }: SwapSentenceProps) {
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
        <Choice<EffectTarget> label="Target" value="swap" options={targetOptions('swap', taken)} onChange={onTarget} />{' '}
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
  /** Targets other effects of the mod have. */
  readonly taken: readonly EffectTarget[];
  readonly onChange: (tape: TapeEffect, key?: string) => void;
  /** Swaps Tape for a new effect on another target. */
  readonly onTarget: (target: EffectTarget) => void;
  readonly onCommit: () => void;
}

/** "Record the first 2/16 of the clip and play it back and forth. Speed goes from 1× to 0.25× over the whole clip, evenly." */
export function TapeSentence({ tape, taken, onChange, onTarget, onCommit }: TapeSentenceProps) {
  const change = (patch: Partial<TapeEffect>, key?: string) => onChange({ ...tape, ...patch }, key);
  const repeatOptions = lengths(MAX_TAPE_STEPS);
  const rampOptions = [{ value: 'clip', label: 'the whole clip' }, ...lengths(128)];
  // A length typed elsewhere (or saved) that is not in the list still shows.
  const withOwn = (options: { value: string; label: string }[], steps: number | null) =>
    steps === null || options.some((o) => o.value === String(steps)) ? options : [...options, { value: String(steps), label: musicalLength(steps) }];
  return (
    <div className="stack-tight">
      <p className="sentence">
        <Choice<EffectTarget> label="Target" value="tape" options={targetOptions('tape', taken)} onChange={onTarget} />: record the first{' '}
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
