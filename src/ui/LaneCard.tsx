import type { ScramblePicture as Picture } from '../engine';
import type { LaneStep, ModDelay, ModFilter, ModFreeze, ModRewind, ModScramble, ModStretch, ModStutter, ModTranceGate, StepEffect, StepSize, TrancePreset } from '../model';
import {
  CELL_SIZES,
  DEFAULT_MOD_DELAY,
  DEFAULT_MOD_DIST,
  DEFAULT_MOD_FILTER,
  DEFAULT_MOD_FREEZE,
  DEFAULT_MOD_REVERB,
  DEFAULT_MOD_REVERSE,
  DEFAULT_MOD_REWIND,
  DEFAULT_MOD_SCRAMBLE,
  DEFAULT_MOD_STRETCH,
  DEFAULT_MOD_STUTTER,
  DEFAULT_MOD_TRANCE_GATE,
  MAX_TRANCE_SMOOTH,
  MIN_TRANCE_SMOOTH,
  STUTTER_GRABS,
  TRANCE_DEPTHS,
  TRANCE_OPENS,
  TRANCE_PRESETS,
  LANES,
  MAX_FEEDBACK,
  MAX_GRAIN,
  MAX_LANE_STEPS,
  MIN_GRAIN,
  canRamp,
  clearLane,
  clearTranceGate,
  inTurn,
  isAudioEffect,
  isDice,
  rampLane,
  rampsUp,
  randomizeLane,
  setLaneLength,
  tranceGatePreset,
  zeroOf,
} from '../model';
import { CELL_TEXT, CURVE_TEXT, GRAB_TEXT, PULL_TEXT, depthText, levelText, pitchStep } from './audioText';
import { TrashIcon } from './icons';
import { DELAY_TIMES, DIST_MODES, sizeText } from './labels';
import { LaneEditor } from './LaneEditor';
import { fullValue, laneSentence } from './laneText';
import { Choices, SourceNote } from './ModCards';
import { TARGET_LABELS } from './modLabels';
import { ScramblePicture } from './ScramblePicture';
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
  /** For Scramble: where each cell comes from in the pass shown, and 🎲 Reroll for the mod. */
  readonly scramble?: { readonly picture: Picture | null; readonly onReroll: () => void };
}

const percent = (v: number) => `${v}%`;
const CELLS = CELL_SIZES.map((c) => [c, CELL_TEXT[c]] as const);
const CELL_TITLES = { '0.5': 'Cells of 1/32', '1': 'Cells of 1/16', '2': 'Cells of 1/8', '4': 'Cells of a beat' };

/** Stutter's preset: 1/16 → 1/32 → 1/64 over a beat (see the sketch). */
const ROLL: readonly LaneStep[] = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 3 }];

/** Trance gate's presets under the card, with what each draws. */
const TRANCE_TITLES: Record<TrancePreset, string> = {
  Straight: '16 steps of 1/16, all open, Open 50%: 16 pulses a bar',
  'Off-beat': '16 steps of 1/16, open on the “and” of each beat (steps 3, 7, 11, 15), Open 75%',
  '3-3-2': '16 steps of 1/16, open on steps 1, 4, 7, 9, 12, 15, Open 75%',
};

/** "Free" pitch rounded to semitones, when Values goes back to Semitones. */
const toSemitones = (lane: readonly LaneStep[]): LaneStep[] =>
  lane.map((s) => (isDice(s) ? { ...s, lo: Math.round(s.lo), hi: Math.max(Math.round(s.lo), Math.round(s.hi)) } : { v: Math.round(s.v) }));

/**
 * One effect with a lane, as a card (see Kortet): its name, unit and Remove;
 * a sentence saying what it does; Step, Length, Randomize, Ramp, Clear, its
 * presets and its own settings; and the lane with a ruler.
 */
