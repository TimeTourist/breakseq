import type { BorrowEffect, Clip, Hit, Mod, ModRate, ModShape, Pad, Project, Rng, Step, StepEffect, StepTarget } from '../model';
import { STEPS_PER_BAR, borrowOf, clipsByStep } from '../model';

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
  /** null keeps the hit's own direction. */
  readonly reverse: boolean | null;
}

/** The hit a step plays: its chosen member if that is in the pad, otherwise member 1. */
function resolve(project: Project, cell: Step): Pick<StepState, 'pad' | 'hit'> {
  const pad = cell.padId === null ? undefined : project.pads[cell.padId];
  if (pad === undefined) return { pad: undefined, hit: undefined };
  const memberId = cell.memberId !== null && pad.members.includes(cell.memberId) ? cell.memberId : pad.members[0];
  return { pad, hit: memberId === undefined ? undefined : project.hits[memberId] };
}

export function stepState(project: Project, cell: Step): StepState {
  return { cell, ...resolve(project, cell), ratchet: 1, pitch: 0, volume: 0, reverse: null };
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
  ['direction', { discrete: true, combine: 'b-wins', apply: (s, v) => ({ ...s, reverse: Math.round(v) === 1 }) }],
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
 * must be asked for in time order: Cycle counts the intervals used so far.
 */
export function modValues(rng: Rng): ModValues {
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

/** Borrow's dice for one interval: whether it borrows at all, and which loop. Rolled once per interval. */
export interface BorrowRoll {
  readonly take: boolean;
  readonly pick: number;
}
export type BorrowRolls = (run: ModRun, effect: BorrowEffect, t: number) => BorrowRoll;

/** Borrow's interval at song step `t`, counted from the clip's content start. */
const borrowInterval = (run: ModRun, effect: BorrowEffect, t: number) => Math.floor((t - run.clip.start + run.clip.offset) / RATE_STEPS[effect.rate]);

/** Rolls Borrow's dice once per interval of a clip and keeps them for every step in it. */
export function borrowRolls(rng: Rng): BorrowRolls {
  const cache = new Map<string, BorrowRoll>();
  return (run, effect, t) => {
    const key = `${run.row}:${run.clip.id}:${borrowInterval(run, effect, t)}`;
    let roll = cache.get(key);
    if (roll === undefined) {
      roll = effect.pick.kind === 'random' ? { take: rng() * 100 < effect.pick.chance, pick: rng() } : { take: true, pick: 0 };
      cache.set(key, roll);
    }
    return roll;
  };
}

/**
 * Which loop an interval plays from: -1 for the step's own, else an index into
 * `effect.sources`. `usable` are the sources it may take from on this step: all,
 * or with skipEmpty only those with a hit there. Random takes with its chance
 * and picks among the usable; Every takes every nth interval, the sources in
 * turn; In turn goes round its own loop and the sources.
 */
export function borrowLayer(effect: BorrowEffect, interval: number, roll: BorrowRoll, usable: readonly number[]): number {
  const count = effect.sources.length;
  if (count === 0) return -1;
  const { pick } = effect;
  if (pick.kind === 'random') {
    return roll.take && usable.length > 0 ? usable[Math.min(usable.length - 1, Math.floor(roll.pick * usable.length))]! : -1;
  }
  const choice =
    pick.kind === 'every'
      ? wrap(interval, pick.n) === pick.n - 1
        ? Math.floor(interval / pick.n) % count
        : -1
      : wrap(interval, count + 1) - 1;
  return choice >= 0 && usable.includes(choice) ? choice : -1;
}

/** Borrow from one row, if it has it: the step it plays instead, or null. */
function borrowed(run: ModRun | null, place: StepPlace, project: Project, rolls: BorrowRolls): Step | null {
  const effect = borrowOf(run?.mod);
  if (run === null || effect === undefined) return null;
  const cells = effect.sources.map((id) => {
    const loop = project.loops[id];
    return loop === undefined || loop.steps.length === 0 ? undefined : loop.steps[place.index % loop.steps.length];
  });
  const usable = cells.flatMap((cell, i) => (cell === undefined || (effect.skipEmpty && cell.padId === null) ? [] : [i]));
  const layer = borrowLayer(effect, borrowInterval(run, effect, place.clock), rolls(run, effect, place.clock), usable);
  return layer < 0 ? null : (cells[layer] ?? null);
}

/**
 * Applies the mods from rows A and B to one step: Borrow first, then target by
 * target in the fixed order. A mod acts on every step under its clip. A
 * borrowed step that ignores mods stops the rest.
 */
export function applyMods(
  state: StepState,
  runs: { readonly A: ModRun | null; readonly B: ModRun | null },
  place: StepPlace,
  project: Project,
  values: ModValues,
  rolls: BorrowRolls,
): StepState {
  let current = state;
  if (current.cell.ignoreMods) return current;
  // B's Borrow wins where it borrows; elsewhere A's may.
  const cell = borrowed(runs.B, place, project, rolls) ?? borrowed(runs.A, place, project, rolls);
  if (cell !== null) current = { ...current, cell, ...resolve(project, cell) };
  // Effects act on hits: an empty step has nothing to change, and Cycle does not count it.
  if (current.hit === undefined) return current;
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

/**
 * Which loop Borrow plays from on each of the first `steps` steps of a clip: -1
 * for the step's own, else an index into its sources. Random rolls with `rng`,
 * so it is one example. Empty steps are not known here, so all sources count.
 */
export function borrowPreview(effect: BorrowEffect, steps: number, rng: Rng): number[] {
  const size = RATE_STEPS[effect.rate];
  const usable = effect.sources.map((_, i) => i);
  const rolls = Array.from({ length: Math.ceil(steps / size) }, (): BorrowRoll =>
    effect.pick.kind === 'random' ? { take: rng() * 100 < effect.pick.chance, pick: rng() } : { take: true, pick: 0 },
  );
  return Array.from({ length: steps }, (_, t) => borrowLayer(effect, Math.floor(t / size), rolls[Math.floor(t / size)]!, usable));
}
