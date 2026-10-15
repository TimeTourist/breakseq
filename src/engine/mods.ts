import type { Hit, Id, Mod, ModRate, ModShape, ModTarget, Pad, Project, Rng, Song, Step } from '../model';
import { STEPS_PER_BAR } from '../model';

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

/** Where a step is: its index in the active loop, and its bar and step on the main clock. */
export interface StepPlace {
  readonly index: number;
  readonly bar: number;
  readonly step: number;
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

/** A mod placed in a row, possibly over several adjacent bars as one continuous modulation. */
export interface ModRun {
  readonly mod: Mod;
  readonly row: Row;
  readonly startBar: number;
  /** How many bars the run lasts. */
  readonly bars: number;
}

/** For each bar, the run that is active in row A and row B. */
export function modRuns(song: Song, mods: Project['mods']): { A: (ModRun | null)[]; B: (ModRun | null)[] } {
  const runsFor = (row: Row, cells: readonly (Id | null)[]) => {
    const runs: { mod: Mod; row: Row; startBar: number; bars: number }[] = [];
    const perBar: (ModRun | null)[] = [];
    cells.forEach((id, bar) => {
      const mod = id === null ? undefined : mods[id];
      const last = runs.at(-1);
      if (mod === undefined) {
        perBar.push(null);
        return;
      }
      if (last !== undefined && last.mod.id === mod.id && last.startBar + last.bars === bar) {
        last.bars++;
      } else {
        runs.push({ mod, row, startBar: bar, bars: 1 });
      }
      perBar.push(runs.at(-1)!);
    });
    return perBar;
  };
  return { A: runsFor('A', song.rows.modA), B: runsFor('B', song.rows.modB) };
}

/** The value a mod has at a step on the main clock, or null when it has none there. */
export type ModValues = (run: ModRun, bar: number, step: number, discrete: boolean) => number | null;

/**
 * A value is worked out once per interval of a run and held for every step and
 * trigger in it, so a random value is only rolled once. Steps must be asked for
 * in time order: Cycle counts the intervals it has been used in so far.
 */
export function modValues(rng: Rng): ModValues {
  const cache = new Map<string, number | null>();
  const cycles = new Map<ModRun, number>();
  return (run, bar, step, discrete) => {
    const size = RATE_STEPS[run.mod.rate];
    const interval = Math.floor(((bar - run.startBar) * STEPS_PER_BAR + step) / size);
    const key = `${run.row}:${run.startBar}:${interval}`;
    if (!cache.has(key)) {
      const intervals = Math.max(1, Math.ceil((run.bars * STEPS_PER_BAR) / size));
      let index = interval;
      if (run.mod.shape.kind === 'cycle') {
        index = cycles.get(run) ?? 0;
        cycles.set(run, index + 1);
      }
      cache.set(key, shapeValue(run.mod.shape, index, intervals, discrete, rng));
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
      return place.step >= scope.from && place.step <= scope.to;
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
        ? values(run, place.bar, place.step, handler.discrete)
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

/** The tempo run in each bar: B's if B has one there, else A's. */
export function tempoRuns(runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }): (ModRun | null)[] {
  return runs.A.map((a, bar) => {
    const b = runs.B[bar] ?? null;
    return b?.mod.target === 'tempo' ? b : a?.mod.target === 'tempo' ? a : null;
  });
}
