import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command } from './command';
import { addSample, ownMatrix, setMarkers, setSlicing } from './chain';
import { copyHits, createLoop, createMatrix, createMatrixFrom, replaceHit, setBpm, setStep } from './commands';
import { apply, createHistory, undo } from './history';
import { matrixSequence } from './lengths';
import { createProject } from './project';
import type { Hit, Id, Project } from './types';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const by = <T,>(record: Readonly<Record<Id, T>>, test: (x: T) => boolean): T => Object.values(record).find(test)!;

/** Amen (2 s, one bar, four slices of four steps) and a 0.3 s snare one-shot, at 120 BPM. */
function amenAndSnare() {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
  const amenId = by(start.samples, (s) => s.name === 'amen.wav').id;
  const project = run(start, setBpm(120), setSlicing(amenId, 1), setMarkers(amenId, [0, 0.25, 0.5, 0.75]));
  const matrixId = ownMatrix(project, amenId)!.id;
  const snareHit = by(project.hits, (h) => h.name === 'snare 1');
  return { project, amenId, matrixId, snareHit };
}

/** The top hit of row `row` of a matrix. */
const rowHit = (project: Project, matrixId: Id, row: number): Hit => project.hits[project.pads[project.matrices[matrixId]!.pads[row]!]!.members[0]!]!;

describe('replacing a hit (decision 12)', () => {
  it('replacing a hit puts the copy in its place and keeps step locks on it', () => {
    const { project: p0, matrixId, snareHit } = amenAndSnare();
    const made = run(p0, createMatrix('Snares'), createLoop('L', 'main', 1));
    const snares = by(made.matrices, (m) => m.name === 'Snares');
    const padId = snares.pads[0]!;
    let project = run(made, copyHits([0, 1, 2].map((r) => rowHit(made, matrixId, r).id), padId));
    const [first, target, last] = project.pads[padId]!.members;
    const loop = by(project.loops, (l) => l.name === 'L').id;
    project = run(project, setStep(loop, 4, { padId, memberId: target! }));

    const next = run(project, replaceHit(target!, snareHit.id));
    const members = next.pads[padId]!.members;
    expect(members).toHaveLength(3);
    expect([members[0], members[2]]).toEqual([first, last]);
    const copy = next.hits[members[1]!]!;
    expect(copy.id).not.toBe(snareHit.id);
    expect(copy).toMatchObject({ sampleId: snareHit.sampleId, slice: snareHit.slice, name: snareHit.name, variantOf: null });
    expect(next.hits[target!]).toBeUndefined();
    expect(next.hits[snareHit.id]).toEqual(snareHit);
    expect(next.loops[loop]!.steps[4]).toMatchObject({ padId, memberId: copy.id });
  });

  it("replacing the first hit changes the pad's length and moves the pads after it", () => {
    const { project, matrixId, snareHit } = amenAndSnare();
    expect(matrixSequence(project, matrixId).map((s) => s.step)).toEqual([0, 4, 8, 12]);
    const next = run(project, replaceHit(rowHit(project, matrixId, 1).id, snareHit.id));
    // The snare sounds 0.3 s: three steps at 120 BPM.
    expect(matrixSequence(next, matrixId).map((s) => [s.step, s.length])).toEqual([[0, 4], [4, 3], [7, 4], [11, 4]]);
    // The matrix's own loop, untouched, follows.
    const loop = next.loops[next.matrices[matrixId]!.loop!]!;
    expect(loop.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual([0, 4, 7, 11]);
  });

  it('replacing is one undo step', () => {
    const { project, matrixId, snareHit } = amenAndSnare();
    const applied = apply(createHistory(project), replaceHit(rowHit(project, matrixId, 1).id, snareHit.id), ctx);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.history.past).toHaveLength(1);
    expect(undo(applied.history).present).toBe(project);
  });

  it('a hit cannot replace itself', () => {
    const { project, snareHit } = amenAndSnare();
    const result = replaceHit(snareHit.id, snareHit.id)(project, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid');
    expect(replaceHit('nope', snareHit.id)(project, ctx).ok).toBe(false);
    expect(replaceHit(snareHit.id, 'nope')(project, ctx).ok).toBe(false);
  });
});

describe('a new matrix from hits (decision 15)', () => {
  it('a new matrix from four hits is one pad of four copies on Round robin', () => {
    const { project, matrixId } = amenAndSnare();
    const hits = [0, 1, 2, 3].map((r) => rowHit(project, matrixId, r));
    const next = run(project, createMatrixFrom('Kit', hits.map((h) => h.id)));
    const matrix = by(next.matrices, (m) => m.name === 'Kit');
    expect(matrix).toMatchObject({ sampleId: null, loop: null });
    expect(matrix.pads).toHaveLength(1);
    const pad = next.pads[matrix.pads[0]!]!;
    expect(pad).toMatchObject({ name: 'Kit 01', choice: 'roundRobin' });
    expect(pad.members).toHaveLength(4);
    expect(pad.members.some((m) => hits.some((h) => h.id === m))).toBe(false);
    expect(pad.members.map((m) => next.hits[m]!.slice)).toEqual([0, 1, 2, 3]);
    // The originals stay where they were.
    expect(hits.every((h) => next.hits[h.id] === h)).toBe(true);
  });

  it('a new matrix from one hit is a one-shot on Top', () => {
    const { project, snareHit } = amenAndSnare();
    const next = run(project, createMatrixFrom('One', [snareHit.id]));
    const matrix = by(next.matrices, (m) => m.name === 'One');
    const pad = next.pads[matrix.pads[0]!]!;
    expect(pad).toMatchObject({ name: 'One 01', choice: 'top' });
    expect(next.hits[pad.members[0]!]).toMatchObject({ sampleId: snareHit.sampleId, name: snareHit.name });
    expect(createMatrixFrom('Empty', [])(project, ctx).ok).toBe(false);
    expect(createMatrixFrom(' ', [snareHit.id])(project, ctx).ok).toBe(false);
    expect(createMatrixFrom('X', ['nope'])(project, ctx).ok).toBe(false);
  });
});
