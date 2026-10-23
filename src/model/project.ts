import type { CommandContext } from './command';
import { defaultContext } from './command';
import { addMissingPresets } from './presets';
import { isSeed, seedOf } from './seed';
import { upgradeMod } from './upgrade-mods';
import type { Id, LoopKind, Mod, Project, Song, Step } from './types';
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

/** A new project: empty but for the mod presets (see Mod-förval). */
export const newProject = (ctx: CommandContext = defaultContext): Project => addMissingPresets(createProject(), ctx);

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

/** What may lack a seed in a project saved before seeds (phase 24a). */
type Unseeded<T> = Omit<T, 'seed'> & { readonly seed?: number };

/** `x` with a seed: its own, or one made from its id. */
const seeded = <T extends { readonly id: Id; readonly seed: number }>(x: Unseeded<T>): T => (isSeed(x.seed) ? (x as T) : ({ ...x, seed: seedOf(x.id) } as T));
const seededAll = <T extends { readonly id: Id; readonly seed: number }>(record: Readonly<Record<Id, Unseeded<T>>>): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).map(([id, x]) => [id, seeded<T>(x)]));

/**
 * A saved project as it is, or null when it was made before Matrix (it has no
 * `matrices`). A mod, matrix, pad or clip saved before seeds gets one made
 * from its id, so it sounds the same every time it is loaded. Mods with the
 * forms List, Cycle, Ramp and Random get step lanes (see Gamla projekt). (Claudes val.)
 * The mod presets it lacks are added; nothing plays them, so it sounds the same.
 */
export function upgradeProject(saved: unknown, ctx: CommandContext = defaultContext): Project | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const matrices = (saved as { matrices?: unknown }).matrices;
  if (typeof matrices !== 'object' || matrices === null) return null;
  const project = saved as Project;
  return addMissingPresets({
    ...project,
    mods: Object.fromEntries(Object.entries(seededAll<Mod>(project.mods)).map(([id, m]) => [id, upgradeMod(m, project)])),
    matrices: seededAll(project.matrices),
    pads: seededAll(project.pads),
    song: { ...project.song, clips: project.song.clips.map((c) => seeded(c)) },
  }, ctx);
}

/** Seconds per step (a 1/16 note). */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export function songDuration(song: Song): number {
  return song.bars * STEPS_PER_BAR * stepDuration(song.bpm);
}
