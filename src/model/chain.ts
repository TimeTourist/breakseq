import type { Command, CommandContext, Usage } from './command';
import { fail, invalid, notFound, ok, sequence } from './command';
import { findUsages } from './references';
import type { SliceGrid } from './project';
import { emptySteps, fullWindow, gridMarkers, nextLoopName, onGrid } from './project';
import type { AudioData, BreakInfo, Hit, Id, Loop, Pad, Project, Sample } from './types';
import { STEPS_PER_BAR } from './types';

/** A file name without its audio extension: "amen.wav 01" → "amen 01". */
export const baseName = (name: string): string => name.replace(/\.(wav|wave|aif|aiff|aifc)(?=\s|$)/gi, '');

/**
 * The automatic chain: every new sample gets a default hit (the whole sample,
 * unchanged) and a pad with that hit as its only member. It runs once; after
 * that they are ordinary objects.
 */
function addWithChain(project: Project, sample: Sample, ctx: CommandContext): { project: Project; padId: Id } {
  const hit: Hit = {
    id: ctx.newId(),
    name: baseName(sample.name),
    sampleId: sample.id,
    region: { start: 0, end: sample.duration },
    direction: 'forward',
    pitch: 0,
    volume: 0,
    fadeOut: 0,
    variantOf: null,
  };
  const pad: Pad = { id: ctx.newId(), name: baseName(sample.name), members: [hit.id], auto: true };
  return {
    project: {
      ...project,
      samples: { ...project.samples, [sample.id]: sample },
      hits: { ...project.hits, [hit.id]: hit },
      pads: { ...project.pads, [pad.id]: pad },
    },
    padId: pad.id,
  };
}

export interface NewSample {
  readonly name: string;
  readonly audio: AudioData;
  /** Cue markers from the file, in seconds. A file with cues becomes a 4-bar break sliced at them. */
  readonly cues?: readonly number[];
}

/** Adds an imported file as a sample, with its default hit and pad. */
export const addSample =
  ({ name, audio, cues = [] }: NewSample): Command =>
  (project, ctx) => {
    const length = audio.channels[0]?.length ?? 0;
    if (length === 0 || audio.sampleRate <= 0) return invalid('Audio is empty');
    const audioId = ctx.newId();
    const sample: Sample = {
      id: ctx.newId(),
      name,
      audioId,
      offset: 0,
      duration: length / audio.sampleRate,
      mainTag: null,
      tagGuessed: false,
      extraTags: [],
      break: null,
      sliceOf: null,
    };
    if (cues.length > 0) {
      const withCues = { ...sample, break: breakInfo(sample.duration, 4, cleanMarkers(cues, sample.duration)) };
      return ok(addWithChain({ ...project, audio: { ...project.audio, [audioId]: audio } }, withCues, ctx).project);
    }
    return ok(addWithChain({ ...project, audio: { ...project.audio, [audioId]: audio } }, sample, ctx).project);
  };

/** A break of `bars` bars in 4/4 lasting `duration` seconds. */
export function breakBpm(duration: number, bars: number): number {
  return (bars * 4 * 60) / duration;
}

/** The shortest slice markers may make, in seconds. */
export const MIN_SLICE = 0.001;

/** A break's info; markers default to 1/16. */
const breakInfo = (duration: number, bars: number, markers: readonly number[] = gridMarkers(duration, bars)): BreakInfo => ({
  bars,
  bpm: breakBpm(duration, bars),
  sliced: false,
  markers,
  loop: null,
});

/** Markers within a sample of `duration`, the first at 0, too-close ones dropped. */
function cleanMarkers(markers: readonly number[], duration: number): number[] {
  const kept: number[] = [0];
  for (const m of [...markers].sort((a, b) => a - b)) {
    if (m - kept[kept.length - 1]! >= MIN_SLICE && duration - m >= MIN_SLICE) kept.push(m);
  }
  return kept;
}

const setSample = (project: Project, sample: Sample): Project => ({
  ...project,
  samples: { ...project.samples, [sample.id]: sample },
});

