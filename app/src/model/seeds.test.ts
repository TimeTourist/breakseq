import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command } from './command';
import { addSample, ownMatrix, setMarkers, setSlicing } from './chain';
import { addClip, copyClip, pasteClip } from './clips';
import { addPad, cloneMatrix, copyPad, createLoop, createMatrix, createMatrixFrom, createMod } from './commands';
import { apply, createHistory, undo } from './history';
import { addMissingPresets } from './presets';
import { createProject, upgradeProject } from './project';
import { rerollAll, rerollClip, rerollMatrix, rerollMod, rerollPad } from './reroll';
import { isSeed, seedOf } from './seed';
import type { Id, Project } from './types';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const only = <T,>(record: Readonly<Record<Id, T>>): T[] => Object.values(record);

/** Amen sliced in four with its matrix and loop, a mod, and the loop and mod in the song. */
function amen(): Project {
  const added = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const sampleId = only(added.samples)[0]!.id;
  const sliced = run(added, setSlicing(sampleId, 1), setMarkers(sampleId, [0, 0.25, 0.5, 0.75]));
  const matrix = ownMatrix(sliced, sampleId)!;
  const withMod = run(sliced, createMod('Wobble', []));
  const modId = only(withMod.mods)[0]!.id;
  return run(withMod, addClip('main', matrix.loop!, 0), addClip('modA', modId, 0));
}

const seedsOf = (p: Project) => ({
  mods: only(p.mods).map((m) => m.seed),
  matrices: only(p.matrices).map((m) => m.seed),
  pads: only(p.pads).map((m) => m.seed),
  clips: p.song.clips.map((c) => c.seed),
});

describe('seeds', () => {
  it('every new mod, matrix, pad and clip gets a seed from the context', () => {
    const p = amen();
    const all = Object.values(seedsOf(p)).flat();
    expect(all.length).toBeGreaterThan(4);
    expect(all.every(isSeed)).toBe(true);
    // From the injected source: all different.
    expect(new Set(all).size).toBe(all.length);
    const more = run(p, createMatrix('Snares'), createLoop(null, 'main', 1));
    const snares = only(more.matrices).find((m) => m.name === 'Snares')!;
    expect(isSeed(snares.seed)).toBe(true);
    expect(isSeed(more.pads[snares.pads[0]!]!.seed)).toBe(true);
    const withPad = run(more, addPad(snares.id));
    const added = withPad.matrices[snares.id]!.pads[1]!;
    expect(isSeed(withPad.pads[added]!.seed)).toBe(true);
    const hit = only(p.hits)[0]!.id;
    const from = run(p, createMatrixFrom('Bag', [hit]));
    const bag = only(from.matrices).find((m) => m.name === 'Bag')!;
    expect(isSeed(bag.seed) && isSeed(from.pads[bag.pads[0]!]!.seed)).toBe(true);
  });

  it('a copied clip keeps its seed (spec); a cloned matrix and a copied pad get new ones (Claudes val)', () => {
    const p = amen();
    const clip = p.song.clips.find((c) => c.row === 'main')!;
    const copied = run(p, copyClip(clip.id, 'main', 16));
    const copy = copied.song.clips.find((c) => c.row === 'main' && c.id !== clip.id)!;
    expect(copy.seed).toBe(clip.seed);
    const pasted = run(p, pasteClip(clip, 'fill', 0));
    expect(pasted.song.clips.find((c) => c.row === 'fill')!.seed).toBe(clip.seed);

    const matrix = only(p.matrices)[0]!;
    const cloned = run(p, cloneMatrix(matrix.id));
    const clone = only(cloned.matrices).find((m) => m.id !== matrix.id)!;
    expect(clone.seed).not.toBe(matrix.seed);
    const before = new Set(only(p.pads).map((x) => x.seed));
    expect(clone.pads.every((id) => !before.has(cloned.pads[id]!.seed))).toBe(true);

    const padId = matrix.pads[0]!;
    const withCopy = run(p, copyPad(padId, matrix.id));
    const padCopy = withCopy.pads[withCopy.matrices[matrix.id]!.pads.at(-1)!]!;
    expect(padCopy.seed).not.toBe(p.pads[padId]!.seed);
  });

  it('a clip split in two by another keeps its seed in both halves', () => {
    const p = amen();
    const clip = p.song.clips.find((c) => c.row === 'main')!;
    const loopId = clip.ref;
    const long = run(p, addClip('main', loopId, 0, 64));
    const whole = long.song.clips.find((c) => c.row === 'main')!;
    const split = run(long, addClip('main', loopId, 16, 16));
    const halves = split.song.clips.filter((c) => c.row === 'main' && c.seed === whole.seed);
    expect(halves).toHaveLength(2);
  });

  it('a project saved without seeds gets them on load, the same every time (Claudes val)', () => {
    const p = amen();
    const strip = <T extends { seed: number }>(record: Readonly<Record<Id, T>>) =>
      Object.fromEntries(Object.entries(record).map(([id, x]) => [id, (({ seed, ...rest }) => (void seed, rest))(x)]));
    const old = JSON.parse(
      JSON.stringify({
        ...p,
        mods: strip(p.mods),
        matrices: strip(p.matrices),
        pads: strip(p.pads),
        song: { ...p.song, clips: p.song.clips.map(({ seed, ...rest }) => (void seed, rest)) },
      }),
    ) as unknown;
    // The presets it gets at Load are new objects; with the same ids and seeds, the rest is the same every time.
    const a = upgradeProject(old, sequentialIds())!;
    const b = upgradeProject(JSON.parse(JSON.stringify(old)) as unknown, sequentialIds())!;
    expect(Object.values(seedsOf(a)).flat().every(isSeed)).toBe(true);
    expect(seedsOf(a)).toEqual(seedsOf(b));
    const pad = only(a.pads)[0]!;
    expect(pad.seed).toBe(seedOf(pad.id));
    // A project with seeds keeps them.
    const withPresets = addMissingPresets(p);
    expect(seedsOf(upgradeProject(withPresets)!)).toEqual(seedsOf(withPresets));
  });
});

