import type { Clip, DelayPlay, DistPlay, FilterPlay, Hit, LaneStep, LaneTarget, Mod, ModRate, ModStretch, Pad, Project, ReverbPlay, Rng, Step, StepEffect, TempoEffect, TempoShape } from '../model';
import {
  DEFAULT_MOD_DELAY,
  DEFAULT_MOD_DIST,
  DEFAULT_MOD_FILTER,
  DEFAULT_MOD_REVERB,
  DEFAULT_MOD_STRETCH,
  STEPS_PER_BAR,
  STEP_SIZES,
  clipsByStep,
  LANES,
  isDice,
  wholeValues,
  delayPlay,
  distPlay,
  filterPlay,
  reverbPlay,
  MOD_TARGETS,
} from '../model';
import type { Dice } from './random';
import { CHOICE } from './random';


/** What a step will play after mods. Handlers return a changed copy. */
export interface StepState {
  /** The step as it stands: its pad, chosen member and locks. Borrow swaps it. */
  readonly cell: Step;
  readonly pad: Pad | undefined;
  readonly hit: Hit | undefined;
  readonly ratchet: number;
  /** Semitones added on top of the hit's own pitch. */
  readonly pitch: number;
  /** dB added on top of the hit's own volume. */
  readonly volume: number;
  /** Added to the hit's own pan, −1 to 1. */
  readonly pan: number;
  /** null keeps the hit's own direction. */
  readonly reverse: boolean | null;
  /** A Stretch mod's factor and settings; null keeps the hit's own stretch. */
  readonly stretch: { readonly factor: number; readonly settings: ModStretch } | null;
  /** A Dist mod's dist, in place of the hit's; null keeps the hit's. */
  readonly dist: DistPlay | null;
  /** A Filter mod's filter, in place of the hit's; null keeps the hit's. */
  readonly filter: FilterPlay | null;
  /** A Reverb mod's reverb, in place of the hit's; undefined keeps the hit's, null sends none. */
  readonly reverb?: ReverbPlay | null;
  /** A Delay mod's delay, in place of the hit's; undefined keeps the hit's, null sends none. */
  readonly delay?: DelayPlay | null;
}

/** The hit a step plays: its chosen member if that is in the pad, otherwise member 1. */
function resolve(project: Project, cell: Step): Pick<StepState, 'pad' | 'hit'> {
  const pad = cell.padId === null ? undefined : project.pads[cell.padId];
  if (pad === undefined) return { pad: undefined, hit: undefined };
  const memberId = cell.memberId !== null && pad.members.includes(cell.memberId) ? cell.memberId : pad.members[0];
  return { pad, hit: memberId === undefined ? undefined : project.hits[memberId] };
}

export function stepState(project: Project, cell: Step): StepState {
  return { cell, ...resolve(project, cell), ratchet: 1, pitch: 0, volume: 0, pan: 0, reverse: null, stretch: null, dist: null, filter: null };
}

export type Row = 'A' | 'B';

/** Where a step is: its index in the active loop, and its song step on the main clock. */
export interface StepPlace {
  readonly index: number;
  /** Song step on the main clock: where the sound is heard. */
  readonly clock: number;
}

interface TargetHandler {
  /** How values from A and B on the same target combine: 'add' for amounts, 'b-wins' for modes. */
  readonly combine: 'add' | 'b-wins';
  readonly apply: (state: StepState, value: number, effect: StepEffect, place: StepPlace, project: Project) => StepState;
}

/**
 * One handler per target, in the fixed order mods are applied in, after Borrow.
 * Tempo is timing, applied by the generator.
 */
