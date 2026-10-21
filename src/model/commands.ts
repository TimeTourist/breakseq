import type { Command, CommandContext, CommandResult } from './command';
import { fail, invalid, notFound, ok, without } from './command';
import { addClip, fitClips } from './clips';
import { dropMatrix, dropParts, following, removeSample } from './chain';
import { matrixSequence, matrixSteps } from './lengths';
import { matrixOfPad, padOfHit } from './owners';
import { renumberRows, rowName } from './names';
import { baseName } from './sound';
import { emptyStep, emptySteps, nextLoopName } from './project';
import type { ReferableKind } from './references';
import { findUsages } from './references';
import type { Config, EffectTarget, Hit, Id, Loop, LoopKind, Matrix, Mod, ModEffect, Pad, PadChoice, Project, Sample, Song, SongRow, Step, StepEffect } from './types';
import { CELL_SIZES, HALFTIME_SPEEDS, MAX_LOOP_STEPS, MAX_TAPE_SPEED, MAX_TAPE_STEPS, NO_CONFIG, STEPS_PER_BAR, STEP_SIZES, STUTTER_GRABS, isStepEffect } from './types';
import { laneProblem } from './lanes';

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

export const updateHit = (id: Id, patch: Patch<Omit<Hit, 'sampleId'>>): Command =>
  following((project) => {
    const hit = project.hits[id];
    if (hit === undefined) return notFound(id);
    return ok({ ...project, hits: { ...project.hits, [id]: { ...hit, ...patch } } });
  });

/**
 * A variant of a hit: a new hit on the same sample with its config, marked as
 * the hit's variant and added last to the hit's pad. One undo step.
 * Not `following`: it never changes a pad's first hit, so no layout changes.
 */
export const addVariant =
  (id: Id, name?: string): Command =>
  (project, ctx) => {
    const hit = project.hits[id];
    if (hit === undefined) return notFound(id);
    const pad = padOfHit(project, id);
    const copy: Hit = { ...hit, id: ctx.newId(), name: name ?? `${hit.name} var`, variantOf: id };
    const hits = { ...project.hits, [copy.id]: copy };
    const pads = pad === undefined ? project.pads : { ...project.pads, [pad.id]: { ...pad, members: [...pad.members, copy.id] } };
    return ok({ ...project, hits, pads });
  };

// Pads

const setPad = (project: Project, pad: Pad): Project => ({ ...project, pads: { ...project.pads, [pad.id]: pad } });
const setMatrix = (project: Project, matrix: Matrix): Project => ({ ...project, matrices: { ...project.matrices, [matrix.id]: matrix } });

const emptyPad = (ctx: CommandContext, name: string): Pad => ({ id: ctx.newId(), name, members: [], choice: 'top', config: NO_CONFIG, seed: ctx.newSeed() });

export const renamePad =
  (id: Id, name: string): Command =>
  (project) => {
    const pad = project.pads[id];
    return pad === undefined ? notFound(id) : ok(setPad(project, { ...pad, name }));
  };

/** How the pad picks a member where no step lock or mod picks one. Not `following`: the layout goes by the first hit. */
export const setPadChoice =
  (id: Id, choice: PadChoice): Command =>
  (project) => {
    const pad = project.pads[id];
    return pad === undefined ? notFound(id) : ok(setPad(project, { ...pad, choice }));
  };

/** Changes the config a pad lays over all its hits. */
export const setPadConfig = (padId: Id, patch: Partial<Config>): Command =>
  following((project) => {
    const pad = project.pads[padId];
    return pad === undefined ? notFound(padId) : ok(setPad(project, { ...pad, config: { ...pad.config, ...patch } }));
  });

/** Moves a member to a new position. Position 0 is member 1, the default. */
export const movePadMember = (padId: Id, hitId: Id, toIndex: number): Command =>
  following((project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (!pad.members.includes(hitId)) return notFound(hitId);
    return ok(setPad(project, { ...pad, members: moved(pad.members, hitId, toIndex) }));
  });

