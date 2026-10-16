import type { Break, Hit, Id, Pad, Project, Region, Sample } from './types';
import { DEFAULT_GRAIN, MAX_CUTOFF, MIN_CUTOFF, NO_DIST, NO_FILTER, NO_STRETCH, STEPS_PER_BAR } from './types';
import type { DistMode, FilterType, GrainFrom } from './types';

/** A file name without its audio extension: "amen.wav 01" → "amen 01". */
export const baseName = (name: string): string => name.replace(/\.(wav|wave|aif|aiff|aifc)(?=\s|$)/gi, '');

/** A break of `bars` bars in 4/4 lasting `duration` seconds. */
export function breakBpm(duration: number, bars: number): number {
  return (bars * 4 * 60) / duration;
}

/** The shortest slice markers may make, in seconds. */
export const MIN_SLICE = 0.001;

/** Slices per bar: 4 = 1/4, 8 = 1/8, 16 = 1/16. Finer grids would need more than 16 steps per bar. */
export type SliceGrid = 4 | 8 | 16;

/** Slice starts on an equal grid, as parts 0–1 of the break. */
export function gridMarkers(bars: number, grid: SliceGrid = 16): number[] {
  const count = bars * grid;
  return Array.from({ length: count }, (_, i) => i / count);
}

/** The grid markers lie on, or null if they were placed by hand. */
export function markerGrid(markers: readonly number[], bars: number): SliceGrid | null {
  return (
    ([4, 8, 16] as const).find((grid) => {
      const even = gridMarkers(bars, grid);
      return even.length === markers.length && even.every((m, i) => Math.abs(m - markers[i]!) < 1e-9);
    }) ?? null
  );
}

/** The sample under a break. */
export const breakSample = (project: Project, brk: Break): Sample | undefined => project.samples[brk.sampleId];

/** A break's tempo, from its sample's length and its bars; null for a one-shot. */
export function bpmOf(project: Project, brk: Break): number | null {
  const sample = breakSample(project, brk);
  return brk.bars === null || sample === undefined ? null : breakBpm(sample.duration, brk.bars);
}

/** Where a slot's slice lies in the break's sample, in seconds from its start; null past the last slice. */
export function sliceWindow(project: Project, brk: Break, slot: number | null): Region | null {
  const sample = breakSample(project, brk);
  if (sample === undefined) return null;
  if (slot === null) return { start: 0, end: sample.duration };
  const start = brk.markers[slot];
  if (start === undefined) return null;
  return { start: start * sample.duration, end: (brk.markers[slot + 1] ?? 1) * sample.duration };
}

/** What a hit sounds: its sample, and its region in seconds from the sample's start. null when its slot is silent. */
export function hitSound(project: Project, hit: Hit): { sample: Sample; region: Region } | null {
  const brk = project.breaks[hit.breakId];
  const sample = brk === undefined ? undefined : breakSample(project, brk);
  const window = brk === undefined ? null : sliceWindow(project, brk, hit.slot);
  if (sample === undefined || window === null) return null;
  const length = window.end - window.start;
  return { sample, region: { start: window.start + hit.region.start * length, end: window.start + hit.region.end * length } };
}

/** The slot a pad stands for in its break, or null if it is not a slot's pad. */
export function padSlot(project: Project, padId: Id): { brk: Break; slot: number } | null {
  for (const brk of Object.values(project.breaks)) {
    const slot = brk.pads.indexOf(padId);
    if (slot >= 0) return { brk, slot };
  }
  return null;
}

/** Whether a slot has a slice: past the last marker it is silent. */
export const slotHeard = (brk: Break, slot: number): boolean => slot < brk.markers.length;

/**
 * The parent of a slice's hit: its break's own hit. Its pitch and volume apply
 * to every hit of the break's slices.
 */
export function parentHit(project: Project, hit: Hit): Hit | undefined {
  const brk = project.breaks[hit.breakId];
  if (brk?.parent == null || hit.slot === null) return undefined;
  return project.hits[brk.parent];
}

/**
 * A hit as it plays, with its parent working like a macro on it: pitch and
 * volume add, reverse on the parent turns each slice round (a reversed slice
 * plays forward again), and the parent's fade applies where the slice has none.
 */
export function effectiveHit(project: Project, hit: Hit): Hit {
  const parent = parentHit(project, hit);
  if (parent === undefined) return hit;
  const flipped = parent.direction === 'reverse';
  return {
    ...hit,
    pitch: hit.pitch + parent.pitch,
    volume: hit.volume + parent.volume,
    pan: hit.pan + parent.pan,
    direction: flipped ? (hit.direction === 'reverse' ? 'forward' : 'reverse') : hit.direction,
    fadeOut: hit.fadeOut > 0 ? hit.fadeOut : parent.fadeOut,
  };
}

/** The longest a stretch may make a hit, and the shortest, as a factor. */
export const MAX_STRETCH = 16;
export const MIN_STRETCH = 1 / 16;
/** Grain lengths in ms. */
export const MIN_GRAIN = 5;
export const MAX_GRAIN = 500;

/** How a hit is stretched as it plays: a length factor, grain length in ms, and where the grain grid starts. */
export interface StretchPlay {
  readonly factor: number;
  readonly grain: number;
  readonly from: GrainFrom;
}

export const clampStretch = (factor: number): number =>
  Number.isFinite(factor) && factor > 0 ? Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, factor)) : 1;

