import { describe, expect, it } from 'vitest';
import { constantAudio, seededRng, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext } from './command';
import { addSample, addSlicedSample, ownMatrix, setSampleBars, setSlicing } from './chain';
import { createMod } from './commands';
import type { Recipe } from './crazy';
import {
  RECIPE_RULES,
  VARIANT_SORTS,
  crazyBuild,
  crazyChain,
  fillBars,
  fillSteps,
  goCrazy,
  makeVariant,
  modPlan,
  rollRecipe,
  roleAt,
  setMode,
  styleAt,
  variantCounts,
} from './crazy';
import { apply, createHistory, undo } from './history';
import { newStepEffect } from './lanes';
import { MOD_PRESETS } from './presets';
import { createProject, newProject, upgradeProject } from './project';
import type { Hit, Id, Mode, Project, SongRow } from './types';
import { STEPS_PER_BAR } from './types';

const run = (project: Project, command: Command, ctx: CommandContext = sequentialIds()): Project => {
  const result = command(project, ctx);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.project;
};

/** A recipe with every rule at its first variant, but for `patch`. */
const recipe = (patch: Partial<Recipe> = {}): Recipe => ({
  role: 'alternate',
  form: 'everyEighth',
  fill: 'shuffled',
  variants: 'few',
  mods: 'oneBig',
  end: 'nothing',
  newBreaks: 'sameStyle',
  ...patch,
});

const strength = (name: string) => MOD_PRESETS.find((p) => p.name === name)?.strength;

/** A project in `mode` with a file of `slices` equal slices over `bars` bars, sliced or not; its sample id. */
function withBreak(ctx: CommandContext, { mode = 'crazy' as Mode, slices = 16, bars = 1, name = 'amen.wav', project = undefined as Project | undefined } = {}) {
  const start = run(project ?? { ...newProject(ctx), mode }, addSample({ name, audio: constantAudio(2 * bars) }), ctx);
  const sampleId = Object.keys(start.samples).find((id) => project?.samples[id] === undefined)!;
  const markers = Array.from({ length: slices }, (_, i) => i / slices);
  return { start, sampleId, markers };
}

/** Slices a sample as Samples does, through the crazy chain. */
const slice = (project: Project, sampleId: Id, markers: readonly number[], bars: number, ctx: CommandContext): Project =>
  run(project, crazyChain(setSlicing(sampleId, bars, markers)), ctx);

/** The song as rows, starts, lengths, offsets and names: what a build lays out, without ids or seeds. */
const shape = (project: Project) =>
  project.song.clips
    .map((c) => ({
      row: c.row,
      start: c.start,
      length: c.length,
      offset: c.offset,
      name: (c.row === 'main' || c.row === 'fill' ? project.loops[c.ref]?.name : project.mods[c.ref]?.name) ?? '?',
    }))
    .sort((a, b) => a.start - b.start || a.row.localeCompare(b.row));

const clipsIn = (project: Project, row: SongRow) => project.song.clips.filter((c) => c.row === row).sort((a, b) => a.start - b.start);
const bar = (step: number) => step / STEPS_PER_BAR;

describe('the mode', () => {
  it('is Crazy madness in a new project, with a recipe seed', () => {
    const project = newProject(sequentialIds());
    expect(project.mode).toBe('crazy');
    expect(Number.isInteger(project.recipeSeed)).toBe(true);
  });

  it('is Total control in an old project, which gets the same recipe seed every time it is loaded', () => {
    const old = { ...createProject() } as Project;
    const a = upgradeProject(old, sequentialIds())!;
    const b = upgradeProject(old, sequentialIds())!;
    expect(a.mode).toBe('total');
    expect(a.recipeSeed).toBe(b.recipeSeed);
    expect(upgradeProject({ ...old, mode: 'crazy', recipeSeed: 7 }, sequentialIds())!).toMatchObject({ mode: 'crazy', recipeSeed: 7 });
  });

  it('is switched by a command that Undo takes back', () => {
    const project = newProject(sequentialIds());
    const switched = apply(createHistory(project), setMode('total'));
    expect(switched.ok && switched.history.present.mode).toBe('total');
    expect(switched.ok && undo(switched.history).present.mode).toBe('crazy');
  });
});