const handlers: readonly (readonly [LaneTarget, TargetHandler])[] = [
  [
    'padMember',
    {
      combine: 'b-wins',
      // Member numbers count from 1; a member the pad does not have plays member 1.
      apply: (state, value, _mod, _place, project) => {
        const members = state.pad?.members ?? [];
        if (members.length === 0) return state;
        const memberId = members[Math.round(value) - 1] ?? members[0]!;
        return { ...state, hit: project.hits[memberId], cell: { ...state.cell, memberId } };
      },
    },
  ],
  ['ratchet', { combine: 'b-wins', apply: (s, v) => ({ ...s, ratchet: Math.max(1, Math.min(8, Math.round(v))) }) }],
  ['pitch', { combine: 'add', apply: (s, v) => ({ ...s, pitch: s.pitch + v }) }],
  ['volume', { combine: 'add', apply: (s, v) => ({ ...s, volume: s.volume + v }) }],
  // Pan values are percent, −100 (left) to 100 (right).
  ['pan', { combine: 'add', apply: (s, v) => ({ ...s, pan: s.pan + v / 100 }) }],
  // On plays backwards; off leaves the hit's own direction. (Claudes val.)
  ['direction', { combine: 'b-wins', apply: (s, v) => (Math.round(v) === 1 ? { ...s, reverse: true } : s) }],
  ['stretch', { combine: 'b-wins', apply: (s, v, effect) => ({ ...s, stretch: { factor: v, settings: effect.stretch ?? DEFAULT_MOD_STRETCH } }) }],
  // Dist values are the amount in percent.
  ['dist', { combine: 'b-wins', apply: (s, v, effect) => ({ ...s, dist: distPlay((effect.dist ?? DEFAULT_MOD_DIST).mode, v / 100) }) }],
  [
    'filter',
    {
      combine: 'b-wins',
      apply: (s, v, effect) => {
        const { type, resonance } = effect.filter ?? DEFAULT_MOD_FILTER;
        return { ...s, filter: filterPlay(type, v, resonance) };
      },
    },
  ],
  // Reverb and delay values are the amount in percent; A's and B's add, and B's settings win.
  ['reverb', { combine: 'add', apply: (s, v, effect) => ({ ...s, reverb: reverbPlay(v / 100, (effect.reverb ?? DEFAULT_MOD_REVERB).size) }) }],
  [
    'delay',
    {
      combine: 'add',
      apply: (s, v, effect) => {
        const { steps, feedback } = effect.delay ?? DEFAULT_MOD_DELAY;
        return { ...s, delay: delayPlay(v / 100, steps, feedback) };
      },
    },
  ],
];

const RATE_STEPS: Record<ModRate, number> = { step: 1, beat: 4, bar: STEPS_PER_BAR };

/** A mod's clip in a row: one continuous modulation. */
export interface ModRun {
  readonly mod: Mod;
  readonly row: Row;
  readonly clip: Clip;
}

/** For each song step, the run that is active in row A and row B. */
export function modRuns(project: Project): { A: (ModRun | null)[]; B: (ModRun | null)[] } {
  const runsFor = (row: Row) =>
    clipsByStep(project, row === 'A' ? 'modA' : 'modB').map((clip): ModRun | null => {
      const mod = clip === null ? undefined : project.mods[clip.ref];
      return clip === null || mod === undefined ? null : { mod, row, clip };
    });
  return { A: runsFor('A'), B: runsFor('B') };
}

/** The value one of a mod's step effects has at song step `t`, or null when it does nothing there. */
export type ModValues = (run: ModRun, effect: StepEffect, t: number) => number | null;

/** A mod's step effect for a lane target, if it has one. */
export const effectFor = (mod: Mod, target: LaneTarget): StepEffect | undefined =>
  mod.effects.find((e): e is StepEffect => e.target === target);

/** A mod's Tempo (slip), if it has one. */
export const tempoEffect = (mod: Mod): TempoEffect | undefined => mod.effects.find((e): e is TempoEffect => e.target === 'tempo');

/** The number of a lane target, mixed into its dice rolls: the same as before lanes, so an old Random rolls what it rolled. */
const targetNumber = (target: LaneTarget | 'tempo'): number => MOD_TARGETS.indexOf(target);

/** Where a song step is in a clip's content, in steps: trimming a clip's start moves into its modulation. */
export const clipPosition = (clip: Pick<Clip, 'start' | 'offset'>, t: number): number => t - clip.start + clip.offset;

/**
 * What a lane does at `position` steps into its clip's content: the lane
 * starts where the clip starts and loops on its own length. A fixed step gives
 * its value. A dice step rolls once per time it plays, from the mod's and the
 * clip's seeds, the target and which step of the clip it is (see Slump och
 * seeds): if its chance does not come up it does nothing (null); otherwise a
 * value in its band, whole where the target's values are whole, and on for an
 * on/off lane.
 */
export function laneValueAt(effect: StepEffect, position: number, roll: (occurrence: number) => Rng): number | null {
  const size = STEP_SIZES[effect.step];
  const occurrence = Math.floor(position / size);
  const step: LaneStep | undefined = effect.lane[((occurrence % effect.lane.length) + effect.lane.length) % effect.lane.length];
  if (step === undefined) return null;
  if (!isDice(step)) return step.v;
  const rng = roll(occurrence);
  if (rng() * 100 >= step.chance) return null;
  if (LANES[effect.target].onOff === true) return 1;
  const r = rng();
  if (wholeValues(effect)) {
    const lo = Math.ceil(step.lo);
    const hi = Math.floor(step.hi);
    return hi < lo ? Math.round((step.lo + step.hi) / 2) : lo + Math.floor(r * (hi - lo + 1));
  }
  return step.lo + r * (step.hi - step.lo);
}

/** The dice for a mod's lane on a clip: one Rng per time a step plays. */
export const laneDice = (dice: Dice, mod: Pick<Mod, 'seed'>, clip: Pick<Clip, 'seed'>, target: LaneTarget) => (occurrence: number) =>
  dice(CHOICE.mod, mod.seed, clip.seed, targetNumber(target), occurrence);

