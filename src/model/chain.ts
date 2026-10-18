import type { Command, CommandContext, Usage } from './command';
import { invalid, notFound, ok, sequence } from './command';
import { findUsages } from './references';
import type { SliceGrid } from './sound';
import { MIN_SLICE, baseName, defaultMatrixName, gridMarkers, markerGrid, sliceWindow, slotHit, slotName } from './sound';
import { sampleBpm } from './owners';
import { matrixSequence, matrixSteps } from './lengths';
import { emptyStep } from './project';
import { renameMatrixIn, renumberRows, rowName } from './names';
import type { AudioData, Id, Loop, Matrix, Pad, Project, Sample, SampleChannel, Step } from './types';
import { MAX_LOOP_STEPS, NO_CONFIG, STEPS_PER_BAR } from './types';

export { MIN_SLICE, baseName, gridMarkers };

export interface NewSample {
  readonly name: string;
  readonly audio: AudioData;
  /** Cue markers from the file, in seconds. A file with cues is marked to be sliced, not sliced: Slice offers them. */
  readonly cues?: readonly number[];
}

const setSampleIn = (project: Project, sample: Sample): Project => ({ ...project, samples: { ...project.samples, [sample.id]: sample } });
const setMatrixIn = (project: Project, matrix: Matrix): Project => ({ ...project, matrices: { ...project.matrices, [matrix.id]: matrix } });

/** The matrix a sample's slicing made: the one whose `sampleId` is the sample. Its rows follow the slicing. */
export function ownMatrix(project: Project, sampleId: Id): Matrix | undefined {
  return Object.values(project.matrices).find((m) => m.sampleId === sampleId);
}

/** A sample over all of `audio`, not sliced. */
function wholeSample(id: Id, name: string, audioId: Id, audio: AudioData, cues: readonly number[]): Sample {
  return {
    id,
    name,
    audioId,
    offset: 0,
    duration: (audio.channels[0]?.length ?? 0) / audio.sampleRate,
    channel: 'stereo',
    trim: 1,
    bars: null,
    markers: [0],
    ...(cues.length > 0 ? { cues: [...cues].sort((x, y) => x - y) } : {}),
  };
}

/** A sample's own matrix as a one-shot: one pad with one hit playing slice 0, named after the trim ("amen 2"). */
function addOwnMatrix(project: Project, sample: Sample, ctx: CommandContext): Project {
  const matrix: Matrix = { id: ctx.newId(), name: defaultMatrixName(sample), pads: [], config: NO_CONFIG, sampleId: sample.id, loop: null };
  return ensureRows(setMatrixIn(project, matrix), matrix.id, 0, 1, ctx.newId);
}

/**
 * Adds an imported file: its audio, a sample over all of it, and the sample's
 * own matrix, a one-shot. A file with cue markers is marked to be sliced, not
 * sliced: its cues are kept for Slice to offer.
 */
export const addSample =
  ({ name, audio, cues = [] }: NewSample): Command =>
  (project, ctx) => {
    if ((audio.channels[0]?.length ?? 0) === 0 || audio.sampleRate <= 0) return invalid('Audio is empty');
    const audioId = ctx.newId();
    const sample: Sample = { ...wholeSample(ctx.newId(), name, audioId, audio, cues), ...(cues.length > 0 ? { unsliced: true as const } : {}) };
    return ok(addOwnMatrix(setSampleIn({ ...project, audio: { ...project.audio, [audioId]: audio } }, sample), sample, ctx));
  };

export interface NewSlicedSample {
  readonly name: string;
  readonly audio: AudioData;
  /** Its length in whole bars. */
  readonly bars: number;
  /** Where its slices start, as parts 0–1 of it. */
  readonly markers: readonly number[];
}

/**
 * Adds a file that is already sliced, as a REX file is: `addSample`, then
 * `setSlicing` with its bars and markers, in one step. Its own matrix gets a
 * pad per slice and a loop playing them, as when it is sliced in Slice.
 * Markers closer than MIN_SLICE to the one before, or to its end, are left out.
 */
export const addSlicedSample =
  ({ name, audio, bars, markers }: NewSlicedSample): Command =>
  (project, ctx) => {
    const added = addSample({ name, audio })(project, ctx);
    if (!added.ok) return added;
    const sample = Object.values(added.project.samples).find((s) => !(s.id in project.samples));
    if (sample === undefined) return invalid('The sample was not added');
    return setSlicing(sample.id, bars, cleanMarkers(markers, sample.duration))(added.project, ctx);
  };

