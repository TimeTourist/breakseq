import { describe, expect, it } from 'vitest';
import type { Command, Project, Step } from '../model';
import {
  addSample,
  createLoop,
  createProject,
  emptyStep,
  setBpm,
  setHitSource,
  setMarkers,
  setPadChoice,
  setSlicing,
  setStep,
  sliceWindow,
  copyHits,
  createMatrix,
  addPad,
  matrixSteps,
} from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import { MAX_PREVIEW_STEPS, PAD_ROUNDS, hitRun, loopSongLooped, matrixSong, matrixSongLooped, previewPasses } from './preview';

const ctx = sequentialIds();
const run = (project: Project, ...commands: Command[]) =>
  commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);

/** One bar of 2 s at 120 BPM in four slices of 0.5 s. */
function split(): Project {
  const project = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120));
  const id = Object.keys(project.samples)[0]!;
  return run(project, setSlicing(id, 1), setMarkers(id, [0, 0.25, 0.5, 0.75]));
}

const matrixOf = (p: Project) => Object.values(p.matrices)[0]!;
const sampleOf = (p: Project) => Object.values(p.samples)[0]!;
const memberOf = (p: Project, row: number) => p.pads[matrixOf(p).pads[row]!]!.members[0]!;

describe('previews', () => {
  it('plays hits one after another, each as long as it sounds', () => {
    const p = split();
    const r = hitRun(p, [memberOf(p, 0), memberOf(p, 2)]);
    expect(r.triggers.map((t) => t.time)).toEqual([0, 0.5]);
    expect(r.seconds).toBeCloseTo(1, 6);
  });

  it('matrixSongLooped renders passes until a round robin pad has gone round whole, so its variations are heard', () => {
    const p0 = split();
    const padId = matrixOf(p0).pads[0]!;
    // Pad 01 has three hits on Round robin: three passes of the bar.
    const p = run(p0, copyHits([memberOf(p0, 1), memberOf(p0, 2)], padId), setPadChoice(padId, 'roundRobin'));
    const song = matrixSongLooped(p, matrixOf(p).id);
    expect(song.song.bars).toBe(3);
    const firsts = generateTake(song, () => 0).triggers.filter((t) => t.step === 0);
    expect(firsts.map((t) => t.hitId)).toEqual(p.pads[padId]!.members.map((id) => p.hits[id]!.id));
    // Played once, as in Loops, it is one pass.
    expect(matrixSong(p, matrixOf(p).id).song.bars).toBe(1);
  });

  it('matrixSongLooped lets a Random pad pick PAD_ROUNDS times', () => {
    const p0 = split();
    const padId = matrixOf(p0).pads[0]!;
    const p = run(p0, copyHits([memberOf(p0, 1), memberOf(p0, 2)], padId), setPadChoice(padId, 'random'));
    const song = matrixSongLooped(p, matrixOf(p).id);
    expect(song.song.bars).toBe(PAD_ROUNDS);
    // The injected rng decides: going up through 0, 1/3, 2/3 picks each hit in turn.
    let i = 0;
    const rng = () => [0, 0.4, 0.7][i++ % 3]!;
    const firsts = generateTake(song, rng).triggers.filter((t) => t.step === 0);
    expect(new Set(firsts.map((t) => t.hitId)).size).toBe(3);
  });

  it('previewPasses: whole rounds of every round robin, enough picks for Random and No repeat, capped', () => {
    const p0 = split();
    const [a, b, c, d] = matrixOf(p0).pads as [string, string, string, string];
    const m = (row: number) => memberOf(p0, row);
    // a: 3 hits on Round robin; b: 2 hits on Round robin; c: 2 hits on No repeat; d: 2 hits on Top.
    const p = run(
      p0,
      copyHits([m(1), m(2)], a),
      setPadChoice(a, 'roundRobin'),
      copyHits([m(0)], b),
      setPadChoice(b, 'roundRobin'),
      copyHits([m(0)], c),
      setPadChoice(c, 'noRepeat'),
      copyHits([m(0)], d),
      setPadChoice(d, 'top'),
    );
    const step = (padId: string | null, memberId: string | null = null): Step => ({ ...emptyStep, padId, memberId });
    const blank = Array.from({ length: 16 }, () => step(null));
    const steps = (...cells: Step[]) => [...cells, ...blank.slice(cells.length)];
    expect(previewPasses(p, steps(step(d)))).toBe(1);
    expect(previewPasses(p, steps(step(a)))).toBe(3);
    // The least common multiple: 3 and 2 go round together after 6.
    expect(previewPasses(p, steps(step(a), step(b)))).toBe(6);
    // Played twice a pass, a pad of two goes round in one.
    expect(previewPasses(p, steps(step(b), step(b)))).toBe(1);
    // A locked step picks nothing.
    expect(previewPasses(p, steps(step(a, p.pads[a]!.members[1]!)))).toBe(1);
    expect(previewPasses(p, steps(step(c)))).toBe(PAD_ROUNDS);
    expect(previewPasses(p, steps(step(c), step(c)))).toBe(PAD_ROUNDS / 2);
    // Both: whole rounds of 3 and at least 8 picks gives 9.
    expect(previewPasses(p, steps(step(a), step(c)))).toBe(9);
    // Never past MAX_PREVIEW_STEPS.
    const long = [step(a), ...Array.from({ length: MAX_PREVIEW_STEPS / 2 - 1 }, () => step(null))];
    expect(previewPasses(p, long)).toBe(2);
    expect(previewPasses(p, [])).toBe(1);
  });

  it('loopSongLooped plays a loop over as many passes as its pads need', () => {
    const p0 = run(split(), createLoop('L', 'main', 1));
    const padId = matrixOf(p0).pads[0]!;
    const loop = Object.values(p0.loops).find((l) => l.name === 'L')!;
    const p = run(p0, copyHits([memberOf(p0, 1)], padId), setPadChoice(padId, 'roundRobin'), setStep(loop.id, 0, { padId }));
    const song = loopSongLooped(p, loop.id);
    expect(song.song.bars).toBe(2);
    expect(generateTake(song, () => 0).triggers.map((t) => t.hitId)).toEqual(p.pads[padId]!.members.map((id) => p.hits[id]!.id));
  });

  it('matrixSong plays a matrix as it lays out', () => {
    const p = split();
    const song = matrixSong(p, matrixOf(p).id);
    expect(song.song.bars).toBe(1);
    expect(song.song.clips).toHaveLength(1);
    expect(generateTake(song, () => 0).triggers.map((t) => t.step)).toEqual([0, 4, 8, 12]);
  });

  it('matrixSong is whole bars: a one-shot is one bar, and a matrix of 20 steps is two', () => {
    const one = run(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), setBpm(120));
    const shot = matrixSong(one, Object.values(one.matrices)[0]!.id);
    expect(shot.song.bars).toBe(1);
    expect(generateTake(shot, () => 0).triggers.map((t) => t.step)).toEqual([0]);

    // At 120 BPM a step is 0.125 s: a 0.75 s hit takes 6 steps and a 1.75 s hit 14, together 20.
    const base = run(createProject(), addSample({ name: 'a.wav', audio: constantAudio(0.75) }), addSample({ name: 'b.wav', audio: constantAudio(1.75) }), setBpm(120));
    const [a, b] = Object.values(base.pads);
    let project = run(base, createMatrix('Long'));
    const matrix = Object.values(project.matrices).find((m) => m.name === 'Long')!;
    project = run(project, addPad(matrix.id));
    const [first, second] = project.matrices[matrix.id]!.pads;
    project = run(project, copyHits(a!.members, first!), copyHits(b!.members, second!));
    expect(matrixSteps(project, matrix.id)).toBe(20);

    const song = matrixSong(project, matrix.id);
    expect(song.song.bars).toBe(2);
    expect(generateTake(song, () => 0).triggers.map((t) => t.step)).toEqual([0, 6]);
  });

  it('plays a matrix as laid out, so a replaced slice plays what replaced it', () => {
    const p0 = split();
    const sample = sampleOf(p0);
    // Slot 4 plays slice 2 instead.
    const p = run(p0, setHitSource(memberOf(p0, 3), sample.id, 1));
    const take = generateTake(matrixSong(p, matrixOf(p).id), () => 0);
    expect(take.triggers.map((t) => t.step)).toEqual([0, 4, 8, 12]);
    expect(take.triggers[3]!.region).toEqual(take.triggers[1]!.region);
    expect(take.triggers[3]!.region).toEqual(sliceWindow(sample, 1));
  });
});
