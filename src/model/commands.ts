import type { Command, CommandResult } from './command';
import { fail, invalid, notFound, ok, without } from './command';
import { addClip, fitClips } from './clips';
import { breakSequence, isParentHit } from './breaks';
import { emptyStep, emptySteps, nextLoopName } from './project';
import type { ReferableKind } from './references';
import { findUsages } from './references';
import type { EffectTarget, Hit, Id, Loop, LoopKind, Mod, ModEffect, Pad, PadChoice, Project, Sample, Song, SongRow, Step } from './types';
import { MAX_TAPE_SPEED, MAX_TAPE_STEPS, STEPS_PER_BAR } from './types';

type Patch<T> = Partial<Omit<T, 'id'>>;

// Samples

export const updateSample =
  (id: Id, patch: Patch<Pick<Sample, 'name'>>): Command =>
  (project) => {
    const sample = project.samples[id];
    if (sample === undefined) return notFound(id);
    return ok({ ...project, samples: { ...project.samples, [id]: { ...sample, ...patch } } });
  };

// Hits

export const updateHit =
  (id: Id, patch: Patch<Omit<Hit, 'sampleId'>>): Command =>
  (project) => {
    const hit = project.hits[id];
    if (hit === undefined) return notFound(id);
    return ok({ ...project, hits: { ...project.hits, [id]: { ...hit, ...patch } } });
  };

/** A copy of the hit with a new id, for making a variant. It is not added to any pad. */
export const duplicateHit =
  (id: Id, name?: string): Command =>
  (project, ctx) => {
    const hit = project.hits[id];
    if (hit === undefined) return notFound(id);
    const copy: Hit = { ...hit, id: ctx.newId(), name: name ?? `${hit.name} copy`, variantOf: id };
    return ok({ ...project, hits: { ...project.hits, [copy.id]: copy } });
  };

/**
 * A variant of a hit, added last to the pad made for the original: the pad that
 * stands for that hit. A variant of a variant goes to the same pad. One undo step.
 */
export const addVariant =
  (id: Id, name?: string): Command =>
  (project, ctx) => {
    const hit = project.hits[id];
    if (hit === undefined) return notFound(id);
    let root = hit;
    while (root.variantOf !== null && project.hits[root.variantOf] !== undefined) root = project.hits[root.variantOf]!;
    const pad = isParentHit(project, root) ? undefined : Object.values(project.pads).find((p) => p.auto && p.members[0] === root.id);
    const copy: Hit = { ...hit, id: ctx.newId(), name: name ?? `${hit.name} var`, variantOf: id };
    const hits = { ...project.hits, [copy.id]: copy };
    const pads = pad === undefined ? project.pads : { ...project.pads, [pad.id]: { ...pad, members: [...pad.members, copy.id] } };
    return ok({ ...project, hits, pads });
  };

// Pads

export const createPad =
  (name: string, members: readonly Id[] = []): Command =>
  (project, ctx) => {
    const missing = members.find((m) => project.hits[m] === undefined);
    if (missing !== undefined) return notFound(missing);
    const pad: Pad = { id: ctx.newId(), name, members, auto: false, choice: 'top' };
    return ok({ ...project, pads: { ...project.pads, [pad.id]: pad } });
  };

const setPad = (project: Project, pad: Pad): Project => ({ ...project, pads: { ...project.pads, [pad.id]: pad } });

export const renamePad =
  (id: Id, name: string): Command =>
  (project) => {
    const pad = project.pads[id];
    return pad === undefined ? notFound(id) : ok(setPad(project, { ...pad, name }));
  };

/** How the pad picks a member where no step lock or mod picks one. */
export const setPadChoice =
  (id: Id, choice: PadChoice): Command =>
  (project) => {
    const pad = project.pads[id];
    return pad === undefined ? notFound(id) : ok(setPad(project, { ...pad, choice }));
  };

export const addPadMember =
  (padId: Id, hitId: Id): Command =>
  (project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (project.hits[hitId] === undefined) return notFound(hitId);
    if (pad.members.includes(hitId)) return invalid('The hit is already a member of the pad');
    const hit = project.hits[hitId]!;
    if (isParentHit(project, hit)) return invalid('A parent is a macro for its slices; place it in a loop instead');
    return ok(setPad(project, { ...pad, members: [...pad.members, hitId] }));
  };

