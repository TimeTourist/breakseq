import type { Id, Pad, Project, Sample } from '../model';
import { STEPS_PER_BAR, baseName, isParentPad } from '../model';

/** Hits have no colour of their own for now: every hit is drawn in this one. */
export const HIT_COLOR = '#C9C4B8';


export const sampleOfHit = (project: Project, hitId: Id | null | undefined): Sample | undefined => {
  const hit = hitId == null ? undefined : project.hits[hitId];
  return hit === undefined ? undefined : project.samples[hit.sampleId];
};

/** A short label for a pad chip: a slice's number ("amen 07" → "07"), otherwise the start of its name. */
export function padLabel(pad: Pad): string {
  const name = baseName(pad.name);
  const number = pad.auto ? /\s(\d+)$/.exec(name)?.[1] : undefined;
  return number ?? (name.length > 8 ? `${name.slice(0, 7)}…` : name);
}

/** The imported file a sample comes from: itself, or the break it was sliced from. */
export const sourceOf = (project: Project, sample: Sample): Sample =>
  (sample.sliceOf === null ? undefined : project.samples[sample.sliceOf]) ?? sample;

export interface Group<T> {
  readonly name: string;
  readonly items: readonly T[];
  /** For a group of a sliced break's pads: the break, whose parent lays all of them out. */
  readonly breakId?: Id;
}

/**
 * Pads grouped the way they belong together: each sliced break's pads in order,
 * named after the break; then one-shots, each a pad with its own hit; then pads
 * built by hand. A break's parent never shows as a pad.
 */
export function padGroups(project: Project, filter: (pad: Pad) => boolean = () => true): Group<Pad>[] {
  const pads = Object.values(project.pads).filter((p) => filter(p) && !isParentPad(project, p));
  const built = pads.filter((p) => !p.auto);
  const byBreak = new Map<Id, { pad: Pad; offset: number }[]>();
  const oneShots: Pad[] = [];
  for (const pad of pads.filter((p) => p.auto)) {
    const sample = sampleOfHit(project, pad.members[0]);
    const source = sample === undefined ? undefined : sourceOf(project, sample);
    if (sample !== undefined && source !== undefined && source.break?.sliced === true && sample.sliceOf === source.id) {
      byBreak.set(source.id, [...(byBreak.get(source.id) ?? []), { pad, offset: sample.offset }]);
    } else {
      oneShots.push(pad);
    }
  }
  return [
    ...[...byBreak].map(([id, items]) => ({
      name: project.samples[id]?.name ?? 'Break',
      items: [...items].sort((a, b) => a.offset - b.offset).map((i) => i.pad),
      breakId: id,
    })),
    ...(oneShots.length > 0 ? [{ name: 'One-shots', items: oneShots }] : []),
    ...(built.length > 0 ? [{ name: 'Built', items: built }] : []),
  ];
}

/** Pads a hit is in, with its member number in each. */
export const hitUsages = (project: Project, hitId: Id) =>
  Object.values(project.pads)
    .filter((p) => p.members.includes(hitId))
    .map((pad) => ({ pad, member: pad.members.indexOf(hitId) + 1 }));

/** Loops a pad is in, with how many steps use it. */
export const padUsages = (project: Project, padId: Id) =>
  Object.values(project.loops)
    .map((loop) => ({ loop, steps: loop.steps.filter((s) => s.padId === padId).length }))
    .filter((u) => u.steps > 0);

/** How many song clips play a loop. */
export const loopUsage = (project: Project, loopId: Id): number =>
  project.song.clips.filter((c) => c.ref === loopId && (c.row === 'main' || c.row === 'fill')).length;

/** A length in steps, as bars and sixteenths: "1 bar", "6/16", "2 bars 4/16". */
export function lengthText(steps: number): string {
  const bars = Math.floor(steps / STEPS_PER_BAR);
  const rest = steps % STEPS_PER_BAR;
  const barText = bars === 0 ? '' : `${bars} bar${bars === 1 ? '' : 's'}`;
  return [barText, rest === 0 ? '' : `${rest}/16`].filter((s) => s !== '').join(' ');
}

/** A length in steps as a musician says it: "3/16", "1 beat", "2 beats", "1 bar", "2 bars". */
export function musicalLength(steps: number): string {
  if (steps % STEPS_PER_BAR === 0) return `${steps / STEPS_PER_BAR} bar${steps === STEPS_PER_BAR ? '' : 's'}`;
  if (steps < STEPS_PER_BAR && steps % 4 === 0) return `${steps / 4} beat${steps === 4 ? '' : 's'}`;
  return lengthText(steps);
}
