import { useEffect, useState } from 'react';
import type { EffectTarget, ModRate, ModScope, ModShape, ModTarget, Project, StepEffect, TapeCurve, TapeEffect } from '../model';
import { MAX_TAPE_SPEED, MAX_TAPE_STEPS, MOD_TARGETS, isParentPad } from '../model';
import { musicalLength } from './labels';
import { TARGET_LABELS, VALUE_HINTS, formatValues, parseValues } from './modText';
import { Slider } from './Slider';

/** Targets that pick one thing out of several: no ramp, and Random picks among them. */
const PICKS = new Set<ModTarget>(['sourceLoop', 'direction']);

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

const scopeKey = (scope: ModScope) => (scope.kind === 'all' ? 'all' : scope.kind === 'tag' ? `tag:${scope.tagId}` : `pad:${scope.padId}`);
const scopeFrom = (key: string): ModScope => {
  const [kind, id] = key.split(':') as [string, string];
  return kind === 'tag' ? { kind: 'tag', tagId: id } : kind === 'pad' ? { kind: 'pad', padId: id } : { kind: 'all' };
};

interface StepSentenceProps {
  readonly effect: StepEffect;
  readonly project: Project;
  /** Targets other effects of the mod have: this one cannot take them. */
  readonly taken: readonly EffectTarget[];
  readonly onChange: (effect: StepEffect, key?: string) => void;
  /** Swaps the effect for a new one on another target. */
  readonly onTarget: (target: ModTarget) => void;
  readonly onCommit: () => void;
}

/** "Every beat, on S steps: Pitch goes through 0 3 5 7 in turn." Every part is its control. */
export function StepSentence({ effect, project, taken, onChange, onTarget, onCommit }: StepSentenceProps) {
  const { shape, target } = effect;
  const picks = PICKS.has(target);
  const change = (patch: Partial<StepEffect>, key?: string) => onChange({ ...effect, ...patch }, key);
  const setShape = (next: ModShape, key?: string) => change({ shape: next }, key);

  const shownValues = shape.kind === 'list' || shape.kind === 'cycle' ? formatValues(effect, shape.values, project) : '';
  const [text, setText] = useState(shownValues);
  const [problem, setProblem] = useState<string | null>(null);
  // Follow the effect when it changes from elsewhere (undo, another effect).
  useEffect(() => {
    setText(shownValues);
    setProblem(null);
  }, [shownValues]);

  const typeValues = (value: string) => {
    setText(value);
    const parsed = parseValues(target, value, project);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    if (shape.kind === 'list' || shape.kind === 'cycle') {
      change({ shape: { kind: shape.kind, values: parsed.values }, ...(target === 'sourceLoop' ? { sources: parsed.sources } : {}) }, 'values');
    }
  };

  const setKind = (kind: ModShape['kind']) => {
    const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : [];
    const range =
      target === 'sourceLoop' ? { min: 0, max: Math.max(0, effect.sources.length - 1) } : target === 'direction' ? { min: 0, max: 1 } : { min: 1, max: 4 };
    setShape(kind === 'list' || kind === 'cycle' ? { kind, values } : kind === 'ramp' ? { kind, from: 0, to: 12 } : { kind, ...range, chance: 50 });
  };

  const tags = Object.values(project.tags);
  // A break's own pad never plays as a pad, so a mod cannot act on it.
  const pads = Object.values(project.pads).filter((p) => !isParentPad(project, p));
  const scopes = [
    { value: 'all', label: 'every step' },
    ...tags.map((t) => ({ value: `tag:${t.id}`, label: `${t.name} steps`, group: 'Tag' })),
    ...pads.map((p) => ({ value: `pad:${p.id}`, label: `pad ${p.name}`, group: 'Pad' })),
  ];

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
        Every <Choice label="Rate" value={effect.rate} options={RATES} onChange={(rate) => change({ rate })} />, on{' '}
        {target === 'tempo' ? (
          <span className="word fixed" title="Tempo moves the whole layer">
            the whole layer
          </span>
        ) : (
          <Choice label="Scope" value={scopeKey(effect.scope)} options={scopes} onChange={(key) => change({ scope: scopeFrom(key) })} />
        )}
        :{' '}
        <Choice
          label="Target"
          value={target}
          options={MOD_TARGETS.filter((t) => t === target || !taken.includes(t)).map((t) => ({ value: t, label: TARGET_LABELS[t] }))}
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
              target === 'sourceLoop' ? (
                <>
                  to a step from{' '}
                  <input
                    className="word values mono"
                    aria-label="Borrow from"
                    placeholder="loop names, e.g. F1 F2"
                    defaultValue={formatValues(effect, effect.sources.map((_, i) => i), project)}
                    onBlur={(e) => {
                      const parsed = parseValues('sourceLoop', e.target.value, project);
                      if (parsed.ok) change({ sources: parsed.sources, shape: { ...shape, min: 0, max: Math.max(0, parsed.sources.length - 1) } });
                      else setProblem(parsed.error);
                    }}
                  />
                  , picked at random.
                </>
              ) : (
                <>to forward or backwards, at random.</>
              )
            ) : (
              <>
                to anything from <Amount label="Min" value={shape.min} onChange={(v) => setShape({ ...shape, min: v }, 'min')} onCommit={onCommit} /> to{' '}
                <Amount label="Max" value={shape.max} onChange={(v) => setShape({ ...shape, max: v }, 'max')} onCommit={onCommit} />.
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
