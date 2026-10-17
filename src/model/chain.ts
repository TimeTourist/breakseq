import type { Command, CommandContext, Usage } from './command';
import { invalid, notFound, ok, sequence } from './command';
import { findUsages } from './references';
import type { SliceGrid } from './breaks';
import { MIN_SLICE, baseName, breakBpm, breakSequence, defaultBreakName, ensureSlots, gridMarkers, markerGrid, padSlot, sliceWindow, slotHit, slotName } from './breaks';
import { emptyStep } from './project';
import { renameBreakIn } from './names';
import type { AudioData, Break, Id, Loop, Pad, Project, Sample, SampleChannel, Step } from './types';
import { STEPS_PER_BAR } from './types';

export { MIN_SLICE, baseName, breakBpm, gridMarkers };

export interface NewSample {
  readonly name: string;
  readonly audio: AudioData;
  /** Cue markers from the file, in seconds. A file with cues becomes a break, not sliced: Slice offers them. */
  readonly cues?: readonly number[];
}

const setBreakIn = (project: Project, brk: Break): Project => ({ ...project, breaks: { ...project.breaks, [brk.id]: brk } });

/** Adds the audio and a sample for it, without a break. */
function addAudio(project: Project, { name, audio, cues = [] }: NewSample, ctx: CommandContext): { project: Project; sample: Sample } | string {
  const length = audio.channels[0]?.length ?? 0;
  if (length === 0 || audio.sampleRate <= 0) return 'Audio is empty';
  const audioId = ctx.newId();
  const sample: Sample = {
    id: ctx.newId(),
    name,
    audioId,
    offset: 0,
    duration: length / audio.sampleRate,
    channel: 'stereo',
    trim: 1,
    ...(cues.length > 0 ? { cues: [...cues].sort((x, y) => x - y) } : {}),
  };
  return { project: { ...project, audio: { ...project.audio, [audioId]: audio }, samples: { ...project.samples, [sample.id]: sample } }, sample };
}

/**
 * Adds an imported file: its sample, and a one-shot break over it with one pad
 * playing the whole sample. A file with cue markers becomes a break, not
 * sliced: its cues are kept for Slice to offer.
 */
export const addSample =
  (file: NewSample): Command =>
  (project, ctx) => {
    const added = addAudio(project, file, ctx);
    if (typeof added === 'string') return invalid(added);
    const { sample } = added;
    const brk: Break = { ...oneShotOn(sample, ctx), ...(sample.cues === undefined ? {} : { unsliced: true as const }) };
    return ok(ensureSlots(setBreakIn(added.project, brk), brk.id, 1, ctx.newId));
  };

/** A break as it is once sliced, or made a one-shot again: no longer waiting to be sliced. */
function withoutUnsliced(brk: Break): Break {
  const { unsliced, ...rest } = brk;
  void unsliced;
  return rest;
}

/**
 * Marks a one-shot as a break to slice, or back: nothing is made or guessed
 * until it is sliced in Slice (`setBreak` with its bars). A sliced break goes
 * back to a one-shot with `makeOneShot`.
 */
export const markBreak =
  (breakId: Id, asBreak: boolean): Command =>
  (project) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (brk.bars !== null) return invalid('The break is already sliced');
    return ok(setBreakIn(project, asBreak ? { ...brk, unsliced: true } : withoutUnsliced(brk)));
  };

/** Whether a break is marked Break but not sliced yet. */
export const isUnsliced = (brk: Break): boolean => brk.bars === null && brk.unsliced === true;

/** The file's cue markers within a trim, as markers of it (parts, the first at 0); null when none fall inside it. */
export function cueMarkers(sample: Sample): number[] | null {
  const inside = (sample.cues ?? []).map((c) => (c - sample.offset) / sample.duration).filter((m) => m > 0 && m < 1);
  return inside.length === 0 ? null : cleanMarkers(inside, sample.duration);
}

/** A one-shot break over a whole trim, named after it ("amen 2"). */
const oneShotOn = (sample: Sample, ctx: CommandContext): Break => ({
  id: ctx.newId(),
  name: defaultBreakName(sample),
  sampleId: sample.id,
  bars: null,
  markers: [0],
  pads: [],
  parent: null,
  loop: null,
});