/** A sample as it is once sliced, or not to be sliced: no longer waiting to be sliced. */
function withoutUnsliced(sample: Sample): Sample {
  const { unsliced, ...rest } = sample;
  void unsliced;
  return rest;
}

/**
 * Marks a sample that is not sliced to be sliced (Import): nothing is made or
 * guessed until it is sliced in Slice (`setSlicing` with its bars).
 * `setSlicing(sampleId, null)` takes the mark back.
 */
export const markUnsliced =
  (sampleId: Id): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.bars !== null) return invalid('The sample is already sliced');
    return ok(setSampleIn(project, { ...sample, unsliced: true }));
  };

/** Whether a sample is marked to be sliced but not sliced yet. */
export const isUnsliced = (sample: Sample): boolean => sample.bars === null && sample.unsliced === true;

/** The file's cue markers within a trim, as markers of it (parts, the first at 0); null when none fall inside it. */
export function cueMarkers(sample: Sample): number[] | null {
  const inside = (sample.cues ?? []).map((c) => (c - sample.offset) / sample.duration).filter((m) => m > 0 && m < 1);
  return inside.length === 0 ? null : cleanMarkers(inside, sample.duration);
}

/** The next free trim number of a file: one more than its highest. */
const nextTrim = (project: Project, audioId: Id): number =>
  Math.max(0, ...Object.values(project.samples).filter((s) => s.audioId === audioId).map((s) => s.trim)) + 1;

/** A new trim of the file `of` trims, with the next free number, as `of` is but for what `patch` sets. */
function newTrimOf(project: Project, of: Sample, patch: Partial<Sample>, ctx: CommandContext): Sample {
  return { ...withoutUnsliced(of), id: ctx.newId(), trim: nextTrim(project, of.audioId), ...patch };
}

/** A new trim of a file another sample already trims, not sliced, with its own one-shot matrix: no need to import the file again. */
function addTrimIn(project: Project, of: Sample, window: { offset: number; duration: number } | null, ctx: CommandContext): Project | string {
  const audio = project.audio[of.audioId];
  if (audio === undefined) return 'The file is missing';
  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const sample = newTrimOf(project, of, { offset: window?.offset ?? 0, duration: window?.duration ?? length, bars: null, markers: [0] }, ctx);
  return addOwnMatrix(setSampleIn(project, sample), sample, ctx);
}

/** A new trim of a sample's file, the whole file or `window` of it, as a one-shot of its own: "amen trim 2", matrix "amen 2". */
export const addTrim =
  (sampleId: Id, window?: { offset: number; duration: number }): Command =>
  (project, ctx) => {
    const of = project.samples[sampleId];
    if (of === undefined) return notFound(sampleId);
    const added = addTrimIn(project, of, window ?? null, ctx);
    return typeof added === 'string' ? invalid(added) : ok(added);
  };

/** A slice made a one-shot of its own: a new trim of the file over just that slice. The sample and its matrix stay as they are. */
export const makeOneShot =
  (sampleId: Id, slice: number): Command =>
  (project, ctx) => {
    const of = project.samples[sampleId];
    if (of === undefined) return notFound(sampleId);
    const window = sliceWindow(of, slice);
    if (window === null) return invalid('The sample has no such slice');
    return addTrim(sampleId, { offset: of.offset + window.start, duration: window.end - window.start })(project, ctx);
  };

export const renameMatrix =
  (matrixId: Id, name: string): Command =>
  (project) => {
    if (project.matrices[matrixId] === undefined) return notFound(matrixId);
    if (name.trim() === '') return invalid('A matrix needs a name');
    return ok(renameMatrixIn(project, matrixId, name));
  };

/** Markers within a sample of `duration` seconds, as parts: the first at 0, ones too close dropped. */
function cleanMarkers(markers: readonly number[], duration: number): number[] {
  const kept: number[] = [0];
  for (const m of [...markers].sort((a, b) => a - b)) {
    if ((m - kept[kept.length - 1]!) * duration >= MIN_SLICE && (1 - m) * duration >= MIN_SLICE) kept.push(m);
  }
  return kept;
}

/**
 * A likely length in bars for a sample of `duration` seconds: the number among
 * 1, 2, 4, 8 and 16 that gives a tempo from 70 to 180 BPM, nearest 140.
 */