describe('the recipe', () => {
  it('is rolled from the seed alone: the same seed gives the same recipe', () => {
    expect(rollRecipe(1234)).toEqual(rollRecipe(1234));
  });

  it('picks every variant of every rule for some seed', () => {
    const recipes = Array.from({ length: 300 }, (_, i) => rollRecipe(i * 7919));
    for (const [rule, variants] of Object.entries(RECIPE_RULES)) {
      const seen = new Set(recipes.map((r) => r[rule as keyof Recipe]));
      expect([...seen].sort()).toEqual([...variants].sort());
    }
  });

  it('each rule is rolled from its name: two seeds rarely give the same recipe', () => {
    const recipes = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(rollRecipe(i))));
    expect(recipes.size).toBeGreaterThan(30);
  });
});

describe('Roll', () => {
  const roles = (r: Recipe, seed: number, n: number) => {
    const out: string[] = [];
    for (let place = 0; place < n; place++) out.push(roleAt(r, seed, place, out.includes('main')));
    return out;
  };

  it('Varannan: main, fill, main, fill …', () => {
    expect(roles(recipe({ role: 'alternate' }), 1, 5)).toEqual(['main', 'fill', 'main', 'fill', 'main']);
  });

  it('Första main: the first main, all after it fills', () => {
    expect(roles(recipe({ role: 'firstMain' }), 1, 4)).toEqual(['main', 'fill', 'fill', 'fill']);
  });

  it('Blandat: the first always main, the rest about half each', () => {
    const all = Array.from({ length: 40 }, (_, seed) => roles(recipe({ role: 'mixed' }), seed, 10));
    expect(all.every((r) => r[0] === 'main')).toBe(true);
    const later = all.flatMap((r) => r.slice(1));
    const mains = later.filter((r) => r === 'main').length / later.length;
    expect(mains).toBeGreaterThan(0.35);
    expect(mains).toBeLessThan(0.65);
  });

  it('a break is main when there is no main yet', () => {
    expect(roleAt(recipe({ role: 'firstMain' }), 1, 3, false)).toBe('main');
  });
});

describe('Form', () => {
  it('Tre fills: fills on bars 8, 12 and 16', () => {
    expect(fillBars('threeFills', seededRng(1))).toEqual([7, 11, 15]);
  });

  it('Var 8:e: fills on bars 8 and 16', () => {
    expect(fillBars('everyEighth', seededRng(1))).toEqual([7, 15]);
  });

  it('Korta mains: mains of 1–3 bars with a fill bar between, up to 16', () => {
    for (let seed = 0; seed < 30; seed++) {
      const fills = fillBars('shortMains', seededRng(seed));
      expect(fills.length).toBeGreaterThan(0);
      expect(fills.every((b) => b >= 1 && b < 16)).toBe(true);
      // The mains between: 1–3 bars each.
      const edges = [-1, ...fills];
      for (let i = 1; i < edges.length; i++) {
        expect(edges[i]! - edges[i - 1]! - 1).toBeGreaterThanOrEqual(1);
        expect(edges[i]! - edges[i - 1]! - 1).toBeLessThanOrEqual(3);
      }
      expect(15 - fills.at(-1)!).toBeLessThanOrEqual(3);
    }
  });
});

