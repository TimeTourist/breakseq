import type { Hit, Id, Pad, PadChoice, Project } from '../model';
import { STEPS_PER_BAR, baseName, isParentPad, slotHeard, slotStep } from '../model';
import { hitSeconds } from '../engine';

/** Hits have no colour of their own for now: every hit is drawn in this one. */
export const HIT_COLOR = '#C9C4B8';


/** A short label for a pad chip: a slice's number ("amen 07" → "07"), otherwise the start of its name. */
export function padLabel(pad: Pad): string {
  const name = baseName(pad.name);
  const number = pad.auto ? /\s(\d+)$/.exec(name)?.[1] : undefined;
  return number ?? (name.length > 8 ? `${name.slice(0, 7)}…` : name);
}

export interface Group<T> {
  readonly name: string;
  readonly items: readonly T[];
  /** For a group of a break's pads: the break, which lays all of them out. */
  readonly breakId?: Id;
}

/**
 * Pads grouped the way they belong together: each break's slot pads in order,
 * named after the break; then one-shots, each a break with one pad; then pads
 * built by hand. A break's parent never shows as a pad, and a silent slot (past
 * the break's last slice) only while a loop still plays it.
 */
export function padGroups(project: Project, filter: (pad: Pad) => boolean = () => true): Group<Pad>[] {
  const inLoops = new Set(Object.values(project.loops).flatMap((l) => l.steps.flatMap((s) => (s.padId === null ? [] : [s.padId]))));
  const silent = new Set(Object.values(project.breaks).flatMap((b) => b.pads.filter((_, slot) => !slotHeard(b, slot))));
  const shown = (id: Id) => {
    const pad = project.pads[id];
    return pad !== undefined && filter(pad) && !isParentPad(project, pad) && (!silent.has(id) || inLoops.has(id)) ? [pad] : [];
  };
  const breaks = Object.values(project.breaks);
  const inBreaks = new Set(breaks.flatMap((b) => b.pads));
  const oneShots = breaks.filter((b) => b.bars === null).flatMap((b) => b.pads.flatMap(shown));
  const built = Object.values(project.pads).filter((p) => !inBreaks.has(p.id) && filter(p) && !isParentPad(project, p));
  return [
    ...breaks
      .filter((b) => b.bars !== null)
      .map((b) => ({ name: b.name, items: b.pads.flatMap(shown), breakId: b.id }))
      .filter((g) => g.items.length > 0),
    ...(oneShots.length > 0 ? [{ name: 'One-shots', items: oneShots }] : []),
    ...(built.length > 0 ? [{ name: 'Built', items: built }] : []),
  ];
}

/** Where a hit in a slot pad plays from, when it is not that slot: "07", "Think 07", or a one-shot's name. */
export function replacedBy(project: Project, padId: Id, hit: Hit): string | null {
  const home = Object.values(project.breaks).find((b) => b.pads.includes(padId));
  if (home === undefined) return null;
  const slot = home.pads.indexOf(padId);
  if (hit.breakId === home.id && hit.slot === slot) return null;
  const source = project.breaks[hit.breakId];
  if (source === undefined) return null;
  if (hit.slot === null || source.bars === null) return source.name;
  const number = String(hit.slot + 1).padStart(2, '0');
  return hit.breakId === home.id ? number : `${source.name} ${number}`;
}

/**
 * How many 1/16 steps a hit takes when placed: a slice the steps from where it
 * lands on its break's grid to where the next slice lands (as Slice shows it),
 * anything else its sound in the song's tempo, rounded up. At least one step.
 */
export function hitSteps(project: Project, hit: Hit): number {
  const brk = project.breaks[hit.breakId];
  if (brk !== undefined && brk.bars !== null && hit.slot !== null && hit.slot < brk.markers.length) {
    const steps = brk.bars * STEPS_PER_BAR;
    const at = slotStep(brk.markers[hit.slot]!, steps);
    const next = brk.markers.map((m) => slotStep(m, steps)).find((s) => s > at) ?? steps;
    return Math.max(1, next - at);
  }
  const step = 60 / project.song.bpm / 4;
  return Math.max(1, Math.ceil(hitSeconds(project, hit) / step - 1e-9));
}

/** How many steps a pad takes when placed: those of its first hit. */
export function padSteps(project: Project, pad: Pad): number {
  const hit = pad.members[0] === undefined ? undefined : project.hits[pad.members[0]];
  return hit === undefined ? 1 : hitSteps(project, hit);
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

/** What each way a pad picks its member is called. */
export const CHOICE_LABEL: Record<PadChoice, string> = { top: 'Top', roundRobin: 'Round robin', random: 'Random', noRepeat: 'No repeat' };

/** Dist modes and filter types as they read, without Off: for a mod, which always does something. */
export const DIST_MODES = [
  ['drive', 'Drive'],
  ['crush', 'Crush'],
  ['decimate', 'Decimate'],
] as const;
export const FILTER_TYPES = [
  ['lowpass', 'Low-pass'],
  ['highpass', 'High-pass'],
] as const;