/** Moves a member to a new position. Position 0 is member 1, the default. */
export const movePadMember =
  (padId: Id, hitId: Id, toIndex: number): Command =>
  (project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (!pad.members.includes(hitId)) return notFound(hitId);
    const rest = pad.members.filter((m) => m !== hitId);
    const index = Math.max(0, Math.min(toIndex, rest.length));
    return ok(setPad(project, { ...pad, members: [...rest.slice(0, index), hitId, ...rest.slice(index)] }));
  };

/** Removes a member. Steps that chose it fall back to member 1. */
export const removePadMember =
  (padId: Id, hitId: Id): Command =>
  (project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (!pad.members.includes(hitId)) return notFound(hitId);
    // The last member may be removed; an empty pad stays and plays nothing.
    const loops = Object.fromEntries(
      Object.entries(project.loops).map(([id, loop]): [Id, Loop] => [
        id,
        loop.steps.some((s) => s.padId === padId && s.memberId === hitId)
          ? {
              ...loop,
              steps: loop.steps.map((s) => (s.padId === padId && s.memberId === hitId ? { ...s, memberId: null } : s)),
            }
          : loop,
      ]),
    );
    return ok({ ...setPad(project, { ...pad, members: pad.members.filter((m) => m !== hitId) }), loops });
  };

// Loops

/** A new empty loop. Without a name it gets the next free M or F number. */
export const createLoop =
  (name: string | null, kind: LoopKind, bars: number): Command =>
  (project, ctx) => {
    if (!Number.isInteger(bars) || bars < 1) return invalid('A loop is a whole number of bars');
    const loop: Loop = {
      id: ctx.newId(),
      name: name ?? nextLoopName(project, kind),
      kind,
      steps: emptySteps(bars),
    };
    return ok({ ...project, loops: { ...project.loops, [loop.id]: loop } });
  };

/** The longest loop: 16 bars. */
export const MAX_LOOP_STEPS = 16 * STEPS_PER_BAR;

/** Changes a loop's length in steps of 1/16. New steps are empty; steps past the new end are dropped. */
export const setLoopLength =
  (id: Id, length: number): Command =>
  (project) => {
    const loop = project.loops[id];
    if (loop === undefined) return notFound(id);
    if (!Number.isInteger(length) || length < 1 || length > MAX_LOOP_STEPS) return invalid('A loop is 1/16 to 16 bars long');
    const steps = Array.from({ length }, (_, i) => loop.steps[i] ?? emptyStep);
    return ok({ ...project, loops: { ...project.loops, [id]: { ...loop, steps } } });
  };

/** Tags a loop as a main or a fill. It only groups and names loops; the Song row decides how it plays. */
export const setLoopKind =
  (id: Id, kind: LoopKind): Command =>
  (project) => {
    const loop = project.loops[id];
    return loop === undefined ? notFound(id) : ok({ ...project, loops: { ...project.loops, [id]: { ...loop, kind } } });
  };

export const renameLoop =
  (id: Id, name: string): Command =>
  (project) => {
    const loop = project.loops[id];
    return loop === undefined ? notFound(id) : ok({ ...project, loops: { ...project.loops, [id]: { ...loop, name } } });
  };

/** Changes one step. Setting a new pad clears the chosen member unless one is given. */
/**
 * Moves steps `from` to `from + count − 1` so they start at `to`, or copies
 * them with `copy`. Steps that would land outside the loop are left out; the
 * steps they came from are emptied all the same when moving.
 */
export const moveSteps =
  (loopId: Id, from: number, count: number, to: number, copy: boolean): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    if (!Number.isInteger(from) || !Number.isInteger(count) || !Number.isInteger(to) || count < 1 || from < 0 || from + count > loop.steps.length) {
      return invalid('Those steps are not in the loop');
    }
    const moving = loop.steps.slice(from, from + count);
    const steps = loop.steps.map((s, i) => (!copy && i >= from && i < from + count ? emptyStep : s));
    moving.forEach((s, i) => {
      if (to + i >= 0 && to + i < steps.length) steps[to + i] = s;
    });
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps } } });
  };