describe('the fill loop', () => {
  const ctx = sequentialIds();
  const { start, sampleId, markers } = withBreak(ctx, { mode: 'total', slices: 8, bars: 1 });
  const project = run(start, setSlicing(sampleId, 1, markers), ctx);
  const matrix = ownMatrix(project, sampleId)!;
  const pads = new Set(matrix.pads);

  it('Omkastad: a bar of the break’s pads in a random order on every 1/16', () => {
    const steps = fillSteps(project, matrix.id, 'shuffled', seededRng(3));
    expect(steps).toHaveLength(16);
    expect(steps.every((s) => s.padId !== null && pads.has(s.padId))).toBe(true);
    // Each pad once before any comes again.
    expect(new Set(steps.slice(0, 8).map((s) => s.padId)).size).toBe(8);
    expect(steps.slice(0, 8).map((s) => s.padId)).not.toEqual(matrix.pads);
  });

  it('Slutet: two beats, the break’s last pads where they play', () => {
    const steps = fillSteps(project, matrix.id, 'end', seededRng(3));
    expect(steps).toHaveLength(8);
    // 8 pads over a bar: each takes 2 steps, so the last four pads are on steps 0, 2, 4 and 6.
    expect(steps.map((s) => s.padId)).toEqual([matrix.pads[4], null, matrix.pads[5], null, matrix.pads[6], null, matrix.pads[7], null]);
  });

  it('Hackad: a bar where each step plays a random pad and a quarter are empty', () => {
    for (let seed = 0; seed < 10; seed++) {
      const steps = fillSteps(project, matrix.id, 'chopped', seededRng(seed));
      expect(steps).toHaveLength(16);
      expect(steps.filter((s) => s.padId === null)).toHaveLength(4);
      expect(steps.every((s) => s.padId === null || pads.has(s.padId))).toBe(true);
    }
  });
});

describe('hit variants', () => {
  it('Få: every fourth pad gets a variant', () => {
    const counts = variantCounts('few', 16, seededRng(2));
    expect(counts.filter((n) => n === 1)).toHaveLength(4);
    expect(counts.filter((n) => n === 0)).toHaveLength(12);
    const first = counts.indexOf(1);
    expect(counts.every((n, i) => n === ((i - first) % 4 === 0 && i >= first ? 1 : 0))).toBe(true);
  });

  it('Många: every pad gets a variant', () => {
    expect(variantCounts('many', 5, seededRng(2))).toEqual([1, 1, 1, 1, 1]);
  });

  it('Vilda: every pad gets two or three', () => {
    const counts = variantCounts('wild', 40, seededRng(2));
    expect(counts.every((n) => n === 2 || n === 3)).toBe(true);
    expect(new Set(counts).size).toBe(2);
  });

  const ctx = sequentialIds();
  const first = withBreak(ctx, { mode: 'total', slices: 4 });
  const sliced = run(first.start, setSlicing(first.sampleId, 1, first.markers), ctx);
  const other = withBreak(ctx, { mode: 'total', slices: 4, name: 'think.wav', project: sliced });
  const project = run(other.start, setSlicing(other.sampleId, 1, other.markers), ctx);
  const matrix = ownMatrix(project, first.sampleId)!;
  const padId = matrix.pads[1]!;
  const top = project.hits[project.pads[padId]!.members[0]!]!;
  const variant = (sort: (typeof VARIANT_SORTS)[number], seed: number): Hit => {
    const made = makeVariant(project, padId, sort, seededRng(seed), ctx);
    return made.hits[made.pads[padId]!.members.at(-1)!]!;
  };

  it('Ändrad: the same slice with 1–3 of pitch, volume, filter, dist and stretch changed up to 40 %', () => {
    for (let seed = 0; seed < 30; seed++) {
      const v = variant('changed', seed);
      expect([v.sampleId, v.slice, v.variantOf]).toEqual([top.sampleId, top.slice, top.id]);
      const changed = [v.pitch !== top.pitch, v.volume !== top.volume, v.filter !== top.filter, v.dist !== top.dist, v.stretch !== top.stretch].filter(Boolean).length;
      expect(changed).toBeGreaterThanOrEqual(1);
      expect(changed).toBeLessThanOrEqual(3);
      expect(Math.abs(v.pitch)).toBeLessThanOrEqual(5);
      expect(v.volume).toBeGreaterThanOrEqual(20 * Math.log10(0.6) - 1e-9);
      expect(v.volume).toBeLessThanOrEqual(20 * Math.log10(1.4) + 1e-9);
      expect(v.dist.mode === 'off' || v.dist.amount <= 0.4).toBe(true);
      expect(v.stretch.mode === 'off' || (v.stretch.factor >= 0.6 && v.stretch.factor <= 1.4)).toBe(true);
    }
  });

  it('Annan: another slice of the same break, or of another break or a one-shot', () => {
    const made = Array.from({ length: 30 }, (_, seed) => variant('other', seed));
    expect(made.every((v) => !(v.sampleId === top.sampleId && v.slice === top.slice))).toBe(true);
    expect(made.some((v) => v.sampleId === top.sampleId)).toBe(true);
    expect(made.some((v) => v.sampleId === other.sampleId)).toBe(true);
  });

  it('Baklänges: the same slice backwards', () => {
    const v = variant('reversed', 1);
    expect([v.sampleId, v.slice, v.direction, v.variantOf]).toEqual([top.sampleId, top.slice, 'reverse', top.id]);
  });

  it('a pad with variants picks Random, and its first hit stays, so the break’s loop does not change', () => {
    const made = makeVariant(project, padId, 'reversed', seededRng(1), ctx);
    expect(made.pads[padId]!.choice).toBe('random');
    expect(made.pads[padId]!.members[0]).toBe(top.id);
    expect(made.loops).toBe(project.loops);
  });
});