/** Makes a sample a break of `bars` bars, working out its BPM, or a one-shot with null. Markers start on 1/16. */
export const setBreak =
  (sampleId: Id, bars: number | null): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.break?.sliced === true) return invalid('A sliced break cannot change');
    if (bars !== null && (!Number.isInteger(bars) || bars < 1)) return invalid('A break must be a whole number of bars');
    // Markers placed by hand (or from cues) stay; markers on a grid follow the new length.
    const own = sample.break !== null && !onGrid(sample.break.markers, sample.duration, sample.break.bars) ? sample.break.markers : undefined;
    return ok(setSample(project, { ...sample, break: bars === null ? null : breakInfo(sample.duration, bars, own) }));
  };

/**
 * Trims an imported sample to `start`–`end` seconds of its file. Hits keep their
 * place in the file, cut to the new window; a hit that covered the whole sample
 * still does. A break gets a new BPM and markers on 1/16.
 */
export const trimSample =
  (sampleId: Id, start: number, end: number): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.sliceOf !== null) return invalid('A slice cannot be trimmed');
    if (sample.break?.sliced === true) return invalid('Re-slice the break to trim it');
    const audio = project.audio[sample.audioId];
    const length = audio === undefined ? 0 : (audio.channels[0]?.length ?? 0) / audio.sampleRate;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(0, Math.min(end, length));
    if (to - from < MIN_SLICE) return invalid('The trimmed sample is too short');

    const duration = to - from;
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const hits = Object.fromEntries(
      Object.entries(project.hits).map(([id, hit]): [Id, Hit] => {
        if (hit.sampleId !== sampleId) return [id, hit];
        const whole = near(hit.region.start, 0) && near(hit.region.end, sample.duration);
        const regionStart = Math.max(0, Math.min(duration, sample.offset + hit.region.start - from));
        const regionEnd = Math.max(0, Math.min(duration, sample.offset + hit.region.end - from));
        const region = whole || regionEnd - regionStart < MIN_SLICE ? { start: 0, end: duration } : { start: regionStart, end: regionEnd };
        return [id, { ...hit, region }];
      }),
    );
    const trimmed: Sample = {
      ...sample,
      offset: from,
      duration,
      break:
        sample.break === null
          ? null
          : breakInfo(
              duration,
              sample.break.bars,
              // Own markers keep their place in the file; markers on a grid follow the new length.
              onGrid(sample.break.markers, sample.duration, sample.break.bars)
                ? undefined
                : cleanMarkers(sample.break.markers.map((m) => m + sample.offset - from), duration),
            ),
    };
    return ok({ ...setSample(project, trimmed), hits });
  };

/** Sets where slices start, in seconds from the break's start. The first is always at 0. */
export const setMarkers =
  (sampleId: Id, markers: readonly number[]): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.break === null) return invalid('Only a break has markers');
    if (sample.break.sliced) return invalid('Re-slice the break to move its markers');
    const sorted = [0, ...markers.filter((m) => m > 0 && m < sample.duration)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! < MIN_SLICE) return invalid('Markers are too close together');
    }
    if (sample.duration - sorted[sorted.length - 1]! < MIN_SLICE) return invalid('A marker is too close to the end');
    return ok(setSample(project, { ...sample, break: { ...sample.break, markers: sorted } }));
  };

/**
 * Slices a break at its markers. Each slice becomes a sample (with the chain),
 * and a main loop plays the slice pads in order, each on the nearest 1/16. If two
 * land on the same step the first keeps it, and the other is left out of the loop.
 */
