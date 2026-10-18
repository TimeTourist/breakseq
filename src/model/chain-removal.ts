// Moved as-is from chain.ts in fas 22 Task 3: removal, clone and swap still
// work on Break. Task 4 rewrites them against Matrix; until then this file does
// not compile and is not exported from index.ts.
import type { Command, Usage } from './command';
import { invalid, notFound, ok, sequence } from './command';
import { findUsages } from './references';
import { baseName, ensureSlots, padSlot } from './sound';
import { breakSequence } from './sound';
import { emptyStep } from './project';
import type { Break, Id, Loop, Pad, Project, Step } from './types';
import { STEPS_PER_BAR } from './types';

const setBreakIn = (project: Project, brk: Break): Project => ({ ...project, breaks: { ...project.breaks, [brk.id]: brk } });

function laidOut(project: Project, brk: Break): Step[] {
  const steps: Step[] = Array.from({ length: (brk.bars ?? 1) * STEPS_PER_BAR }, () => emptyStep);
  for (const { padId, step } of breakSequence(project, brk.id)) steps[step] = { ...emptyStep, padId };
  return steps;
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
