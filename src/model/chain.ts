import type { Command, CommandContext } from './command';
import { invalid, notFound, ok } from './command';
import { emptySteps } from './project';
import type { AudioData, Hit, Id, Loop, Pad, Project, Sample } from './types';
import { STEPS_PER_BAR } from './types';

/**
 * The automatic chain: every new sample gets a default hit (the whole sample,
 * unchanged) and a pad with that hit as its only member. It runs once; after
 * that they are ordinary objects.
 */
function addWithChain(project: Project, sample: Sample, ctx: CommandContext): { project: Project; padId: Id } {
  const hit: Hit = {
    id: ctx.newId(),
    name: sample.name,
    sampleId: sample.id,
    region: { start: 0, end: sample.duration },
    direction: 'forward',
    pitch: 0,
    volume: 0,
    fadeOut: 0,
  };
  const pad: Pad = { id: ctx.newId(), name: sample.name, members: [hit.id] };
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
}

/** Adds an imported file as a sample, with its default hit and pad. */
export const addSample =
  ({ name, audio }: NewSample): Command =>
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
      extraTags: [],
      break: null,
    };
    return ok(addWithChain({ ...project, audio: { ...project.audio, [audioId]: audio } }, sample, ctx).project);
  };

/** A break of `bars` bars in 4/4 lasting `duration` seconds. */
export function breakBpm(duration: number, bars: number): number {
  return (bars * 4 * 60) / duration;
}

/** Slices per bar: 4 = 1/4, 8 = 1/8, 16 = 1/16. Finer grids would need more than 16 steps per bar. */
export type SliceGrid = 4 | 8 | 16;

function nextMainLoopName(project: Project): string {
  const names = new Set(Object.values(project.loops).map((l) => l.name));
  let n = 1;
  while (names.has(`M${n}`)) n++;
  return `M${n}`;
}

/**
 * Slices a break on an equal grid. Each slice becomes a sample (with the
 * chain), and a main loop (M1) plays the slice pads in order, quantized to 1/16.
 */
export const sliceBreak =
  (sampleId: Id, bars: number, grid: SliceGrid = 16): Command =>
  (project, ctx) => {
    const source = project.samples[sampleId];
    if (source === undefined) return notFound(sampleId);
    if (!Number.isInteger(bars) || bars < 1) return invalid('A break must be a whole number of bars');

    const count = bars * grid;
    const sliceDuration = source.duration / count;
    const digits = String(count).length;
    const stepsPerSlice = STEPS_PER_BAR / grid;

    let next: Project = {
      ...project,
      samples: { ...project.samples, [sampleId]: { ...source, break: { bars, bpm: breakBpm(source.duration, bars) } } },
    };
    const steps = emptySteps(bars);
    for (let i = 0; i < count; i++) {
      const slice: Sample = {
        id: ctx.newId(),
        name: `${source.name} ${String(i + 1).padStart(digits, '0')}`,
        audioId: source.audioId,
        offset: source.offset + i * sliceDuration,
        duration: sliceDuration,
        mainTag: null,
        extraTags: [],
        break: null,
      };
      const added = addWithChain(next, slice, ctx);
      next = added.project;
      steps[i * stepsPerSlice] = { padId: added.padId, memberId: null, ignoreMods: false, nudge: 0 };
    }

    const loop: Loop = { id: ctx.newId(), name: nextMainLoopName(next), kind: 'main', bars, steps };
    return ok({ ...next, loops: { ...next.loops, [loop.id]: loop } });
  };