/** `ids` with `id` moved to `toIndex`, kept within the list. */
function moved(ids: readonly Id[], id: Id, toIndex: number): Id[] {
  const rest = ids.filter((m) => m !== id);
  const index = Math.max(0, Math.min(toIndex, rest.length));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

/**
 * Removes a member, which is the hit itself: a hit belongs to its pad only.
 * Steps that chose it fall back to member 1; the last member may go, and an
 * empty pad stays and plays nothing.
 */
export const removePadMember = (padId: Id, hitId: Id): Command =>
  following((project) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    if (!pad.members.includes(hitId)) return notFound(hitId);
    return ok(dropParts(project, { pads: new Set(), hits: new Set([hitId]), loop: null }));
  });

// Matrices

/** A new matrix, built by hand (a bag of sounds): one empty pad, no sample and no loop. */
export const createMatrix =
  (name: string): Command =>
  (project, ctx) => {
    if (name.trim() === '') return invalid('A matrix needs a name');
    const pad = emptyPad(ctx, rowName(name, 0));
    const matrix: Matrix = { id: ctx.newId(), name, pads: [pad.id], config: NO_CONFIG, sampleId: null, loop: null, seed: ctx.newSeed() };
    return ok(setMatrix(setPad(project, pad), matrix));
  };

/** An empty pad added last to a matrix, named after its row: "Snares 02". */
export const addPad = (matrixId: Id): Command =>
  following((project, ctx) => {
    const matrix = project.matrices[matrixId];
    if (matrix === undefined) return notFound(matrixId);
    const pad = emptyPad(ctx, rowName(matrix.name, matrix.pads.length));
    return ok(setMatrix(setPad(project, pad), { ...matrix, pads: [...matrix.pads, pad.id] }));
  });

/** Moves a pad to row `to` (0 is row 01) of its matrix; pads named after their row are renamed after their new one. */
export const movePad = (matrixId: Id, padId: Id, to: number): Command =>
  following((project) => {
    const matrix = project.matrices[matrixId];
    if (matrix === undefined) return notFound(matrixId);
    if (!matrix.pads.includes(padId)) return notFound(padId);
    return ok(renumberRows(setMatrix(project, { ...matrix, pads: moved(matrix.pads, padId, to) }), matrixId));
  });

/**
 * Moves a matrix to place `to` (0 is first) in the project's order of
 * matrices, which is the order Matrices lists them in. Ids and contents stay.
 */
export const moveMatrix =
  (matrixId: Id, to: number): Command =>
  (project) => {
    if (project.matrices[matrixId] === undefined) return notFound(matrixId);
    const order = moved(Object.keys(project.matrices), matrixId, to);
    return ok({ ...project, matrices: Object.fromEntries(order.map((id) => [id, project.matrices[id]!])) });
  };

/** Changes the config a matrix lays over all its pads. */
export const setMatrixConfig = (matrixId: Id, patch: Partial<Config>): Command =>
  following((project) => {
    const matrix = project.matrices[matrixId];
    return matrix === undefined ? notFound(matrixId) : ok(setMatrix(project, { ...matrix, config: { ...matrix.config, ...patch } }));
  });

// Copies (decision 8): new hits and pads with no link to where they came from.

/** New hits as copies of `hitIds`: each hit's own fields only, no variant. Added to `hits`; returns their ids. */
function copiesOf(project: Project, hitIds: readonly Id[], hits: Record<Id, Hit>, ctx: CommandContext, rename: (name: string) => string = (n) => n): Id[] {
  return hitIds.flatMap((id) => {
    const hit = project.hits[id];
    if (hit === undefined) return [];
    const copy: Hit = { ...hit, id: ctx.newId(), name: rename(hit.name), variantOf: null };
    hits[copy.id] = copy;
    return [copy.id];
  });
}

/** A new pad named `name` as a copy of `pad`: its choice and config, with copies of its hits. Added to `pads` and `hits`. */
function padCopy(project: Project, pad: Pad, name: string, pads: Record<Id, Pad>, hits: Record<Id, Hit>, ctx: CommandContext, rename?: (name: string) => string): Id {
  const members = copiesOf(project, pad.members, hits, ctx, rename);
  const copy: Pad = { ...pad, id: ctx.newId(), name, members, seed: ctx.newSeed() };
  pads[copy.id] = copy;
  return copy.id;
}

/**
 * Copies hits last to a pad: new hits on the same samples with the hits' own
 * config only; the config of the pad and matrix they came from does not come
 * along, the new place's applies. Changing a copy leaves the original, and the
 * other way round.
 */
