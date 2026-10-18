import type { LoopKind, Project, Song, Step } from './types';
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
  return { audio: {}, samples: {}, matrices: {}, hits: {}, pads: {}, loops: {}, mods: {}, song: emptySong() };
}

/** The next free loop name: M1, M2, … for mains and F1, F2, … for fills. */
export function nextLoopName(project: Project, kind: LoopKind): string {
  const prefix = kind === 'main' ? 'M' : 'F';
  const names = new Set(Object.values(project.loops).map((l) => l.name));
  let n = 1;
  while (names.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Why a project from before Matrix is not opened. */
export const OLD_PROJECT_MESSAGE = 'This project was made before Matrix (phase 22). Open it in the tag fas-21-fore-matrix.';

/** A saved project as it is, or null when it was made before Matrix (it has no `matrices`). */
export function upgradeProject(saved: unknown): Project | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const matrices = (saved as { matrices?: unknown }).matrices;
  if (typeof matrices !== 'object' || matrices === null) return null;
  return saved as Project;
}

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}