describe('a project saved with Crazy madness', () => {
  it('loads without its mode and recipe seed, which no longer exist', () => {
    const saved = JSON.parse(JSON.stringify({ ...createProject(), mode: 'crazy', recipeSeed: 7 })) as unknown;
    const loaded = upgradeProject(saved)!;
    expect('mode' in loaded).toBe(false);
    expect('recipeSeed' in loaded).toBe(false);
  });
});

describe('Reroll', () => {
  const changed = (a: readonly number[], b: readonly number[]) => a.filter((x, i) => x !== b[i]).length;

  it('everything: new seeds on every mod, matrix, pad and clip, in one undo step', () => {
    const p = amen();
    const history = apply(createHistory(p), rerollAll(), ctx);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const before = seedsOf(p);
    const after = seedsOf(history.history.present);
    for (const key of ['mods', 'matrices', 'pads', 'clips'] as const) expect(changed(before[key], after[key])).toBe(before[key].length);
    expect(seedsOf(undo(history.history).present)).toEqual(before);
  });

  it('everything keeps copies as copies: clips that shared a seed get the same new seed, the others each their own', () => {
    const p = amen();
    const main = p.song.clips.find((c) => c.row === 'main')!;
    const copied = run(p, copyClip(main.id, 'main', main.start + main.length));
    const before = copied.song.clips.filter((c) => c.row === 'main');
    expect(before).toHaveLength(2);
    expect(before[0]!.seed).toBe(before[1]!.seed);
    const after = run(copied, rerollAll());
    const [a, b] = before.map((c) => after.song.clips.find((x) => x.id === c.id)!);
    expect(a!.seed).not.toBe(main.seed);
    expect(a!.seed).toBe(b!.seed);
    const mod = after.song.clips.find((c) => c.row === 'modA')!;
    expect(mod.seed).not.toBe(a!.seed);
    expect(mod.seed).not.toBe(copied.song.clips.find((c) => c.row === 'modA')!.seed);
  });

  it('a clip: only that clip', () => {
    const p = amen();
    const clip = p.song.clips.find((c) => c.row === 'main')!;
    const after = run(p, rerollClip(clip.id));
    expect(after.song.clips.find((c) => c.id === clip.id)!.seed).not.toBe(clip.seed);
    expect(seedsOf(after)).toEqual({ ...seedsOf(p), clips: after.song.clips.map((c) => (c.id === clip.id ? c.seed : p.song.clips.find((x) => x.id === c.id)!.seed)) });
    expect(after.song.clips.filter((c) => c.id !== clip.id)).toEqual(p.song.clips.filter((c) => c.id !== clip.id));
  });

  it('a mod: only that mod', () => {
    const p = amen();
    const mod = only(p.mods)[0]!;
    const after = run(p, rerollMod(mod.id));
    expect(after.mods[mod.id]!.seed).not.toBe(mod.seed);
    expect({ ...seedsOf(after), mods: [] }).toEqual({ ...seedsOf(p), mods: [] });
  });

  it('a matrix: the matrix and its pads, nothing else', () => {
    const p = run(amen(), createMatrix('Snares'));
    const matrix = only(p.matrices).find((m) => m.name !== 'Snares')!;
    const after = run(p, rerollMatrix(matrix.id));
    expect(after.matrices[matrix.id]!.seed).not.toBe(matrix.seed);
    for (const id of matrix.pads) expect(after.pads[id]!.seed).not.toBe(p.pads[id]!.seed);
    const snares = only(p.matrices).find((m) => m.name === 'Snares')!;
    expect(after.matrices[snares.id]).toBe(p.matrices[snares.id]);
    expect(after.pads[snares.pads[0]!]).toBe(p.pads[snares.pads[0]!]);
  });

  it('a pad: only that pad', () => {
    const p = amen();
    const [padId, other] = only(p.matrices)[0]!.pads;
    const after = run(p, rerollPad(padId!));
    expect(after.pads[padId!]!.seed).not.toBe(p.pads[padId!]!.seed);
    expect(after.pads[other!]).toBe(p.pads[other!]);
  });

  it('something that is not there is not found', () => {
    const p = amen();
    for (const command of [rerollClip('x'), rerollMod('x'), rerollMatrix('x'), rerollPad('x')]) expect(command(p, ctx).ok).toBe(false);
  });
});