export const copyHits = (hitIds: readonly Id[], toPadId: Id): Command => following(copyHitsTo(hitIds, toPadId));

/** `copyHits` without following, for commands built on it. */
const copyHitsTo =
  (hitIds: readonly Id[], toPadId: Id): Command =>
  (project, ctx) => {
    const pad = project.pads[toPadId];
    if (pad === undefined) return notFound(toPadId);
    const missing = hitIds.find((h) => project.hits[h] === undefined);
    if (missing !== undefined) return notFound(missing);
    const hits = { ...project.hits };
    const copies = copiesOf(project, hitIds, hits, ctx);
    return ok(setPad({ ...project, hits }, { ...pad, members: [...pad.members, ...copies] }));
  };

/**
 * A new pad last in a matrix, named after its row, holding copies of
 * `hitIds`; Round robin when it gets more than one. One undo step.
 */
export const addPadWith = (matrixId: Id, hitIds: readonly Id[]): Command =>
  following((project, ctx) => {
    const matrix = project.matrices[matrixId];
    if (matrix === undefined) return notFound(matrixId);
    const pad = emptyPad(ctx, rowName(matrix.name, matrix.pads.length));
    const added = setMatrix(setPad(project, pad), { ...matrix, pads: [...matrix.pads, pad.id] });
    const filled = copyHitsTo(hitIds, pad.id)(added, ctx);
    if (!filled.ok) return filled;
    const made = filled.project.pads[pad.id]!;
    return ok(made.members.length > 1 ? setPad(filled.project, { ...made, choice: 'roundRobin' }) : filled.project);
  });

/** Copies a pad last to a matrix: a new pad named after its row there, with its choice and config, and copies of its hits. */
export const copyPad = (padId: Id, toMatrixId: Id): Command =>
  following((project, ctx) => {
    const pad = project.pads[padId];
    if (pad === undefined) return notFound(padId);
    const matrix = project.matrices[toMatrixId];
    if (matrix === undefined) return notFound(toMatrixId);
    const pads = { ...project.pads };
    const hits = { ...project.hits };
    const copy = padCopy(project, pad, rowName(matrix.name, matrix.pads.length), pads, hits, ctx);
    return ok(setMatrix({ ...project, pads, hits }, { ...matrix, pads: [...matrix.pads, copy] }));
  });

/** Copies a matrix: to a matrix, each of its pads last, named after their rows (`copyPad`); to a pad, all its hits last, pad by pad (`copyHits`). */
export const copyMatrix = (fromId: Id, to: { readonly matrixId: Id } | { readonly padId: Id }): Command =>
  following((project, ctx) => {
    const from = project.matrices[fromId];
    if (from === undefined) return notFound(fromId);
    if ('padId' in to) return copyHitsTo(from.pads.flatMap((p) => project.pads[p]?.members ?? []), to.padId)(project, ctx);
    const matrix = project.matrices[to.matrixId];
    if (matrix === undefined) return notFound(to.matrixId);
    const pads = { ...project.pads };
    const hits = { ...project.hits };
    const copies: Id[] = [];
    for (const p of from.pads) {
      const pad = project.pads[p];
      if (pad !== undefined) copies.push(padCopy(project, pad, rowName(matrix.name, matrix.pads.length + copies.length), pads, hits, ctx));
    }
    return ok(setMatrix({ ...project, pads, hits }, { ...matrix, pads: [...matrix.pads, ...copies] }));
  });

/**
 * A matrix copied whole, to change apart from the original: "<name> copy",
 * with its config and copies of its pads and hits; names that carry its name
 * carry the copy's ("amen 1 07" becomes "amen 1 copy 07"). It has no sample,
 * so its rows no longer follow the slicing, and no loop.
 */
export const cloneMatrix =
  (matrixId: Id): Command =>
  (project, ctx) => {
    const matrix = project.matrices[matrixId];
    if (matrix === undefined) return notFound(matrixId);
    const from = baseName(matrix.name);
    const name = `${from} copy`;
    const rename = (n: string) => (n === from || n.startsWith(`${from} `) ? `${name}${n.slice(from.length)}` : n);
    const pads = { ...project.pads };
    const hits = { ...project.hits };
    const copies = matrix.pads.flatMap((p) => (project.pads[p] === undefined ? [] : [padCopy(project, project.pads[p]!, rename(project.pads[p]!.name), pads, hits, ctx, rename)]));
    return ok(setMatrix({ ...project, pads, hits }, { id: ctx.newId(), name, pads: copies, config: matrix.config, sampleId: null, loop: null, seed: ctx.newSeed() }));
  };

