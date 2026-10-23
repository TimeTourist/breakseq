import type { Id, Project, Sample } from '../model';
import { baseName, defaultMatrixName, renumberConflict } from '../model';
import { padLabel } from './labels';

const COLLECTIONS = [
  ['samples', 'sample'],
  ['matrices', 'matrix'],
  ['hits', 'hit'],
  ['pads', 'pad'],
  ['loops', 'loop'],
  ['mods', 'mod'],
] as const;

const addedIds = <T>(a: Readonly<Record<Id, T>>, b: Readonly<Record<Id, T>>): Id[] => Object.keys(b).filter((id) => !(id in a));

/** A change to one trim, by what it did to it: "slice amen 1", "move marker", "renumber amen 1"; null when it is none of these. */
function sampleChange(before: Project, a: Sample, b: Sample): string | null {
  const name = defaultMatrixName(b);
  if (a.bars === null && b.bars !== null) return `slice ${name}`;
  if (a.bars !== null && b.bars === null) return `don't slice ${name}`;
  if (a.bars !== b.bars) return `change bars ${name}`;
  if (a.markers !== b.markers) {
    const by = b.markers.length - a.markers.length;
    if (by === 0) return 'move marker';
    if (renumberConflict(before, a.id, b.markers) !== null) return `renumber ${name}`;
    if (by === 1) return 'add marker';
    if (by === -1) return 'remove marker';
    return `change markers ${name}`;
  }
  if (a.offset !== b.offset || a.duration !== b.duration) return `trim ${name}`;
  if (a.channel !== b.channel) return `change channel ${name}`;
  return null;
}

/** What a change to the samples did: an import, a new trim, or slicing; null when it is something else. */
function samplesChange(before: Project, after: Project): string | null {
  if (before.samples === after.samples) return null;
  const added = addedIds(before.samples, after.samples).map((id) => after.samples[id]!);
  if (added.length > 0) {
    const files = [...new Set(added.filter((s) => !(s.audioId in before.audio)).map((s) => s.audioId))];
    if (files.length === 0) return added.length === 1 ? `new sample ${defaultMatrixName(added[0]!)}` : `${added.length} new samples`;
    return files.length === 1 ? `import ${added.find((s) => s.audioId === files[0])!.name}` : `import ${files.length} files`;
  }
  const changed = Object.keys(after.samples).filter((id) => id in before.samples && before.samples[id] !== after.samples[id]);
  return changed.length === 1 ? sampleChange(before, before.samples[changed[0]!]!, after.samples[changed[0]!]!) : null;
}

/** What a change to pads and hits in matrices that stay did: a copied pad or hit, or a replaced hit; null when it is something else. */
function copyChange(before: Project, after: Project): string | null {
  const pads = addedIds(before.pads, after.pads);
  const hits = addedIds(before.hits, after.hits);
  const goneHits = Object.keys(before.hits).filter((id) => !(id in after.hits));
  if (pads.length > 0) {
    const full = pads.filter((id) => after.pads[id]!.members.length > 0);
    if (full.length === 0) return null;
    return full.length === 1 ? `copy pad ${padLabel(after.pads[full[0]!]!)}` : `copy ${full.length} pads`;
  }
  if (hits.length === 1 && goneHits.length === 1) return 'replace hit';
  if (hits.length > 0 && goneHits.length === 0 && hits.every((id) => after.hits[id]!.variantOf === null)) {
    return hits.length === 1 ? `copy hit ${baseName(after.hits[hits[0]!]!.name)}` : `copy ${hits.length} hits`;
  }
  return null;
}

/** Whether `b` is `a` with only a new seed. */
const reseeded = (a: object | undefined, b: object | undefined): boolean => {
  if (a === undefined || b === undefined || a === b) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return x.seed !== y.seed && [...keys].every((k) => k === 'seed' || x[k] === y[k]);
};

