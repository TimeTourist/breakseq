import type { Config, Hit, Id, Project, Region, Sample } from './types';
import { DEFAULT_GRAIN, DELAY_STEPS, MAX_CUTOFF, MIN_CUTOFF, NO_CONFIG, NO_FILTER } from './types';
import type { DelaySteps, DistMode, FilterType, GrainFrom } from './types';
import { matrixOfPad, padOfHit, sampleBpm } from './owners';

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

/** Slice starts on an equal grid, as parts 0–1 of the sample. */
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

/** A sample is a trim of a file: "amen trim 2". The file keeps its own name ("amen.wav"). */
export const trimName = (sample: Sample): string => `${baseName(sample.name)} trim ${sample.trim}`;

/** A trim's slicing, named after the trim it slices: "amen slice 2". */
export const sliceName = (sample: Sample): string => `${baseName(sample.name)} slice ${sample.trim}`;

/** The name a trim's own matrix gets: its file without the extension, and its trim's number ("amen 2"). */
export const defaultMatrixName = (sample: Sample): string => `${baseName(sample.name)} ${sample.trim}`;

/** Where a slice lies in its sample, in seconds from its start; null past the last marker. */
export function sliceWindow(sample: Sample, slice: number | null): Region | null {
  if (slice === null) return { start: 0, end: sample.duration };
  const start = sample.markers[slice];
  if (start === undefined) return null;
  return { start: start * sample.duration, end: (sample.markers[slice + 1] ?? 1) * sample.duration };
}

/** What a hit sounds: its sample, and its region in seconds from the sample's start. null when its slice is silent. */
export function hitSound(project: Project, hit: Hit): { sample: Sample; region: Region } | null {
  const sample = project.samples[hit.sampleId];
  const window = sample === undefined ? null : sliceWindow(sample, hit.slice);
  if (sample === undefined || window === null) return null;
  const length = window.end - window.start;
  return { sample, region: { start: window.start + hit.region.start * length, end: window.start + hit.region.end * length } };
}

/** A hit's config and those laid over it, nearest first: the hit, its pad, its matrix. */
export function configLayers(project: Project, hit: Hit): readonly Config[] {
  const pad = padOfHit(project, hit.id);
  const matrix = pad === undefined ? undefined : matrixOfPad(project, pad.id);
  return [hit, ...(pad === undefined ? [] : [pad.config]), ...(matrix === undefined ? [] : [matrix.config])];
}

/** The nearest layer whose config has something for `has`, or undefined. */
const nearest = (layers: readonly Config[], has: (config: Config) => boolean): Config | undefined => layers.find(has);

/**
 * A hit as it plays, with its pad's and matrix's config laid over it: pitch,
 * volume and pan add, each reverse turns it round (a reversed hit in a
 * reversed matrix plays forward again), and fade comes from the nearest layer
 * that has one.
 */