/**
 * Decision 12: a copy of `sourceHitId` takes `targetHitId`'s place in its pad;
 * steps locked to the target lock the copy; the target goes. One undo step.
 */
export const replaceHit = (targetHitId: Id, sourceHitId: Id): Command =>
  following((project, ctx) => {
    if (targetHitId === sourceHitId) return invalid('A hit cannot replace itself');
    if (project.hits[targetHitId] === undefined) return notFound(targetHitId);
    if (project.hits[sourceHitId] === undefined) return notFound(sourceHitId);
    const pad = padOfHit(project, targetHitId);
    if (pad === undefined) return invalid('The hit is in no pad');
    const hits = { ...project.hits };
    const [copy] = copiesOf(project, [sourceHitId], hits, ctx);
    const placed = setPad({ ...project, hits }, { ...pad, members: pad.members.map((m) => (m === targetHitId ? copy! : m)) });
    const relock = (s: Step): Step => (s.memberId === targetHitId ? { ...s, memberId: copy! } : s);
    const loops = Object.fromEntries(
      Object.entries(placed.loops).map(([id, l]) => [id, l.steps.some((s) => s.memberId === targetHitId) ? { ...l, steps: l.steps.map(relock) } : l]),
    );
    return ok(dropParts({ ...placed, loops }, { pads: new Set(), hits: new Set([targetHitId]), loop: null }));
  });

/**
 * Decision 15: a new matrix with one pad holding copies of the given hits
 * (each with its own settings), choice Round robin when more than one. It has
 * no sample and no loop.
 */
export const createMatrixFrom =
  (name: string, hitIds: readonly Id[]): Command =>
  (project, ctx) => {
    if (name.trim() === '') return invalid('A matrix needs a name');
    if (hitIds.length === 0) return invalid('A matrix from hits needs at least one hit');
    const missing = hitIds.find((h) => project.hits[h] === undefined);
    if (missing !== undefined) return notFound(missing);
    const hits = { ...project.hits };
    const members = copiesOf(project, hitIds, hits, ctx);
    const pad: Pad = { ...emptyPad(ctx, rowName(name, 0)), members, choice: members.length > 1 ? 'roundRobin' : 'top' };
    const matrix: Matrix = { id: ctx.newId(), name, pads: [pad.id], config: NO_CONFIG, sampleId: null, loop: null, seed: ctx.newSeed() };
    return ok(setMatrix(setPad({ ...project, hits }, pad), matrix));
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

/**
 * Lays `steps` out in a loop from step `at`, over what is there, empty steps
 * too (Magnus beslut): Ctrl+V of copied steps. Steps past the loop's end are
 * dropped.
 */
export const pasteSteps =
  (loopId: Id, at: number, steps: readonly Step[]): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    if (!Number.isInteger(at) || at < 0 || at >= loop.steps.length) return invalid('That step is not in the loop');
    const next = [...loop.steps];
    steps.forEach((s, i) => {
      if (at + i < next.length) next[at + i] = s;
    });
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps: next } } });
  };

/**
 * Moves a loop to place `to` (0 is first) in the project's order of loops,
 * the order Loops lists them in, tagged `kind`: dragged into the other group
 * it changes from Main to Fill or back (Magnus beslut).
 */
export const moveLoop =
  (loopId: Id, to: number, kind: LoopKind): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const order = moved(Object.keys(project.loops), loopId, to);
    return ok({ ...project, loops: Object.fromEntries(order.map((id) => [id, id === loopId ? { ...loop, kind } : project.loops[id]!])) });
  };

/** A copy of a loop, "<name> copy", with its tag and steps, last in the order: to change apart from it. */
export const cloneLoop =
  (loopId: Id): Command =>
  (project, ctx) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const copy: Loop = { ...loop, id: ctx.newId(), name: `${loop.name} copy` };
    return ok({ ...project, loops: { ...project.loops, [copy.id]: copy } });
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
 * Lays a matrix out in a loop from step `at`, pad after pad as it plays
 * (decision 15). It writes over its whole length: steps there that no pad
 * lands on are emptied. Pads past the loop's end are left out.
 */
