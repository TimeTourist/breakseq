import type { Clip, Hit, Mod, ModRate, ModShape, ModTarget, Pad, Project, Rng, Step } from '../model';
import { STEPS_PER_BAR, clipsByStep } from '../model';

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
  readonly apply: (state: StepState, value: number, mod: Mod, place: StepPlace, project: Project) => StepState;
}

const wrap = (n: number, size: number) => ((n % size) + size) % size;

/** One handler per target, in the fixed order mods are applied in. Tempo is timing, applied by the generator. */
const handlers: readonly (readonly [ModTarget, TargetHandler])[] = [
  [
    'sourceLoop',
    {
      discrete: true,
      combine: 'b-wins',
      // The same step in the chosen loop, with its pad, member and locks.
      apply: (state, value, mod, place, project) => {
        if (mod.sources.length === 0) return state;
        const source = project.loops[mod.sources[wrap(Math.round(value), mod.sources.length)]!];
        const cell = source === undefined ? undefined : source.steps[place.index % source.steps.length];
        return cell === undefined ? state : { ...state, cell, ...resolve(project, cell) };
      },
    },
  ],
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

/** The value a mod has at song step `t`, or null when it has none there. */
export type ModValues = (run: ModRun, t: number, discrete: boolean) => number | null;

/**
 * A value is worked out once per interval of a clip and held for every step and
 * trigger in it, so a random value is only rolled once. Intervals count from the
 * clip's content start, so trimming its start moves into the modulation. Steps
 * must be asked for in time order: Cycle counts the intervals used so far.
 */
export function modValues(rng: Rng): ModValues {
  const cache = new Map<string, number | null>();
  const cycles = new Map<string, number>();
  return (run, t, discrete) => {
    const { clip, mod } = run;
    const size = RATE_STEPS[mod.rate];
    const interval = Math.floor((t - clip.start + clip.offset) / size);
    const key = `${run.row}:${clip.id}:${interval}`;
    if (!cache.has(key)) {
      const intervals = Math.max(1, Math.ceil((clip.offset + clip.length) / size));
      let index = interval;
      if (mod.shape.kind === 'cycle') {
        index = cycles.get(clip.id) ?? 0;
        cycles.set(clip.id, index + 1);
      }
      cache.set(key, shapeValue(mod.shape, index, intervals, discrete, rng));
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
      return discrete
        ? Math.ceil(shape.min) + Math.floor(r * (Math.floor(shape.max) - Math.ceil(shape.min) + 1))
        : shape.min + r * (shape.max - shape.min);
    }
  }
}

function inScope(mod: Mod, state: StepState, place: StepPlace, project: Project): boolean {
  const { scope } = mod;
  switch (scope.kind) {
    case 'all':
      return true;
    case 'tag':
      return state.hit !== undefined && project.samples[state.hit.sampleId]?.mainTag === scope.tagId;
    case 'pad':
      return state.cell.padId === scope.padId;
    case 'range':
      return place.clock % STEPS_PER_BAR >= scope.from && place.clock % STEPS_PER_BAR <= scope.to;
  }
}

/**
 * Applies the mods from rows A and B to one step, target by target in the fixed
 * order. Scope is tested against the step as earlier targets left it, so a tag
 * scope sees a hit that Borrow or a member mod swapped in. A borrowed step that
 * ignores mods stops the rest.
 */
export function applyMods(
  state: StepState,
  runs: { readonly A: ModRun | null; readonly B: ModRun | null },
  place: StepPlace,
  project: Project,
  values: ModValues,
): StepState {
  let current = state;
  for (const [target, handler] of handlers) {
    if (current.cell.ignoreMods) break;
    const fromRow = (run: ModRun | null) =>
      run !== null && run.mod.target === target && inScope(run.mod, current, place, project)
        ? values(run, place.clock, handler.discrete)
        : null;
    const a = fromRow(runs.A);
    const b = fromRow(runs.B);
    if (a === null && b === null) continue;
    const mod = (b !== null ? runs.B : runs.A)!.mod;
    const value = handler.combine === 'add' ? (a ?? 0) + (b ?? 0) : (b ?? a ?? 0);
    current = handler.apply(current, value, mod, place, project);
  }
  return current;
}

/** The tempo run at each song step: B's if B has one there, else A's. */
export function tempoRuns(runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }): (ModRun | null)[] {
  return runs.A.map((a, t) => {
    const b = runs.B[t] ?? null;
    return b?.mod.target === 'tempo' ? b : a?.mod.target === 'tempo' ? a : null;
  });
}
