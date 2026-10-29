import type { Command, CommandContext } from './command';
import { invalid, notFound, ok } from './command';
import type { Clip, Id, Project, SongRow } from './types';
import { STEPS_PER_BAR, tapeOf } from './types';

export const LOOP_ROWS: readonly SongRow[] = ['main', 'fill'];
export const MOD_ROWS: readonly SongRow[] = ['modA', 'modB'];
export const isLoopRow = (row: SongRow): boolean => row === 'main' || row === 'fill';

/** The song's length in steps. */
export const songSteps = (project: Project): number => project.song.bars * STEPS_PER_BAR;

/** The shortest a clip can be: a mod with Tape is at least as long as its segment. */
export function minLength(project: Project, row: SongRow, ref: Id): number {
  return isLoopRow(row) ? 1 : (tapeOf(project.mods[ref])?.length ?? 1);
}

/** A clip's natural length: a loop's own length, or one bar for a mod (longer if its tape needs it). */
export function defaultLength(project: Project, row: SongRow, ref: Id): number {
  return isLoopRow(row) ? (project.loops[ref]?.steps.length ?? STEPS_PER_BAR) : Math.max(STEPS_PER_BAR, minLength(project, row, ref));
}

const tooShort = (min: number) => invalid(`Its tape needs at least ${min} steps here`);

/**
 * A moved edge's offset. A loop's is kept as it is, past its length or below 0,
 * since the random choices come from where in the clip a step is: wrapping it
 * would move every step a whole loop and reroll them (En ändring slår inte om
 * slumpen). It wraps where the loop is read (loopIndex). A mod's stops at 0.
 */
function edgeOffset(clip: Pick<Clip, 'row'>, offset: number): number {
  return isLoopRow(clip.row) ? offset : Math.max(0, offset);
}

/** Where a clip is in its content at song step `t`, and the random choices with it: its offset counts, unwrapped. */
export const clipPlace = (clip: Pick<Clip, 'start' | 'offset'>, t: number): number => t - clip.start + clip.offset;

/** The step of its loop (of `length` steps) a loop clip plays at song step `t`: it wraps round, also before its start. */
export const loopIndex = (clip: Pick<Clip, 'start' | 'offset'>, t: number, length: number): number => ((clipPlace(clip, t) % length) + length) % length;

/**
 * Puts a clip into its row, making room: clips it covers whole are removed, one
 * it falls inside is split in two, and ones it overlaps at an end are cut back.
 */
function placeClip(project: Project, clip: Clip, ctx: CommandContext): Clip[] {
  const end = clip.start + clip.length;
  const out: Clip[] = [];
  for (const c of project.song.clips) {
    if (c.id === clip.id) continue;
    const cEnd = c.start + c.length;
    if (c.row !== clip.row || cEnd <= clip.start || c.start >= end) {
      out.push(c);
    } else if (c.start < clip.start && cEnd > end) {
      out.push({ ...c, length: clip.start - c.start });
      // The other half of the same clip: it keeps its seed, so it sounds as it did.
      out.push({ ...c, id: ctx.newId(), start: end, length: cEnd - end, offset: edgeOffset(c, c.offset + (end - c.start)) });
    } else if (c.start < clip.start) {
      out.push({ ...c, length: clip.start - c.start });
    } else if (cEnd > end) {
      out.push({ ...c, start: end, length: cEnd - end, offset: edgeOffset(c, c.offset + (end - c.start)) });
    }
  }
  out.push(clip);
  return out.sort((a, b) => a.start - b.start);
}

const withClips = (project: Project, clips: Clip[]): Project => ({ ...project, song: { ...project.song, clips } });

function check(project: Project, row: SongRow, ref: Id): string | null {
  if (isLoopRow(row)) return project.loops[ref] === undefined ? 'Loops go in Main or Fill' : null;
  return project.mods[ref] === undefined ? 'Mods go in Mod A or Mod B' : null;
}

/** Lays a loop or mod out from `start` with its natural length, cut at the song's end. */
export const addClip =
  (row: SongRow, ref: Id, start: number, length?: number): Command =>
  (project, ctx) => {
    const problem = check(project, row, ref);
    if (problem !== null) return invalid(problem);
    const total = songSteps(project);
    const from = Math.max(0, Math.min(total - 1, Math.round(start)));
    const min = minLength(project, row, ref);
    const span = Math.min(total - from, Math.max(min, length ?? defaultLength(project, row, ref)));
    if (span < min) return tooShort(min);
    const clip: Clip = { id: ctx.newId(), row, ref, start: from, length: span, offset: 0, seed: ctx.newSeed() };
    return ok(withClips(project, placeClip(project, clip, ctx)));
  };