/** A new trim of a file another sample already trims, as a one-shot over it: no need to import the file again. */
function addTrimIn(project: Project, of: Sample, window: { offset: number; duration: number } | null, ctx: CommandContext): { project: Project; brk: Break } | string {
  const audio = project.audio[of.audioId];
  if (audio === undefined) return 'The file is missing';
  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const trim = Math.max(0, ...Object.values(project.samples).filter((s) => s.audioId === of.audioId).map((s) => s.trim)) + 1;
  const sample: Sample = {
    id: ctx.newId(),
    name: of.name,
    audioId: of.audioId,
    offset: window?.offset ?? 0,
    duration: window?.duration ?? length,
    channel: of.channel,
    trim,
    ...(of.cues === undefined ? {} : { cues: of.cues }),
  };
  const brk = oneShotOn(sample, ctx);
  const next = ensureSlots(setBreakIn({ ...project, samples: { ...project.samples, [sample.id]: sample } }, brk), brk.id, 1, ctx.newId);
  return { project: next, brk: next.breaks[brk.id]! };
}

/** A new trim of a sample's file, the whole file, as a one-shot of its own: "amen trim 2", break "amen 2". */
export const addTrim =
  (sampleId: Id): Command =>
  (project, ctx) => {
    const of = project.samples[sampleId];
    if (of === undefined) return notFound(sampleId);
    const added = addTrimIn(project, of, null, ctx);
    return typeof added === 'string' ? invalid(added) : ok(added.project);
  };

/** A slice of a break made a one-shot of its own: a new trim of the file over just that slice. The break stays as it is. */
export const sliceToOneShot =
  (breakId: Id, slot: number): Command =>
  (project, ctx) => {
    const brk = project.breaks[breakId];
    const of = brk === undefined ? undefined : project.samples[brk.sampleId];
    if (brk === undefined || of === undefined) return notFound(breakId);
    const window = sliceWindow(project, brk, slot);
    if (window === null) return invalid('The break has no such slice');
    const added = addTrimIn(project, of, { offset: of.offset + window.start, duration: window.end - window.start }, ctx);
    return typeof added === 'string' ? invalid(added) : ok(added.project);
  };

export const renameBreak =
  (breakId: Id, name: string): Command =>
  (project) => {
    if (project.breaks[breakId] === undefined) return notFound(breakId);
    if (name.trim() === '') return invalid('A break needs a name');
    return ok(renameBreakIn(project, breakId, name));
  };

/** Markers within a break of `duration` seconds, as parts: the first at 0, ones too close dropped. */
function cleanMarkers(markers: readonly number[], duration: number): number[] {
  const kept: number[] = [0];
  for (const m of [...markers].sort((a, b) => a - b)) {
    if ((m - kept[kept.length - 1]!) * duration >= MIN_SLICE && (1 - m) * duration >= MIN_SLICE) kept.push(m);
  }
  return kept;
}

/**
 * A likely length in bars for a break of `duration` seconds: the number among
 * 1, 2, 4, 8 and 16 that gives a tempo from 70 to 180 BPM, nearest 140.
 */
export function guessBars(duration: number): number {
  const options = [1, 2, 4, 8, 16].map((bars) => ({ bars, bpm: breakBpm(duration, bars) }));
  const fitting = options.filter((o) => o.bpm >= 70 && o.bpm <= 180);
  const pool = fitting.length > 0 ? fitting : options;
  return pool.reduce((best, o) => (Math.abs(o.bpm - 140) < Math.abs(best.bpm - 140) ? o : best)).bars;
}

/** Whether a break's tempo looks wrong, which usually means its bars are. */
export const unlikelyBpm = (bpm: number): boolean => bpm < 60 || bpm > 200;

/** The steps of a loop that plays a break's slots in order, each on its nearest 1/16. */
function laidOut(project: Project, brk: Break): Step[] {
  const steps: Step[] = Array.from({ length: (brk.bars ?? 1) * STEPS_PER_BAR }, () => emptyStep);
  for (const { padId, step } of breakSequence(project, brk.id)) steps[step] = { ...emptyStep, padId };
  return steps;
}

const sameSteps = (a: readonly Step[], b: readonly Step[]) =>
  a.length === b.length && a.every((s, i) => s.padId === b[i]!.padId && s.memberId === b[i]!.memberId && !s.ignoreMods && !b[i]!.ignoreMods);

