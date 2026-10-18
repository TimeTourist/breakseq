import type { Clip, Hit, Id, Loop, LoopKind, Mod, ModEffect, ModRate, ModShape, Pad, Project, Sample, Song, SongRow, Step, StepTarget, SwapEffect, TapeEffect } from './types';
import { NO_DELAY, NO_DIST, NO_FILTER, NO_REVERB, NO_STRETCH, STEPS_PER_BAR } from './types';
import { defaultBreakName } from './sound';
import { renameBreakIn } from './names';

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
  return { audio: {}, samples: {}, breaks: {}, hits: {}, pads: {}, loops: {}, mods: {}, song: emptySong() };
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
    Object.entries(project.hits).map(([id, hit]): [Id, Hit] => [id, { ...hit, pan: hit.pan ?? 0, variantOf: hit.variantOf ?? null, stretch: hit.stretch ?? NO_STRETCH, dist: hit.dist ?? NO_DIST, filter: hit.filter ?? NO_FILTER, reverb: hit.reverb ?? NO_REVERB, delay: hit.delay ?? NO_DELAY }]),
  );
  const pads = Object.fromEntries(
    Object.entries(project.pads).map(([id, pad]): [Id, Pad] => [id, { ...pad, auto: pad.auto ?? true, choice: pad.choice ?? 'top' }]),
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
  // Tags went: a sample keeps everything but its tag fields. Samples from before the channel choice play in stereo.
  const samples = Object.fromEntries(
    Object.entries(project.samples).map(([id, sample]): [Id, Sample] => {
      const copy: Sample & { mainTag?: unknown; extraTags?: unknown; tagGuessed?: unknown } = { ...sample, channel: sample.channel ?? 'stereo' };
      delete copy.mainTag;
      delete copy.extraTags;
      delete copy.tagGuessed;
      return [id, copy];
    }),
  );
  const upgraded: Project & { tags?: unknown } = { ...project, samples, hits, pads, loops, mods, song };
  delete upgraded.tags;
  return namedTrims(upgraded);
}

/**
 * Samples became trims of their file, numbered per file, and a break named as
 * its file ("amen.wav") is named as a new one would be ("amen 1").
 */
function namedTrims(project: Project): Project {
  const counts = new Map<Id, number>();
  const samples = Object.fromEntries(
    Object.entries(project.samples).map(([id, sample]): [Id, Sample] => {
      if (typeof (sample as { trim?: number }).trim === 'number') return [id, sample];
      const trim = (counts.get(sample.audioId) ?? 0) + 1;
      counts.set(sample.audioId, trim);
      return [id, { ...sample, trim }];
    }),
  );
  let next: Project = { ...project, samples };
  for (const brk of Object.values(next.breaks)) {
    const sample = next.samples[brk.sampleId];
    if (sample !== undefined && brk.name === sample.name) next = renameBreakIn(next, brk.id, defaultBreakName(sample));
  }
  return next;
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

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}
