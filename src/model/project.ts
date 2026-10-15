import type { CommandContext } from './command';
import { defaultContext } from './command';
import type { Hit, Id, LoopKind, Pad, Project, Song, Step, Tag } from './types';
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
  return { ...project, hits, pads };
}

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}
