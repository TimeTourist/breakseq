import type { Project } from '../model';
import { baseName } from '../model';

const COLLECTIONS = [
  ['samples', 'sample'],
  ['breaks', 'break'],
  ['hits', 'hit'],
  ['pads', 'pad'],
  ['loops', 'loop'],
  ['mods', 'mod'],
] as const;

/**
 * What changed from one project to the next, in a few words for an undo
 * button: "change hit Amen-break 05", "add 64 samples", "change the song".
 */
export function describeChange(before: Project, after: Project): string {
  // A removed break takes its sample, pads and hits with it: it is the break that goes.
  const removedBreaks = Object.keys(before.breaks).filter((id) => !(id in after.breaks));
  if (removedBreaks.length === 1) return `remove break ${baseName(before.breaks[removedBreaks[0]!]!.name)}`;
  for (const [key, noun] of COLLECTIONS) {
    const a = before[key] as Readonly<Record<string, { name: string }>>;
    const b = after[key] as Readonly<Record<string, { name: string }>>;
    if (a === b) continue;
    const added = Object.keys(b).filter((id) => !(id in a));
    const removed = Object.keys(a).filter((id) => !(id in b));
    const changed = Object.keys(b).filter((id) => id in a && a[id] !== b[id]);
    const name = (record: typeof a, ids: string[]) =>
      ids.length === 1 ? `${noun} ${baseName(record[ids[0]!]!.name)}` : `${ids.length} ${noun}s`;
    if (added.length > 0) return `add ${name(b, added)}`;
    if (removed.length > 0) return `remove ${name(a, removed)}`;
    if (changed.length > 0) return `change ${name(b, changed)}`;
  }
  if (before.song !== after.song) {
    if (before.song.bpm !== after.song.bpm) return 'change the tempo';
    const { loop: a = null, ...restBefore } = before.song;
    const { loop: b = null, ...restAfter } = after.song;
    if (a?.on !== b?.on && a?.start === b?.start && a?.end === b?.end) return b?.on === true ? 'turn the loop on' : 'turn the loop off';
    if (a !== b && restBefore.bars === restAfter.bars && restBefore.clips === restAfter.clips) return 'change the loop';
    return 'change the song';
  }
  if (before.audio !== after.audio) return 'change audio';
  return 'change';
}