/** A hit's own stretch factor: Fit to tempo is the break's tempo over the song's, and 1 for a one-shot. */
function ownFactor(project: Project, hit: Hit): number {
  const { mode, factor } = hit.stretch;
  if (mode === 'factor') return clampStretch(factor);
  if (mode === 'off') return 1;
  const brk = project.breaks[hit.breakId];
  const bpm = brk === undefined ? null : bpmOf(project, brk);
  return bpm === null || project.song.bpm <= 0 ? 1 : clampStretch(bpm / project.song.bpm);
}

/**
 * How a hit is stretched without mods: its own factor times its parent's, which
 * works like a macro. Grain length and grid come from the hit, else its parent,
 * else the defaults.
 */
export function hitStretch(project: Project, hit: Hit): StretchPlay {
  const parent = parentHit(project, hit);
  return {
    factor: clampStretch(ownFactor(project, hit) * (parent === undefined ? 1 : ownFactor(project, parent))),
    grain: hit.stretch.grain ?? parent?.stretch.grain ?? DEFAULT_GRAIN,
    from: hit.stretch.from ?? parent?.stretch.from ?? 'break',
  };
}

/** Dist as a sound plays it: a mode and an amount 0–1. */
export interface DistPlay {
  readonly mode: Exclude<DistMode, 'off'>;
  readonly amount: number;
}
/** A filter as a sound plays it. */
export interface FilterPlay {
  readonly type: Exclude<FilterType, 'off'>;
  readonly cutoff: number;
  readonly resonance: number;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const clampCutoff = (hz: number): number => (Number.isFinite(hz) ? Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz)) : NO_FILTER.cutoff);
export const distPlay = (mode: Exclude<DistMode, 'off'>, amount: number): DistPlay => ({ mode, amount: clamp01(amount) });
export const filterPlay = (type: Exclude<FilterType, 'off'>, cutoff: number, resonance: number): FilterPlay => ({
  type,
  cutoff: clampCutoff(cutoff),
  resonance: clamp01(resonance),
});

/**
 * A hit's dist and filter without mods: its own, or where it has none (Off),
 * its parent's, as with fade.
 */
export function hitColour(project: Project, hit: Hit): { readonly dist: DistPlay | null; readonly filter: FilterPlay | null } {
  const parent = parentHit(project, hit);
  const d = hit.dist.mode !== 'off' ? hit.dist : parent?.dist;
  const f = hit.filter.type !== 'off' ? hit.filter : parent?.filter;
  return {
    dist: d === undefined || d.mode === 'off' ? null : distPlay(d.mode, d.amount),
    filter: f === undefined || f.type === 'off' ? null : filterPlay(f.type, f.cutoff, f.resonance),
  };
}

/** Whether a hit is a break's parent: a macro for its slices, never played as a pad. */
export function isParentHit(project: Project, hit: Hit): boolean {
  return project.breaks[hit.breakId]?.parent === hit.id;
}

/** A pad whose members are only parent hits: hidden, because parents are not played. */
export function isParentPad(project: Project, pad: Pad): boolean {
  return (
    pad.members.length > 0 &&
    pad.members.every((m) => {
      const hit = project.hits[m];
      return hit !== undefined && isParentHit(project, hit);
    })
  );
}

/** A new hit playing a whole slot (or the whole break), unchanged. */
export function slotHit(id: Id, name: string, breakId: Id, slot: number | null): Hit {
  return { id, name, breakId, slot, region: { start: 0, end: 1 }, direction: 'forward', pitch: 0, volume: 0, pan: 0, fadeOut: 0, stretch: NO_STRETCH, dist: NO_DIST, filter: NO_FILTER, variantOf: null };
}

/** The name of a slot's hit and pad: "amen 05", or just "snare" for a one-shot. */
export const slotName = (brk: Break, slot: number): string =>
  brk.bars === null ? baseName(brk.name) : `${baseName(brk.name)} ${String(slot + 1).padStart(2, '0')}`;

/**
 * Gives a break pads up to `count` slots, each with its slot's hit as its only
 * member. Slots it has already are left as they are.
 */
export function ensureSlots(project: Project, breakId: Id, count: number, newId: () => Id): Project {
  const brk = project.breaks[breakId];
  if (brk === undefined || brk.pads.length >= count) return project;
  const hits = { ...project.hits };
  const pads = { ...project.pads };
  const added: Id[] = [];
  for (let slot = brk.pads.length; slot < count; slot++) {
    const hit = slotHit(newId(), slotName(brk, slot), breakId, slot);
    const pad: Pad = { id: newId(), name: hit.name, members: [hit.id], auto: true, choice: 'top' };
    hits[hit.id] = hit;
    pads[pad.id] = pad;
    added.push(pad.id);
  }
  return { ...project, hits, pads, breaks: { ...project.breaks, [breakId]: { ...brk, pads: [...brk.pads, ...added] } } };
}

/** Where a slot lands on a grid of `steps` steps: its nearest step. */
export const slotStep = (marker: number, steps: number): number => Math.round(marker * steps);

/**
 * A break's slot pads in order, each with the step it plays on from the break's
 * start, as laying the break in a loop places them: on the nearest 1/16, the
 * first one there wins. A one-shot is its one pad on step 0.
 */
export function breakSequence(project: Project, breakId: Id): { padId: Id; step: number }[] {
  const brk = project.breaks[breakId];
  if (brk === undefined) return [];
  const steps = (brk.bars ?? 1) * STEPS_PER_BAR;
  const taken = new Set<number>();
  return brk.markers.flatMap((marker, slot) => {
    const step = slotStep(marker, steps);
    const padId = brk.pads[slot];
    if (padId === undefined || step >= steps || taken.has(step)) return [];
    taken.add(step);
    return [{ padId, step }];
  });
}
