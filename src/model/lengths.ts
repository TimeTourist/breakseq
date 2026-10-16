import type { Hit, Id, Loop, Project, Step } from './types';
import { effectiveHit, stepDuration } from './project';

/** How long a hit sounds, in seconds: its region at its pitch and its parent's, without mods. */
export function hitSeconds(project: Project, hit: Hit): number {
  const { region, pitch } = effectiveHit(project, hit);
  return (region.end - region.start) / 2 ** (pitch / 12);
}

/** The hit a step plays: its chosen member, or member 1. */
export function stepHit(project: Project, step: Step | undefined): Hit | undefined {
  const pad = step?.padId == null ? undefined : project.pads[step.padId];
  if (pad === undefined) return undefined;
  const id: Id | undefined = step?.memberId != null && pad.members.includes(step.memberId) ? step.memberId : pad.members[0];
  return id === undefined ? undefined : project.hits[id];
}

/**
 * How much of each step a sound covers, 0 to 1, given the length in steps of
 * the hit on each step (null where there is none). A sound reaches over the
 * steps after it until it ends or the next hit cuts it; it does not wrap round
 * from the end to the start.
 */
export function reach(lengths: readonly (number | null)[]): number[] {
  let start = -1;
  let length = 0;
  return lengths.map((l, i) => {
    if (l !== null) {
      start = i;
      length = l;
    }
    return start < 0 ? 0 : Math.max(0, Math.min(1, length - (i - start)));
  });
}

/** For each step of a loop, how much of it the sounds cover at the song's tempo. */
export function loopReach(project: Project, loop: Loop): number[] {
  const step = stepDuration(project.song.bpm);
  return reach(
    loop.steps.map((cell) => {
      const hit = stepHit(project, cell);
      return hit === undefined ? null : hitSeconds(project, hit) / step;
    }),
  );
}

/** Where a slice lands on a break's 1/16 grid. */
export interface SlicePlace {
  /** The slice that plays on this step, or null. */
  readonly slice: number | null;
  /** Other slices that land on the step too: they are left out when the break is laid out in a loop. */
  readonly dropped: readonly number[];
  /** How much of the step the slices' sound covers, 0 to 1, at the break's tempo. */
  readonly reach: number;
}

/**
 * The break's slices on its 1/16 grid, as laying the parent in a loop places
 * them: each on its nearest step, the first one there wins. `markers` are the
 * slice starts and `duration` the break's length, in seconds.
 */
export function slicePlaces(markers: readonly number[], duration: number, steps: number): SlicePlace[] {
  const stepTime = duration / steps;
  const slices: (number | null)[] = Array.from({ length: steps }, () => null);
  const dropped: number[][] = Array.from({ length: steps }, () => []);
  const lengths: (number | null)[] = Array.from({ length: steps }, () => null);
  markers.forEach((m, i) => {
    const at = Math.round(m / stepTime);
    if (at >= steps) return;
    if (slices[at] !== null) {
      dropped[at]!.push(i);
      return;
    }
    slices[at] = i;
    lengths[at] = ((markers[i + 1] ?? duration) - m) / stepTime;
  });
  const covered = reach(lengths);
  return slices.map((slice, i) => ({ slice, dropped: dropped[i]!, reach: covered[i]! }));
}