/**
 * The break's loop follows a change to the break while it is still exactly as
 * the break laid it out before: once edited by hand, it is left alone.
 */
function followLoop(before: Project, after: Project, breakId: Id): Project {
  const was = before.breaks[breakId];
  const brk = after.breaks[breakId];
  const loop = brk?.loop == null ? undefined : after.loops[brk.loop];
  if (was === undefined || brk === undefined || loop === undefined || was.bars === null || brk.bars === null) return after;
  if (!sameSteps(loop.steps, laidOut(before, was))) return after;
  return { ...after, loops: { ...after.loops, [loop.id]: { ...loop, steps: laidOut(after, brk) } } };
}

/**
 * Makes a break a break of `bars` bars, or a one-shot with null. Markers on a
 * grid follow the new length; markers placed by hand stay, unless `markers` are
 * given. A break gets a parent and pads for its slots, and the first time, a
 * loop named after it playing them in order. After that the loop follows the
 * break only while it is exactly as the break laid it out.
 */
export const setBreak =
  (breakId: Id, bars: number | null, markers?: readonly number[]): Command =>
  (project, ctx) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (bars !== null && (!Number.isInteger(bars) || bars < 1)) return invalid('A break must be a whole number of bars');
    if (bars === null) return ok(setBreakIn(project, { ...withoutUnsliced(brk), bars: null, markers: [0] }));

    const grid = brk.bars === null ? 16 : markerGrid(brk.markers, brk.bars);
    const nextMarkers = markers ?? (grid === null ? brk.markers : gridMarkers(bars, grid));
    let next = project;
    // A one-shot's pad and hit become slot 01's.
    if (brk.bars === null) next = renameSlot(next, { ...brk, bars }, 0);
    let parent = brk.parent;
    if (parent === null) {
      const hit = slotHit(ctx.newId(), baseName(brk.name), breakId, null);
      next = { ...next, hits: { ...next.hits, [hit.id]: hit } };
      parent = hit.id;
    }
    next = ensureSlots(setBreakIn(next, { ...withoutUnsliced(brk), bars, markers: nextMarkers, parent }), breakId, nextMarkers.length, ctx.newId);
    const updated = next.breaks[breakId]!;

    if (brk.loop === null) {
      const loop: Loop = { id: ctx.newId(), name: baseName(brk.name), kind: 'main', steps: laidOut(next, updated) };
      return ok(setBreakIn({ ...next, loops: { ...next.loops, [loop.id]: loop } }, { ...updated, loop: loop.id }));
    }
    return ok(followLoop(project, next, breakId));
  };

/** Names slot `slot`'s pad and its hit after the slot, if they still have the break's plain name. */
function renameSlot(project: Project, brk: Break, slot: number): Project {
  const pad = project.pads[brk.pads[slot] ?? ''];
  const hit = pad === undefined ? undefined : project.hits[pad.members[0] ?? ''];
  const plain = baseName(brk.name);
  const name = slotName(brk, slot);
  return {
    ...project,
    pads: pad === undefined || pad.name !== plain ? project.pads : { ...project.pads, [pad.id]: { ...pad, name } },
    hits: hit === undefined || hit.name !== plain ? project.hits : { ...project.hits, [hit.id]: { ...hit, name } },
  };
}

/**
 * What a break takes with it when removed: its parent and slot pads, their
 * hits, hits of its slices, and its own loop. Made a one-shot, it keeps slot
 * 01's pad with its hits, and hits that play slot 01 or the whole break.
 */
