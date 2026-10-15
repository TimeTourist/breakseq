import type { Clip, Hit, Id, Loop, LoopKind, Mod, ModEffect, ModRate, ModShape, Pad, Project, Sample, Song, SongRow, Step, StepTarget, SwapEffect, TapeEffect } from './types';
import { STEPS_PER_BAR } from './types';

// A new song starts at 170 BPM and 8 bars.
export const DEFAULT_BPM = 170;
export const DEFAULT_SONG_BARS = 8;

export const emptyStep: Step = { padId: null, memberId: null, ignoreMods: false, nudge: 0 };

export function emptySteps(bars: number): Step[] {
  return Array.from({ length: bars * STEPS_PER_BAR }, () => emptyStep);
}

export function emptySong(bars = DEFAULT_SONG_BARS, bpm = DEFAULT_BPM): Song {
  return { bpm, bars, clips: [] };
}

export function createProject(): Project {
  return { audio: {}, samples: {}, hits: {}, pads: {}, loops: {}, mods: {}, song: emptySong() };
}

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
  // Tags went: a sample keeps everything but its tag fields.
  const untagged = (sample: Sample): Sample => {
    const copy: Sample & { mainTag?: unknown; extraTags?: unknown; tagGuessed?: unknown } = { ...sample };
    delete copy.mainTag;
    delete copy.extraTags;
    delete copy.tagGuessed;
    return copy;
  };
  const samples = Object.fromEntries(
    Object.entries(project.samples).map(([id, sample]): [Id, Sample] => [
      id,
      sample.break === null || (sample.break.markers !== undefined && sample.break.loop !== undefined)
        ? untagged(sample)
        : {
            ...untagged(sample),
            break: {
              ...sample.break,
              markers: sample.break.markers ?? gridMarkers(sample.duration, sample.break.bars),
              loop: sample.break.loop ?? (sample.break.sliced ? sliceLoop(project, id) : null),
            },
          },
    ]),
  );
  const legacyLoops = project.loops as Readonly<Record<Id, Loop & { window?: LegacyWindow }>>;
  // Fill windows became clips, and a loop's length is its steps: drop both fields.
  const loops = Object.fromEntries(
    Object.entries(legacyLoops).map(([id, loop]): [Id, Loop] => {
      const copy: Loop & { window?: LegacyWindow; bars?: number } = { ...loop };
      delete copy.window;
      delete copy.bars;
      return [id, copy];
    }),
  );
  const legacy = project.song as Song & { rows?: LegacyRows };
  const song: Song = legacy.rows === undefined ? legacy : { bpm: legacy.bpm, bars: legacy.bars, clips: clipsFromRows(legacy.rows, legacy.bars, legacyLoops) };
  // A mod used to be one step effect: it becomes a mod with that effect.
  const mods = Object.fromEntries(
    Object.entries(project.mods as unknown as Readonly<Record<Id, SavedMod>>).map(([id, mod]): [Id, Mod] => {
      const effects = mod.effects ?? [mod as unknown as SavedEffect];
      return [id, { id, name: mod.name, effects: effects.map(upgradeEffect) }];
    }),
  );
  // Tags went with the samples' tag fields.
  const upgraded: Project & { tags?: unknown } = { ...project, samples, hits, pads, loops, mods, song };
  delete upgraded.tags;
  return upgraded;
}

/** An effect as an older version may have saved it. */
type SavedEffect = { readonly target: string; readonly [field: string]: unknown };
/** A mod as an older version may have saved it: with effects, or as one effect itself. */
type SavedMod = { readonly id: Id; readonly name: string; readonly effects?: readonly SavedEffect[] };

/** An effect brought up to date, with defaults for what it was saved without. */
function upgradeEffect(saved: SavedEffect): ModEffect {
  if (saved.target === 'tape') {
    return { rampOver: null, curve: 'linear', wow: 0, flutter: 0, ...(saved as unknown as Partial<TapeEffect>) } as TapeEffect;
  }
  // Scopes went: a mod acts on everything under its clip in Song.
  const rest: Record<string, unknown> = { ...saved };
  delete rest.scope;
  const rate = saved.rate as ModRate;
  if (saved.target === 'swap') return rest as unknown as SwapEffect;
  // Borrow became Swap: it now takes from the layers under the playhead, at random.
  if (saved.target === 'sourceLoop') return { target: 'swap', rate, mode: { kind: 'stack', pick: 'random' } };
  // Random got a choice of whole numbers; pitch rolls semitones unless set otherwise.
  const savedShape = saved.shape as ModShape;
  const shape: ModShape =
    savedShape.kind === 'random' && (savedShape as { whole?: boolean }).whole === undefined ? { ...savedShape, whole: saved.target === 'pitch' } : savedShape;
  return { target: saved.target as StepTarget, rate, shape };
}

