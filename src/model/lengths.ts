import type { Hit, Id, Project, Step } from './types';
import { effectiveHit, hitSound, hitStretch, slotStep } from './breaks';

/** How long a hit sounds, in seconds: its region at its pitch and stretch and its parent's, without mods. */
export function hitSeconds(project: Project, hit: Hit): number {
  const sound = hitSound(project, hit);
  if (sound === null) return 0;
  return ((sound.region.end - sound.region.start) / 2 ** (effectiveHit(project, hit).pitch / 12)) * hitStretch(project, hit).factor;
}

/** The hit a step plays: its chosen member, or member 1. */
export function stepHit(project: Project, step: Step | undefined): Hit | undefined {
  const pad = step?.padId == null ? undefined : project.pads[step.padId];
  if (pad === undefined) return undefined;
  const id: Id | undefined = step?.memberId != null && pad.members.includes(step.memberId) ? step.memberId : pad.members[0];
  return id === undefined ? undefined : project.hits[id];
}

/** A run of steps one hit holds: from its own step up to the next hit, or the end. */
export interface Hold {
  readonly start: number;
  readonly length: number;
}

/**
 * The steps each hit holds, given which steps have one: a hit holds the steps
 * after it until the next hit or the end, however long its sound rings.
 * Steps before the first hit are held by none.
 */
export function holds(filled: readonly boolean[]): Hold[] {
  const starts = filled.flatMap((f, i) => (f ? [i] : []));
  return starts.map((start, i) => ({ start, length: (starts[i + 1] ?? filled.length) - start }));
}

/** The holds within steps `from` to `to`, cut at both ends: a hold over a row's end goes on in the next row. */
export function holdsIn(all: readonly Hold[], from: number, to: number): Hold[] {
  return all.flatMap((h) => {
    const start = Math.max(h.start, from);
    const end = Math.min(h.start + h.length, to);
    return end > start ? [{ start, length: end - start }] : [];
  });
}

/** Where a slice lands on a break's 1/16 grid. */
export interface SlicePlace {
  /** The slice that plays on this step, or null. */
  readonly slice: number | null;
  /** Other slices that land on the step too: they are left out when the break is laid out in a loop. */
  readonly dropped: readonly number[];
}

/**
 * The break's slices on its 1/16 grid, as laying the break in a loop places
 * them: each on its nearest step, the first one there wins. `markers` are the
 * slice starts as parts 0–1 of the break.
 */
export function slicePlaces(markers: readonly number[], steps: number): SlicePlace[] {
  const slices: (number | null)[] = Array.from({ length: steps }, () => null);
  const dropped: number[][] = Array.from({ length: steps }, () => []);
  markers.forEach((m, i) => {
    const at = slotStep(m, steps);
    if (at >= steps) return;
    if (slices[at] !== null) {
      dropped[at]!.push(i);
      return;
    }
    slices[at] = i;
  });
  return slices.map((slice, i) => ({ slice, dropped: dropped[i]! }));
}
