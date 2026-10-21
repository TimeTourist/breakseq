import type { LaneStep, ModDelay, ModFilter, ModStretch, StepEffect, StepSize } from '../model';
import {
  DEFAULT_MOD_DELAY,
  DEFAULT_MOD_DIST,
  DEFAULT_MOD_FILTER,
  DEFAULT_MOD_REVERB,
  DEFAULT_MOD_STRETCH,
  LANES,
  MAX_FEEDBACK,
  MAX_GRAIN,
  MAX_LANE_STEPS,
  MIN_GRAIN,
  canRamp,
  clearLane,
  inTurn,
  isDice,
  rampLane,
  rampsUp,
  randomizeLane,
  setLaneLength,
  zeroOf,
} from '../model';
import { TrashIcon } from './icons';
import { DELAY_TIMES, DIST_MODES, sizeText } from './labels';
import { LaneEditor } from './LaneEditor';
import { fullValue, laneSentence } from './laneText';
import { TARGET_LABELS } from './modLabels';
import { Slider } from './Slider';
import { Unheard } from './Unheard';

const SIZES: readonly { value: StepSize; label: string; title: string }[] = [
  { value: '1/16', label: '1/16', title: 'Each step lasts 1/16' },
  { value: 'beat', label: 'beat', title: 'Each step lasts 1 beat' },
  { value: 'bar', label: 'bar', title: 'Each step lasts 1 bar' },
];

const RESONANCES = [0, 0.3, 0.6] as const;
const FILTERS = [
  ['lowpass', 'Low-pass'],
  ['highpass', 'High-pass'],
] as const;

export interface LaneCardProps {
  readonly effect: StepEffect;
  /** A changed effect; `key` merges changes in a row into one undo step (a drag, a slider). */
  readonly onChange: (effect: StepEffect, key?: string) => void;
  /** A drag or slider is over: close its undo step. */
  readonly onCommit: () => void;
  readonly onRemove: () => void;
  /** Randomness for Randomize: a drawing tool, so it is kept as the steps' values. */
  readonly rng: () => number;
  /** For Pad member's In turn: the most members a pad in the loop under Plays on has, and the loop's name. */
  readonly members: { readonly count: number; readonly loop: string | null };
  /** For Stretch: why Multiply and Replace sound the same just now, or null. */
  readonly stretchUnheard: string | null;
}

/** "Free" pitch rounded to semitones, when Values goes back to Semitones. */
const toSemitones = (lane: readonly LaneStep[]): LaneStep[] =>
  lane.map((s) => (isDice(s) ? { ...s, lo: Math.round(s.lo), hi: Math.max(Math.round(s.lo), Math.round(s.hi)) } : { v: Math.round(s.v) }));

/**
 * One effect with a lane, as a card (see Kortet): its name, unit and Remove;
 * a sentence saying what it does; Step, Length, Randomize, Ramp, Clear, its
 * presets and its own settings; and the lane with a ruler.
 */