describe('mods', () => {
  const fills = [7, 15];

  it('Extrem och subtila: an extreme mod for a bar and subtle mods on 4 bars, not on fill bars', () => {
    for (let seed = 0; seed < 20; seed++) {
      const plan = modPlan('extremeAndSubtle', fills, seededRng(seed));
      const extreme = plan.filter((p) => p.strength === 'extreme');
      const subtle = plan.filter((p) => p.strength === 'subtle');
      expect(extreme.map((p) => p.bars)).toEqual([1]);
      expect(subtle.reduce((n, p) => n + p.bars, 0)).toBe(4);
      for (const p of subtle) for (let b = p.bar; b < p.bar + p.bars; b++) expect(fills).not.toContain(b);
    }
  });

  it('Många små: a subtle mod on every other bar, not on fill bars', () => {
    const plan = modPlan('manySmall', fills, seededRng(4));
    expect(plan.every((p) => p.strength === 'subtle' && p.bars === 1)).toBe(true);
    const bars = plan.map((p) => p.bar);
    expect(bars.every((b) => b % 2 === bars[0]! % 2 && !fills.includes(b))).toBe(true);
    expect(bars.length).toBeGreaterThanOrEqual(6);
  });

  it('En stor: an extreme mod over 2 bars', () => {
    const plan = modPlan('oneBig', fills, seededRng(4));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ strength: 'extreme', bars: 2 });
    expect(plan[0]!.bar).toBeLessThanOrEqual(14);
  });
});

describe('Nya breaks', () => {
  it('Samma stil: later breaks keep the recipe’s fill loop and hit variants', () => {
    const r = recipe({ newBreaks: 'sameStyle', fill: 'end', variants: 'wild' });
    for (let place = 0; place < 6; place++) expect(styleAt(r, 9, place)).toEqual({ fill: 'end', variants: 'wild' });
  });

  it('Egen stil: each later break rolls its own from its place', () => {
    const r = recipe({ newBreaks: 'ownStyle', fill: 'end', variants: 'wild' });
    expect(styleAt(r, 9, 0)).toEqual({ fill: 'end', variants: 'wild' });
    const styles = new Set(Array.from({ length: 20 }, (_, place) => JSON.stringify(styleAt(r, 9, place + 1))));
    expect(styles.size).toBeGreaterThan(3);
    expect(styleAt(r, 9, 3)).toEqual(styleAt(r, 9, 3));
  });
});