export const setStep =
  (loopId: Id, index: number, patch: Patch<Step>): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const step = loop.steps[index];
    if (step === undefined) return invalid(`Step ${index} is outside the loop`);

    const padChanged = patch.padId !== undefined && patch.padId !== step.padId;
    const next: Step = { ...step, ...(padChanged ? { memberId: null } : {}), ...patch };
    if (next.padId !== null) {
      const pad = project.pads[next.padId];
      if (pad === undefined) return notFound(next.padId);
      if (next.memberId !== null && !pad.members.includes(next.memberId)) {
        return invalid('The chosen member is not in the pad');
      }
    } else if (next.memberId !== null) {
      return invalid('An empty step cannot choose a member');
    }
    const steps = loop.steps.map((s, i) => (i === index ? next : s));
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps } } });
  };

/**
 * Lays a sliced break's slices out in a loop from step `at`, each on its own
 * step as in the loop the slicing made: what placing the break's parent means.
 * It writes over the break's whole length: steps there that no slice lands on
 * are emptied. Slices past the loop's end, or on the same step as an earlier
 * one, are left out.
 */
export const placeBreak =
  (loopId: Id, breakId: Id, at: number): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const sequence = breakSequence(project, breakId);
    if (sequence.length === 0) return invalid('The break has no slices');
    const span = (project.breaks[breakId]?.bars ?? 1) * STEPS_PER_BAR;
    const steps = loop.steps.map((s, i) => (i >= at && i < at + span ? emptyStep : s));
    const used = new Set<number>();
    for (const { padId, step } of sequence) {
      const index = at + step;
      if (index >= steps.length || used.has(index)) continue;
      used.add(index);
      steps[index] = { padId, memberId: null, ignoreMods: false, nudge: 0 };
    }
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps } } });
  };

// Mods