export const sliceAtMarkers =
  (sampleId: Id): Command =>
  (project, ctx) => {
    const source = project.samples[sampleId];
    if (source === undefined) return notFound(sampleId);
    const info = source.break;
    if (info === null) return invalid('Only a break can be sliced');
    if (info.sliced) return invalid('The break is already sliced');

    const { bars, markers } = info;
    const digits = String(markers.length).length;
    const stepTime = source.duration / (bars * STEPS_PER_BAR);
    const loopId = ctx.newId();
    let next = setSample(project, { ...source, break: { ...info, sliced: true, loop: loopId } });
    const steps = emptySteps(bars);
    markers.forEach((marker, i) => {
      const end = markers[i + 1] ?? source.duration;
      const slice: Sample = {
        id: ctx.newId(),
        name: `${baseName(source.name)} ${String(i + 1).padStart(digits, '0')}`,
        audioId: source.audioId,
        offset: source.offset + marker,
        duration: end - marker,
        mainTag: null,
        tagGuessed: false,
        extraTags: [],
        break: null,
        sliceOf: sampleId,
      };
      const added = addWithChain(next, slice, ctx);
      next = added.project;
      const step = Math.min(steps.length - 1, Math.round(marker / stepTime));
      if (steps[step]?.padId === null) steps[step] = { padId: added.padId, memberId: null, ignoreMods: false, nudge: 0 };
    });

    const loop: Loop = { id: loopId, name: nextLoopName(next, 'main'), kind: 'main', bars, steps, window: fullWindow(bars) };
    return ok({ ...next, loops: { ...next.loops, [loop.id]: loop } });
  };

/** Makes the break `bars` bars, puts its markers on an equal grid and slices it. */
export const sliceBreak = (sampleId: Id, bars: number, grid: SliceGrid = 16): Command =>
  sequence(
    setBreak(sampleId, bars),
    (project, ctx) => {
      const sample = project.samples[sampleId];
      return sample === undefined ? notFound(sampleId) : setMarkers(sampleId, gridMarkers(sample.duration, bars, grid))(project, ctx);
    },
    sliceAtMarkers(sampleId),
  );

/**
 * Takes back a slicing, so the break can be sliced again: removes its slices,
 * their hits and pads, and the loop the slicing made. Refused, listing why, if
 * anything else uses them, that loop plays other pads too, or it is in the song.
 */
export const unsliceBreak =
  (sampleId: Id): Command =>
  (project) => {
    const source = project.samples[sampleId];
    if (source === undefined) return notFound(sampleId);
    if (source.break?.sliced !== true) return invalid('The break is not sliced');

    const slices = new Set(Object.values(project.samples).filter((s) => s.sliceOf === sampleId).map((s) => s.id));
    const hits = new Set(Object.values(project.hits).filter((h) => slices.has(h.sampleId)).map((h) => h.id));
    const pads = new Set(
      Object.values(project.pads)
        .filter((p) => p.auto && p.members.length === 1 && hits.has(p.members[0]!))
        .map((p) => p.id),
    );
    const loops = Object.values(project.loops).filter((l) => l.steps.some((s) => s.padId !== null && pads.has(s.padId)));
    const made = source.break.loop === null ? undefined : project.loops[source.break.loop];
    const own = made !== undefined && made.steps.every((s) => s.padId === null || pads.has(s.padId)) ? [made] : [];

    const usages: Usage[] = [
      ...Object.values(project.hits)
        .filter((h) => h.variantOf !== null && hits.has(h.variantOf) && !hits.has(h.id))
        .map((h): Usage => ({ kind: 'hit', id: h.id, name: h.name })),
      ...Object.values(project.pads)
        .filter((p) => !pads.has(p.id) && p.members.some((m) => hits.has(m)))
        .map((p): Usage => ({ kind: 'pad', id: p.id, name: p.name })),
      ...loops.filter((l) => !own.includes(l)).map((l): Usage => ({ kind: 'loop', id: l.id, name: l.name })),
      ...Object.values(project.mods)
        .filter((m) => m.scope.kind === 'pad' && pads.has(m.scope.padId))
        .map((m): Usage => ({ kind: 'mod', id: m.id, name: m.name })),
      ...own
        .filter((l) => findUsages(project, 'loop', l.id).length > 0)
        .map((l): Usage => ({ kind: 'song', id: null, name: `${l.name} in Song` })),
    ];
    if (usages.length > 0) return fail({ kind: 'in-use', usages });

    const keep = <T extends { id: Id }>(record: Readonly<Record<Id, T>>, drop: Set<Id>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => !drop.has(id)));
    const unsliced = setSample(project, { ...source, break: { ...source.break, sliced: false, loop: null } });
    return ok({
      ...unsliced,
      samples: keep(unsliced.samples, slices),
      hits: keep(project.hits, hits),
      pads: keep(project.pads, pads),
      loops: keep(project.loops, new Set(own.map((l) => l.id))),
    });
  };