/** What a Reroll (🎲) did: "reroll everything", "reroll mod Wobble" …; null when it was something else. */
function rerollChange(before: Project, after: Project): string | null {
  if (before.audio !== after.audio || before.samples !== after.samples || before.hits !== after.hits || before.loops !== after.loops) return null;
  const { clips: clipsBefore, ...songBefore } = before.song;
  const { clips: clipsAfter, ...songAfter } = after.song;
  if (Object.keys(songBefore).some((k) => songBefore[k as keyof typeof songBefore] !== songAfter[k as keyof typeof songAfter]) || clipsBefore.length !== clipsAfter.length) return null;
  const changes = <T extends object>(a: Readonly<Record<Id, T>>, b: Readonly<Record<Id, T>>) => {
    if (Object.keys(a).length !== Object.keys(b).length) return null;
    const changed = Object.keys(b).filter((id) => a[id] !== b[id]);
    return changed.every((id) => reseeded(a[id], b[id])) ? changed : null;
  };
  const mods = changes(before.mods, after.mods);
  const matrices = changes(before.matrices, after.matrices);
  const pads = changes(before.pads, after.pads);
  const clips = clipsAfter.every((c, i) => c === clipsBefore[i] || reseeded(clipsBefore[i], c)) ? clipsAfter.filter((c, i) => c !== clipsBefore[i]) : null;
  if (mods === null || matrices === null || pads === null || clips === null) return null;
  const count = mods.length + matrices.length + pads.length + clips.length;
  if (count === 0) return null;
  const all = Object.keys(after.mods).length + Object.keys(after.matrices).length + Object.keys(after.pads).length + clipsAfter.length;
  if (count === all && count > 1) return 'reroll everything';
  if (mods.length === 1 && count === 1) return `reroll mod ${baseName(after.mods[mods[0]!]!.name)}`;
  if (matrices.length === 1 && mods.length === 0 && clips.length === 0) return `reroll matrix ${baseName(after.matrices[matrices[0]!]!.name)}`;
  if (pads.length === 1 && count === 1) return `reroll pad ${padLabel(after.pads[pads[0]!]!)}`;
  if (clips.length === 1 && count === 1) {
    const clip = clips[0]!;
    return `reroll clip ${baseName((clip.row === 'main' || clip.row === 'fill' ? after.loops[clip.ref]?.name : after.mods[clip.ref]?.name) ?? '')}`.trimEnd();
  }
  return 'reroll';
}

/**
 * What changed from one project to the next, in a few words for an undo
 * button, saying what happened where it can tell: "slice amen 1", "move
 * marker", "import 120Stereo.rx2", "copy pad 07", "replace hit"; otherwise
 * what changed: "change hit amen 1 05", "change the song".
 */
export function describeChange(before: Project, after: Project): string {
  // A project file swaps in everything at once, each part new.
  if (before.audio !== after.audio && before.samples !== after.samples && before.mods !== after.mods && before.song !== after.song) return 'import project';
  if (before.recipeSeed !== after.recipeSeed && before.samples === after.samples) return 'go crazy';
  if (before.mode !== after.mode) return after.mode === 'crazy' ? 'switch to Crazy madness' : 'switch to Total control';
  // A removed matrix takes its pads and hits with it: it is the matrix that goes.
  const rerolled = rerollChange(before, after);
  if (rerolled !== null) return rerolled;
  const removed = Object.keys(before.matrices).filter((id) => !(id in after.matrices));
  if (removed.length === 1 && before.samples === after.samples) return `remove matrix ${baseName(before.matrices[removed[0]!]!.name)}`;
  const samples = samplesChange(before, after);
  if (samples !== null) return samples;
  const made = addedIds(before.matrices, after.matrices);
  if (made.length === 1 && before.samples === after.samples) return `new matrix ${baseName(after.matrices[made[0]!]!.name)}`;
  if (made.length === 0 && before.samples === after.samples) {
    const copied = copyChange(before, after);
    if (copied !== null) return copied;
  }
  for (const [key, noun] of COLLECTIONS) {
    const a = before[key] as Readonly<Record<string, { name: string }>>;
    const b = after[key] as Readonly<Record<string, { name: string }>>;
    if (a === b) continue;
    const added = Object.keys(b).filter((id) => !(id in a));
    const removed = Object.keys(a).filter((id) => !(id in b));
    const changed = Object.keys(b).filter((id) => id in a && a[id] !== b[id]);
    const name = (record: typeof a, ids: string[]) =>
      ids.length === 1 ? `${noun} ${baseName(record[ids[0]!]!.name)}` : `${ids.length} ${noun === 'matrix' ? 'matrices' : `${noun}s`}`;
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