export function guessBars(duration: number): number {
  const options = [1, 2, 4, 8, 16].map((bars) => ({ bars, bpm: sampleBpm({ duration, bars })! }));
  const fitting = options.filter((o) => o.bpm >= 70 && o.bpm <= 180);
  const pool = fitting.length > 0 ? fitting : options;
  return pool.reduce((best, o) => (Math.abs(o.bpm - 140) < Math.abs(best.bpm - 140) ? o : best)).bars;
}

/** Whether a sample's tempo looks wrong, which usually means its bars are. */
export const unlikelyBpm = (bpm: number): boolean => bpm < 60 || bpm > 200;

/** The slice of `sampleId` a pad's top hit plays, or null when it plays something else. */
function padSlice(project: Project, padId: Id, sampleId: Id): number | null {
  const pad = project.pads[padId];
  const hit = pad?.members[0] === undefined ? undefined : project.hits[pad.members[0]];
  return hit === undefined || hit.sampleId !== sampleId ? null : (hit.slice ?? 0);
}

/**
 * Gives a matrix a row for each new slice of its sample, `from` up to `count`,
 * that no pad of it plays yet (by its top hit): a pad with one hit playing
 * that slice, added last. Rows are matched by what they play, not where they
 * are, since a matrix is free to edit (decision 12): a pad added by hand is no
 * row, and a row removed by hand is not made again for an older slice. Rows
 * are never taken away; one past the last slice is silent until there are more.
 * A new pad is named after its row ("amen 1 17"), its hit after its slice; a
 * one-shot's pad has the matrix's plain name.
 */
function ensureRows(project: Project, matrixId: Id, from: number, count: number, newId: () => Id): Project {
  const matrix = project.matrices[matrixId];
  const sample = matrix?.sampleId == null ? undefined : project.samples[matrix.sampleId];
  if (matrix === undefined || sample === undefined) return project;
  const played = new Set(matrix.pads.map((p) => padSlice(project, p, sample.id)));
  const missing = Array.from({ length: Math.max(0, count - from) }, (_, i) => from + i).filter((slice) => !played.has(slice));
  if (missing.length === 0) return project;
  const hits = { ...project.hits };
  const pads = { ...project.pads };
  const added: Id[] = [];
  for (const slice of missing) {
    const hit = slotHit(newId(), slotName(matrix.name, sample, slice), sample.id, slice);
    const pad: Pad = { id: newId(), name: sample.bars === null ? hit.name : rowName(matrix.name, matrix.pads.length + added.length), members: [hit.id], choice: 'top', config: NO_CONFIG };
    hits[hit.id] = hit;
    pads[pad.id] = pad;
    added.push(pad.id);
  }
  return setMatrixIn({ ...project, hits, pads }, { ...matrix, pads: [...matrix.pads, ...added] });
}

/**
 * The steps of a loop that plays a matrix's pads in order: its sample's bars,
 * or longer if its pads take more, up to whole bars (a loop of whole bars
 * stays in time in the song) and at most MAX_LOOP_STEPS; pads past the end are left out.
 */
function laidOut(project: Project, matrix: Matrix): Step[] {
  const bars = matrix.sampleId === null ? null : (project.samples[matrix.sampleId]?.bars ?? null);
  const taken = Math.ceil(matrixSteps(project, matrix.id) / STEPS_PER_BAR) * STEPS_PER_BAR;
  const length = Math.min(MAX_LOOP_STEPS, Math.max((bars ?? 1) * STEPS_PER_BAR, taken));
  const steps: Step[] = Array.from({ length }, () => emptyStep);
  for (const { padId, step } of matrixSequence(project, matrix.id)) if (step < length) steps[step] = { ...emptyStep, padId };
  return steps;
}

const sameSteps = (a: readonly Step[], b: readonly Step[]) =>
  a.length === b.length && a.every((s, i) => s.padId === b[i]!.padId && s.memberId === b[i]!.memberId && !s.ignoreMods && !b[i]!.ignoreMods);

/**
 * The matrix's own loop follows a change while it was exactly as the matrix
 * laid it out before: once edited by hand, it is left alone. Other loops are
 * never touched.
 */
export function followMatrix(before: Project, after: Project, matrixId: Id): Project {
  const was = before.matrices[matrixId];
  const matrix = after.matrices[matrixId];
  const old = was?.loop == null ? undefined : before.loops[was.loop];
  const loop = matrix?.loop == null ? undefined : after.loops[matrix.loop];
  if (was === undefined || matrix === undefined || old === undefined || loop === undefined || old.id !== loop.id) return after;
  if (!sameSteps(old.steps, laidOut(before, was))) return after;
  const steps = laidOut(after, matrix);
  return sameSteps(loop.steps, steps) ? after : { ...after, loops: { ...after.loops, [loop.id]: { ...loop, steps } } };
}