export function effectiveHit(project: Project, hit: Hit): Hit {
  const layers = configLayers(project, hit);
  if (layers.length === 1) return hit;
  const sum = (field: 'pitch' | 'volume' | 'pan') => layers.reduce((total, c) => total + c[field], 0);
  const flips = layers.filter((c) => c.direction === 'reverse').length;
  return {
    ...hit,
    pitch: sum('pitch'),
    volume: sum('volume'),
    pan: sum('pan'),
    direction: flips % 2 === 1 ? 'reverse' : 'forward',
    fadeOut: nearest(layers, (c) => c.fadeOut > 0)?.fadeOut ?? 0,
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

/** A layer's own stretch factor; Fit to tempo is counted apart, once. */
const layerFactor = (config: Config): number => (config.stretch.mode === 'factor' ? clampStretch(config.stretch.factor) : 1);

/** Fit to tempo for a hit: its own sample's tempo over the song's, and 1 for a sample with no tempo. */
function fitFactor(project: Project, hit: Hit): number {
  const sample = project.samples[hit.sampleId];
  const bpm = sample === undefined ? null : sampleBpm(sample);
  return bpm === null || project.song.bpm <= 0 ? 1 : clampStretch(bpm / project.song.bpm);
}

/**
 * How a hit is stretched without mods: the factors of all its layers
 * multiplied, and Fit to tempo once if any layer has it. Grain length and grid
 * come from the nearest layer that has them, else the defaults.
 */
export function hitStretch(project: Project, hit: Hit): StretchPlay {
  const layers = configLayers(project, hit);
  const fit = layers.some((c) => c.stretch.mode === 'fit') ? fitFactor(project, hit) : 1;
  return {
    factor: clampStretch(layers.reduce((f, c) => f * layerFactor(c), fit)),
    grain: nearest(layers, (c) => c.stretch.grain !== null)?.stretch.grain ?? DEFAULT_GRAIN,
    from: nearest(layers, (c) => c.stretch.from !== null)?.stretch.from ?? 'break',
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

/** A hit's dist and filter without mods: from the nearest layer that is not Off, as with fade. */
export function hitColour(project: Project, hit: Hit): { readonly dist: DistPlay | null; readonly filter: FilterPlay | null } {
  const layers = configLayers(project, hit);
  const d = nearest(layers, (c) => c.dist.mode !== 'off')?.dist;
  const f = nearest(layers, (c) => c.filter.type !== 'off')?.filter;
  return {
    dist: d === undefined || d.mode === 'off' ? null : distPlay(d.mode, d.amount),
    filter: f === undefined || f.type === 'off' ? null : filterPlay(f.type, f.cutoff, f.resonance),
  };
}

/** Reverb as a sound sends it: an amount 0–1 and a size 0–1. */
export interface ReverbPlay {
  readonly amount: number;
  readonly size: number;
}
/** Delay as a sound sends it: an amount 0–1, a time in steps of 1/16, and feedback 0–1. */
export interface DelayPlay {
  readonly amount: number;
  readonly steps: DelaySteps;
  readonly feedback: number;
}

/** The most feedback a delay takes, so its echoes always die away. */
export const MAX_FEEDBACK = 0.9;
export const delaySteps = (steps: number): DelaySteps =>
  DELAY_STEPS.reduce((best, s) => (Math.abs(s - steps) < Math.abs(best - steps) ? s : best), DELAY_STEPS[0] as DelaySteps);
/** Reverb to send, or null when the amount is nothing. */
export const reverbPlay = (amount: number, size: number): ReverbPlay | null => {
  const a = clamp01(amount);
  return a <= 0 ? null : { amount: a, size: clamp01(size) };
};
/** Delay to send, or null when the amount is nothing. */
export const delayPlay = (amount: number, steps: number, feedback: number): DelayPlay | null => {
  const a = clamp01(amount);
  return a <= 0 ? null : { amount: a, steps: delaySteps(steps), feedback: Math.min(MAX_FEEDBACK, clamp01(feedback)) };
};

/** A hit's reverb and delay without mods: from the nearest layer whose amount is above 0, as with dist. */
export function hitSpace(project: Project, hit: Hit): { readonly reverb: ReverbPlay | null; readonly delay: DelayPlay | null } {
  const layers = configLayers(project, hit);
  const r = nearest(layers, (c) => c.reverb.amount > 0)?.reverb;
  const d = nearest(layers, (c) => c.delay.amount > 0)?.delay;
  return {
    reverb: r === undefined ? null : reverbPlay(r.amount, r.size),
    delay: d === undefined ? null : delayPlay(d.amount, d.steps, d.feedback),
  };
}

/** A new hit playing a whole slice (or the whole sample), unchanged. */
export function slotHit(id: Id, name: string, sampleId: Id, slice: number | null): Hit {
  return { ...NO_CONFIG, id, name, sampleId, slice, region: { start: 0, end: 1 }, variantOf: null };
}

/** The name of a row's hit and pad: "amen 05", or just "snare" when its sample is not sliced. */
export const slotName = (name: string, sample: Sample, slice: number): string =>
  sample.bars === null ? baseName(name) : `${baseName(name)} ${String(slice + 1).padStart(2, '0')}`;

/** Where a slice lands on a grid of `steps` steps: its nearest step. */
export const slotStep = (marker: number, steps: number): number => Math.round(marker * steps);