function breakParts(project: Project, brk: Break, toOneShot = false) {
  const kept = toOneShot ? brk.pads.slice(0, 1) : [];
  const keptHits = new Set(kept.flatMap((p) => project.pads[p]?.members ?? []));
  const pads = new Set(brk.pads.filter((p) => !kept.includes(p)));
  const inOtherPads = new Set(Object.values(project.pads).filter((p) => !pads.has(p.id)).flatMap((p) => p.members));
  const ofBreak = Object.values(project.hits).filter((h) => h.breakId === brk.id && !(toOneShot && h.id !== brk.parent && (h.slot === 0 || h.slot === null)));
  // Hits of later slices go even from slot 01's pad, where they would be silent.
  const hits = new Set([
    ...(brk.parent === null ? [] : [brk.parent]),
    ...ofBreak.map((h) => h.id),
    ...[...pads].flatMap((p) => project.pads[p]?.members ?? []).filter((h) => !inOtherPads.has(h) && !keptHits.has(h)),
  ]);
  return { pads, hits, loop: brk.loop !== null && project.loops[brk.loop] !== undefined ? brk.loop : null, inOtherPads, kept: new Set(kept) };
}

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** What goes, in words: "4 pads", "5 hits", "loop amen 1". */
function takesText(project: Project, { pads, hits, loop }: ReturnType<typeof breakParts>): string[] {
  const own = loop === null ? undefined : project.loops[loop];
  return [...(pads.size > 0 ? [count(pads.size, 'pad')] : []), ...(hits.size > 0 ? [count(hits.size, 'hit')] : []), ...(own === undefined ? [] : [`loop ${own.name}`])];
}

/** What goes with a break when it is removed, said in words: "4 pads, 5 hits, loop amen 1", or a one-shot's "1 hit". */
export function breakTakes(project: Project, breakId: Id): string[] {
  const brk = project.breaks[breakId];
  if (brk === undefined) return [];
  const parts = breakParts(project, brk);
  const { pads, hits, loop } = parts;
  // A one-shot is its hit: its pad is not seen as one.
  if (brk.bars === null && pads.size <= 1 && hits.size <= 1 && loop === null) return ['1 hit'];
  return [count(pads.size, 'pad'), count(hits.size, 'hit'), ...takesText(project, { ...parts, pads: new Set(), hits: new Set() })];
}

/** What goes when a sliced break is made a one-shot: all but slot 01's pad and hit, and its own loop. */
export function oneShotTakes(project: Project, breakId: Id): string[] {
  const brk = project.breaks[breakId];
  return brk === undefined || brk.bars === null ? [] : takesText(project, breakParts(project, brk, true));
}

/** Where a sliced break made a one-shot is used with what goes, which goes silent there. */
export function oneShotUsages(project: Project, breakId: Id): Usage[] {
  const brk = project.breaks[breakId];
  return brk === undefined || brk.bars === null ? [] : usagesOf(project, breakParts(project, brk, true));
}

/**
 * Where a break is used outside itself, which goes silent when it is removed:
 * loops other than its own that play its pads, its own loop in the song, and
 * other pads with a hit of its slices.
 */
export function breakUsages(project: Project, breakId: Id): Usage[] {
  const brk = project.breaks[breakId];
  return brk === undefined ? [] : usagesOf(project, breakParts(project, brk));
}

function usagesOf(project: Project, { pads, hits, loop, inOtherPads, kept }: ReturnType<typeof breakParts>): Usage[] {
  const lent = [...hits].filter((h) => inOtherPads.has(h));
  return [
    ...Object.values(project.loops)
      .filter((l) => l.id !== loop && l.steps.some((s) => s.padId !== null && pads.has(s.padId)))
      .map((l): Usage => ({ kind: 'loop', id: l.id, name: l.name })),
    ...(loop === null ? [] : findUsages(project, 'loop', loop)),
    ...Object.values(project.pads)
      .filter((p) => !pads.has(p.id) && !kept.has(p.id) && p.members.some((m) => lent.includes(m)))
      .map((p): Usage => ({ kind: 'pad', id: p.id, name: p.name })),
  ];
}

/**
 * Removes a break with everything that only it uses: its parent, slot pads and
 * their hits, and its own loop; its sample too when no other break plays it.
 * Where it was used (see `breakUsages`) goes silent: steps with its pads are
 * emptied, clips of its loop leave the song, and its hits leave other pads.
 */
const keep = <T,>(record: Readonly<Record<Id, T>>, gone: (id: Id) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !gone(id))) as Record<Id, T>;

export const removeBreak =
  (breakId: Id): Command =>
  (project) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    const breaks = keep(project.breaks, (id) => id === breakId);
    const sampleUsed = Object.values(breaks).some((b) => b.sampleId === brk.sampleId);
    const sample = project.samples[brk.sampleId];
    const samples = sampleUsed ? project.samples : keep(project.samples, (id) => id === brk.sampleId);
    const audioUsed = sample === undefined || Object.values(samples).some((s) => s.audioId === sample.audioId);
    return ok({
      ...dropParts(project, breakParts(project, brk)),
      breaks,
      samples,
      audio: audioUsed ? project.audio : keep(project.audio, (id) => id === sample.audioId),
    });
  };