/** Moves a clip to another start, or row of the same kind, keeping its length and offset. */
export const moveClip =
  (id: Id, row: SongRow, start: number): Command =>
  (project, ctx) => {
    const clip = project.song.clips.find((c) => c.id === id);
    if (clip === undefined) return notFound(id);
    if (isLoopRow(row) !== isLoopRow(clip.row)) return invalid(isLoopRow(clip.row) ? 'Loops go in Main or Fill' : 'Mods go in Mod A or Mod B');
    const total = songSteps(project);
    const from = Math.max(0, Math.min(total - 1, Math.round(start)));
    const moved: Clip = { ...clip, row, start: from, length: Math.min(clip.length, total - from) };
    const min = minLength(project, row, clip.ref);
    if (moved.length < min) return tooShort(min);
    return ok(withClips(project, placeClip(project, moved, ctx)));
  };

/** A copy of a clip at another start or row of the same kind. */
export const copyClip =
  (id: Id, row: SongRow, start: number): Command =>
  (project, ctx) => {
    const clip = project.song.clips.find((c) => c.id === id);
    return clip === undefined ? notFound(id) : pasteClip(clip, row, start)(project, ctx);
  };

/**
 * A new clip like `clip` at `start` in `row`, which must be of its kind. The
 * clip itself need not be in the song any more, as after a copy and delete.
 */
export const pasteClip =
  (clip: Clip, row: SongRow, start: number): Command =>
  (project, ctx) => {
    if (isLoopRow(row) !== isLoopRow(clip.row)) return invalid(isLoopRow(clip.row) ? 'Loops go in Main or Fill' : 'Mods go in Mod A or Mod B');
    const problem = check(project, row, clip.ref);
    if (problem !== null) return invalid(problem);
    const total = songSteps(project);
    const from = Math.max(0, Math.min(total - 1, Math.round(start)));
    const copy: Clip = { ...clip, id: ctx.newId(), row, start: from, length: Math.min(clip.length, total - from) };
    const min = minLength(project, row, clip.ref);
    if (copy.length < min) return tooShort(min);
    return ok(withClips(project, placeClip(project, copy, ctx)));
  };

/**
 * Moves one edge of a clip to a step boundary. The end edge changes its length;
 * the start edge trims or extends its beginning, moving where the content
 * starts with it. A clip is at least one step long.
 */
export const resizeClip =
  (id: Id, edge: 'start' | 'end', position: number): Command =>
  (project, ctx) => {
    const clip = project.song.clips.find((c) => c.id === id);
    if (clip === undefined) return notFound(id);
    const end = clip.start + clip.length;
    const min = Math.min(minLength(project, clip.row, clip.ref), Math.max(1, clip.length));
    let resized: Clip;
    if (edge === 'end') {
      const to = Math.max(clip.start + min, Math.min(songSteps(project), Math.round(position)));
      resized = { ...clip, length: to - clip.start };
    } else {
      const from = Math.max(0, Math.min(end - min, Math.round(position)));
      resized = { ...clip, start: from, length: end - from, offset: edgeOffset(clip, clip.offset + (from - clip.start)) };
    }
    return ok(withClips(project, placeClip(project, resized, ctx)));
  };

export const removeClip =
  (id: Id): Command =>
  (project) =>
    project.song.clips.some((c) => c.id === id) ? ok(withClips(project, project.song.clips.filter((c) => c.id !== id))) : notFound(id);

/** Clips cut to a song of `total` steps: past the end they go, across it they are shortened. */
export function fitClips(clips: readonly Clip[], total: number): Clip[] {
  return clips.filter((c) => c.start < total).map((c) => (c.start + c.length > total ? { ...c, length: total - c.start } : c));
}

/** The clip of a row playing at song step `t`, if any. */
export function clipAt(project: Project, row: SongRow, t: number): Clip | undefined {
  return project.song.clips.find((c) => c.row === row && t >= c.start && t < c.start + c.length);
}

/** For each song step, the clip a row plays there. */
export function clipsByStep(project: Project, row: SongRow): (Clip | null)[] {
  const steps: (Clip | null)[] = Array.from({ length: songSteps(project) }, () => null);
  for (const c of project.song.clips) {
    if (c.row !== row) continue;
    for (let t = c.start; t < Math.min(steps.length, c.start + c.length); t++) steps[t] = c;
  }
  return steps;
}

/** Two clips share their seed: they may still play different parts (a split or trimmed clip keeps its seed). */
export const sameSeed = (a: Clip, b: Clip): boolean => a.id !== b.id && a.seed === b.seed;

/**
 * Two clips sound the same: the same loop or mod, seed and length, starting at
 * the same place in it (Song-v2). The offset is compared unwrapped, since the
 * random choices follow it (clipPlace). Claudes val: a loop clip in Main and
 * one in Fill count as the same, as do a mod in Mod A and Mod B.
 */
export const soundsSame = (a: Clip, b: Clip): boolean =>
  sameSeed(a, b) && isLoopRow(a.row) === isLoopRow(b.row) && a.ref === b.ref && a.length === b.length && a.offset === b.offset;
