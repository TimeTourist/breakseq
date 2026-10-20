import type { Hit, Id, Loop, Project, Step } from '../model';
import { STEPS_PER_BAR, emptyStep, matrixSequence } from '../model';
import type { Trigger } from './generate';
import { loopSong } from './generate';
import { triggerSeconds } from './midi';
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

/** How many times, at least, a Random or No repeat pad picks in a looped preview: enough to hear its choice. */
export const PAD_ROUNDS = 8;

/** The most a looped preview renders, in steps: 32 bars, however many passes its pads would want. */
export const MAX_PREVIEW_STEPS = 32 * STEPS_PER_BAR;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * How many passes of `steps` a looped preview renders, so that what the pads
 * pick is heard rather than one pick looped: a Round robin pad goes round
 * whole (and the next pass starts on its first hit again), and a Random or No
 * repeat pad picks PAD_ROUNDS times or more. At most MAX_PREVIEW_STEPS, and at
 * least one pass. A step that locks a member picks nothing.
 */
export function previewPasses(project: Project, steps: readonly Step[]): number {
  if (steps.length === 0) return 1;
  const most = Math.max(1, Math.floor(MAX_PREVIEW_STEPS / steps.length));
  // How many times each pad picks in a pass.
  const picks = new Map<Id, number>();
  for (const step of steps) if (step.padId !== null && step.memberId === null) picks.set(step.padId, (picks.get(step.padId) ?? 0) + 1);
  let whole = 1;
  let random = 1;
  for (const [padId, times] of picks) {
    const pad = project.pads[padId];
    const count = pad?.members.length ?? 0;
    if (pad === undefined || count < 2) continue;
    if (pad.choice === 'roundRobin') {
      // Passes until the pad's turn is back on its first hit; past the cap it no longer matters.
      const round = count / gcd(count, times);
      whole = Math.min((whole * round) / gcd(whole, round), most + 1);
    } else if (pad.choice === 'random' || pad.choice === 'noRepeat') {
      random = Math.max(random, Math.ceil(PAD_ROUNDS / times));
    }
  }
  return Math.min(most, whole * Math.ceil(random / whole));
}

/**
 * How long a matrix plays on its own, in steps: exactly its pads' steps, not
 * whole bars, so a loop of it goes straight on from its last step (Magnus
 * beslut). Steps are whole 1/16s; a matrix of only empty pads is one silent
 * step. (Claudes val.)
 */
export function matrixPassSteps(project: Project, matrixId: Id): number {
  return Math.max(1, ...matrixSequence(project, matrixId).map((s) => s.step + s.length));
}

/** The project with a matrix laid out as a loop: each pad on its step, from step 0, as long as its steps. */
function withMatrixLoop(project: Project, matrixId: Id): { project: Project; loop: Loop } {
  const steps = Array.from({ length: matrixPassSteps(project, matrixId) }, () => emptyStep);
  for (const { padId, step } of matrixSequence(project, matrixId)) steps[step] = { ...emptyStep, padId };
  const loop: Loop = { id: 'preview-matrix', name: project.matrices[matrixId]?.name ?? '', kind: 'main', steps };
  return { project: { ...project, loops: { ...project.loops, [loop.id]: loop } }, loop };
}

/**
 * The project with a song that plays a matrix once, laid out as it is in a
 * loop: each pad on its step, from step 0. A replaced slice plays what replaced it.
 */
export function matrixSong(project: Project, matrixId: Id): Project {
  const laid = withMatrixLoop(project, matrixId);
  return loopSong(laid.project, laid.loop.id);
}

/** A matrix as matrixSong lays it out, over as many passes as its pads need to be heard looped (see previewPasses). */
export function matrixSongLooped(project: Project, matrixId: Id): Project {
  const laid = withMatrixLoop(project, matrixId);
  return loopSong(laid.project, laid.loop.id, previewPasses(laid.project, laid.loop.steps));
}

/** A loop on its own, over as many passes as its pads need to be heard looped (see previewPasses). */
export function loopSongLooped(project: Project, loopId: Id): Project {
  const loop = project.loops[loopId];
  return loopSong(project, loopId, loop === undefined ? 1 : previewPasses(project, loop.steps));
}
