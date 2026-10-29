import type { Clip, Command, CommandContext, Id, Project } from '../../model';
import { addSample, copyHits, createLoop, createProject, setBpm, setSongBars, setStep } from '../../model';
import { constantAudio, sequentialIds } from '../../test/fixtures';

function runWith(ctx: CommandContext, project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const added = (before: Project, after: Project, key: 'hits' | 'pads' | 'loops'): Id => Object.keys(after[key]).find((k) => !(k in before[key]))!;

/**
 * Mods saved before step lanes (phase 24b), with the forms List, Cycle, Ramp
 * and Random, as a project file has them: `{ target, rate, shape }`.
 */
export const OLD_MODS = {
  list: {
    id: 'old-list',
    name: 'List',
    seed: 11,
    effects: [
      { target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } },
      { target: 'volume', rate: 'step', shape: { kind: 'list', values: [0, -6, -3] } },
    ],
  },
  cycle: {
    id: 'old-cycle',
    name: 'Cycle',
    seed: 12,
    effects: [
      { target: 'ratchet', rate: 'step', shape: { kind: 'cycle', values: [1, 2, 3] } },
      { target: 'padMember', rate: 'step', shape: { kind: 'cycle', values: [1, 2] } },
    ],
  },
  ramp: {
    id: 'old-ramp',
    name: 'Ramp',
    seed: 13,
    effects: [
      { target: 'filter', rate: 'step', shape: { kind: 'ramp', from: 200, to: 8000 }, filter: { type: 'lowpass', resonance: 0.2 } },
      { target: 'pitch', rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } },
    ],
  },
  random: {
    id: 'old-random',
    name: 'Random',
    seed: 14,
    effects: [
      { target: 'pitch', rate: 'step', shape: { kind: 'random', min: -12, max: 12, chance: 50, whole: true } },
      { target: 'pan', rate: 'step', shape: { kind: 'random', min: -100, max: 100, chance: 100, whole: false } },
      { target: 'ratchet', rate: 'beat', shape: { kind: 'random', min: 2, max: 4, chance: 75, whole: true } },
    ],
  },
  nearest: {
    id: 'old-nearest',
    name: 'Nearest',
    seed: 15,
    effects: [
      { target: 'volume', rate: 'step', shape: { kind: 'random', min: -12, max: 0, chance: 30, whole: false } },
      { target: 'direction', rate: 'step', shape: { kind: 'random', min: 0, max: 1, chance: 25, whole: true } },
    ],
  },
  // Random with whole numbers on a target whose dice roll freely now (fas 24f).
  whole: {
    id: 'old-whole',
    name: 'Whole',
    seed: 16,
    effects: [
      { target: 'volume', rate: 'step', shape: { kind: 'random', min: -12, max: 0, chance: 100, whole: true } },
      { target: 'pan', rate: 'beat', shape: { kind: 'random', min: -50, max: 50, chance: 50, whole: true } },
    ],
  },
  // An empty List did nothing (fas 24f).
  empty: {
    id: 'old-empty',
    name: 'Empty',
    seed: 17,
    effects: [
      { target: 'pitch', rate: 'step', shape: { kind: 'list', values: [] } },
      { target: 'volume', rate: 'beat', shape: { kind: 'list', values: [] } },
    ],
  },
  // An empty Cycle counted 1, 2, 3 … on any target (fas 24g).
  counting: {
    id: 'old-counting',
    name: 'Counting',
    seed: 18,
    effects: [
      { target: 'volume', rate: 'beat', shape: { kind: 'cycle', values: [] } },
      { target: 'pitch', rate: 'step', shape: { kind: 'cycle', values: [] } },
    ],
  },
} as const;

/**
 * A one-bar loop with a pad of four hits on every step, in Main over 9 bars,
 * and one old mod per bar in Mod A: List (twice, the second clip trimmed by 3
 * steps), Cycle, Ramp, Random, Nearest, Whole, Empty and Counting. Built with sequential ids, so the
 * same every time. The project is as a saved file has it: not upgraded.
 */
export function oldShapesSong(ctx: CommandContext = sequentialIds()): { readonly project: Project; readonly pad: Id; readonly loop: Id } {
  const run = (project: Project, ...commands: Command[]) => runWith(ctx, project, ...commands);
  let project = run(createProject(), setBpm(170));
  const hits: Id[] = [];
  let pad: Id | null = null;
  for (const name of ['a', 'b', 'c', 'd']) {
    const next = run(project, addSample({ name, audio: constantAudio(0.05, [0.1, 0.1]) }));
    hits.push(added(project, next, 'hits'));
    pad ??= added(project, next, 'pads');
    project = next;
  }
  project = run(project, copyHits(hits.slice(1), pad!));
  const withLoop = run(project, createLoop('M1', 'main', 1));
  const loop = added(project, withLoop, 'loops');
  project = run(withLoop, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: pad })), setSongBars(9));
  const clip = (id: string, row: Clip['row'], ref: Id, start: number, length: number, offset: number, seed: number): Clip => ({ id, row, ref, start, length, offset, seed });
  const clips: Clip[] = [
    clip('main-1', 'main', loop, 0, 144, 0, 101),
    clip('mod-list-1', 'modA', OLD_MODS.list.id, 0, 16, 0, 201),
    clip('mod-list-2', 'modA', OLD_MODS.list.id, 16, 13, 3, 202),
    clip('mod-cycle', 'modA', OLD_MODS.cycle.id, 32, 16, 0, 203),
    clip('mod-ramp', 'modA', OLD_MODS.ramp.id, 48, 16, 0, 204),
    clip('mod-random', 'modA', OLD_MODS.random.id, 64, 16, 0, 205),
    clip('mod-nearest', 'modA', OLD_MODS.nearest.id, 80, 16, 0, 206),
    clip('mod-whole', 'modA', OLD_MODS.whole.id, 96, 16, 0, 207),
    clip('mod-empty', 'modA', OLD_MODS.empty.id, 112, 16, 0, 208),
    clip('mod-counting', 'modA', OLD_MODS.counting.id, 128, 16, 0, 209),
  ];
  // Saved as a file has it: mods of the old shape go in as they are, past the commands' checks.
  const mods = Object.fromEntries(Object.values(OLD_MODS).map((m) => [m.id, m])) as unknown as Project['mods'];
  return { project: { ...project, mods, song: { ...project.song, clips } }, pad: pad!, loop };
}
