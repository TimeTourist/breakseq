import type { Command } from './command';
import { fail, invalid, notFound, ok, without } from './command';
import { DEFAULT_TAG_NAMES, emptySteps, fullWindow, nextLoopName } from './project';
import type { ReferableKind } from './references';
import { findUsages } from './references';
import type { Hit, Id, Loop, LoopKind, Mod, Pad, Project, Sample, Song, SongRow, Step, Tag } from './types';
import { MAX_TAGS, STEPS_PER_BAR } from './types';

type Patch<T> = Partial<Omit<T, 'id'>>;

// Tags

export const addTag =
  (name: string): Command =>
  (project, ctx) => {
    if (Object.keys(project.tags).length >= MAX_TAGS) return invalid(`At most ${MAX_TAGS} tags`);
    const tag: Tag = { id: ctx.newId(), name };
    return ok({ ...project, tags: { ...project.tags, [tag.id]: tag } });
  };

// Samples

export const updateSample =
  (id: Id, patch: Patch<Pick<Sample, 'name' | 'mainTag' | 'extraTags'>>): Command =>
  (project) => {
    const sample = project.samples[id];
    if (sample === undefined) return notFound(id);
    const tagIds = [patch.mainTag, ...(patch.extraTags ?? [])].filter((t): t is Id => typeof t === 'string');
    const missing = tagIds.find((t) => project.tags[t] === undefined);
    if (missing !== undefined) return notFound(missing);
    // A tag set by hand is never a guess.
    const guessed = patch.mainTag === undefined ? sample.tagGuessed : false;
    return ok({ ...project, samples: { ...project.samples, [id]: { ...sample, ...patch, tagGuessed: guessed } } });
  };

/**
 * Guesses the main tag of the untagged samples among `ids`. `guess` names a tag
 * (K, S, …) or returns null; guesses are marked until confirmed.
 */
export const guessTags =
  (ids: readonly Id[], guess: (sample: Sample) => string | null): Command =>
  (project) => {
    const byName = new Map(Object.values(project.tags).map((t) => [t.name, t.id]));
    const samples = { ...project.samples };
    for (const id of ids) {
      const sample = samples[id];
      if (sample === undefined || sample.mainTag !== null) continue;
      const name = guess(sample);
      const tagId = name === null ? undefined : byName.get(name);
      if (tagId !== undefined) samples[id] = { ...sample, mainTag: tagId, tagGuessed: true };
    }
    return ok({ ...project, samples });
  };

/** Confirms guessed tags: they become ordinary tags. */
export const confirmTags =
  (ids: readonly Id[]): Command =>
  (project) => {
    const samples = { ...project.samples };
    for (const id of ids) {
      const sample = samples[id];
      if (sample?.tagGuessed === true) samples[id] = { ...sample, tagGuessed: false };
    }
    return ok({ ...project, samples });
  };

/** Removes a tag of your own. The five defaults stay, and a tag in use cannot go. */
export const removeTag =
  (id: Id): Command =>
  (project, ctx) => {
    const tag = project.tags[id];
    if (tag === undefined) return notFound(id);
    if ((DEFAULT_TAG_NAMES as readonly string[]).includes(tag.name)) return invalid(`${tag.name} is one of the default tags`);
    return remove('tag', id)(project, ctx);
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

// Pads

export const createPad =
  (name: string, members: readonly Id[] = []): Command =>
  (project, ctx) => {
    const missing = members.find((m) => project.hits[m] === undefined);
    if (missing !== undefined) return notFound(missing);
    const pad: Pad = { id: ctx.newId(), name, members, auto: false };
    return ok({ ...project, pads: { ...project.pads, [pad.id]: pad } });
  };

const setPad = (project: Project, pad: Pad): Project => ({ ...project, pads: { ...project.pads, [pad.id]: pad } });

export const renamePad =
  (id: Id, name: string): Command =>
  (project) => {
    const pad = project.pads[id];
    return pad === undefined ? notFound(id) : ok(setPad(project, { ...pad, name }));
  };

export const addPadMember =
  (padId: Id, hitId: Id): Command =>
  (project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (project.hits[hitId] === undefined) return notFound(hitId);
    if (pad.members.includes(hitId)) return invalid('The hit is already a member of the pad');
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
      bars,
      steps: emptySteps(bars),
      window: fullWindow(bars),
    };
    return ok({ ...project, loops: { ...project.loops, [loop.id]: loop } });
  };