/**
 * A sliced break made a one-shot again: its slicing goes, as `removeBreak`
 * would take it (parent, the pads after slot 01 and their hits, its own loop),
 * and where those were used goes silent. Slot 01's pad and hit stay and play
 * the whole sample, named after the break again.
 */
export const makeOneShot =
  (breakId: Id): Command =>
  (project) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (brk.bars === null) return invalid('It is already a one-shot');
    const next = dropParts(project, breakParts(project, brk, true));
    const shot: Break = { ...withoutUnsliced(brk), bars: null, markers: [0], pads: brk.pads.slice(0, 1), parent: null, loop: null };
    return ok(plainSlot(setBreakIn(next, shot), shot, slotName(brk, 0)));
  };

/** Slot 01's pad and hit named after the break again, if they still have the slot's name. */
function plainSlot(project: Project, brk: Break, slot: string): Project {
  const pad = project.pads[brk.pads[0] ?? ''];
  const hit = pad === undefined ? undefined : project.hits[pad.members[0] ?? ''];
  const plain = baseName(brk.name);
  return {
    ...project,
    pads: pad === undefined || pad.name !== slot ? project.pads : { ...project.pads, [pad.id]: { ...pad, name: plain } },
    hits: hit === undefined || hit.name !== slot ? project.hits : { ...project.hits, [hit.id]: { ...hit, name: plain } },
  };
}

/** Removes pads, hits and a loop, silencing where they were used: steps emptied, clips out of the song, hits out of other pads. */
function dropParts(project: Project, { pads, hits, loop }: ReturnType<typeof breakParts>): Project {
    const otherPads = keep(project.pads, (id) => pads.has(id));
    const loops = Object.fromEntries(
      Object.entries(keep(project.loops, (id) => id === loop)).map(([id, l]): [Id, Loop] => [
        id,
        l.steps.some((s) => (s.padId !== null && pads.has(s.padId)) || (s.memberId !== null && hits.has(s.memberId)))
          ? { ...l, steps: l.steps.map((s) => (s.padId !== null && pads.has(s.padId) ? emptyStep : s.memberId !== null && hits.has(s.memberId) ? { ...s, memberId: null } : s)) }
          : l,
      ]),
    );
    return {
      ...project,
      pads: Object.fromEntries(
        Object.entries(otherPads).map(([id, p]): [Id, Pad] => [id, p.members.some((m) => hits.has(m)) ? { ...p, members: p.members.filter((m) => !hits.has(m)) } : p]),
      ),
      hits: keep(project.hits, (id) => hits.has(id)),
      loops,
      song: loop === null || !project.song.clips.some((c) => c.ref === loop) ? project.song : { ...project.song, clips: project.song.clips.filter((c) => c.ref !== loop) },
    };
}

/** The breaks on trims of a file, in trim order. */
export const fileBreaks = (project: Project, audioId: Id): Break[] =>
  Object.values(project.breaks)
    .filter((b) => project.samples[b.sampleId]?.audioId === audioId)
    .sort((a, b) => (project.samples[a.sampleId]?.trim ?? 0) - (project.samples[b.sampleId]?.trim ?? 0));