/** `followMatrix` for every matrix with its own loop. */
export function followMatrices(before: Project, after: Project): Project {
  return Object.values(after.matrices).reduce((next, m) => (m.loop === null ? next : followMatrix(before, next, m.id)), after);
}

/**
 * A command after which the matrices' own loops follow the change, each while
 * it was exactly as its matrix laid it out (`followMatrices`). Wrap a command
 * once: commands built from wrapped ones use their unwrapped core.
 */
export const following =
  (command: Command): Command =>
  (project, ctx) => {
    const result = command(project, ctx);
    return result.ok ? ok(followMatrices(project, result.project)) : result;
  };

/**
 * The markers a sample gets when sliced over `bars` bars without markers given
 * (`setSlicing`, `setSampleBars`): markers on a grid follow the new length, on
 * 1/16 when it is not sliced yet; markers placed by hand stay. For the UI to
 * ask `renumberConflict` before a change of bars.
 */
export function markersForBars(sample: Sample, bars: number): readonly number[] {
  const grid = sample.bars === null ? 16 : markerGrid(sample.markers, sample.bars);
  return grid === null ? sample.markers : gridMarkers(bars, grid);
}

/**
 * Slices a sample over `bars` bars, or takes its slicing away with null.
 * Markers on a grid follow the new length; markers placed by hand stay, unless
 * `markers` are given. Its own matrix gets a row per slice (a one-shot's pad
 * is row 01), and the first time a loop named after it playing them in order;
 * after that the loop follows only while it is exactly as the matrix laid it out.
 * A sample whose own matrix was removed is only sliced: no matrix is made again.
 */
export const setSlicing =
  (sampleId: Id, bars: number | null, markers?: readonly number[]): Command =>
  (project, ctx) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (bars === null) return unslice(project, sample);
    if (!Number.isInteger(bars) || bars < 1) return invalid('A sample is sliced over a whole number of bars');

    const nextMarkers = markers ?? markersForBars(sample, bars);
    const sliced: Sample = { ...withoutUnsliced(sample), bars, markers: nextMarkers };
    const own = ownMatrix(project, sampleId);
    if (own === undefined) return ok(followMatrices(project, setSampleIn(project, sliced)));
    // A one-shot's pad and hit become row 01's.
    let next = sample.bars === null ? renameRow(project, own, sliced, 0) : project;
    next = ensureRows(setSampleIn(next, sliced), own.id, sample.markers.length, nextMarkers.length, ctx.newId);
    if (own.loop === null) {
      const matrix = next.matrices[own.id]!;
      const loop: Loop = { id: ctx.newId(), name: baseName(matrix.name), kind: 'main', steps: laidOut(next, matrix) };
      return ok(followMatrices(project, setMatrixIn({ ...next, loops: { ...next.loops, [loop.id]: loop } }, { ...matrix, loop: loop.id })));
    }
    return ok(followMatrices(project, next));
  };

/** Names row `row`'s pad and its top hit after the row ("amen 1 01"), if they still have the matrix's plain name. */
function renameRow(project: Project, matrix: Matrix, sample: Sample, row: number): Project {
  return renamePadAndHit(project, matrix.pads[row], baseName(matrix.name), slotName(matrix.name, sample, row));
}

/** Renames a pad and its top hit from `from` to `to`, each only if it is still named `from`. */
function renamePadAndHit(project: Project, padId: Id | undefined, from: string, to: string): Project {
  const pad = padId === undefined ? undefined : project.pads[padId];
  const hit = pad === undefined ? undefined : project.hits[pad.members[0] ?? ''];
  return {
    ...project,
    pads: pad === undefined || pad.name !== from ? project.pads : { ...project.pads, [pad.id]: { ...pad, name: to } },
    hits: hit === undefined || hit.name !== from ? project.hits : { ...project.hits, [hit.id]: { ...hit, name: to } },
  };
}

/**
 * Changes how many bars a sliced sample is: its BPM follows, and markers on a
 * grid (`markersForBars`). With `newTrim`, as in `setMarkers`, the own matrix
 * moves to a new trim with the new bars and markers and the sample stays as it was.
 */
export const setSampleBars =
  (sampleId: Id, bars: number, newTrim = false): Command =>
  (project, ctx) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.bars === null) return invalid('Only a sliced sample has bars');
    if (!newTrim) return setSlicing(sampleId, bars)(project, ctx);
    if (!Number.isInteger(bars) || bars < 1) return invalid('A sample is sliced over a whole number of bars');
    return ok(changeOwnRows(project, sample, toNewTrim(project, sample, { bars, markers: markersForBars(sample, bars) }, ctx), ctx));
  };