export function LaneCard({ effect, onChange, onCommit, onRemove, rng, members, stretchUnheard }: LaneCardProps) {
  const name = TARGET_LABELS[effect.target];
  const range = LANES[effect.target];
  const n = effect.lane.length;
  const setLane = (lane: readonly LaneStep[], key?: string) => onChange({ ...effect, lane }, key);
  const up = rampsUp(effect);
  const segmented = <T extends string | number>(
    label: string,
    options: readonly (readonly [T, string])[],
    value: T | undefined,
    pick: (v: T) => void,
    titles?: Partial<Record<string, string>>,
    ariaLabel = label,
  ) => (
    <div className="lane-extra">
      <span className="lane-extra-label">{label}</span>
      <div className="segmented" role="group" aria-label={ariaLabel}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} title={titles?.[String(v)]} onClick={() => pick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  const extras = () => {
    switch (effect.target) {
      case 'pitch':
        return segmented(
          'Values',
          [
            ['semitones', 'Semitones'],
            ['free', 'Free'],
          ] as const,
          effect.pitch?.values ?? 'semitones',
          (values) => onChange({ ...effect, pitch: { values }, lane: values === 'semitones' ? toSemitones(effect.lane) : effect.lane }),
          { semitones: 'Whole semitones, drawn and rolled', free: 'Any pitch, drawn in tenths of a semitone' },
        );
      case 'filter': {
        const settings = effect.filter ?? DEFAULT_MOD_FILTER;
        const set = (patch: Partial<ModFilter>) => onChange({ ...effect, filter: { ...settings, ...patch } });
        return (
          <>
            {segmented('Type', FILTERS, settings.type, (type) => set({ type }), undefined, 'Filter type')}
            {segmented(
              'Resonance',
              RESONANCES.map((r) => [r, `${Math.round(r * 100)}%`] as const),
              RESONANCES.find((r) => Math.abs(r - settings.resonance) < 1e-6),
              (resonance) => set({ resonance }),
            )}
          </>
        );
      }
      case 'dist':
        return segmented('Mode', DIST_MODES, (effect.dist ?? DEFAULT_MOD_DIST).mode, (mode) => onChange({ ...effect, dist: { mode } }), undefined, 'Dist mode');
      case 'reverb': {
        const { size } = effect.reverb ?? DEFAULT_MOD_REVERB;
        return (
          <div className="lane-slider">
            <Slider label="Size" value={size} min={0} max={1} step={0.01} format={sizeText} onChange={(v) => onChange({ ...effect, reverb: { size: v } }, 'size')} onCommit={onCommit} />
          </div>
        );
      }
      case 'delay': {
        const settings = effect.delay ?? DEFAULT_MOD_DELAY;
        const set = (patch: Partial<ModDelay>, key?: string) => onChange({ ...effect, delay: { ...settings, ...patch } }, key);
        return (
          <>
            {segmented('Delay time', DELAY_TIMES, settings.steps, (steps) => set({ steps }))}
            <div className="lane-slider">
              <Slider label="Feedback" value={settings.feedback} min={0} max={MAX_FEEDBACK} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ feedback: v }, 'feedback')} onCommit={onCommit} />
            </div>
          </>
        );
      }
      case 'stretch': {
        const settings = effect.stretch ?? DEFAULT_MOD_STRETCH;
        const set = (patch: Partial<ModStretch>, key?: string) => onChange({ ...effect, stretch: { ...settings, ...patch } }, key);
        return (
          <>
            <Unheard why={stretchUnheard ?? ''} when={stretchUnheard !== null}>
              {segmented(
                "With the hit's own stretch",
                [
                  ['multiply', 'Multiply'],
                  ['replace', 'Replace'],
                ] as const,
                settings.combine,
                (combine) => set({ combine }),
                { multiply: "Times the hit's stretch: 2× makes a hit on Fit to tempo twice as long as its steps", replace: "Instead of the hit's stretch" },
              )}
            </Unheard>
            <div className="lane-slider">
              <Slider label="Grain" value={settings.grain} min={MIN_GRAIN} max={MAX_GRAIN} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ grain: v }, 'grain')} onCommit={onCommit} />
            </div>
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <article className="mod-card" aria-label={name}>
      <div className="mod-card-head">
        <h3>{name}</h3>
        <span className="mod-unit">{range.unit}</span>
        <button type="button" className="icon-button small push" aria-label={`Remove ${name}`} title={`Remove ${name} from the mod`} onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>
      <p className="mod-card-sentence" aria-live="polite">
        {laneSentence(effect)}
      </p>
      <div className="mod-card-controls">
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
          <button type="button" aria-label="One step fewer" title="One step fewer" disabled={n <= 1} onClick={() => setLane(setLaneLength(effect.lane, n - 1))}>
            −
          </button>
          <span className="mono">
            {n} {n === 1 ? 'step' : 'steps'}
          </span>
          <button type="button" aria-label="One step more" title="One step more: a copy of the last" disabled={n >= MAX_LANE_STEPS} onClick={() => setLane(setLaneLength(effect.lane, n + 1))}>
            +
          </button>
        </div>
        <span className="mod-card-sep" aria-hidden="true" />
        <button type="button" className="small-button" title="Fill the steps with random fixed values, as if drawn. Shift-click: dice steps" onClick={(e) => setLane(randomizeLane(effect, rng, e.shiftKey))}>
          Randomize
        </button>
        <button type="button" className="small-button dashed" title="Shift+Randomize: fill the steps with dice steps, each rolling a new value every pass" onClick={() => setLane(randomizeLane(effect, rng, true))}>
          Shift: dice
        </button>
        <Unheard why="An on/off lane has no slope" when={!canRamp(effect.target)}>
          <button
            type="button"
            className="small-button"
            disabled={!canRamp(effect.target) || n < 2}
            title={
              !canRamp(effect.target)
                ? 'An on/off lane has no slope'
                : n < 2
                  ? 'A ramp needs 2 steps or more'
                  : up
                    ? 'Draw a straight line up, from the lowest value in the lane to the highest; next press ramps down'
                    : 'Draw a straight line down, from the highest value in the lane to the lowest; next press ramps up'
            }
            onClick={() => setLane(rampLane(effect, up))}
          >
            {up ? 'Ramp ↗' : 'Ramp ↘'}
          </button>
        </Unheard>
        <button type="button" className="small-button" title={`Every step back to ${fullValue(effect, zeroOf(effect.target))}, fixed`} onClick={() => setLane(clearLane(effect))}>
          Clear
        </button>
        {effect.target === 'padMember' && (
          <button
            type="button"
            className="small-button preset"
            title={`Draws 1, 2, 3 … up to ${members.count}, the most members a pad has${members.loop === null ? '' : ` in ${members.loop}`}`}
            onClick={() => setLane(inTurn(members.count))}
          >
            In turn
          </button>
        )}
        {extras()}
      </div>
      <LaneEditor effect={effect} onChange={(lane, done) => (done ? (setLane(lane, 'draw'), onCommit()) : setLane(lane, 'draw'))} />
    </article>
  );
}