/** Where a file's breaks are used outside the file, which goes silent when it is removed. */
export function fileUsages(project: Project, audioId: Id): Usage[] {
  const breaks = fileBreaks(project, audioId);
  const own = new Set(breaks.flatMap((b) => [...b.pads, ...(b.loop === null ? [] : [b.loop])]));
  const seen = new Set<string>();
  return breaks
    .flatMap((b) => breakUsages(project, b.id))
    .filter((u) => {
      const key = `${u.kind}:${u.id ?? ''}`;
      if ((u.id !== null && own.has(u.id)) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Removes a file with every trim of it, as `removeBreak` does each: one undo step. */
export const removeFile =
  (audioId: Id): Command =>
  (project, ctx) => {
    const breaks = fileBreaks(project, audioId);
    if (breaks.length === 0) return notFound(audioId);
    return sequence(...breaks.map((b) => removeBreak(b.id)))(project, ctx);
  };

/**
 * A sliced break copied whole, to change apart from the original: the same
 * sample, bars and markers, a parent and slot pads of its own, and copies of
 * every hit in them (an alternative from another break or a one-shot is copied
 * too, still playing from there). The copy gets its own laid-out loop.
 */
export const cloneBreak =
  (breakId: Id, name?: string): Command =>
  (project, ctx) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (brk.bars === null || brk.parent === null) return invalid('Only a sliced break can be cloned');
    const id = ctx.newId();
    const copyName = name ?? `${baseName(brk.name)} copy`;
    const from = baseName(brk.name);
    const renamed = (n: string) => (n.startsWith(from) ? `${baseName(copyName)}${n.slice(from.length)}` : n);
    const hitIds = new Set([brk.parent, ...brk.pads.flatMap((p) => project.pads[p]?.members ?? [])]);
    const newIds = new Map([...hitIds].map((h) => [h, ctx.newId()] as const));
    const hits = { ...project.hits };
    for (const [old, fresh] of newIds) {
      const hit = project.hits[old];
      if (hit === undefined) continue;
      const own = hit.breakId === breakId;
      hits[fresh] = {
        ...hit,
        id: fresh,
        name: own ? renamed(hit.name) : hit.name,
        breakId: own ? id : hit.breakId,
        variantOf: hit.variantOf === null ? null : (newIds.get(hit.variantOf) ?? hit.variantOf),
      };
    }
    const pads = { ...project.pads };
    const padIds = brk.pads.map((old) => {
      const pad = project.pads[old];
      const fresh = ctx.newId();
      pads[fresh] = {
        ...(pad ?? { auto: true, choice: 'top' as const }),
        id: fresh,
        name: pad === undefined ? '' : renamed(pad.name),
        members: (pad?.members ?? []).flatMap((m) => (newIds.has(m) ? [newIds.get(m)!] : [])),
      };
      return fresh;
    });
    const clone: Break = { ...brk, id, name: copyName, pads: padIds, parent: newIds.get(brk.parent)!, loop: null };
    const next = setBreakIn({ ...project, hits, pads }, clone);
    const loop: Loop = { id: ctx.newId(), name: baseName(copyName), kind: 'main', steps: laidOut(next, clone) };
    return ok(setBreakIn({ ...next, loops: { ...next.loops, [loop.id]: loop } }, { ...clone, loop: loop.id }));
  };

/** Changes how many bars a break is: its BPM follows, and markers on a grid. */
export const setBreakBars =
  (breakId: Id, bars: number): Command =>
  (project, ctx) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (brk.bars === null) return invalid('Only a break has bars');
    return setBreak(breakId, bars)(project, ctx);
  };

/** Which channels of its file a sample plays: Stereo, Left, Right or Mono, always in stereo. */
export const setSampleChannel =
  (sampleId: Id, channel: SampleChannel): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    return ok({ ...project, samples: { ...project.samples, [sampleId]: { ...sample, channel } } });
  };

/**
 * Trims an imported sample to `start`–`end` seconds of its file. Markers and
 * hits are parts of the break and its slices, so they come along.
 */
export const trimSample =
  (sampleId: Id, start: number, end: number): Command =>
  (project) => {
    const sample = project.samples[sampleId];
    if (sample === undefined) return notFound(sampleId);
    const audio = project.audio[sample.audioId];
    const length = audio === undefined ? 0 : (audio.channels[0]?.length ?? 0) / audio.sampleRate;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(0, Math.min(end, length));
    if (to - from < MIN_SLICE) return invalid('The trimmed sample is too short');
    return ok({ ...project, samples: { ...project.samples, [sampleId]: { ...sample, offset: from, duration: to - from } } });
  };

/**
 * Sets where slices start, as parts 0–1 of the break; the first is always at 0.
 * Every slot is worked out again by number: with fewer slices the last slots go
 * silent, with more there are new pads for them. Nothing asks first.
 */
export const setMarkers =
  (breakId: Id, markers: readonly number[]): Command =>
  (project, ctx) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (brk.bars === null) return invalid('A one-shot has no markers');
    const duration = project.samples[brk.sampleId]?.duration ?? 0;
    const sorted = [0, ...markers.filter((m) => m > 0 && m < 1)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i]! - sorted[i - 1]!) * duration < MIN_SLICE) return invalid('Markers are too close together');
    }
    if ((1 - sorted[sorted.length - 1]!) * duration < MIN_SLICE) return invalid('A marker is too close to the end');
    return ok(followLoop(project, ensureSlots(setBreakIn(project, { ...brk, markers: sorted }), breakId, sorted.length, ctx.newId), breakId));
  };

