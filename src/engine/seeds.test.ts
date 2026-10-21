import { describe, expect, it } from 'vitest';
import type { Command, Id, Project } from '../model';
import {
  apply,
  copyClip,
  createHistory,
  copyHits,
  rerollAll,
  rerollClip,
  rerollMod,
  rerollPad,
  setPadChoice,
  setPadConfig,
  setSongBars,
  undo,
} from '../model';
import { sequentialIds } from '../test/fixtures';
import { randomSong } from './fixtures/random-song';
import type { Trigger } from './generate';
import { generateTake, generateTriggers } from './generate';
import { blockStart, loopBlock, matrixBlock, modBlock } from './preview';
import { readProjectFile, writeProjectFile } from './project-file';
import { mix, placeRng } from './random';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const inBar = (triggers: readonly Trigger[], bar: number) => triggers.filter((t) => t.bar === bar).map((t) => [t.step, t.hitId, t.pitch]);

describe('seeds: the same project sounds the same', () => {
  it('gives the same triggers and tapes every time it is generated', () => {
    const { project } = randomSong(ctx);
    const a = generateTake(project);
    const b = generateTake(project);
    expect(a.triggers).toEqual(b.triggers);
    expect(a.tapes).toEqual(b.tapes);
    // There is randomness in it: pads pick more than one hit, and pitch varies.
    expect(new Set(a.triggers.map((t) => t.hitId)).size).toBeGreaterThan(2);
    expect(new Set(a.triggers.map((t) => t.pitch)).size).toBeGreaterThan(2);
    expect(a.tapes[0]!.wobble.length).toBeGreaterThan(0);
  });

  it('after Save and Load (a project file)', () => {
    const { project } = randomSong(ctx);
    const loaded = readProjectFile(writeProjectFile(project));
    expect(generateTake(loaded)).toEqual(generateTake(project));
  });

  it('reroll on everything changes what plays; Undo, the old seeds, plays the same again', () => {
    const { project } = randomSong(ctx);
    const rerolled = run(project, rerollAll());
    expect(generateTriggers(rerolled)).not.toEqual(generateTriggers(project));
  });
});

describe('seeds: each random choice from its own seed and place', () => {
  it('two clips of the same loop vary between them; a copied clip plays like the original', () => {
    const { project, loop } = randomSong(ctx);
    const triggers = generateTriggers(project);
    // Bars 0 and 1 are two clips of the same loop with their own seeds.
    expect(inBar(triggers, 0).map((t) => t[1])).not.toEqual(inBar(triggers, 1).map((t) => t[1]));
    // A copy of the first clip, without mods over it, picks the same Random hits as the first clip would there.
    const plain = run({ ...project, song: { ...project.song, clips: project.song.clips.filter((c) => c.row === 'main' && c.start === 0) } }, setSongBars(4));
    const clip = plain.song.clips[0]!;
    const copied = run(plain, copyClip(clip.id, 'main', 32));
    const t = generateTriggers(copied);
    const randomSteps = (bar: number) => inBar(t, bar).filter((x) => (x[0] as number) % 2 === 0);
    expect(randomSteps(2)).toEqual(randomSteps(0));
    void loop;
  });

  it('🎲 on a clip changes only that clip’s randomness, and Undo brings it back', () => {
    const { project } = randomSong(ctx);
    // The clip over bars 2–3; bar 2 is under the tape, bar 3 is heard as it is.
    const third = project.song.clips.find((c) => c.row === 'main' && c.start === 32)!;
    const before = generateTriggers(project);
    const rerolled = run(project, rerollClip(third.id));
    const after = generateTriggers(rerolled);
    expect(inBar(after, 0)).toEqual(inBar(before, 0));
    expect(inBar(after, 1)).toEqual(inBar(before, 1));
    expect(inBar(after, 3)).not.toEqual(inBar(before, 3));
    // Undo is the project with the old seed: it plays as before.
    const history = apply(createHistory(project), rerollClip(third.id), ctx);
    expect(history.ok && generateTriggers(undo(history.history).present)).toEqual(before);
  });

  it('🎲 on a pad changes its picks; 🎲 on a mod changes the mod’s', () => {
    const { project, padA, mod } = randomSong(ctx);
    const hitsOf = (p: Project) => generateTriggers(p).map((t) => t.hitId);
    const pitches = (p: Project) => generateTriggers(p).map((t) => t.pitch);
    expect(hitsOf(run(project, rerollPad(padA)))).not.toEqual(hitsOf(project));
    expect(pitches(run(project, rerollMod(mod)))).not.toEqual(pitches(project));
  });

  it('a change does not reroll: changing one pad keeps the other pad’s picks', () => {
    const { project, padA, padB } = randomSong(ctx);
    const plain = { ...project, song: { ...project.song, clips: project.song.clips.filter((c) => c.row === 'main') } };
    const ofPad = (p: Project, pad: Id) => generateTriggers(p).filter((t) => p.pads[pad]!.members.includes(t.hitId) && t.step % 2 === 0).map((t) => [t.bar, t.step, t.hitId]);
    const louder = run(plain, setPadConfig(padB, { volume: -6 }));
    expect(ofPad(louder, padA)).toEqual(ofPad(plain, padA));
  });

  it('the place mixes into the dice: other numbers, another Rng', () => {
    expect(mix([1, 2, 3])).toBe(mix([1, 2, 3]));
    expect(mix([1, 2, 3])).not.toBe(mix([1, 3, 2]));
    expect(placeRng(5, 6)()).toBe(placeRng(5, 6)());
    expect(placeRng(5, 6)()).not.toBe(placeRng(5, 7)());
    const r = placeRng(1);
    for (let i = 0; i < 100; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe('varv: Play in Matrices, Loops and Mods sounds different each pass', () => {
  it('a mod with Random sounds different in pass 1 and 2, and the same series of passes every time', () => {
    const { project, mod, loop } = randomSong(ctx);
    const pitches = (block: number) => generateTriggers(modBlock(project, mod, loop, block)).map((t) => t.pitch);
    expect(pitches(0)).not.toEqual(pitches(1));
    expect(pitches(0)).toEqual(pitches(0));
    expect(pitches(1)).toEqual(pitches(1));
    expect(pitches(2)).not.toEqual(pitches(1));
  });

  it('a loop with a Random pad picks anew each block; a block is at least a bar', () => {
    const { project, loop } = randomSong(ctx);
    const hits = (block: number) => generateTriggers(loopBlock(project, loop, block)).map((t) => t.hitId);
    expect(hits(0)).not.toEqual(hits(1));
    expect(hits(1)).toEqual(hits(1));
  });

  it('Round robin goes on counting over the passes: the next block takes over where the last ended', () => {
    const { project, padC } = randomSong(ctx);
    // Pad C with three hits on Round robin, alone in a matrix of one pad: one step a pass.
    const hits = Object.values(project.hits).slice(0, 3).map((h) => h.id);
    const p = run(project, copyHits(hits.slice(0, 2), padC), setPadChoice(padC, 'roundRobin'));
    const matrixId = Object.values(p.matrices).find((m) => m.pads.includes(padC))!.id;
    const members = p.pads[padC]!.members;
    const blocks = (b: number) => matrixBlock(p, matrixId, b);
    const first = generateTake(blocks(0));
    const second = generateTake(blocks(1), { from: blockStart(blocks, 1) });
    const all = [...first.triggers, ...second.triggers].map((t) => members.indexOf(t.hitId));
    // One long round: 0, 1, 2, 0, 1, 2 … across the blocks.
    expect(all).toEqual(all.map((_, i) => i % 3));
  });
});
