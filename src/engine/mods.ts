import type { Clip, DelayPlay, DistPlay, FilterPlay, Hit, Mod, ModRate, ModShape, ModStretch, Pad, Project, ReverbPlay, Rng, Step, StepEffect, StepTarget } from '../model';
import {
  DEFAULT_MOD_DELAY,
  DEFAULT_MOD_DIST,
  DEFAULT_MOD_FILTER,
  DEFAULT_MOD_REVERB,
  DEFAULT_MOD_STRETCH,
  STEPS_PER_BAR,
  clipsByStep,
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
  /** Discrete targets get whole numbers from Random and Ramp. */
  readonly discrete: boolean;
  /** How values from A and B on the same target combine: 'add' for amounts, 'b-wins' for modes. */
  readonly combine: 'add' | 'b-wins';
  readonly apply: (state: StepState, value: number, effect: StepEffect, place: StepPlace, project: Project) => StepState;
}

const wrap = (n: number, size: number) => ((n % size) + size) % size;

/**
 * One handler per target, in the fixed order mods are applied in, after Borrow.
 * Tempo is timing, applied by the generator.
 */
const handlers: readonly (readonly [StepTarget, TargetHandler])[] = [
  [
    'padMember',
    {
      discrete: true,
      combine: 'b-wins',
      // Member numbers count from 1 and wrap round the pad.
      apply: (state, value, _mod, _place, project) => {
        const members = state.pad?.members ?? [];
        if (members.length === 0) return state;
        const memberId = members[wrap(Math.round(value) - 1, members.length)]!;
        return { ...state, hit: project.hits[memberId], cell: { ...state.cell, memberId } };
      },
    },
  ],
  ['ratchet', { discrete: true, combine: 'b-wins', apply: (s, v) => ({ ...s, ratchet: Math.max(1, Math.min(8, Math.round(v))) }) }],
  ['pitch', { discrete: false, combine: 'add', apply: (s, v) => ({ ...s, pitch: s.pitch + v }) }],
  ['volume', { discrete: false, combine: 'add', apply: (s, v) => ({ ...s, volume: s.volume + v }) }],
  // Pan values are percent, −100 (left) to 100 (right).
  ['pan', { discrete: false, combine: 'add', apply: (s, v) => ({ ...s, pan: s.pan + v / 100 }) }],
  ['direction', { discrete: true, combine: 'b-wins', apply: (s, v) => ({ ...s, reverse: Math.round(v) === 1 }) }],
  ['stretch', { discrete: false, combine: 'b-wins', apply: (s, v, effect) => ({ ...s, stretch: { factor: v, settings: effect.stretch ?? DEFAULT_MOD_STRETCH } }) }],
  ['dist', { discrete: false, combine: 'b-wins', apply: (s, v, effect) => ({ ...s, dist: distPlay((effect.dist ?? DEFAULT_MOD_DIST).mode, v) }) }],
  [
    'filter',
    {
      discrete: false,
      combine: 'b-wins',
      apply: (s, v, effect) => {
        const { type, resonance } = effect.filter ?? DEFAULT_MOD_FILTER;
        return { ...s, filter: filterPlay(type, v, resonance) };
      },
    },
  ],
  // Reverb and delay values are the amount in percent; A's and B's add, and B's settings win.
  ['reverb', { discrete: false, combine: 'add', apply: (s, v, effect) => ({ ...s, reverb: reverbPlay(v / 100, (effect.reverb ?? DEFAULT_MOD_REVERB).size) }) }],
  [
    'delay',
    {
      discrete: false,
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

/** The value one of a mod's effects has at song step `t`, or null when it has none there. */
export type ModValues = (run: ModRun, effect: StepEffect, t: number, discrete: boolean) => number | null;

/** A mod's effect for a step target, if it has one. */
export const effectFor = (mod: Mod, target: StepTarget): StepEffect | undefined =>
  mod.effects.find((e): e is StepEffect => e.target === target);

/**
 * A value is worked out once per interval of a clip and held for every step and
 * trigger in it, so a random value is only rolled once. Intervals count from the
 * clip's content start, so trimming its start moves into the modulation. Steps
 * must be asked for in time order: Cycle counts the intervals used so far. A
 * random value comes from the mod's seed, the clip's seed, the target and the
 * interval (see Slump och seeds).
 */
export function modValues(dice: Dice): ModValues {
  const cache = new Map<string, number | null>();
  const cycles = new Map<string, number>();
  return (run, effect, t, discrete) => {
    const { clip } = run;
    const size = RATE_STEPS[effect.rate];
    const interval = Math.floor((t - clip.start + clip.offset) / size);
    const key = `${run.row}:${clip.id}:${effect.target}:${interval}`;
    if (!cache.has(key)) {
      const intervals = Math.max(1, Math.ceil((clip.offset + clip.length) / size));
      let index = interval;
      if (effect.shape.kind === 'cycle') {
        const counter = `${clip.id}:${effect.target}`;
        index = cycles.get(counter) ?? 0;
        cycles.set(counter, index + 1);
      }
      const rng = dice(CHOICE.mod, run.mod.seed, clip.seed, MOD_TARGETS.indexOf(effect.target), interval);
      cache.set(key, shapeValue(effect.shape, index, intervals, discrete, rng));
    }
    return cache.get(key) ?? null;
  };
}

/** `index` is the interval for List, Ramp and Random, and the number of intervals used so far for Cycle. */
function shapeValue(shape: ModShape, index: number, intervals: number, discrete: boolean, rng: Rng): number | null {
  switch (shape.kind) {
    case 'list':
      return shape.values.length === 0 ? null : (shape.values[index % shape.values.length] ?? null);
    case 'cycle':
      // No values: 1, 2, 3, …, which a pad member mod wraps round the pad.
      return shape.values.length === 0 ? index + 1 : (shape.values[index % shape.values.length] ?? null);
    case 'ramp': {
      const value = intervals <= 1 ? shape.from : shape.from + ((shape.to - shape.from) * index) / (intervals - 1);
      return discrete ? Math.round(value) : value;
    }
    case 'random': {
      if (rng() * 100 >= shape.chance) return null;
      const r = rng();
      return discrete || shape.whole
        ? Math.ceil(shape.min) + Math.floor(r * (Math.floor(shape.max) - Math.ceil(shape.min) + 1))
        : shape.min + r * (shape.max - shape.min);
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
  // Effects act on hits: an empty step has nothing to change, and Cycle does not count it.
  if (current.cell.ignoreMods || current.hit === undefined) return current;
  for (const [target, handler] of handlers) {
    if (current.cell.ignoreMods) break;
    const fromRow = (run: ModRun | null) => {
      const effect = run === null ? undefined : effectFor(run.mod, target);
      return run !== null && effect !== undefined
        ? { effect, value: values(run, effect, place.clock, handler.discrete) }
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
    return b !== null && effectFor(b.mod, 'tempo') !== undefined ? b : a !== null && effectFor(a.mod, 'tempo') !== undefined ? a : null;
  });
}

/** Whether a target takes whole numbers. */
export const isDiscrete = (target: StepTarget): boolean => handlers.find(([t]) => t === target)?.[1].discrete ?? false;

/**
 * What a step effect does over the first `steps` steps of a clip: its value on
 * each step, or null where it does nothing. Random rolls with `rng`, so it is
 * one example of what a take might do. Cycle is drawn as if every interval hit
 * a step.
 */
export function effectPreview(effect: StepEffect, steps: number, rng: Rng): (number | null)[] {
  const size = RATE_STEPS[effect.rate];
  const intervals = Math.max(1, Math.ceil(steps / size));
  const values = Array.from({ length: intervals }, (_, i) => shapeValue(effect.shape, i, intervals, isDiscrete(effect.target), rng));
  return Array.from({ length: steps }, (_, t) => values[Math.floor(t / size)] ?? null);
}