/**
 * What each step effect of a mod does at song step `t` of its run (see
 * laneValueAt). A dice step is rolled once each time it plays and held for
 * every step and trigger in it.
 */
export function modValues(dice: Dice): ModValues {
  const rolls = new Map<string, { readonly rng: Rng; readonly drawn: number[] }>();
  return (run, effect, t) => {
    const held = (occurrence: number): Rng => {
      const key = `${run.row}:${run.clip.id}:${effect.target}:${occurrence}`;
      let roll = rolls.get(key);
      if (roll === undefined) {
        roll = { rng: laneDice(dice, run.mod, run.clip, effect.target)(occurrence), drawn: [] };
        rolls.set(key, roll);
      }
      // The numbers drawn the first time are given again each time after.
      const { rng, drawn } = roll;
      let i = 0;
      return () => {
        if (i >= drawn.length) drawn.push(rng());
        return drawn[i++]!;
      };
    };
    return laneValueAt(effect, clipPosition(run.clip, t), held);
  };
}

/** Tempo's value at song step `t`, or null where it has none. Steps must be asked for in time order: Cycle counts the intervals used so far. */
export type TempoValues = (run: ModRun, effect: TempoEffect, t: number) => number | null;

/**
 * Tempo (slip) keeps its forms: a value is worked out once per interval of a
 * clip and held for every step in it. A random value comes from the mod's
 * seed, the clip's seed and the interval.
 */
export function tempoValues(dice: Dice): TempoValues {
  const cache = new Map<string, number | null>();
  const cycles = new Map<string, number>();
  return (run, effect, t) => {
    const { clip } = run;
    const size = RATE_STEPS[effect.rate];
    const interval = Math.floor(clipPosition(clip, t) / size);
    const key = `${run.row}:${clip.id}:${interval}`;
    if (!cache.has(key)) {
      const intervals = Math.max(1, Math.ceil((clip.offset + clip.length) / size));
      let index = interval;
      if (effect.shape.kind === 'cycle') {
        const counter = clip.id;
        index = cycles.get(counter) ?? 0;
        cycles.set(counter, index + 1);
      }
      const rng = dice(CHOICE.mod, run.mod.seed, clip.seed, targetNumber('tempo'), interval);
      cache.set(key, tempoShapeValue(effect.shape, index, intervals, rng));
    }
    return cache.get(key) ?? null;
  };
}

/** `index` is the interval for List, Ramp and Random, and the number of intervals used so far for Cycle. */
function tempoShapeValue(shape: TempoShape, index: number, intervals: number, rng: Rng): number | null {
  switch (shape.kind) {
    case 'list':
    case 'cycle':
      return shape.values.length === 0 ? null : (shape.values[index % shape.values.length] ?? null);
    case 'ramp':
      return intervals <= 1 ? shape.from : shape.from + ((shape.to - shape.from) * index) / (intervals - 1);
    case 'random': {
      if (rng() * 100 >= shape.chance) return null;
      const r = rng();
      return shape.whole ? Math.ceil(shape.min) + Math.floor(r * (Math.floor(shape.max) - Math.ceil(shape.min) + 1)) : shape.min + r * (shape.max - shape.min);
    }
  }
}

/**
 * Applies the mods from rows A and B to one step, target by target in the fixed
 * order. Swap has already chosen the step. A mod acts on every step under its
 * clip that has a hit; a step that ignores mods is left alone.
 */
export function applyMods(
  state: StepState,
  runs: { readonly A: ModRun | null; readonly B: ModRun | null },
  place: StepPlace,
  project: Project,
  values: ModValues,
): StepState {
  let current = state;
  // Effects act on hits: an empty step has nothing to change.
  if (current.cell.ignoreMods || current.hit === undefined) return current;
  for (const [target, handler] of handlers) {
    if (current.cell.ignoreMods) break;
    const fromRow = (run: ModRun | null) => {
      const effect = run === null ? undefined : effectFor(run.mod, target);
      return run !== null && effect !== undefined
        ? { effect, value: values(run, effect, place.clock) }
        : null;
    };
    const a = fromRow(runs.A);
    const b = fromRow(runs.B);
    const winner = b?.value != null ? b : a?.value != null ? a : null;
    if (winner === null) continue;
    const value = handler.combine === 'add' ? (a?.value ?? 0) + (b?.value ?? 0) : winner.value!;
    current = handler.apply(current, value, winner.effect, place, project);
  }
  return current;
}

/** The tempo run at each song step: B's if B has one there, else A's. */
export function tempoRuns(runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }): (ModRun | null)[] {
  return runs.A.map((a, t) => {
    const b = runs.B[t] ?? null;
    return b !== null && tempoEffect(b.mod) !== undefined ? b : a !== null && tempoEffect(a.mod) !== undefined ? a : null;
  });
}