describe('slicing a break in Crazy madness', () => {
  it('builds a song of 16 bars: the break’s loop as main, fills, mods from the presets', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx, { slices: 16 });
    const project = slice(start, sampleId, markers, 1, ctx);
    const matrix = ownMatrix(project, sampleId)!;
    expect(project.song.bars).toBe(16);
    const mains = clipsIn(project, 'main');
    expect(mains.length).toBeGreaterThan(0);
    expect(mains.every((c) => c.ref === matrix.loop)).toBe(true);
    // The main keeps time: its offset is where it is in the section.
    expect(mains.every((c) => c.offset === c.start)).toBe(true);
    const fills = clipsIn(project, 'fill');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((c) => project.loops[c.ref]!.kind === 'fill' && c.length === STEPS_PER_BAR)).toBe(true);
    // Main and fill bars together make up the section.
    expect([...mains, ...fills].reduce((n, c) => n + c.length, 0)).toBe(16 * STEPS_PER_BAR);
    const mods = project.song.clips.filter((c) => c.row === 'modA' || c.row === 'modB');
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.every((c) => project.mods[c.ref]!.isPreset === true)).toBe(true);
    // Hit variants: some pad has more than one hit, and picks Random.
    const varied = matrix.pads.map((id) => project.pads[id]!).filter((p) => p.members.length > 1);
    expect(varied.length).toBeGreaterThan(0);
    expect(varied.every((p) => p.choice === 'random')).toBe(true);
  });

  it('is one undo step with the slicing: Undo takes all Crazy built away', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx);
    const done = apply(createHistory(start), crazyChain(setSlicing(sampleId, 1, markers)), ctx);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.history.present.song.clips.length).toBeGreaterThan(0);
    expect(undo(done.history).present).toBe(start);
  });

  it('builds the same song from the same project, whatever ids and seeds the commands get', () => {
    const a = sequentialIds();
    const { start, sampleId, markers } = withBreak(a);
    const one = slice(start, sampleId, markers, 1, a);
    let n = 0;
    const other: CommandContext = { newId: () => `x-${++n}`, newSeed: () => 99 + n };
    const two = slice(start, sampleId, markers, 1, other);
    expect(shape(two)).toEqual(shape(one));
    const hits = (p: Project) => ownMatrix(p, sampleId)!.pads.map((id) => p.pads[id]!.members.map((h) => ({ ...p.hits[h]!, id: '', variantOf: null })));
    expect(hits(two)).toEqual(hits(one));
  });

  it('two recipes build different songs', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx);
    const shapes = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(shape(slice({ ...start, recipeSeed: seed }, sampleId, markers, 1, ctx)))));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('does only the automatic chain in Total control', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx, { mode: 'total' });
    const project = slice(start, sampleId, markers, 1, ctx);
    expect(project.song.clips).toEqual([]);
    expect(Object.values(project.loops)).toHaveLength(1);
  });

  it('builds only the first time a trim is sliced: a change of bars builds nothing', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx);
    const project = slice(start, sampleId, markers, 1, ctx);
    const again = run(project, crazyChain(setSampleBars(sampleId, 2)), ctx);
    expect(again.song).toEqual(project.song);
  });

  it('builds when a REX file comes in sliced', () => {
    const ctx = sequentialIds();
    const project = run(newProject(ctx), crazyChain(addSlicedSample({ name: 'rex.rx2', audio: constantAudio(2), bars: 1, markers: [0, 0.25, 0.5, 0.75] })), ctx);
    expect(project.song.clips.length).toBeGreaterThan(0);
  });

  it('a one-shot gets its matrix and no loop or clips', () => {
    const ctx = sequentialIds();
    const project = run(newProject(ctx), crazyChain(addSample({ name: 'snare.wav', audio: constantAudio(0.2) })), ctx);
    expect(Object.values(project.loops)).toEqual([]);
    expect(project.song.clips).toEqual([]);
  });

  it('a Tape stop end puts the preset on the section’s last bar, a mod at the end on its last 2 bars', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx, { mode: 'total' });
    const sliced = run(start, setSlicing(sampleId, 1, markers), ctx);
    const tape = run(sliced, crazyBuild(sampleId, recipe({ end: 'tapeStop', mods: 'oneBig' })), ctx);
    const tapeStop = Object.values(tape.mods).find((m) => m.name === 'Tape stop')!;
    expect(tape.song.clips.filter((c) => c.ref === tapeStop.id).map((c) => [bar(c.start), c.length])).toContainEqual([15, STEPS_PER_BAR]);
    const end = run(sliced, crazyBuild(sampleId, recipe({ end: 'modAtEnd', mods: 'oneBig' })), ctx);
    const last = end.song.clips.filter((c) => (c.row === 'modA' || c.row === 'modB') && c.start === 14 * STEPS_PER_BAR && c.length === 2 * STEPS_PER_BAR);
    expect(last.some((c) => strength(end.mods[c.ref]!.name) === 'extreme')).toBe(true);
    const none = run(sliced, crazyBuild(sampleId, recipe({ end: 'nothing', mods: 'oneBig' })), ctx);
    expect(none.song.clips.filter((c) => c.row === 'modA' || c.row === 'modB')).toHaveLength(1);
  });

  it('puts a mod in Mod B where one is already in Mod A', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx, { mode: 'total' });
    const sliced = run(start, setSlicing(sampleId, 1, markers), ctx);
    let used = false;
    for (let seed = 1; seed <= 10; seed++) {
      const project = run({ ...sliced, recipeSeed: seed }, crazyBuild(sampleId, recipe({ end: 'modAtEnd', mods: 'manySmall' })), ctx);
      const a = clipsIn(project, 'modA');
      const b = clipsIn(project, 'modB');
      expect(a.length).toBeGreaterThan(0);
      // Only where Mod A is taken.
      expect(b.every((c) => a.some((x) => x.start < c.start + c.length && c.start < x.start + x.length))).toBe(true);
      used ||= b.length > 0;
    }
    expect(used).toBe(true);
  });

  it('the fill bars follow Form: Var 8:e has fills on bars 8 and 16', () => {
    const ctx = sequentialIds();
    const { start, sampleId, markers } = withBreak(ctx, { mode: 'total' });
    const sliced = run(start, setSlicing(sampleId, 1, markers), ctx);
    const project = run(sliced, crazyBuild(sampleId, recipe({ form: 'everyEighth' })), ctx);
    expect(clipsIn(project, 'fill').map((c) => bar(c.start))).toEqual([7, 15]);
    expect(clipsIn(project, 'main').map((c) => [bar(c.start), bar(c.length)])).toEqual([
      [0, 7],
      [8, 7],
    ]);
  });
});