/** What is wrong with an effect, or null. */
function effectProblem(effect: ModEffect): string | null {
  if (effect.target === 'swap') {
    const { mode } = effect;
    if (mode.kind === 'shuffle' && mode.pick.kind === 'rotate' && !(Number.isInteger(mode.pick.by) && mode.pick.by >= 1 && mode.pick.by <= 15)) {
      return 'Rotate is by 1 to 15';
    }
    return null;
  }
  if (effect.target !== 'tape') return null;
  if (!Number.isInteger(effect.length) || effect.length < 1 || effect.length > MAX_TAPE_STEPS) return 'Repeat is 1/16 to 4 bars';
  const { from, to } = effect.speed;
  if (![from, to].every((v) => Number.isFinite(v) && v >= 0 && v <= MAX_TAPE_SPEED)) return `Speed is 0× to ${MAX_TAPE_SPEED}×`;
  if (effect.rampOver !== null && !(Number.isInteger(effect.rampOver) && effect.rampOver >= 1)) return 'Ramp over is at least 1/16';
  if (![effect.wow, effect.flutter].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return 'Wow and flutter are 0 to 100 %';
  return null;
}

/** Checks a mod's effects: at least one, at most one per target, each valid. */
function effectsProblem(effects: readonly ModEffect[]): string | null {
  if (new Set(effects.map((e) => e.target)).size !== effects.length) return 'A mod has one effect per target';
  return effects.map(effectProblem).find((p) => p !== null) ?? null;
}

const setMod = (project: Project, mod: Mod): CommandResult => {
  const problem = effectsProblem(mod.effects);
  return problem !== null ? invalid(problem) : ok({ ...project, mods: { ...project.mods, [mod.id]: mod } });
};

/** A new mod with its effects. */
export const createMod =
  (name: string, effects: readonly ModEffect[]): Command =>
  (project, ctx) =>
    setMod(project, { id: ctx.newId(), name, effects });

export const renameMod =
  (id: Id, name: string): Command =>
  (project) => {
    const mod = project.mods[id];
    return mod === undefined ? notFound(id) : ok({ ...project, mods: { ...project.mods, [id]: { ...mod, name } } });
  };

/** Adds an effect for a target the mod does not have yet. */
export const addEffect =
  (id: Id, effect: ModEffect): Command =>
  (project) => {
    const mod = project.mods[id];
    return mod === undefined ? notFound(id) : setMod(project, { ...mod, effects: [...mod.effects, effect] });
  };

/** Puts `effect` where the effect for `target` is; it may have another target. */
export const replaceEffect =
  (id: Id, target: EffectTarget, effect: ModEffect): Command =>
  (project) => {
    const mod = project.mods[id];
    if (mod === undefined) return notFound(id);
    if (!mod.effects.some((e) => e.target === target)) return notFound(`${id}:${target}`);
    return setMod(project, { ...mod, effects: mod.effects.map((e) => (e.target === target ? effect : e)) });
  };

/** Takes an effect out of a mod; the last one stays. */
export const removeEffect =
  (id: Id, target: EffectTarget): Command =>
  (project) => {
    const mod = project.mods[id];
    if (mod === undefined) return notFound(id);
    return setMod(project, { ...mod, effects: mod.effects.filter((e) => e.target !== target) });
  };

// Song

const setSong = (project: Project, song: Song): Project => ({ ...project, song });

export const setBpm =
  (bpm: number): Command =>
  (project) =>
    bpm > 0 ? ok(setSong(project, { ...project.song, bpm })) : invalid('BPM must be positive');

/** Changes the song length. Clips past the new end go; clips across it are shortened. */
export const setSongBars =
  (bars: number): Command =>
  (project) => {
    if (!Number.isInteger(bars) || bars < 1) return invalid('A song is a whole number of bars');
    const total = bars * STEPS_PER_BAR;
    const loop = project.song.loop;
    const fitted = loop == null || loop.start >= total ? null : { ...loop, end: Math.min(loop.end, total) };
    return ok(setSong(project, { ...project.song, bars, clips: fitClips(project.song.clips, total), loop: fitted }));
  };

/** Marks steps `start` to `end` (after the last) as the song's loop, on unless `on` says otherwise. */
export const setSongLoop =
  (start: number, end: number, on = true): Command =>
  (project) => {
    const total = project.song.bars * STEPS_PER_BAR;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > total || end <= start) {
      return invalid('A loop is at least one step, within the song');
    }
    return ok(setSong(project, { ...project.song, loop: { start, end, on } }));
  };

/** Turns the song's loop on or off, keeping where it is. */
export const setSongLoopOn =
  (on: boolean): Command =>
  (project) => {
    const loop = project.song.loop;
    if (loop == null) return invalid('Drag in the ruler to mark a loop first');
    return ok(setSong(project, { ...project.song, loop: { ...loop, on } }));
  };

/**
 * Lays a loop or mod out from the start of a bar with its natural length, or
 * with null removes the clip that starts there. A shorthand for addClip.
 */
export const setSongCell =
  (row: SongRow, bar: number, id: Id | null): Command =>
  (project, ctx) => {
    if (!Number.isInteger(bar) || bar < 0 || bar >= project.song.bars) return invalid(`Bar ${bar} is outside the song`);
    const start = bar * STEPS_PER_BAR;
    if (id === null) {
      return ok(setSong(project, { ...project.song, clips: project.song.clips.filter((c) => !(c.row === row && c.start === start)) }));
    }
    return addClip(row, id, start)(project, ctx);
  };

// Removal

const collection = {
  sample: 'samples',
  hit: 'hits',
  pad: 'pads',
  loop: 'loops',
  mod: 'mods',
} as const satisfies Record<ReferableKind, keyof Project>;

/** Removes an object. Fails, listing where it is used, if anything refers to it. */
export const remove =
  (kind: ReferableKind, id: Id): Command =>
  (project) => {
    const key = collection[kind];
    if (project[key][id] === undefined) return notFound(id);
    const usages = findUsages(project, kind, id);
    if (usages.length > 0) return fail({ kind: 'in-use', usages });
    return ok({ ...project, [key]: without<unknown>(project[key], id) });
  };

/** Swaps in a whole project, as when opening a project file. Undo brings the old one back. */
export const replaceProject =
  (next: Project): Command =>
  () =>
    ok(next);
