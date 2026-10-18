import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBpm, setHitSource, setMarkers, setPadChoice, setSlicing, sliceWindow, copyHits, createMatrix, addPad, matrixSteps } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import { matrixSong, hitRun, padTurns } from './preview';

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

  it('lets a pad pick each round when looped, a round robin going round whole', () => {
    const p0 = split();
    const padId = matrixOf(p0).pads[0]!;
    const p = run(p0, copyHits([memberOf(p0, 1), memberOf(p0, 2)], padId), setPadChoice(padId, 'roundRobin'));
    const pad = p.pads[padId]!;
    const turns = padTurns(pad, true, () => 0);
    expect(turns).toHaveLength(9);
    expect(turns.slice(0, 4)).toEqual([pad.members[0], pad.members[1], pad.members[2], pad.members[0]]);
    expect(padTurns(pad, false, () => 0)).toEqual([pad.members[0]]);
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