describe('a second break', () => {
  /** Two breaks sliced in Crazy with recipe seed `seed`: the project after each. */
  function two(seed: number) {
    const ctx = sequentialIds();
    const first = withBreak(ctx, { project: { ...newProject(ctx), recipeSeed: seed } });
    const one = slice(first.start, first.sampleId, first.markers, 1, ctx);
    const second = withBreak(ctx, { name: 'think.wav', project: one });
    const both = slice(second.start, second.sampleId, second.markers, 1, ctx);
    return { one, both, first: first.sampleId, second: second.sampleId };
  }

  it('adds a new section of 16 bars last, and leaves the first as it was', () => {
    const { one, both } = two(5);
    expect(both.song.bars).toBe(32);
    const kept = both.song.clips.filter((c) => c.start < 16 * STEPS_PER_BAR);
    expect(kept).toEqual(one.song.clips);
    expect(both.song.clips.some((c) => c.start >= 16 * STEPS_PER_BAR)).toBe(true);
  });

  it('as a fill: the section plays the latest main and the new break’s fill loop in the fill bars', () => {
    // Varannan makes the second break a fill.
    const seed = Array.from({ length: 200 }, (_, i) => i).find((s) => rollRecipe(s).role !== 'mixed')!;
    const { both, first, second } = two(seed);
    const later = both.song.clips.filter((c) => c.start >= 16 * STEPS_PER_BAR);
    const mainLoop = ownMatrix(both, first)!.loop;
    expect(later.filter((c) => c.row === 'main').every((c) => c.ref === mainLoop)).toBe(true);
    const secondPads = new Set(ownMatrix(both, second)!.pads);
    const fillLoops = later.filter((c) => c.row === 'fill').map((c) => both.loops[c.ref]!);
    expect(fillLoops.length).toBeGreaterThan(0);
    expect(fillLoops.every((l) => l.kind === 'fill' && l.steps.every((s) => s.padId === null || secondPads.has(s.padId)))).toBe(true);
  });

  it('as a main after a fill break: its section uses that break’s fill loop', () => {
    const seed = Array.from({ length: 400 }, (_, i) => i).find((s) => rollRecipe(s).role === 'alternate')!;
    const ctx = sequentialIds();
    const { both, second } = two(seed);
    const third = withBreak(ctx, { name: 'funky.wav', project: both });
    const all = slice(third.start, third.sampleId, third.markers, 1, ctx);
    const later = all.song.clips.filter((c) => c.start >= 32 * STEPS_PER_BAR);
    expect(later.filter((c) => c.row === 'main').every((c) => c.ref === ownMatrix(all, third.sampleId)!.loop)).toBe(true);
    const secondPads = new Set(ownMatrix(all, second)!.pads);
    const fills = later.filter((c) => c.row === 'fill').map((c) => all.loops[c.ref]!);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((l) => l.steps.every((s) => s.padId === null || secondPads.has(s.padId)))).toBe(true);
  });
});