/**
 * What un-slicing a sample takes: the rows of its own matrix (pads whose top
 * hit plays it) but the first, which stays to play the whole sample, with
 * their hits; hits in that row that play a later slice of it (they would be
 * silent); and its own loop. Pads added by hand stay, and so do copies of its
 * slices elsewhere, silent.
 */
function unsliceParts(project: Project, sample: Sample) {
  const own = ownMatrix(project, sample.id);
  const rows = (own?.pads ?? []).filter((p) => padSlice(project, p, sample.id) !== null);
  const kept = rows.find((p) => padSlice(project, p, sample.id) === 0) ?? rows[0];
  const pads = new Set(rows.filter((p) => p !== kept));
  const first = kept === undefined ? undefined : project.pads[kept];
  const hits = new Set([
    ...[...pads].flatMap((p) => project.pads[p]?.members ?? []),
    ...(first?.members ?? []).filter((h) => project.hits[h]?.sampleId === sample.id && (project.hits[h]?.slice ?? 0) > 0),
  ]);
  const loop = own?.loop != null && project.loops[own.loop] !== undefined ? own.loop : null;
  return { own, kept, pads, hits, loop };
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** What goes when a sliced sample is no longer sliced, in words: "15 pads", "15 hits", "loop amen 1". */
export function unsliceTakes(project: Project, sampleId: Id): string[] {
  const sample = project.samples[sampleId];
  if (sample === undefined || sample.bars === null) return [];
  const { pads, hits, loop } = unsliceParts(project, sample);
  const own = loop === null ? undefined : project.loops[loop];
  return [...(pads.size > 0 ? [count(pads.size, 'pad')] : []), ...(hits.size > 0 ? [count(hits.size, 'hit')] : []), ...(own === undefined ? [] : [`loop ${own.name}`])];
}

/**
 * Where a sliced sample is used, which goes silent when it is no longer
 * sliced: loops other than its own that play the rows that go, its own loop in
 * the song, and pads elsewhere with a hit of a later slice.
 */
export function unsliceUsages(project: Project, sampleId: Id): Usage[] {
  const sample = project.samples[sampleId];
  if (sample === undefined || sample.bars === null) return [];
  const { own, pads, loop } = unsliceParts(project, sample);
  const ownPads = new Set(own?.pads ?? []);
  return [
    ...Object.values(project.loops)
      .filter((l) => l.id !== loop && l.steps.some((s) => s.padId !== null && pads.has(s.padId)))
      .map((l): Usage => ({ kind: 'loop', id: l.id, name: l.name })),
    ...(loop === null ? [] : findUsages(project, 'loop', loop)),
    ...Object.values(project.pads)
      .filter((p) => !ownPads.has(p.id) && p.members.some((m) => project.hits[m]?.sampleId === sampleId && (project.hits[m]?.slice ?? 0) > 0))
      .map((p): Usage => ({ kind: 'pad', id: p.id, name: p.name })),
  ];
}

const keep = <T,>(record: Readonly<Record<Id, T>>, gone: (id: Id) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !gone(id))) as Record<Id, T>;

const mapValues = <T,>(record: Readonly<Record<Id, T>>, change: (x: T) => T): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).map(([id, x]) => [id, change(x)]));

/** Pads, hits and a loop that go together. */
export interface Parts {
  readonly pads: ReadonlySet<Id>;
  readonly hits: ReadonlySet<Id>;
  readonly loop: Id | null;
}

/**
 * Removes pads with their hits, other hits and a loop, silencing where they
 * were used: pads leave their matrices and hits their pads, steps with the
 * pads are emptied, steps locked to the hits fall back to member 1, and the
 * loop leaves the song and its matrix. Pads that become empty stay. The rows
 * after a removed pad are renamed (`renumberRows`), and variants of a removed
 * hit are variants no more.
 */
export function dropParts(project: Project, parts: Parts): Project {
  const dropped = dropPartsOnly(project, parts);
  const changed = Object.values(project.matrices).filter((m) => m.pads.some((p) => parts.pads.has(p)));
  return changed.reduce((next, m) => renumberRows(next, m.id), dropped);
}

