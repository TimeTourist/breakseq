import type { Hit, Id, Loop, Project, Step } from '../model';
import { STEPS_PER_BAR, emptyStep, matrixSequence } from '../model';
import type { Trigger } from './generate';
import { generateTake, loopSong, modPreviewSong } from './generate';
import type { PickState } from './pad-choice';
import { NO_PICKS } from './pad-choice';
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

/** The shortest a block of passes is, in steps: a bar, so the next block has time to render. (Claudes val.) */
export const MIN_BLOCK_STEPS = STEPS_PER_BAR;

/**
 * How many passes of `steps` a block holds: `wanted`, and at least enough for
 * MIN_BLOCK_STEPS, but no more than MAX_PREVIEW_STEPS; always at least one.
 */
export function blockPasses(steps: number, wanted = 1): number {
  if (steps <= 0) return 1;
  const most = Math.max(1, Math.floor(MAX_PREVIEW_STEPS / steps));
  return Math.max(1, Math.min(most, Math.max(wanted, Math.ceil(MIN_BLOCK_STEPS / steps))));
}

/**
 * Play in Matrices, Loops and Mods renders in blocks, one after the other as
 * it plays: block `block` holds passes block·n … block·n + n − 1, each with its
 * own number in its seeds (see Varv i loop). A block of a matrix or loop holds
 * as many passes as its pads need to be heard (previewPasses), and at least a bar.
 */
export function matrixBlock(project: Project, matrixId: Id, block: number): Project {
  const laid = withMatrixLoop(project, matrixId);
  const passes = blockPasses(laid.loop.steps.length, previewPasses(laid.project, laid.loop.steps));
  return loopSong(laid.project, laid.loop.id, passes, block * passes);
}

/** A loop on its own, block `block` of its passes (see matrixBlock). */
export function loopBlock(project: Project, loopId: Id, block: number): Project {
  const loop = project.loops[loopId];
  const passes = loop === undefined ? 1 : blockPasses(loop.steps.length, previewPasses(project, loop.steps));
  return loopSong(project, loopId, passes, block * passes);
}

/** A mod on a loop, block `block` of its passes: each pass the loop once with the mod over it, and at least a bar. */
export function modBlock(project: Project, modId: Id, loopId: Id, block: number): Project {
  const passes = blockPasses(project.loops[loopId]?.steps.length ?? 0);
  return modPreviewSong(project, modId, loopId, passes, block * passes);
}

/**
 * Where the pads' choices stand when block `block` starts: the blocks before
 * it generated in turn (triggers only), so Round robin and No repeat go on
 * where the last block ended, and the same blocks give the same.
 */
export function blockStart(blocks: (block: number) => Project, block: number): PickState {
  let state = NO_PICKS;
  for (let b = 0; b < block; b++) state = generateTake(blocks(b), { from: state }).end ?? state;
  return state;
}
