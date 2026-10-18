import type { Hit, Id, Loop, Pad, Project, Rng } from '../model';
import { STEPS_PER_BAR, emptyStep, matrixSequence } from '../model';
import type { Trigger } from './generate';
import { loopSong } from './generate';
import { triggerSeconds } from './midi';
import { padPicker } from './pad-choice';
import { hitPlay } from './render';

/**
 * What Play plays in views that show one thing rather than the song: a hit, a
 * pad's choice, or a matrix as laid out. Pure, like generate.
 */

/** Hits one after another, each heard to its end: the triggers and how long they last. */
export interface HitRun {
  readonly triggers: readonly Trigger[];
  readonly seconds: number;
}

/** The shortest a run lasts, so an empty region still gives a take. */
const MIN_SECONDS = 0.05;

/** How long a hit sounds on its own, with its parent's settings. */
export const hitSeconds = (project: Project, hit: Hit): number => triggerSeconds({ ...hitPlay(project, hit), time: 0, bar: 0, step: 0 });

/** Hits played one after another, each as long as it sounds. */
export function hitRun(project: Project, hitIds: readonly Id[]): HitRun {
  const triggers: Trigger[] = [];
  let time = 0;
  for (const id of hitIds) {
    const hit = project.hits[id];
    if (hit === undefined) continue;
    triggers.push({ ...hitPlay(project, hit), time, bar: 0, step: 0 });
    time += hitSeconds(project, hit);
  }
  return { triggers, seconds: Math.max(MIN_SECONDS, time) };
}

/** How many times a looped pad picks: enough to hear its choice, whole rounds of a round robin. */
export const PAD_ROUNDS = 8;

/** The members a pad plays, in turn: once, or PAD_ROUNDS times (a round robin goes round whole). */
export function padTurns(pad: Pad, loop: boolean, rng: Rng): Id[] {
  const count = pad.members.length;
  const rounds = !loop || count < 2 || pad.choice === 'top' ? 1 : pad.choice === 'roundRobin' ? count * Math.ceil(PAD_ROUNDS / count) : PAD_ROUNDS;
  const pick = padPicker(rng);
  return Array.from({ length: rounds }, () => pick(pad)).filter((id): id is Id => id !== undefined);
}

/**
 * The project with a song that plays a matrix once, laid out as it is in a
 * loop: each pad on its step, from step 0. A replaced slice plays what replaced it.
 */
export function matrixSong(project: Project, matrixId: Id): Project {
  const sequence = matrixSequence(project, matrixId);
  // Whole bars, at least one, as a break always was.
  const total = Math.max(0, ...sequence.map((s) => s.step + s.length));
  const length = Math.max(1, Math.ceil(total / STEPS_PER_BAR)) * STEPS_PER_BAR;
  const steps = Array.from({ length }, () => emptyStep);
  for (const { padId, step } of sequence) steps[step] = { ...emptyStep, padId };
  const loop: Loop = { id: 'preview-matrix', name: project.matrices[matrixId]?.name ?? '', kind: 'main', steps };
  return loopSong({ ...project, loops: { ...project.loops, [loop.id]: loop } }, loop.id);
}