function dropPartsOnly(project: Project, { pads, hits: others, loop }: Parts): Project {
  const hits = new Set([...others, ...[...pads].flatMap((p) => project.pads[p]?.members ?? [])]);
  const step = (s: Step): Step => (s.padId !== null && pads.has(s.padId) ? emptyStep : s.memberId !== null && hits.has(s.memberId) ? { ...s, memberId: null } : s);
  return {
    ...project,
    matrices: mapValues(project.matrices, (m) =>
      m.pads.some((p) => pads.has(p)) || (loop !== null && m.loop === loop) ? { ...m, pads: m.pads.filter((p) => !pads.has(p)), loop: m.loop === loop ? null : m.loop } : m,
    ),
    pads: mapValues(keep(project.pads, (id) => pads.has(id)), (p) => (p.members.some((m) => hits.has(m)) ? { ...p, members: p.members.filter((m) => !hits.has(m)) } : p)),
    hits: mapValues(keep(project.hits, (id) => hits.has(id)), (h) => (h.variantOf !== null && hits.has(h.variantOf) ? { ...h, variantOf: null } : h)),
    loops: mapValues(keep(project.loops, (id) => id === loop), (l) => (l.steps.some((s) => step(s) !== s) ? { ...l, steps: l.steps.map(step) } : l)),
    song: loop === null || !project.song.clips.some((c) => c.ref === loop) ? project.song : { ...project.song, clips: project.song.clips.filter((c) => c.ref !== loop) },
  };
}

/**
 * A sample no longer sliced ("Don't slice"), or no longer marked to be. A
 * sliced one loses what `unsliceParts` lists, and where that was used goes
 * silent (`dropParts`). Row 01 stays and plays the whole sample, named after
 * the matrix again.
 */
function unslice(project: Project, sample: Sample) {
  if (sample.bars === null) return sample.unsliced === true ? ok(setSampleIn(project, withoutUnsliced(sample))) : invalid('The sample is not sliced');
  const { own, kept, pads, hits, loop } = unsliceParts(project, sample);
  let next = dropParts(setSampleIn(project, { ...withoutUnsliced(sample), bars: null, markers: [0] }), { pads, hits, loop });
  if (own !== undefined) {
    next = renamePadAndHit(setMatrixIn(next, { ...next.matrices[own.id]!, loop: null }), kept, slotName(own.name, sample, 0), baseName(own.name));
  }
  return ok(followMatrices(project, next));
}

/** What goes with a matrix: its pads and their hits, not its loop or samples (decision 9). */
const matrixParts = (project: Project, matrixId: Id): Parts => ({ pads: new Set(project.matrices[matrixId]?.pads ?? []), hits: new Set(), loop: null });

/** Removes a matrix with its pads and hits; where they were used goes silent. Its loop and samples stay. */
export function dropMatrix(project: Project, matrixId: Id): Project {
  if (project.matrices[matrixId] === undefined) return project;
  const next = dropParts(project, matrixParts(project, matrixId));
  return { ...next, matrices: keep(next.matrices, (id) => id === matrixId) };
}

/** What a matrix takes with it when removed, in words: "16 pads", "16 hits"; a one-shot "1 pad", "1 hit". */
export function matrixTakes(project: Project, matrixId: Id): string[] {
  const matrix = project.matrices[matrixId];
  if (matrix === undefined) return [];
  const hits = matrix.pads.flatMap((p) => project.pads[p]?.members ?? []).length;
  return [...(matrix.pads.length > 0 ? [count(matrix.pads.length, 'pad')] : []), ...(hits > 0 ? [count(hits, 'hit')] : [])];
}

/** What goes with a sample (a trim): its own matrix with its pads and hits, and every hit that plays it, wherever it is. */
function sampleParts(project: Project, sampleId: Id): Parts {
  const own = ownMatrix(project, sampleId);
  return { ...matrixParts(project, own?.id ?? ''), hits: new Set(Object.values(project.hits).filter((h) => h.sampleId === sampleId).map((h) => h.id)) };
}

/** What a sample takes with it when removed, in words: "matrix amen 1", "16 pads", "18 hits". */
export function sampleTakes(project: Project, sampleId: Id): string[] {
  if (project.samples[sampleId] === undefined) return [];
  const own = ownMatrix(project, sampleId);
  const { pads, hits } = sampleParts(project, sampleId);
  const all = new Set([...hits, ...[...pads].flatMap((p) => project.pads[p]?.members ?? [])]);
  return [...(own === undefined ? [] : [`matrix ${own.name}`]), ...(pads.size > 0 ? [count(pads.size, 'pad')] : []), ...(all.size > 0 ? [count(all.size, 'hit')] : [])];
}