export const placeMatrix =
  (loopId: Id, matrixId: Id, at: number): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    if (project.matrices[matrixId] === undefined) return notFound(matrixId);
    if (!Number.isInteger(at) || at < 0 || at >= loop.steps.length) return invalid(`Step ${at} is outside the loop`);
    const sequence = matrixSequence(project, matrixId);
    if (sequence.length === 0) return invalid('The matrix has nothing to play');
    const span = matrixSteps(project, matrixId);
    const steps = loop.steps.map((s, i) => (i >= at && i < at + span ? emptyStep : s));
    for (const { padId, step } of sequence) if (at + step < steps.length) steps[at + step] = { ...emptyStep, padId };
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps } } });
  };

/** The matrices whose pads a loop plays, in the order they first come. */
export function loopMatrices(project: Project, loop: Loop): Matrix[] {
  const found: Matrix[] = [];
  for (const step of loop.steps) {
    const matrix = step.padId === null ? undefined : matrixOfPad(project, step.padId);
    if (matrix !== undefined && !found.includes(matrix)) found.push(matrix);
  }
  return found;
}

/**
 * Swaps one matrix for another in a loop: every step playing row N of
 * `fromId` plays row N of `toId`, or is emptied when it has no row N. A
 * chosen member not in the new pad falls back to member 1.
 */
export const swapMatrix =
  (loopId: Id, fromId: Id, toId: Id): Command =>
  (project) => {
    const loop = project.loops[loopId];
    if (loop === undefined) return notFound(loopId);
    const from = project.matrices[fromId];
    if (from === undefined) return notFound(fromId);
    const to = project.matrices[toId];
    if (to === undefined) return notFound(toId);
    const steps = loop.steps.map((s): Step => {
      const row = s.padId === null ? -1 : from.pads.indexOf(s.padId);
      if (row < 0) return s;
      const padId = to.pads[row];
      if (padId === undefined) return emptyStep;
      return { ...s, padId, memberId: s.memberId !== null && project.pads[padId]?.members.includes(s.memberId) === true ? s.memberId : null };
    });
    return ok({ ...project, loops: { ...project.loops, [loopId]: { ...loop, steps } } });
  };

// Mods (not `following`: mods never change a pad's first hit, so no layout changes)

const oneOf = (value: unknown, options: readonly unknown[]) => options.includes(value);

/** What is wrong with an audio mod's own settings, or null (see Mods som samplar det som hörs). */
function audioSettingsProblem(effect: StepEffect): string | null {
  const { scramble, stutter, freeze, reverse, rewind } = effect;
  if (scramble !== undefined && !(oneOf(scramble.cell, CELL_SIZES) && oneOf(scramble.from, ['song', 'around', 'clip']) && oneOf(scramble.around, [1, 2, 4]) && oneOf(scramble.reverse, [0, 25, 50, 100]))) {
    return 'Scramble’s cell, Take from, Around the clip or Reverse chance is not one of its choices';
  }
  if (stutter !== undefined && !(oneOf(stutter.grabs, STUTTER_GRABS) && oneOf(stutter.pitch, [-2, -1, 0, 1, 2]) && oneOf(stutter.gate, [100, 75, 50]))) {
    return 'Stutter’s Grabs, Pitch per repeat or Gate is not one of its choices';
  }
  if (freeze !== undefined && !(oneOf(freeze.grain, [10, 30, 80]) && oneOf(freeze.spread, [0, 25, 50]) && oneOf(freeze.level, [-6, -3, 0]))) {
    return 'Freeze’s Grain, Spread or Level is not one of its choices';
  }
  if (reverse !== undefined && !oneOf(reverse.cell, CELL_SIZES)) return 'Reverse’s cell is 1/32, 1/16, 1/8 or a beat';
  if (rewind !== undefined && !(oneOf(rewind.pullBack, [4, 8, 16]) && oneOf(rewind.curve, ['fast', 'slowing', 'spinBack']))) {
    return 'Rewind pulls back 1 beat, 2 beats or 1 bar, Fast, Slowing or Spin-back';
  }
  return null;
}