/** Changes a loop's length. New bars are empty; steps past the new end are dropped. */
export const setLoopBars =
  (id: Id, bars: number): Command =>
  (project) => {
    const loop = project.loops[id];
    if (loop === undefined) return notFound(id);
    if (!Number.isInteger(bars) || bars < 1) return invalid('A loop is a whole number of bars');
    const length = bars * STEPS_PER_BAR;
    const steps = [...loop.steps.slice(0, length), ...emptySteps(bars)].slice(0, length);
    // A window over the whole loop keeps covering it; any other is cut to the new length.
    const whole = loop.window.start === 0 && loop.window.end === loop.steps.length;
    const start = Math.min(loop.window.start, length - 1);
    const window = whole ? fullWindow(bars) : { start, end: Math.max(start + 1, Math.min(loop.window.end, length)) };
    return ok({ ...project, loops: { ...project.loops, [id]: { ...loop, bars, steps, window } } });
  };

/** Sets the steps a loop plays when it is in the Fill row; the main shows through the rest. End is exclusive. */
export const setFillWindow =
  (id: Id, start: number, end: number): Command =>
  (project) => {
    const loop = project.loops[id];
    if (loop === undefined) return notFound(id);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > loop.steps.length || end <= start) {
      return invalid('The window must cover at least one step of the loop');
    }
    return ok({ ...project, loops: { ...project.loops, [id]: { ...loop, window: { start, end } } } });
  };

/** Tags a loop as a main or a fill. It only groups loops and shows the fill window; the Song row decides how it plays. */
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

// Mods

/** A new mod. `sources` only matters for Borrow and defaults to none. */
export const createMod =
  (fields: Omit<Mod, 'id' | 'sources'> & { readonly sources?: readonly Id[] }): Command =>
  (project, ctx) => {
    const mod: Mod = { id: ctx.newId(), ...fields, sources: fields.sources ?? [] };
    return ok({ ...project, mods: { ...project.mods, [mod.id]: mod } });
  };

export const updateMod =
  (id: Id, patch: Patch<Mod>): Command =>
  (project) => {
    const mod = project.mods[id];
    return mod === undefined ? notFound(id) : ok({ ...project, mods: { ...project.mods, [id]: { ...mod, ...patch } } });
  };

// Song

const setSong = (project: Project, song: Song): Project => ({ ...project, song });

export const setBpm =
  (bpm: number): Command =>
  (project) =>
    bpm > 0 ? ok(setSong(project, { ...project.song, bpm })) : invalid('BPM must be positive');

/** Changes the song length. Cells past the new end are dropped. */
export const setSongBars =
  (bars: number): Command =>
  (project) => {
    if (!Number.isInteger(bars) || bars < 1) return invalid('A song is a whole number of bars');
    const resize = (row: readonly (Id | null)[]) => Array.from({ length: bars }, (_, i) => row[i] ?? null);
    const { rows } = project.song;
    return ok(
      setSong(project, {
        ...project.song,
        bars,
        rows: { main: resize(rows.main), fill: resize(rows.fill), modA: resize(rows.modA), modB: resize(rows.modB) },
      }),
    );
  };

/** Places a loop or mod at the start of a bar, or clears the cell with null. */
export const setSongCell =
  (row: SongRow, bar: number, id: Id | null): Command =>
  (project) => {
    if (!Number.isInteger(bar) || bar < 0 || bar >= project.song.bars) return invalid(`Bar ${bar} is outside the song`);
    if (id !== null) {
      if (row === 'main' || row === 'fill') {
        // Any loop can go in either row: the row decides how it plays.
        if (project.loops[id] === undefined) return notFound(id);
      } else if (project.mods[id] === undefined) {
        return notFound(id);
      }
    }
    const cells = project.song.rows[row].map((c, i) => (i === bar ? id : c));
    return ok(setSong(project, { ...project.song, rows: { ...project.song.rows, [row]: cells } }));
  };

// Removal

const collection = {
  tag: 'tags',
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
    return ok({ ...project, [key]: without(project[key], id) });
  };

/** Swaps in a whole project, as when opening a project file. Undo brings the old one back. */
export const replaceProject =
  (next: Project): Command =>
  () =>
    ok(next);