/**
 * Removes a sample (a trim) with its own matrix, its pads and hits, and every
 * hit that plays it, in any matrix: pads elsewhere that become empty stay, and
 * steps locked to a removed hit fall back to member 1. Where it was used
 * (`findUsages(…, 'sample', …)`) goes silent; its file goes with its last trim.
 */
export const removeSample = (sampleId: Id): Command =>
  following((project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    const own = ownMatrix(project, sampleId);
    const dropped = dropParts(project, sampleParts(project, sampleId));
    const next = own === undefined ? dropped : { ...dropped, matrices: keep(dropped.matrices, (id) => id === own.id) };
    const samples = keep(next.samples, (id) => id === sampleId);
    const fileUsed = Object.values(samples).some((s) => s.audioId === sample.audioId);
    return ok({ ...next, samples, audio: fileUsed ? next.audio : keep(next.audio, (id) => id === sample.audioId) });
  });

/** Where a file's trims are used outside the file, each place once; it goes silent when the file is removed. */
export function fileUsages(project: Project, audioId: Id): Usage[] {
  const samples = fileSamples(project, audioId);
  const owns = samples.flatMap((s) => {
    const own = ownMatrix(project, s.id);
    return own === undefined ? [] : [...own.pads, ...(own.loop === null ? [] : [own.loop])];
  });
  const inside = new Set(owns);
  const seen = new Set<string>();
  return samples
    .flatMap((s) => findUsages(project, 'sample', s.id))
    .filter((u) => {
      const key = `${u.kind}:${u.id ?? ''}`;
      if ((u.id !== null && inside.has(u.id)) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Removes a file with every trim of it, as `removeSample` does each: one undo step. */
export const removeFile =
  (audioId: Id): Command =>
  (project, ctx) => {
    const samples = fileSamples(project, audioId);
    if (samples.length === 0) return notFound(audioId);
    return sequence(...samples.map((s) => removeSample(s.id)))(project, ctx);
  };

/** Which channels of its file a sample plays: Stereo, Left, Right or Mono, always in stereo. */
export const setSampleChannel =
  (sampleId: Id, channel: SampleChannel): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    return ok(setSampleIn(project, { ...sample, channel }));
  };

/**
 * Trims a sample to `start`–`end` seconds of its file. Markers and regions are
 * parts of the sample and its slices, so they come along.
 */
export const trimSample = (sampleId: Id, start: number, end: number): Command =>
  following((project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    const audio = project.audio[sample.audioId];
    const length = audio === undefined ? 0 : (audio.channels[0]?.length ?? 0) / audio.sampleRate;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(0, Math.min(end, length));
    if (to - from < MIN_SLICE) return invalid('The trimmed sample is too short');
    return ok(setSampleIn(project, { ...sample, offset: from, duration: to - from }));
  });

/** Markers as `setMarkers` keeps them: sorted, the first at 0, none at or past the end. */
const sortedMarkers = (markers: readonly number[]): number[] => [0, ...markers.filter((m) => m > 0 && m < 1)].sort((a, b) => a - b);

/** Slices change numbers or go when a change in markers changes their count: those from the first marker that differs to the old last. */
function renumbered(before: readonly number[], after: readonly number[]): number[] {
  if (before.length === after.length) return [];
  let first = 0;
  while (first < Math.min(before.length, after.length) && Math.abs(before[first]! - after[first]!) < 1e-9) first++;
  return Array.from({ length: Math.max(0, before.length - first) }, (_, i) => first + i);
}

/** Slices that change number or go, and the pads with hits that play them. */
export interface Renumber {
  readonly slices: readonly number[];
  readonly pads: readonly Id[];
}

/**
 * Decision 14: whether new markers would renumber slices that are used more
 * than once. A slice is used when more than one hit plays it, variants and
 * copies alike, wherever they are. null when the numbering stays (a marker
 * only moves) or no slice concerned is used.
 */
export function renumberConflict(project: Project, sampleId: Id, markers: readonly number[]): Renumber | null {
  const sample = project.samples[sampleId];
  if (sample === undefined) return null;
  const concerned = renumbered(sample.markers, sortedMarkers(markers));
  const playing = (slice: number) => Object.values(project.hits).filter((h) => h.sampleId === sampleId && h.slice === slice);
  const slices = concerned.filter((s) => playing(s).length > 1);
  if (slices.length === 0) return null;
  const hits = new Set(slices.flatMap((s) => playing(s).map((h) => h.id)));
  const pads = Object.values(project.pads)
    .filter((p) => p.members.some((m) => hits.has(m)))
    .map((p) => p.id);
  return { slices, pads };
}

/**
 * Moves a sample's own matrix to a new trim of the same window, sliced by
 * `markers` (decision 16): its hits that play the sample play the new trim.
 * The sample keeps its markers, and hits elsewhere stay on it.
 */
function toNewTrim(project: Project, sample: Sample, patch: Pick<Sample, 'markers'> & Partial<Pick<Sample, 'bars'>>, ctx: CommandContext): Project {
  const fresh = newTrimOf(project, sample, patch, ctx);
  const own = ownMatrix(project, sample.id);
  let next = setSampleIn(project, fresh);
  if (own !== undefined) {
    const moved = new Set(own.pads.flatMap((p) => project.pads[p]?.members ?? []).filter((h) => project.hits[h]?.sampleId === sample.id));
    const hits = Object.fromEntries(Object.entries(next.hits).map(([id, h]) => [id, moved.has(id) ? { ...h, sampleId: fresh.id } : h]));
    next = setMatrixIn({ ...next, hits }, { ...own, sampleId: fresh.id });
  }
  return next;
}

/**
 * After a change to a sample's slicing (`changed`), its own matrix gets rows
 * for new slices and the matrices' own loops follow, as `setSlicing` does:
 * any matrix may play the sample.
 */
function changeOwnRows(before: Project, sample: Sample, changed: Project, ctx: CommandContext): Project {
  const own = ownMatrix(before, sample.id);
  if (own === undefined) return followMatrices(before, changed);
  const now = changed.matrices[own.id]?.sampleId;
  const count = now == null ? 0 : (changed.samples[now]?.markers.length ?? 0);
  return followMatrices(before, ensureRows(changed, own.id, sample.markers.length, count, ctx.newId));
}

/**
 * Sets where slices start, as parts 0–1 of the sample; the first is always at
 * 0. Without `newTrim`, slices count by number wherever they are played: with
 * fewer the last go silent, and its own matrix gets rows for more. With
 * `newTrim`, the own matrix moves to a new trim with these markers and
 * everything else stays on the sample as it was (decision 14, Yes).
 */
export const setMarkers =
  (sampleId: Id, markers: readonly number[], newTrim = false): Command =>
  (project, ctx) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.bars === null) return invalid('A sample that is not sliced has no markers');
    const sorted = sortedMarkers(markers);
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i]! - sorted[i - 1]!) * sample.duration < MIN_SLICE) return invalid('Markers are too close together');
    }
    if ((1 - sorted[sorted.length - 1]!) * sample.duration < MIN_SLICE) return invalid('A marker is too close to the end');
    const changed = newTrim ? toNewTrim(project, sample, { markers: sorted }, ctx) : setSampleIn(project, { ...sample, markers: sorted });
    return ok(changeOwnRows(project, sample, changed, ctx));
  };

