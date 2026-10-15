import type { CommandContext } from './command';
import { defaultContext } from './command';
import type { Id, Project, Song, Step, Tag } from './types';
import { STEPS_PER_BAR } from './types';

export const DEFAULT_TAG_NAMES = ['K', 'S', 'H', 'R', 'G'] as const;

// TODO(spec): the spec does not give a default tempo or song length.
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

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}