/** Puts a break's markers on an equal grid. */
export const setGrid = (breakId: Id, grid: SliceGrid): Command => (project, ctx) => {
  const brk = project.breaks[breakId];
  if (brk === undefined) return notFound(breakId);
  if (brk.bars === null) return invalid('A one-shot has no markers');
  return setMarkers(breakId, gridMarkers(brk.bars, grid))(project, ctx);
};

/** Makes a sample's break a break of `bars` bars with its markers on an equal grid. */
export const sliceBreak = (breakId: Id, bars: number, grid: SliceGrid = 16): Command =>
  sequence(setBreak(breakId, bars), setGrid(breakId, grid));

/** Plays another sample under a break: the markers keep their steps, and the sound under them changes. */
export const replaceSample =
  (breakId: Id, sampleId: Id): Command =>
  (project) => {
    const brk = project.breaks[breakId];
    if (brk === undefined) return notFound(breakId);
    if (project.samples[sampleId] === undefined) return notFound(sampleId);
    return ok(setBreakIn(project, { ...brk, sampleId }));
  };

/** Adds a file as a sample and plays it under a break. The old sample stays, to go back to. */
export const replaceSampleWithFile =
  (breakId: Id, file: NewSample): Command =>
  (project, ctx) => {
    if (project.breaks[breakId] === undefined) return notFound(breakId);
    const added = addAudio(project, file, ctx);
    if (typeof added === 'string') return invalid(added);
    return replaceSample(breakId, added.sample.id)(added.project, ctx);
  };

/** Makes a hit play another slot, of this break or another, keeping its pitch, volume, fade and direction. */
export const setHitSource =
  (hitId: Id, breakId: Id, slot: number | null): Command =>
  (project) => {
    const hit = project.hits[hitId];
    if (hit === undefined) return notFound(hitId);
    if (project.breaks[breakId] === undefined) return notFound(breakId);
    if (slot !== null && (!Number.isInteger(slot) || slot < 0)) return invalid('A slot is a whole number from 0');
    return ok({ ...project, hits: { ...project.hits, [hitId]: { ...hit, breakId, slot } } });
  };

/** The breaks whose slots a loop plays, in the order they first come. */
export function loopBreaks(project: Project, loop: Loop): Break[] {
  const found: Break[] = [];
  for (const step of loop.steps) {
    const at = step.padId === null ? null : padSlot(project, step.padId);
    if (at !== null && !found.includes(at.brk)) found.push(at.brk);
  }
  return found;
}

/**
 * Swaps one break for another in a loop: every step playing slot N of `fromId`
 * plays slot N of `toId`. A slot the new break lacks gets a pad, silent until it
 * has a slice. A chosen member not in the new pad falls back to member 1.
 */
export const swapBreak =
  (loopId: Id, fromId: Id, toId: Id): Command =>
  (project, ctx) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const from = project.breaks[fromId];
    if (from === undefined) return notFound(fromId);
    if (project.breaks[toId] === undefined) return notFound(toId);
    const slots = loop.steps.map((s) => (s.padId === null ? -1 : from.pads.indexOf(s.padId)));
    const next = ensureSlots(project, toId, Math.max(0, ...slots) + 1, ctx.newId);
    const to = next.breaks[toId]!;
    const steps = loop.steps.map((s, i): Step => {
      const slot = slots[i]!;
      if (slot < 0) return s;
      const padId = to.pads[slot]!;
      const pad: Pad | undefined = next.pads[padId];
      return { ...s, padId, memberId: s.memberId !== null && pad?.members.includes(s.memberId) === true ? s.memberId : null };
    });
    return ok({ ...next, loops: { ...next.loops, [loopId]: { ...loop, steps } } });
  };
