import type { Command, CommandContext } from './command';
import { ok } from './command';
import { ownMatrix, remakeOwnMatrix, setHitSource } from './chain';
import { addClip, pasteClip } from './clips';
import { addVariant, setPadChoice, setSongBars, updateHit } from './commands';
import { matrixSequence } from './lengths';
import { MOD_PRESETS, addMissingPresets } from './presets';
import type { PresetStrength } from './presets';
import { DEFAULT_SONG_BARS, emptyStep, nextLoopName, recipeSeedOf } from './project';
import { seedOf } from './seed';
import type { Clip, Config, Id, Loop, LoopKind, Mode, Project, Rng, SongRow, Step } from './types';
import { STEPS_PER_BAR } from './types';

/**
 * Crazy madness (see the spec's Crazy madness): when a break is sliced the
 * first time, the app builds all the way to Song after the song's recipe, with
 * ordinary commands in one undo step. The recipe is hidden: a seed in the
 * project (`recipeSeed`), from which a variant of each rule is rolled.
 */

// Randomness: all of it from the recipe's seed and what is rolled, never Math.random.

/** One 32-bit number from many, each changing it all through (murmur3's mixing). */
function mix(values: readonly number[]): number {
  let h = 0x9e3779b9 ^ values.length;
  for (const value of values) {
    let k = Math.imul(value >>> 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32: 0 ≤ x < 1. */
function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The Rng for what is rolled: the recipe's seed and keys (names and numbers, such as a break's place). */
export const recipeRng = (seed: number, ...keys: readonly (string | number)[]): Rng =>
  mulberry(mix([seed, ...keys.map((k) => (typeof k === 'string' ? seedOf(k) : k))]));

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// The recipe

/** The rules and their variants, in the spec's order (see Recept). */
export const RECIPE_RULES = {
  /** Varannan, Första main, Blandat. */
  role: ['alternate', 'firstMain', 'mixed'],
  /** Korta mains, Tre fills, Var 8:e. */
  form: ['shortMains', 'threeFills', 'everyEighth'],
  /** Omkastad, Slutet, Hackad. */
  fill: ['shuffled', 'end', 'chopped'],
  /** Få, Många, Vilda. */
  variants: ['few', 'many', 'wild'],
  /** Extrem och subtila, Många små, En stor. */
  mods: ['extremeAndSubtle', 'manySmall', 'oneBig'],
  /** Mod på slutet, Tape stop, Inget särskilt. */
  end: ['modAtEnd', 'tapeStop', 'nothing'],
  /** Samma stil, Egen stil. */
  newBreaks: ['sameStyle', 'ownStyle'],
} as const;

type Rules = typeof RECIPE_RULES;
/** A variant of each rule. */
export type Recipe = { readonly [K in keyof Rules]: Rules[K][number] };

/** Hit-variantens sort, rolled per variant: Ändrad, Annan, Baklänges. */
export const VARIANT_SORTS = ['changed', 'other', 'reversed'] as const;
export type VariantSort = (typeof VARIANT_SORTS)[number];

const rollRule = <K extends keyof Rules>(rule: K, rng: Rng): Recipe[K] => pick(RECIPE_RULES[rule], rng) as Recipe[K];

/** The recipe of a seed: a variant per rule, rolled from the seed and the rule's name. */
export function rollRecipe(seed: number): Recipe {
  const roll = <K extends keyof Rules>(rule: K) => rollRule(rule, recipeRng(seed, rule));
  return { role: roll('role'), form: roll('form'), fill: roll('fill'), variants: roll('variants'), mods: roll('mods'), end: roll('end'), newBreaks: roll('newBreaks') };
}

/**
 * The fill loop and hit variants of the break at `place` (0 the first): the
 * recipe's, or with Egen stil for a later break its own, rolled from its place.
 */
export function styleAt(recipe: Recipe, seed: number, place: number): Pick<Recipe, 'fill' | 'variants'> {
  if (recipe.newBreaks === 'sameStyle' || place === 0) return { fill: recipe.fill, variants: recipe.variants };
  return { fill: rollRule('fill', recipeRng(seed, 'fill', place)), variants: rollRule('variants', recipeRng(seed, 'variants', place)) };
}

/** Whether the break at `place` is a main or a fill (Roll); with no main before it, always a main. */
export function roleAt(recipe: Recipe, seed: number, place: number, mainBefore: boolean): LoopKind {
  if (!mainBefore) return 'main';
  switch (recipe.role) {
    case 'alternate':
      return place % 2 === 0 ? 'main' : 'fill';
    case 'firstMain':
      return 'fill';
    case 'mixed':
      return recipeRng(seed, 'role', place)() < 0.5 ? 'main' : 'fill';
  }
}

/** The bars of a 16-bar section (from 0) that play the fill loop (Form). */
export function fillBars(form: Recipe['form'], rng: Rng): number[] {
  switch (form) {
    case 'threeFills':
      return [7, 11, 15];
    case 'everyEighth':
      return [7, 15];
    case 'shortMains': {
      const fills: number[] = [];
      let at = 0;
      for (;;) {
        at += 1 + Math.floor(rng() * 3);
        if (at >= 16) return fills;
        fills.push(at);
        at += 1;
        if (at >= 16) return fills;
      }
    }
  }
}

const padStep = (padId: Id | null): Step => (padId === null ? emptyStep : { ...emptyStep, padId });

/** A fill loop's steps made of a matrix's pads (Fill-loopen). */
export function fillSteps(project: Project, matrixId: Id, fill: Recipe['fill'], rng: Rng): Step[] {
  const sequence = matrixSequence(project, matrixId);
  const pads = sequence.map((s) => s.padId);
  if (pads.length === 0) return [];
  switch (fill) {
    case 'shuffled': {
      const order = shuffled(pads, rng);
      return Array.from({ length: STEPS_PER_BAR }, (_, i) => padStep(order[i % order.length]!));
    }
    case 'end': {
      const length = 8;
      const end = sequence.at(-1)!.step + sequence.at(-1)!.length;
      const from = Math.max(0, end - length);
      const steps: Step[] = Array.from({ length }, () => emptyStep);
      for (const s of sequence) {
        if (s.step >= from && s.step < end) steps[s.step - from] = padStep(s.padId);
        // The pad sounding where the two beats begin starts them.
        else if (s.step < from && s.step + s.length > from) steps[0] = padStep(s.padId);
      }
      return steps;
    }
    case 'chopped': {
      const empty = new Set(shuffled(Array.from({ length: STEPS_PER_BAR }, (_, i) => i), rng).slice(0, STEPS_PER_BAR / 4));
      return Array.from({ length: STEPS_PER_BAR }, (_, i) => padStep(empty.has(i) ? null : pick(pads, rng)));
    }
  }
}

/** How many variants each of `pads` pads gets (Hit-varianter). */
export function variantCounts(variants: Recipe['variants'], pads: number, rng: Rng): number[] {
  switch (variants) {
    case 'few': {
      const first = Math.floor(rng() * 4);
      return Array.from({ length: pads }, (_, i) => (i >= first && (i - first) % 4 === 0 ? 1 : 0));
    }
    case 'many':
      return Array.from({ length: pads }, () => 1);
    case 'wild':
      return Array.from({ length: pads }, () => 2 + Math.floor(rng() * 2));
  }
}

/** How much Ändrad changes at most: 40 %. */
const MAX_CHANGE = 0.4;
const CHANGES = ['pitch', 'volume', 'filter', 'dist', 'stretch'] as const;

/**
 * What Ändrad changes in a hit: 1–3 of pitch, volume, filter, dist and stretch,
 * each by up to 40 % (Claudes val of what 40 % is): pitch up to 40 % of an
 * octave, in whole semitones; volume up to 40 % up or down in level; a low- or
 * high-pass up to 40 % of the way in from its open end (on a log scale); dist
 * of any mode at up to 40 %; stretch by a factor up to 40 % longer or shorter.
 */
function changedPatch(hit: Config, rng: Rng): Partial<Config> {
  const count = 1 + Math.floor(rng() * 3);
  const patch: { -readonly [K in keyof Config]?: Config[K] } = {};
  for (const what of shuffled(CHANGES, rng).slice(0, count)) {
    const r = MAX_CHANGE * (1 - rng());
    const sign = rng() < 0.5 ? -1 : 1;
    switch (what) {
      case 'pitch':
        patch.pitch = hit.pitch + sign * Math.max(1, Math.round(r * 12));
        break;
      case 'volume':
        patch.volume = hit.volume + 20 * Math.log10(1 + sign * r);
        break;
      case 'filter':
        patch.filter =
          sign < 0 ? { type: 'lowpass', cutoff: Math.round(20000 * (20 / 20000) ** r), resonance: 0.2 } : { type: 'highpass', cutoff: Math.round(20 * 1000 ** r), resonance: 0.2 };
        break;
      case 'dist':
        patch.dist = { mode: pick(['drive', 'crush', 'decimate'] as const, rng), amount: r };
        break;
      case 'stretch':
        patch.stretch = { mode: 'factor', factor: 1 + sign * r, grain: null, from: null };
        break;
    }
  }
  return patch;
}

/** Where Annan may take a hit from: every slice of a sliced sample, a one-shot whole; not the slice the pad plays. */
function otherSources(project: Project, sampleId: Id, slice: number | null): { sampleId: Id; slices: (number | null)[] }[] {
  return Object.values(project.samples)
    .map((s) => ({
      sampleId: s.id,
      slices: (s.bars === null ? [null] : s.markers.map((_, i) => i)).filter((n) => !(s.id === sampleId && n === slice)),
    }))
    .filter((s) => s.slices.length > 0);
}

const must = (result: ReturnType<Command>): Project => {
  if (!result.ok) throw new Error(`Crazy madness: ${JSON.stringify(result.error)}`);
  return result.project;
};

/**
 * A hit variant of pad `padId` of sort `sort`, added last to it with the
 * ordinary commands, and the pad picks Random. Its first hit stays, so how the
 * matrix is laid out does not change.
 */
export function makeVariant(project: Project, padId: Id, sort: VariantSort, rng: Rng, ctx: CommandContext): Project {
  const pad = project.pads[padId];
  const top = pad?.members[0] === undefined ? undefined : project.hits[pad.members[0]];
  if (pad === undefined || top === undefined) return project;
  let next = must(addVariant(top.id)(project, ctx));
  const id = next.pads[padId]!.members.at(-1)!;
  switch (sort) {
    case 'changed':
      next = must(updateHit(id, changedPatch(top, rng))(next, ctx));
      break;
    case 'reversed':
      next = must(updateHit(id, { direction: top.direction === 'reverse' ? 'forward' : 'reverse' })(next, ctx));
      break;
    case 'other': {
      const sources = otherSources(next, top.sampleId, top.slice);
      if (sources.length === 0) break;
      const source = pick(sources, rng);
      next = must(setHitSource(id, source.sampleId, pick(source.slices, rng))(next, ctx));
      break;
    }
  }
  return pad.choice === 'random' ? next : must(setPadChoice(padId, 'random')(next, ctx));
}

/** A mod clip to lay out in a section: how hard, its first bar (from 0) and how many bars. */
export interface ModPlace {
  readonly strength: PresetStrength;
  readonly bar: number;
  readonly bars: number;
}

/** Where the mods of a section go (Mods): on whole bars, the subtle ones not on fill bars. */
export function modPlan(mods: Recipe['mods'], fills: readonly number[], rng: Rng): ModPlace[] {
  const free = (bar: number) => !fills.includes(bar);
  switch (mods) {
    case 'extremeAndSubtle': {
      const plan: ModPlace[] = [{ strength: 'extreme', bar: Math.floor(rng() * 16), bars: 1 }];
      const used = new Set<number>();
      let total = 0;
      while (total < 4) {
        const bars = 4 - total >= 2 && rng() < 0.5 ? 2 : 1;
        total += bars;
        const starts = Array.from({ length: 17 - bars }, (_, b) => b).filter((b) => Array.from({ length: bars }, (_, k) => b + k).every((x) => free(x) && !used.has(x)));
        if (starts.length === 0) continue;
        const bar = pick(starts, rng);
        for (let k = 0; k < bars; k++) used.add(bar + k);
        plan.push({ strength: 'subtle', bar, bars });
      }
      return plan;
    }
    case 'manySmall': {
      const phase = Math.floor(rng() * 2);
      return Array.from({ length: 16 }, (_, b) => b).flatMap((bar) => (bar % 2 === phase && free(bar) ? [{ strength: 'subtle' as const, bar, bars: 1 }] : []));
    }
    case 'oneBig':
      return [{ strength: 'extreme', bar: Math.floor(rng() * 15), bars: 2 }];
  }
}

// Building a break into the project

/** The project's presets of a strength, in the order of the app's presets. */
function presetsOf(project: Project, strength: PresetStrength): Id[] {
  const byName = new Map(Object.values(project.mods).flatMap((m) => (m.isPreset === true ? [[m.name, m.id] as const] : [])));
  return MOD_PRESETS.flatMap((p) => (p.strength === strength && byName.has(p.name) ? [byName.get(p.name)!] : []));
}

const overlaps = (c: Clip, row: SongRow, start: number, length: number) => c.row === row && c.start < start + length && start < c.start + c.length;

/** Lays a mod out in Mod A, or in Mod B where one is already in Mod A; where both are taken, not at all. */
function placeMod(project: Project, modId: Id | undefined, start: number, length: number, ctx: CommandContext): Project {
  if (modId === undefined) return project;
  const row = (['modA', 'modB'] as const).find((r) => !project.song.clips.some((c) => overlaps(c, r, start, length)));
  return row === undefined ? project : must(addClip(row, modId, start, length)(project, ctx));
}

/** The sliced samples whose own matrix has its loop: the breaks, in the samples' order. */
function breaksIn(project: Project): Id[] {
  return Object.values(project.samples).flatMap((s) => {
    const loop = s.bars === null ? null : ownMatrix(project, s.id)?.loop;
    return loop != null && project.loops[loop] !== undefined ? [s.id] : [];
  });
}

/** The fill loop made of a break's pads: one tagged fill whose steps play only them. */
function fillLoopOf(project: Project, sampleId: Id): Id | undefined {
  const pads = new Set(ownMatrix(project, sampleId)?.pads ?? []);
  const loops = Object.values(project.loops).filter((l) => l.kind === 'fill' && l.steps.some((s) => s.padId !== null) && l.steps.every((s) => s.padId === null || pads.has(s.padId)));
  return loops.at(-1)?.id;
}

/** A new fill loop of a break's pads, as Fill-loopen says, and its id; none when the break has no pads to play. */
function addFillLoop(project: Project, matrixId: Id, fill: Recipe['fill'], rng: Rng, ctx: CommandContext): { project: Project; id: Id | undefined } {
  const steps = fillSteps(project, matrixId, fill, rng);
  if (steps.length === 0) return { project, id: undefined };
  const loop: Loop = { id: ctx.newId(), name: nextLoopName(project, 'fill'), kind: 'fill', steps };
  return { project: { ...project, loops: { ...project.loops, [loop.id]: loop } }, id: loop.id };
}

/** Where a new section starts: after the last clip, at the next whole bar. */
const sectionStart = (project: Project): number =>
  Math.ceil(Math.max(0, ...project.song.clips.map((c) => c.start + c.length)) / STEPS_PER_BAR) * STEPS_PER_BAR;

const SECTION_BARS = 16;

/**
 * Builds the break of `sampleId` (sliced, its own matrix with its loop) into
 * the project after `recipe`, as the break at its place after `earlier`.
 * Only adds: hit variants in its matrix, maybe a fill loop, and a section of 16
 * bars last in Song with its mods and end (see Hur ett break fogas in).
 */
function build(project: Project, sampleId: Id, earlier: readonly Id[], recipe: Recipe, seed: number, ctx: CommandContext): Project {
  const matrix = ownMatrix(project, sampleId);
  if (matrix?.loop == null || project.loops[matrix.loop] === undefined) return project;
  const place = earlier.length;
  const style = styleAt(recipe, seed, place);

  // The breaks before: their roles, and the latest main and fill break.
  const roles: LoopKind[] = [];
  for (let i = 0; i < earlier.length; i++) roles.push(roleAt(recipe, seed, i, roles.includes('main')));
  const lastOf = (kind: LoopKind) => earlier.filter((_, i) => roles[i] === kind).findLast((id) => kind === 'fill' || ownMatrix(project, id)?.loop != null);
  const latestMain = lastOf('main');
  const mainLoop = latestMain === undefined ? undefined : ownMatrix(project, latestMain)!.loop!;
  const role = mainLoop === undefined || project.loops[mainLoop] === undefined ? 'main' : roleAt(recipe, seed, place, true);

  // Hit variants in the break's matrix.
  let next = project;
  const pads = matrix.pads.filter((id) => (project.pads[id]?.members.length ?? 0) > 0);
  const counts = variantCounts(style.variants, pads.length, recipeRng(seed, place, 'variants'));
  pads.forEach((padId, i) => {
    for (let k = 0; k < counts[i]!; k++) {
      const sort = pick(VARIANT_SORTS, recipeRng(seed, place, 'sort', i, k));
      next = makeVariant(next, padId, sort, recipeRng(seed, place, 'variant', i, k), ctx);
    }
  });

  // The loops of the section.
  const fillRng = recipeRng(seed, place, 'fill');
  let main: Id;
  let fill: Id | undefined;
  if (role === 'main') {
    main = matrix.loop;
    const latestFill = lastOf('fill');
    fill = latestFill === undefined ? undefined : fillLoopOf(next, latestFill);
    if (fill === undefined) ({ project: next, id: fill } = addFillLoop(next, matrix.id, style.fill, fillRng, ctx));
  } else {
    main = mainLoop!;
    ({ project: next, id: fill } = addFillLoop(next, matrix.id, style.fill, fillRng, ctx));
  }

  // The section: the main where Form has none of its fill bars, keeping time, and the fill loop in them.
  const start = sectionStart(next);
  next = must(setSongBars(Math.max(next.song.bars, start / STEPS_PER_BAR + SECTION_BARS))(next, ctx));
  const fills = fill === undefined ? [] : fillBars(recipe.form, recipeRng(seed, place, 'form'));
  let run = 0;
  for (let b = 0; b <= SECTION_BARS; b++) {
    if (b < SECTION_BARS && !fills.includes(b)) continue;
    if (b > run) {
      const clip: Clip = { id: '', row: 'main', ref: main, start: start + run * STEPS_PER_BAR, length: (b - run) * STEPS_PER_BAR, offset: run * STEPS_PER_BAR, seed: ctx.newSeed() };
      next = must(pasteClip(clip, 'main', clip.start)(next, ctx));
    }
    if (b < SECTION_BARS) next = must(addClip('fill', fill!, start + b * STEPS_PER_BAR, STEPS_PER_BAR)(next, ctx));
    run = b + 1;
  }

  // The end first, then the mods: each in Mod A, or Mod B where Mod A is taken.
  const modRng = recipeRng(seed, place, 'mods');
  const bars = (bar: number) => start + bar * STEPS_PER_BAR;
  if (recipe.end === 'modAtEnd') next = placeMod(next, pickOr(presetsOf(next, 'extreme'), modRng), bars(14), 2 * STEPS_PER_BAR, ctx);
  if (recipe.end === 'tapeStop') next = placeMod(next, Object.values(next.mods).find((m) => m.isPreset === true && m.name === 'Tape stop')?.id, bars(15), STEPS_PER_BAR, ctx);
  for (const m of modPlan(recipe.mods, fills, modRng)) next = placeMod(next, pickOr(presetsOf(next, m.strength), modRng), bars(m.bar), m.bars * STEPS_PER_BAR, ctx);
  return next;
}

const pickOr = <T>(items: readonly T[], rng: Rng): T | undefined => (items.length === 0 ? undefined : pick(items, rng));

const seedFor = (project: Project): number => project.recipeSeed ?? recipeSeedOf(project);

/**
 * Builds a sliced break into the project as Crazy does when it is sliced the
 * first time: after the song's recipe, or `recipe` (for tests), as the break
 * after the others that are sliced.
 */
export const crazyBuild =
  (sampleId: Id, recipe?: Recipe): Command =>
  (project, ctx) => {
    const seed = seedFor(project);
    const earlier = breaksIn(project).filter((id) => id !== sampleId);
    return ok(build(project, sampleId, earlier, recipe ?? rollRecipe(seed), seed, ctx));
  };

/**
 * The samples a command sliced the first time: their own matrix got its loop
 * in it (a matrix that was there, or one with a new sample, as a REX file).
 * A matrix moved to a new trim keeps its loop, and Go crazy's new matrices are
 * of samples that were there, so neither counts.
 */
function slicedNow(before: Project, after: Project): Id[] {
  return breaksIn(after).filter((id) => {
    const matrix = ownMatrix(after, id)!;
    return !(matrix.loop! in before.loops) && (matrix.id in before.matrices || !(id in before.samples));
  });
}

/**
 * A command, and in Crazy madness what Crazy builds of each trim it sliced the
 * first time, in the same command, so one Undo takes it all away. In Total
 * control the command as it is.
 */
export const crazyChain =
  (command: Command): Command =>
  (project, ctx) => {
    const result = command(project, ctx);
    if (!result.ok || result.project.mode !== 'crazy') return result;
    return ok(slicedNow(project, result.project).reduce((next, id) => must(crazyBuild(id)(next, ctx)), result.project));
  };

/** Switches between Total control and Crazy madness: what is built by itself when a break is sliced. */
export const setMode =
  (mode: Mode): Command =>
  (project) =>
    ok({ ...project, mode });

/**
 * Go crazy: matrices, loops, mods and the song go, the presets are made anew,
 * and everything is built again with a new recipe, as if each sliced trim were
 * sliced now, in the samples' order. Samples and mods of one's own stay. One command.
 */
export const goCrazy =
  (): Command =>
  (project, ctx) => {
    const seed = ctx.newSeed();
    const mods = Object.fromEntries(Object.entries(project.mods).filter(([, m]) => m.isPreset !== true));
    let next: Project = addMissingPresets(
      { ...project, recipeSeed: seed, matrices: {}, pads: {}, hits: {}, loops: {}, mods, song: { bpm: project.song.bpm, bars: DEFAULT_SONG_BARS, clips: [], loop: null } },
      ctx,
    );
    for (const id of Object.keys(next.samples)) next = remakeOwnMatrix(next, id, ctx);
    const breaks = breaksIn(next);
    const recipe = rollRecipe(seed);
    breaks.forEach((id, i) => {
      next = build(next, id, breaks.slice(0, i), recipe, seed, ctx);
    });
    return ok(next);
  };
