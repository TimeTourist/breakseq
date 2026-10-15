import type { CommandContext } from './command';
import { defaultContext } from './command';
import type { Hit, Id, Loop, LoopKind, Mod, Pad, Project, Sample, Song, Step, StepWindow, Tag } from './types';
import { STEPS_PER_BAR } from './types';

export const DEFAULT_TAG_NAMES = ['K', 'S', 'H', 'R', 'G'] as const;

// A new song starts at 170 BPM and 8 bars.
export const DEFAULT_BPM = 170;
export const DEFAULT_SONG_BARS = 8;

export const emptyStep: Step = { padId: null, memberId: null, ignoreMods: false, nudge: 0 };

export function emptySteps(bars: number): Step[] {
  return Array.from({ length: bars * STEPS_PER_BAR }, () => emptyStep);
}

export function emptySong(bars = DEFAULT_SONG_BARS, bpm = DEFAULT_BPM): Song {
  const row = () => Array.from({ length: bars }, (): Id | null => null);
  return { bpm, bars, rows: { main: row(), fill: row(), modA: row(), modB: row() } };
}

export function createProject(ctx: CommandContext = defaultContext): Project {
  const tags: Record<Id, Tag> = {};
  for (const name of DEFAULT_TAG_NAMES) {
    const id = ctx.newId();
    tags[id] = { id, name };
  }
  return { audio: {}, tags, samples: {}, hits: {}, pads: {}, loops: {}, mods: {}, song: emptySong() };
}

/** A window over every step of a loop of `bars` bars. */
export const fullWindow = (bars: number): StepWindow => ({ start: 0, end: bars * STEPS_PER_BAR });

/** Slices per bar: 4 = 1/4, 8 = 1/8, 16 = 1/16. Finer grids would need more than 16 steps per bar. */
export type SliceGrid = 4 | 8 | 16;

/** Slice starts on an equal grid, in seconds from the start of the break. */
export function gridMarkers(duration: number, bars: number, grid: SliceGrid = 16): number[] {
  const count = bars * grid;
  return Array.from({ length: count }, (_, i) => (i * duration) / count);
}

/** Whether markers lie on an equal grid of some resolution, rather than placed by hand. */
export function onGrid(markers: readonly number[], duration: number, bars: number): boolean {
  return ([4, 8, 16] as const).some((grid) => {
    const even = gridMarkers(duration, bars, grid);
    return even.length === markers.length && even.every((m, i) => Math.abs(m - markers[i]!) < 1e-6);
  });
}

/** The next free loop name: M1, M2, … for mains and F1, F2, … for fills. */
export function nextLoopName(project: Project, kind: LoopKind): string {
  const prefix = kind === 'main' ? 'M' : 'F';
  const names = new Set(Object.values(project.loops).map((l) => l.name));
  let n = 1;
  while (names.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Fills in fields added after a project was saved, so older autosaves and
 * project files still load. Pads saved before `auto` existed all came from the chain.
 */
export function upgradeProject(project: Project): Project {
  const hits = Object.fromEntries(
    Object.entries(project.hits).map(([id, hit]): [Id, Hit] => [id, { ...hit, variantOf: hit.variantOf ?? null }]),
  );
  const pads = Object.fromEntries(
    Object.entries(project.pads).map(([id, pad]): [Id, Pad] => [id, { ...pad, auto: pad.auto ?? true }]),
  );
  const samples = Object.fromEntries(
    Object.entries(project.samples).map(([id, sample]): [Id, Sample] => [
      id,
      sample.break === null || (sample.break.markers !== undefined && sample.break.loop !== undefined)
        ? { ...sample, tagGuessed: sample.tagGuessed ?? false }
        : {
            ...sample,
            tagGuessed: sample.tagGuessed ?? false,
            break: {
              ...sample.break,
              markers: sample.break.markers ?? gridMarkers(sample.duration, sample.break.bars),
              loop: sample.break.loop ?? (sample.break.sliced ? sliceLoop(project, id) : null),
            },
          },
    ]),
  );
  const loops = Object.fromEntries(
    Object.entries(project.loops).map(([id, loop]): [Id, Loop] => [id, loop.window === undefined ? { ...loop, window: fullWindow(loop.bars) } : loop]),
  );
  const mods = Object.fromEntries(
    Object.entries(project.mods).map(([id, mod]): [Id, Mod] => [id, mod.sources === undefined ? { ...mod, sources: [] } : mod]),
  );
  return { ...project, samples, hits, pads, loops, mods };
}

/** For breaks sliced before the loop was recorded: the first loop that only plays the break's slices. */
function sliceLoop(project: Project, breakId: Id): Id | null {
  const isSlicePad = (padId: Id) => {
    const hit = project.hits[project.pads[padId]?.members[0] ?? ''];
    return hit !== undefined && project.samples[hit.sampleId]?.sliceOf === breakId;
  };
  const loop = Object.values(project.loops).find(
    (l) => l.steps.some((s) => s.padId !== null) && l.steps.every((s) => s.padId === null || isSlicePad(s.padId)),
  );
  return loop?.id ?? null;
}

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}

/**
 * The parent of a slice's hit: the break's own hit (its whole, trimmed sample).
 * Its pitch and volume apply to every hit from the break's slices.
 */
export function parentHit(project: Project, hit: Hit): Hit | undefined {
  const breakId = project.samples[hit.sampleId]?.sliceOf;
  if (breakId == null) return undefined;
  return Object.values(project.hits).find((h) => h.sampleId === breakId && h.variantOf === null);
}

/** A hit as it plays: its own pitch and volume plus its parent's. */
export function effectiveHit(project: Project, hit: Hit): Hit {
  const parent = parentHit(project, hit);
  return parent === undefined ? hit : { ...hit, pitch: hit.pitch + parent.pitch, volume: hit.volume + parent.volume };
}
