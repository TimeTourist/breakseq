import type { Hit, Id, Mod, ModRate, ModShape, ModTarget, Project, Rng, Song } from '../model';
import { STEPS_PER_BAR } from '../model';

/** What a step will play after mods. Handlers return a changed copy. */
export interface StepState {
  readonly padId: Id;
  readonly hit: Hit;
  readonly ratchet: number;
  /** Semitones added on top of the hit's own pitch. */
  readonly pitch: number;
}

export type Row = 'A' | 'B';

interface TargetHandler {
  /** Discrete targets get whole numbers from Random. */
  readonly discrete: boolean;
  /**
   * How values from A and B on the same target combine: 'add' for numeric
   * values, 'b-wins' for mode values.
   */
  readonly combine: 'add' | 'b-wins';
  readonly apply: (state: StepState, value: number) => StepState;
}

/**
 * One handler per target, in the fixed order mods are applied in, whatever
 * their row. Phase 4 adds sourceLoop (Borrow) and padMember before ratchet,
 * volume and direction next to pitch, and tempo last.
 */
const handlers: readonly (readonly [ModTarget, TargetHandler])[] = [
  [
    'ratchet',
    {
      discrete: true,
      // TODO(spec): the spec only says numeric values (pitch, volume) add and mode values (direction, member) let B win. Ratchet is treated as a mode value.
      combine: 'b-wins',
      apply: (state, value) => ({ ...state, ratchet: Math.max(1, Math.min(8, Math.round(value))) }),
    },
  ],
  [
    'pitch',
    {
      discrete: false,
      combine: 'add',
      apply: (state, value) => ({ ...state, pitch: state.pitch + value }),
    },
  ],
];

const RATE_STEPS: Record<ModRate, number> = { step: 1, beat: 4, bar: STEPS_PER_BAR };

/** A mod placed in a row, possibly over several adjacent bars as one continuous modulation. */
export interface ModRun {
  readonly mod: Mod;
  readonly row: Row;
  readonly startBar: number;
}

/** For each bar, the run that is active in row A and row B. */
export function modRuns(song: Song, mods: Project['mods']): { A: (ModRun | null)[]; B: (ModRun | null)[] } {
  const runsFor = (row: Row, cells: readonly (Id | null)[]) => {
    const runs: (ModRun | null)[] = [];
    cells.forEach((id, bar) => {
      const mod = id === null ? undefined : mods[id];
      const previous = runs[bar - 1];
      if (mod === undefined) runs.push(null);
      else if (previous?.mod.id === mod.id) runs.push(previous);
      else runs.push({ mod, row, startBar: bar });
    });
    return runs;
  };
  return { A: runsFor('A', song.rows.modA), B: runsFor('B', song.rows.modB) };
}

/** The value a mod has at a step, or null when it has none there. */
export type ModValues = (run: ModRun, bar: number, step: number, discrete: boolean) => number | null;

/**
 * A value is worked out once per interval of a run and held for every step
 * and trigger in it, so a random value is only rolled once.
 */
export function modValues(rng: Rng): ModValues {
  const cache = new Map<string, number | null>();
  return (run, bar, step, discrete) => {
    const position = (bar - run.startBar) * STEPS_PER_BAR + step;
    const interval = Math.floor(position / RATE_STEPS[run.mod.rate]);
    const key = `${run.row}:${run.startBar}:${interval}`;
    if (!cache.has(key)) cache.set(key, shapeValue(run.mod.shape, interval, discrete, rng));
    return cache.get(key) ?? null;
  };
}

function shapeValue(shape: ModShape, interval: number, discrete: boolean, rng: Rng): number | null {
  switch (shape.kind) {
    case 'list':
      return shape.values.length === 0 ? null : (shape.values[interval % shape.values.length] ?? null);
    case 'random': {
      if (rng() * 100 >= shape.chance) return null;
      const r = rng();
      return discrete
        ? shape.min + Math.floor(r * (Math.floor(shape.max) - Math.ceil(shape.min) + 1))
        : shape.min + r * (shape.max - shape.min);
    }
  }
}

function inScope(mod: Mod, state: StepState, step: number, project: Project): boolean {
  const { scope } = mod;
  switch (scope.kind) {
    case 'all':
      return true;
    case 'tag':
      // TODO(spec): the spec does not say whether the tag is read before or after other mods change the hit. It is read from the step's own hit.
      return project.samples[state.hit.sampleId]?.mainTag === scope.tagId;
    case 'pad':
      return state.padId === scope.padId;
    case 'range':
      return step >= scope.from && step <= scope.to;
  }
}

/** Applies the mods from rows A and B to one step, target by target in the fixed order. */
export function applyMods(
  state: StepState,
  runs: { readonly A: ModRun | null; readonly B: ModRun | null },
  bar: number,
  step: number,
  project: Project,
  values: ModValues,
): StepState {
  let current = state;
  for (const [target, handler] of handlers) {
    const fromRow = (run: ModRun | null) =>
      run !== null && run.mod.target === target && inScope(run.mod, state, step, project)
        ? values(run, bar, step, handler.discrete)
        : null;
    const a = fromRow(runs.A);
    const b = fromRow(runs.B);
    if (a === null && b === null) continue;
    const value = handler.combine === 'add' ? (a ?? 0) + (b ?? 0) : (b ?? a ?? 0);
    current = handler.apply(current, value);
  }
  return current;
}