export function LaneCard({ effect, onChange, onCommit, onRemove, rng, members, stretchUnheard, scramble }: LaneCardProps) {
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
      case 'scramble': {
        const x = effect.scramble ?? DEFAULT_MOD_SCRAMBLE;
        const set = (patch: Partial<ModScramble>) => onChange({ ...effect, scramble: { ...x, ...patch } });
        return (
          <>
            <Choices label="Cell" options={CELLS} value={x.cell} onPick={(cell) => set({ cell })} titles={CELL_TITLES} />
            <Choices
              label="Take from"
              options={
                [
                  ['song', 'Whole song'],
                  ['around', '± bars'],
                  ['clip', 'Inside the clip'],
                ] as const
              }
              value={x.from}
              onPick={(from) => set({ from })}
              titles={{ song: 'A swapped cell can come from anywhere in the song', around: 'From a number of bars either side of the clip', clip: 'From inside the clip: its own cells shuffled' }}
            />
            <Unheard why="Only with Take from ± bars" when={x.from !== 'around'}>
              <Choices label="Around the clip" options={([1, 2, 4] as const).map((n) => [n, `± ${n}`] as const)} value={x.around} onPick={(around) => set({ around })} />
            </Unheard>
            <Choices label="Reverse chance" options={([0, 25, 50, 100] as const).map((r) => [r, percent(r)] as const)} value={x.reverse} onPick={(reverse) => set({ reverse })} titles={{ '0': 'Swapped cells play forward', '100': 'Every swapped cell plays backwards' }} />
          </>
        );
      }
      case 'stutter': {
        const x = effect.stutter ?? DEFAULT_MOD_STUTTER;
        const set = (patch: Partial<ModStutter>) => onChange({ ...effect, stutter: { ...x, ...patch } });
        return (
          <>
            <Choices
              label="Grabs"
              options={STUTTER_GRABS.map((g) => [g, GRAB_TEXT[g]] as const)}
              value={x.grabs}
              onPick={(grabs) => set({ grabs })}
              titles={{ '1': 'Each 1/16 repeats its own start', '2': 'Repeats the start of each 1/8', '4': 'Repeats the start of each beat: a roll on its first hit' }}
            />
            <Choices label="Pitch per repeat" options={([-2, -1, 0, 1, 2] as const).map((p) => [p, pitchStep(p)] as const)} value={x.pitch} onPick={(pitch) => set({ pitch })} />
            <Choices label="Gate" options={([100, 75, 50] as const).map((g) => [g, percent(g)] as const)} value={x.gate} onPick={(gate) => set({ gate })} titles={{ '100': 'Each repeat is heard whole', '50': 'Half of each repeat is heard, the rest is silent' }} />
          </>
        );
      }
      case 'freeze': {
        const x = effect.freeze ?? DEFAULT_MOD_FREEZE;
        const set = (patch: Partial<ModFreeze>) => onChange({ ...effect, freeze: { ...x, ...patch } });
        return (
          <>
            <Choices label="Grain" options={([10, 30, 80] as const).map((g) => [g, `${g} ms`] as const)} value={x.grain} onPick={(grain) => set({ grain })} titles={{ '10': 'A short grain: a high tone', '80': 'A long grain: a low, rough tone' }} />
            <Choices label="Spread" options={([0, 25, 50] as const).map((v) => [v, percent(v)] as const)} value={x.spread} onPick={(spread) => set({ spread })} titles={{ '0': 'Every grain the same: a clean tone', '50': 'Grains start up to half a grain either way: noisier' }} />
            <Choices label="Level" options={([-6, -3, 0] as const).map((v) => [v, levelText(v)] as const)} value={x.level} onPick={(level) => set({ level })} />
          </>
        );
      }
      case 'reverse': {
        const x = effect.reverse ?? DEFAULT_MOD_REVERSE;
        return <Choices label="Cell" options={CELLS} value={x.cell} onPick={(cell) => onChange({ ...effect, reverse: { cell } })} titles={CELL_TITLES} />;
      }
      case 'rewind': {
        const x = effect.rewind ?? DEFAULT_MOD_REWIND;
        const set = (patch: Partial<ModRewind>) => onChange({ ...effect, rewind: { ...x, ...patch } });
        return (
          <>
            <Choices label="Pulls back" options={([4, 8, 16] as const).map((p) => [p, PULL_TEXT[p]] as const)} value={x.pullBack} onPick={(pullBack) => set({ pullBack })} />
            <Choices
              label="Curve"
              options={(['fast', 'slowing', 'spinBack'] as const).map((c) => [c, CURVE_TEXT[c]] as const)}
              value={x.curve}
              onPick={(curve) => set({ curve })}
              titles={{ fast: 'At an even speed', slowing: 'Fast at first, coming to a stop', spinBack: 'Brakes from playing, turns and spins back faster and faster' }}
            />
          </>
        );
      }
      case 'tranceGate': {
        const x = effect.tranceGate ?? DEFAULT_MOD_TRANCE_GATE;
        const set = (patch: Partial<ModTranceGate>, key?: string) => onChange({ ...effect, tranceGate: { ...x, ...patch } }, key);
        return (
          <>
            <Choices label="Depth" options={TRANCE_DEPTHS.map((d) => [d, depthText(d)] as const)} value={x.depth} onPick={(depth) => set({ depth })} titles={{ '-inf': 'A closed step is silent' }} />
            <Choices
              label="Open"
              options={TRANCE_OPENS.map((o) => [o, percent(o)] as const)}
              value={x.open}
              onPick={(open) => set({ open })}
              titles={{ '50': 'Half of each open step is heard: 16 open 1/16 steps give 16 pulses', '100': 'Open steps are heard whole' }}
            />
            <div className="lane-slider">
              <Slider label="Smooth" value={x.smooth} min={MIN_TRANCE_SMOOTH} max={MAX_TRANCE_SMOOTH} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ smooth: v }, 'smooth')} onCommit={onCommit} />
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
      {/* TODO(spec): Trance gate gates what plays, other audio mods too, so the Source line would be wrong on it; the spec does not say what its card says instead. */}
      {isAudioEffect(effect) && effect.target !== 'tranceGate' && <SourceNote />}
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
        {effect.target === 'tranceGate' ? (
          <button type="button" className="small-button" title="Every step open and Open 100%: as without the gate" onClick={() => onChange(clearTranceGate(effect))}>
            Clear
          </button>
        ) : (
          <button type="button" className="small-button" title={`Every step back to ${fullValue(effect, zeroOf(effect.target))}, fixed`} onClick={() => setLane(clearLane(effect))}>
            Clear
          </button>
        )}
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
        {effect.target === 'stutter' && (
          <button type="button" className="small-button preset" title="1/16 → 1/32 → 1/64 over a beat" onClick={() => onChange({ ...effect, step: '1/16', lane: ROLL })}>
            Roll
          </button>
        )}
        {effect.target === 'tranceGate' &&
          (Object.keys(TRANCE_PRESETS) as TrancePreset[]).map((preset) => (
            <button key={preset} type="button" className="small-button preset" title={TRANCE_TITLES[preset]} onClick={() => onChange(tranceGatePreset(effect, preset))}>
              {preset}
            </button>
          ))}
        {extras()}
      </div>
      <LaneEditor effect={effect} onChange={(lane, done) => (done ? (setLane(lane, 'draw'), onCommit()) : setLane(lane, 'draw'))} />
      {effect.target === 'scramble' && scramble !== undefined && <ScramblePicture picture={scramble.picture} onReroll={scramble.onReroll} />}
    </article>
  );
}
