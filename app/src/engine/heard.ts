import type { Project } from '../model';

/**
 * What of a project can be heard when its song plays: the song (but not its
 * loop region, which only says what plays over and over), and everything the
 * song reaches through ids, as stored. Pure, like generate.
 *
 * From the song's clips it follows every id it finds to the loop, mod, pad,
 * hit, matrix, sample or audio it names, and on from there. It also takes the
 * pad that holds a heard hit and the matrix that holds a heard pad, since
 * their config is laid over the hit, but not on from them: the rest of that
 * matrix is not heard unless something else reaches it. Names are left out,
 * as is the hit a variant was made from: neither changes the sound.
 */
export function heardOf(project: Project): Readonly<Record<string, unknown>> {
  const collections = ['audio', 'samples', 'matrices', 'hits', 'pads', 'loops', 'mods'] as const;
  const where = new Map<string, (typeof collections)[number]>();
  for (const c of collections) for (const id of Object.keys(project[c])) where.set(id, c);

  const heard: Record<string, unknown> = {};
  const queue: string[] = [];
  const add = (id: string) => {
    const collection = where.get(id);
    if (collection === undefined || `${collection}:${id}` in heard) return;
    heard[`${collection}:${id}`] = project[collection][id];
    // Audio is data, not ids: nothing to follow in it.
    if (collection !== 'audio') queue.push(id);
  };
  const follow = (value: unknown, key?: string): void => {
    if (key === 'name' || key === 'variantOf') return;
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) value.forEach((v) => follow(v));
    else if (value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)) for (const [k, v] of Object.entries(value)) follow(v, k);
  };

  const { loop, ...song } = project.song;
  void loop;
  heard.song = song;
  follow(song.clips);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const collection = where.get(id)!;
    follow(project[collection][id]);
  }
  // The layers over what is heard: the pad holding a hit, the matrix holding a pad.
  for (const pad of Object.values(project.pads)) if (pad.members.some((id) => `hits:${id}` in heard)) heard[`pads:${pad.id}`] ??= pad;
  for (const matrix of Object.values(project.matrices)) if (matrix.pads.some((id) => `pads:${id}` in heard)) heard[`matrices:${matrix.id}`] ??= matrix;
  return heard;
}

/**
 * Whether two values are the same as heard: equal all through, but for names
 * and the hit a variant was made from. Audio samples are compared as objects,
 * never sample by sample: audio is never changed, only replaced.
 */
export function sameHeard(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameHeard(v, b[i]));
  const keys = (o: object) => Object.keys(o).filter((k) => k !== 'name' && k !== 'variantOf' && (o as Record<string, unknown>)[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameHeard((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