/** Puts a sample's markers on an equal grid. */
export const setGrid =
  (sampleId: Id, grid: SliceGrid, newTrim = false): Command =>
  (project, ctx) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    if (sample.bars === null) return invalid('A sample that is not sliced has no markers');
    return setMarkers(sampleId, gridMarkers(sample.bars, grid), newTrim)(project, ctx);
  };

/** Slices a sample over `bars` bars with its markers on an equal grid. */
export const sliceSample = (sampleId: Id, bars: number, grid: SliceGrid = 16): Command => setSlicing(sampleId, bars, gridMarkers(bars, grid));

/** Makes a hit play another slice, of this sample or another, keeping its own config and region. On another sample it is no longer a variant. */
export const setHitSource = (hitId: Id, sampleId: Id, slice: number | null): Command =>
  following((project) => {
    const hit = project.hits[hitId];
    if (hit === undefined) return notFound(hitId);
    if (project.samples[sampleId] === undefined) return notFound(sampleId);
    if (slice !== null && (!Number.isInteger(slice) || slice < 0)) return invalid('A slice is a whole number from 0');
    const variantOf = sampleId === hit.sampleId ? hit.variantOf : null;
    return ok({ ...project, hits: { ...project.hits, [hitId]: { ...hit, sampleId, slice, variantOf } } });
  });

/** The samples (trims) of a file, in trim order. */
export const fileSamples = (project: Project, audioId: Id): Sample[] =>
  Object.values(project.samples)
    .filter((s) => s.audioId === audioId)
    .sort((a, b) => a.trim - b.trim);