/** What is wrong with an effect, or null. */
function effectProblem(effect: ModEffect): string | null {
  if (effect.target === 'swap') {
    const { mode } = effect;
    if (mode.kind === 'shuffle' && mode.pick.kind === 'rotate' && !(Number.isInteger(mode.pick.by) && mode.pick.by >= 1 && mode.pick.by <= 15)) {
      return 'Rotate is by 1 to 15';
    }
    return null;
  }
  if (isStepEffect(effect)) return STEP_SIZES[effect.step] === undefined ? 'A step is 1/16, a beat or a bar' : (laneProblem(effect) ?? audioSettingsProblem(effect));
  if (effect.target === 'halftime') return (HALFTIME_SPEEDS as readonly number[]).includes(effect.speed) ? null : 'Halftime’s speed is ×0.5, ×0.75 or ×2';
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
    setMod(project, { id: ctx.newId(), name, effects, seed: ctx.newSeed() });

/** A copy of a mod, named "<name> copy", with an id and a seed of its own. */
export const cloneMod =
  (id: Id): Command =>
  (project, ctx) => {
    const mod = project.mods[id];
    return mod === undefined ? notFound(id) : setMod(project, { ...mod, id: ctx.newId(), name: `${mod.name} copy`, seed: ctx.newSeed() });
  };

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

/** Changes the tempo. Hits laid out by how long they sound take other steps, and own loops follow. */
export const setBpm = (bpm: number): Command =>
  following((project) => (bpm > 0 ? ok(setSong(project, { ...project.song, bpm })) : invalid('BPM must be positive')));

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

/**
 * Turns the song's loop on or off, keeping where it is. With no loop marked,
 * the whole song is the loop: on loops it all, off leaves it unmarked.
 */
export const setSongLoopOn =
  (on: boolean): Command =>
  (project) => {
    const loop = project.song.loop;
    if (loop == null) {
      if (!on) return ok(project);
      return ok(setSong(project, { ...project.song, loop: { start: 0, end: project.song.bars * STEPS_PER_BAR, on } }));
    }
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
  matrix: 'matrices',
  hit: 'hits',
  pad: 'pads',
  loop: 'loops',
  mod: 'mods',
} as const satisfies Record<ReferableKind, keyof Project>;

/** Removes an object as `removeAnyway` does. Fails, listing where it is used, if anything refers to it. */
export const remove =
  (kind: ReferableKind, id: Id): Command =>
  (project, ctx) => {
    if (project[collection[kind]][id] === undefined) return notFound(id);
    const usages = findUsages(project, kind, id);
    if (usages.length > 0) return fail({ kind: 'in-use', usages });
    return removeAnyway(kind, id)(project, ctx);
  };

/**
 * Removes an object even where it is used, which goes silent (`dropParts`):
 * a pad leaves its matrix with its hits, a hit its pad, steps with the pad are
 * emptied and steps locked to the hit fall back to member 1, and clips of the
 * loop or mod leave the song. A matrix takes its pads and hits, not its loop or
 * samples (decision 9); a sample as `removeSample`.
 */
export const removeAnyway = (kind: ReferableKind, id: Id): Command => (kind === 'sample' ? removeSample(id) : following(removeOther(kind, id)));

/** `removeAnyway` of anything but a sample (which follows by itself), without following. */
const removeOther =
  (kind: Exclude<ReferableKind, 'sample'>, id: Id): Command =>
  (project) => {
    const key = collection[kind];
    if (project[key][id] === undefined) return notFound(id);
    const none = new Set<Id>();
    switch (kind) {
      case 'matrix':
        return ok(dropMatrix(project, id));
      case 'pad':
        return ok(dropParts(project, { pads: new Set([id]), hits: none, loop: null }));
      case 'hit':
        return ok(dropParts(project, { pads: none, hits: new Set([id]), loop: null }));
      case 'loop':
        return ok(dropParts(project, { pads: none, hits: none, loop: id }));
      case 'mod':
        return ok({ ...project, mods: without(project.mods, id), song: { ...project.song, clips: project.song.clips.filter((c) => c.ref !== id) } });
    }
  };

/** Swaps in a whole project, as when opening a project file. Undo brings the old one back. */
export const replaceProject =
  (next: Project): Command =>
  () =>
    ok(next);