/** Songs saved before clips: one cell per bar and row. */
type LegacyRows = { readonly [R in SongRow]: readonly (Id | null)[] };
/** Fill windows saved before clips, in steps of the loop. */
type LegacyWindow = { readonly start: number; readonly end: number };

/**
 * Clips that play what the old rows did. A main ran until the next main or the
 * song's end; a fill covered its length, within its window; adjacent cells of
 * the same mod were one run.
 */
function clipsFromRows(rows: LegacyRows, bars: number, loops: Readonly<Record<Id, Loop & { window?: LegacyWindow }>>): Clip[] {
  const total = bars * STEPS_PER_BAR;
  const clips: Clip[] = [];
  const mainStarts = rows.main.flatMap((id, bar) => (id === null ? [] : [{ id, bar }]));
  mainStarts.forEach(({ id, bar }, i) => {
    const end = (mainStarts[i + 1]?.bar ?? bars) * STEPS_PER_BAR;
    clips.push({ id: `main-${bar}`, row: 'main', ref: id, start: bar * STEPS_PER_BAR, length: end - bar * STEPS_PER_BAR, offset: 0 });
  });
  const fills = rows.fill.flatMap((id, bar) => (id === null || loops[id] === undefined ? [] : [{ id, bar, loop: loops[id] }]));
  fills.forEach(({ id, bar, loop }, i) => {
    const window = loop.window ?? { start: 0, end: loop.steps.length };
    const start = bar * STEPS_PER_BAR + window.start;
    // A later fill took over from an earlier one.
    const end = Math.min(bar * STEPS_PER_BAR + window.end, total, (fills[i + 1]?.bar ?? bars) * STEPS_PER_BAR);
    if (end > start) clips.push({ id: `fill-${bar}`, row: 'fill', ref: id, start, length: end - start, offset: window.start });
  });
  for (const row of ['modA', 'modB'] as const) {
    rows[row].forEach((id, bar) => {
      if (id === null) return;
      const last = clips.at(-1);
      if (last !== undefined && last.row === row && last.ref === id && last.start + last.length === bar * STEPS_PER_BAR) {
        clips[clips.length - 1] = { ...last, length: last.length + STEPS_PER_BAR };
      } else {
        clips.push({ id: `${row}-${bar}`, row, ref: id, start: bar * STEPS_PER_BAR, length: STEPS_PER_BAR, offset: 0 });
      }
    });
  }
  return clips;
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
    direction: flipped ? (hit.direction === 'reverse' ? 'forward' : 'reverse') : hit.direction,
    fadeOut: hit.fadeOut > 0 ? hit.fadeOut : parent.fadeOut,
  };
}

/** Whether a hit is the parent of a sliced break: a macro for its slices, never played as a pad. */
export function isParentHit(project: Project, hit: Hit): boolean {
  return project.samples[hit.sampleId]?.break?.sliced === true && hit.variantOf === null;
}

/** A pad whose members are only parent hits: hidden, because parents are not played. */
export function isParentPad(project: Project, pad: Pad): boolean {
  return pad.members.length > 0 && pad.members.every((m) => {
    const hit = project.hits[m];
    return hit !== undefined && isParentHit(project, hit);
  });
}

/**
 * A sliced break's slice pads in order, each with the step it plays on from the
 * break's start, as in the loop the slicing made.
 */
export function breakSequence(project: Project, breakId: Id): { padId: Id; step: number }[] {
  const source = project.samples[breakId];
  if (source?.break?.sliced !== true) return [];
  const stepTime = source.duration / (source.break.bars * STEPS_PER_BAR);
  const slices = Object.values(project.samples)
    .filter((s) => s.sliceOf === breakId)
    .sort((a, b) => a.offset - b.offset);
  return slices.flatMap((slice) => {
    const hit = Object.values(project.hits).find((h) => h.sampleId === slice.id && h.variantOf === null);
    const pad = hit === undefined ? undefined : Object.values(project.pads).find((p) => p.auto && p.members[0] === hit.id);
    return pad === undefined ? [] : [{ padId: pad.id, step: Math.round((slice.offset - source.offset) / stepTime) }];
  });
}
