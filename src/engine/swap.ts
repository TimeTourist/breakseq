import type { Project, Rng, ShufflePick, StackPick, Step, SwapEffect } from '../model';
import { STEPS_PER_BAR, clipsByStep, swapOf } from '../model';
import type { ModRun } from './mods';
import type { Dice } from './random';
import { CHOICE } from './random';

const RATE_STEPS = { step: 1, beat: 4, bar: STEPS_PER_BAR } as const;

/**
 * For each song step, the steps of the loops under it, top down: the Fill
 * clip's, then the Main clip's, whether heard or not. A layer with no clip there
 * is left out.
 */
export function songStack(project: Project): (readonly Step[])[] {
  const rows = [clipsByStep(project, 'fill'), clipsByStep(project, 'main')];
  return rows[0]!.map((_, t) =>
    rows.flatMap((row) => {
      const clip = row[t] ?? null;
      const loop = clip === null ? undefined : project.loops[clip.ref];
      if (clip === null || loop === undefined || loop.steps.length === 0) return [];
      const cell = loop.steps[(t - clip.start + clip.offset) % loop.steps.length];
      return cell === undefined ? [] : [cell];
    }),
  );
}

/** Every hit a stack offers, in order: layer by layer, and in each its pad's hits. */
export function stackCandidates(project: Project, stack: readonly Step[]): Step[] {
  return stack.flatMap((cell) => {
    const pad = cell.padId === null ? undefined : project.pads[cell.padId];
    return pad === undefined ? [] : pad.members.map((memberId) => ({ ...cell, memberId }));
  });
}

/**
 * Which candidate Stack takes. `count` is how many intervals with a hit came
 * before this one in the clip; `roll` is this interval's random number.
 */
export function stackPick(pick: StackPick, candidates: readonly Step[], layers: readonly Step[], count: number, roll: number): Step | null {
  switch (pick) {
    case 'random':
      return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))] ?? null;
    case 'roundRobin':
      return candidates.length === 0 ? null : candidates[count % candidates.length]!;
    case 'topDown':
      return layers.length === 0 ? null : layers[count % layers.length]!;
    case 'bottomUp':
      return layers.length === 0 ? null : layers[layers.length - 1 - (count % layers.length)]!;
  }
}

/** The order Shuffle deals a clip's hits in: for hit k, the index of the hit it plays. */
export function shuffleOrder(pick: ShufflePick, count: number, rng: Rng): number[] {
  const indexes = Array.from({ length: count }, (_, i) => i);
  switch (pick.kind) {
    case 'deck':
      // Fisher–Yates: every order equally likely, every hit once.
      for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
      }
      return indexes;
    case 'random':
      return indexes.map(() => Math.min(count - 1, Math.floor(rng() * count)));
    case 'reverse':
      return indexes.reverse();
    case 'rotate':
      return indexes.map((i) => (i + pick.by) % count);
  }
}

/** The run that swaps at a song step: B's if B has Swap there, else A's. */
const swapRun = (runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }, t: number): ModRun | null => {
  const b = runs.B[t] ?? null;
  const a = runs.A[t] ?? null;
  return b !== null && swapOf(b.mod) !== undefined ? b : a !== null && swapOf(a.mod) !== undefined ? a : null;
};

/**
 * Swaps step by step as a take is generated: `swapped(content, clock, cell)`
 * gives the step to play instead of `cell`, or `cell` itself. Steps without a
 * hit are never swapped, so the rhythm stays as it is. Shuffle deals each
 * clip's hits out once, up front; Stack picks as the steps come, in time order.
 * Shuffle's order comes from the mod's and the clip's seeds, Stack's roll for
 * an interval from them and the interval (see Slump och seeds).
 */
export function swapper(
  project: Project,
  runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] },
  heardCells: readonly (Step | undefined)[],
  rollFor: Dice,
): (content: number, clock: number, cell: Step) => Step {
  const stack = songStack(project);
  const hasHit = (cell: Step | undefined) => cell !== undefined && cell.padId !== null && project.pads[cell.padId] !== undefined;

  // Shuffle: for each clip, its hits in order, dealt out to the same steps.
  const dealt = new Map<number, Step>();
  const shuffled = new Set<string>();
  heardCells.forEach((_, t) => {
    const run = swapRun(runs, t);
    const effect = swapOf(run?.mod);
    if (run === null || effect?.mode.kind !== 'shuffle') return;
    const key = `${run.row}:${run.clip.id}`;
    if (shuffled.has(key)) return;
    shuffled.add(key);
    const steps: number[] = [];
    for (let s = run.clip.start; s < run.clip.start + run.clip.length; s++) {
      const there = swapRun(runs, s);
      if (there?.row === run.row && there.clip.id === run.clip.id && hasHit(heardCells[s])) steps.push(s);
    }
    const order = shuffleOrder(effect.mode.pick, steps.length, rollFor(CHOICE.shuffle, run.mod.seed, run.clip.seed));
    steps.forEach((s, k) => dealt.set(s, heardCells[steps[order[k]!]!]!));
  });

  // Stack: dice per interval, and how many intervals with a hit came before, per clip.
  const intervals = new Map<string, { count: number; roll: number }>();
  const counts = new Map<string, number>();
  const stackDice = (run: ModRun, effect: SwapEffect, t: number) => {
    const interval = Math.floor((t - run.clip.start + run.clip.offset) / RATE_STEPS[effect.rate]);
    const key = `${run.row}:${run.clip.id}:${interval}`;
    let rolled = intervals.get(key);
    if (rolled === undefined) {
      const clipKey = `${run.row}:${run.clip.id}`;
      const count = counts.get(clipKey) ?? 0;
      counts.set(clipKey, count + 1);
      rolled = { count, roll: rollFor(CHOICE.stack, run.mod.seed, run.clip.seed, interval)() };
      intervals.set(key, rolled);
    }
    return rolled;
  };

  return (content, clock, cell) => {
    if (!hasHit(cell)) return cell;
    const run = swapRun(runs, clock);
    const effect = swapOf(run?.mod);
    if (run === null || effect === undefined) return cell;
    if (effect.mode.kind === 'shuffle') return dealt.get(content) ?? cell;
    const layers = (stack[content] ?? []).filter(hasHit);
    const { count, roll } = stackDice(run, effect, clock);
    return stackPick(effect.mode.pick, stackCandidates(project, layers), layers, count, roll) ?? cell;
  };
}
