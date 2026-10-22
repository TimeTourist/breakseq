import type { Command, CommandContext } from './command';
import { notFound, ok } from './command';
import type { Clip, Id, Project } from './types';

/**
 * Reroll (🎲): new seeds, so what plays at random picks anew. Each is one
 * command, so Undo brings back the randomness there was (see Slump och seeds).
 */

const reseed = <T extends { readonly seed: number }>(x: T, ctx: CommandContext): T => ({ ...x, seed: ctx.newSeed() });
const reseedAll = <T extends { readonly seed: number }>(record: Readonly<Record<Id, T>>, ctx: CommandContext): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).map(([id, x]) => [id, reseed(x, ctx)]));

/** New seeds for the clips, keeping copies as copies: clips that shared a seed get the same new seed. */
function reseedClips(clips: readonly Clip[], ctx: CommandContext): Clip[] {
  const next = new Map<number, number>();
  return clips.map((c) => {
    const seed = next.get(c.seed) ?? ctx.newSeed();
    next.set(c.seed, seed);
    return { ...c, seed };
  });
}

/** New seeds for everything: every mod, matrix, pad and clip (copies stay copies). */
export const rerollAll =
  (): Command =>
  (project, ctx) =>
    ok({
      ...project,
      mods: reseedAll(project.mods, ctx),
      matrices: reseedAll(project.matrices, ctx),
      pads: reseedAll(project.pads, ctx),
      song: { ...project.song, clips: reseedClips(project.song.clips, ctx) },
    });

export const rerollMod =
  (id: Id): Command =>
  (project, ctx) => {
    const mod = project.mods[id];
    return mod === undefined ? notFound(id) : ok({ ...project, mods: { ...project.mods, [id]: reseed(mod, ctx) } });
  };

const reseedPads = (project: Project, ids: readonly Id[], ctx: CommandContext): Project => {
  const pads = { ...project.pads };
  for (const id of ids) if (pads[id] !== undefined) pads[id] = reseed(pads[id], ctx);
  return { ...project, pads };
};

/** A matrix: its own seed and its pads'. */
export const rerollMatrix =
  (id: Id): Command =>
  (project, ctx) => {
    const matrix = project.matrices[id];
    if (matrix === undefined) return notFound(id);
    return ok(reseedPads({ ...project, matrices: { ...project.matrices, [id]: reseed(matrix, ctx) } }, matrix.pads, ctx));
  };

export const rerollPad =
  (id: Id): Command =>
  (project, ctx) =>
    project.pads[id] === undefined ? notFound(id) : ok(reseedPads(project, [id], ctx));

/** A clip in Song: only that clip. */
export const rerollClip =
  (id: Id): Command =>
  (project, ctx) =>
    project.song.clips.some((c) => c.id === id)
      ? ok({ ...project, song: { ...project.song, clips: project.song.clips.map((c) => (c.id === id ? reseed(c, ctx) : c)) } })
      : notFound(id);