describe('Go crazy', () => {
  function built() {
    const ctx = sequentialIds();
    const first = withBreak(ctx);
    const one = slice(first.start, first.sampleId, first.markers, 1, ctx);
    const own = run(one, createMod('Wobble', [newStepEffect('volume')]), ctx);
    const snare = run(own, addSample({ name: 'snare.wav', audio: constantAudio(0.2) }), ctx);
    const second = withBreak(ctx, { name: 'think.wav', project: snare });
    return { project: slice(second.start, second.sampleId, second.markers, 1, ctx), ctx };
  }

  it('throws away matrices, loops, presets and the song and builds it all again from a new recipe', () => {
    const { project, ctx } = built();
    const crazy = run(project, goCrazy(), ctx);
    expect(crazy.recipeSeed).not.toBe(project.recipeSeed);
    expect(crazy.samples).toBe(project.samples);
    // Every matrix, loop, pad and hit is new.
    for (const key of ['matrices', 'loops', 'pads', 'hits'] as const) for (const id of Object.keys(crazy[key])) expect(project[key][id]).toBeUndefined();
    // The presets are made again; the mod of one's own stays.
    const presets = Object.values(crazy.mods).filter((m) => m.isPreset === true);
    expect(presets).toHaveLength(MOD_PRESETS.length);
    expect(presets.every((m) => project.mods[m.id] === undefined)).toBe(true);
    expect(Object.values(crazy.mods).filter((m) => m.isPreset !== true)).toEqual(Object.values(project.mods).filter((m) => m.isPreset !== true));
    // Each sample has its own matrix again, and the two breaks two sections.
    for (const id of Object.keys(crazy.samples)) expect(ownMatrix(crazy, id)).toBeDefined();
    expect(crazy.song.bars).toBe(32);
    expect(crazy.song.clips.every((c) => crazy.loops[c.ref] !== undefined || crazy.mods[c.ref]?.isPreset === true)).toBe(true);
  });

  it('builds as slicing each break now with the new recipe, in the samples’ order', () => {
    const { project, ctx } = built();
    const crazy = run(project, goCrazy(), ctx);
    const again = run({ ...project, recipeSeed: crazy.recipeSeed! }, goCrazy(), { ...sequentialIds(), newSeed: () => crazy.recipeSeed! });
    expect(shape(again)).toEqual(shape(crazy));
  });

  it('works in Total control too, and keeps the mode', () => {
    const { project, ctx } = built();
    const crazy = run({ ...project, mode: 'total' }, goCrazy(), ctx);
    expect(crazy.mode).toBe('total');
    expect(crazy.song.clips.length).toBeGreaterThan(0);
  });

  it('is one command: Undo brings it all back', () => {
    const { project, ctx } = built();
    const done = apply(createHistory(project), crazyChain(goCrazy()), ctx);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(undo(done.history).present).toBe(project);
  });

  it('does not build twice when run through the crazy chain', () => {
    const { project } = built();
    const seed = () => 4242;
    const plain = run(project, goCrazy(), { ...sequentialIds(), newSeed: seed });
    const chained = run(project, crazyChain(goCrazy()), { ...sequentialIds(), newSeed: seed });
    expect(shape(chained)).toEqual(shape(plain));
  });
});
