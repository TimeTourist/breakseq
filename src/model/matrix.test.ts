import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command } from './command';
import { addSample, addTrim, fileSamples, fileUsages, matrixTakes, ownMatrix, removeFile, removeSample, sampleTakes, setMarkers, setSlicing } from './chain';
import {
  addPad,
  addVariant,
  cloneMatrix,
  copyHits,
  copyMatrix,
  copyPad,
  createLoop,
  createMatrix,
  loopMatrices,
  movePad,
  placeMatrix,
  remove,
  removeAnyway,
  setMatrixConfig,
  setPadChoice,
  setPadConfig,
  setStep,
  swapMatrix,
  updateHit,
} from './commands';
import { addClip } from './clips';
import { createProject } from './project';
import { findUsages } from './references';
import { effectiveHit, hitSound } from './sound';
import type { Hit, Id, Project } from './types';
import { NO_CONFIG } from './types';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const by = <T,>(record: Readonly<Record<Id, T>>, test: (x: T) => boolean): T => Object.values(record).find(test)!;

/** A one-bar sample of `slices` equal slices, `seconds` long, its id and its own matrix's. */
function sliced(project: Project, name: string, slices = 4, seconds = 2) {
  const start = run(project, addSample({ name, audio: constantAudio(seconds) }));
  const sampleId = by(start.samples, (s) => s.name === name && !(s.id in project.samples)).id;
  const next = run(start, setSlicing(sampleId, 1), setMarkers(sampleId, Array.from({ length: slices }, (_, i) => i / slices)));
  return { project: next, sampleId, matrixId: ownMatrix(next, sampleId)!.id };
}

/** Amen sliced in four, its rows made at 1/16 (sixteen pads, four of them sounding). */
const amen = () => sliced(createProject(), 'amen.wav');

/** The top hit of row `row` of a matrix. */
const rowHit = (project: Project, matrixId: Id, row: number): Hit => project.hits[project.pads[project.matrices[matrixId]!.pads[row]!]!.members[0]!]!;
const pads = (project: Project, matrixId: Id) => project.matrices[matrixId]!.pads;
const members = (project: Project, padId: Id) => project.pads[padId]!.members;

/** A new matrix "Snares" with its one pad holding copies of the given hits. */
function snares(project: Project, hitIds: readonly Id[]) {
  const made = run(project, createMatrix('Snares'));
  const matrixId = by(made.matrices, (m) => m.name === 'Snares').id;
  const padId = made.matrices[matrixId]!.pads[0]!;
  return { project: run(made, copyHits(hitIds, padId)), matrixId, padId };
}

describe('pads and matrices', () => {
  it('a new matrix has one empty pad and no sample or loop', () => {
    const project = run(createProject(), createMatrix('Snares'));
    const matrix = by(project.matrices, (m) => m.name === 'Snares');
    expect(matrix).toMatchObject({ sampleId: null, loop: null, config: NO_CONFIG });
    expect(matrix.pads).toHaveLength(1);
    expect(project.pads[matrix.pads[0]!]).toMatchObject({ name: 'Snares 01', members: [], choice: 'top', config: NO_CONFIG });
    expect(createMatrix(' ')(project, ctx).ok).toBe(false);
  });

  it('addPad adds an empty pad last, named after the matrix', () => {
    const start = run(createProject(), createMatrix('Snares'));
    const id = by(start.matrices, (m) => m.name === 'Snares').id;
    const project = run(start, addPad(id), addPad(id));
    expect(pads(project, id).map((p) => project.pads[p]!.name)).toEqual(['Snares 01', 'Snares 02', 'Snares 03']);
    expect(members(project, pads(project, id)[2]!)).toEqual([]);
  });

  it('movePad moves a pad to a new place in its matrix', () => {
    const { project, matrixId } = amen();
    const [a, b, c] = pads(project, matrixId);
    const moved = run(project, movePad(matrixId, c!, 0));
    expect(pads(moved, matrixId).slice(0, 3)).toEqual([c, a, b]);
    expect(movePad(matrixId, 'nope', 0)(project, ctx).ok).toBe(false);
  });

  it("a pad's and a matrix's config are layers over their hits", () => {
    const { project, matrixId } = amen();
    const padId = pads(project, matrixId)[1]!;
    const next = run(project, setPadConfig(padId, { pitch: 3 }), setMatrixConfig(matrixId, { volume: -6 }));
    expect(next.pads[padId]!.config).toMatchObject({ pitch: 3, volume: 0 });
    expect(next.matrices[matrixId]!.config).toMatchObject({ pitch: 0, volume: -6 });
    expect(effectiveHit(next, rowHit(next, matrixId, 1))).toMatchObject({ pitch: 3, volume: -6 });
  });
});

describe('copies (decision 8)', () => {
  it('copying a matrix with five hits to pad 02 adds five new hits last', () => {
    const { project: p0, matrixId: amenId } = amen();
    const five = [0, 1, 2, 3, 4].map((row) => rowHit(p0, amenId, row).id);
    const { project, matrixId } = snares(p0, five);
    const target = pads(project, amenId)[1]!;
    const before = members(project, target);

    const next = run(project, copyMatrix(matrixId, { padId: target }));
    const after = members(next, target);
    expect(after).toHaveLength(6);
    expect(after[0]).toBe(before[0]);
    const copies = after.slice(1).map((h) => next.hits[h]!);
    const sources = members(project, pads(project, matrixId)[0]!).map((h) => project.hits[h]!);
    expect(copies.map((h) => h.id).some((h) => five.includes(h) || sources.some((s) => s.id === h))).toBe(false);
    expect(copies.map((h) => [h.sampleId, h.slice])).toEqual(sources.map((h) => [h.sampleId, h.slice]));
    expect(copies.every((h) => h.variantOf === null)).toBe(true);
  });

  it('changing a copy leaves the original, and the other way round', () => {
    const { project: p0, matrixId: amenId } = amen();
    const original = rowHit(p0, amenId, 2);
    const { project, padId } = snares(p0, [original.id]);
    const copy = project.hits[members(project, padId)[0]!]!;
    expect(copy).toMatchObject({ sampleId: original.sampleId, slice: 2, name: original.name });

    const pitched = run(project, updateHit(copy.id, { pitch: 5 }));
    expect(pitched.hits[original.id]!.pitch).toBe(0);
    const other = run(project, updateHit(original.id, { volume: -3 }));
    expect(other.hits[copy.id]!.volume).toBe(0);
  });

  it("a copy takes only the hit's own config", () => {
    const { project: p0, matrixId: amenId } = amen();
    const source = pads(p0, amenId)[1]!;
    const hit = rowHit(p0, amenId, 1);
    const project = run(p0, setPadConfig(source, { pitch: 3 }), setMatrixConfig(amenId, { volume: -6 }), updateHit(hit.id, { pitch: 1 }));
    const { project: next, padId } = snares(project, [hit.id]);
    const copy = next.hits[members(next, padId)[0]!]!;
    expect(copy.pitch).toBe(1);
    expect(effectiveHit(next, copy)).toMatchObject({ pitch: 1, volume: 0 });
    expect(effectiveHit(next, next.hits[hit.id]!)).toMatchObject({ pitch: 4, volume: -6 });
  });

  it('copying a pad adds a new pad last with its choice, config and copies of its hits', () => {
    const { project: p0, matrixId: amenId } = amen();
    const { project: p1, matrixId, padId } = snares(p0, [rowHit(p0, amenId, 1).id, rowHit(p0, amenId, 3).id]);
    const project = run(p1, setPadConfig(padId, { pan: 0.5 }), setPadChoice(padId, 'roundRobin'));
    const next = run(project, copyPad(padId, amenId));
    const added = next.pads[pads(next, amenId).at(-1)!]!;
    expect(pads(next, amenId)).toHaveLength(17);
    expect(added).toMatchObject({ name: 'Snares 01', choice: 'roundRobin', config: { ...NO_CONFIG, pan: 0.5 } });
    expect(added.id).not.toBe(padId);
    expect(added.members).toHaveLength(2);
    expect(added.members.some((m) => members(next, padId).includes(m))).toBe(false);
    expect(pads(next, matrixId)).toEqual([padId]);
  });

  it('copying a matrix to a matrix adds its pads last with their choice and config', () => {
    const { project: p0, matrixId: amenId } = amen();
    const { project: p1, matrixId, padId } = snares(p0, [rowHit(p0, amenId, 1).id]);
    const project = run(p1, addPad(matrixId), setPadConfig(padId, { pitch: -2 }));
    const second = pads(project, matrixId)[1]!;
    const next = run(project, copyMatrix(matrixId, { matrixId: amenId }));
    const added = pads(next, amenId).slice(16).map((p) => next.pads[p]!);
    expect(added.map((p) => p.name)).toEqual(['Snares 01', 'Snares 02']);
    expect(added.map((p) => p.config.pitch)).toEqual([-2, 0]);
    expect(added.map((p) => p.choice)).toEqual(['top', 'top']);
    expect(added.map((p) => p.members.length)).toEqual([1, 0]);
    expect(added.some((p) => p.id === padId || p.id === second)).toBe(false);
  });

  it("a variant goes last in the original's pad; a variant of a variant goes there too", () => {
    const { project: p0, matrixId } = amen();
    const padId = pads(p0, matrixId)[1]!;
    const original = members(p0, padId)[0]!;
    let project = run(p0, addVariant(original));
    const variant = by(project.hits, (h) => h.variantOf === original);
    project = run(project, addVariant(variant.id));
    const second = by(project.hits, (h) => h.variantOf === variant.id);
    expect(members(project, padId)).toEqual([original, variant.id, second.id]);
    expect(variant).toMatchObject({ sampleId: project.hits[original]!.sampleId, slice: 1 });
  });

  it('cloning a matrix copies it whole with new pads and hits, no sample and no loop', () => {
    const { project: p0, matrixId } = amen();
    const project = run(p0, updateHit(rowHit(p0, matrixId, 2).id, { pitch: 5 }), setMatrixConfig(matrixId, { pan: -0.5 }));
    const next = run(project, cloneMatrix(matrixId));
    const copy = by(next.matrices, (m) => m.id !== matrixId);
    expect(copy).toMatchObject({ name: 'amen 1 copy', sampleId: null, loop: null, config: { ...NO_CONFIG, pan: -0.5 } });
    expect(copy.pads).toHaveLength(16);
    expect(copy.pads.some((p) => pads(next, matrixId).includes(p))).toBe(false);
    expect(next.pads[copy.pads[0]!]!.name).toBe('amen 1 copy 01');
    const third = rowHit(next, copy.id, 2);
    expect(third).toMatchObject({ name: 'amen 1 copy 03', slice: 2, pitch: 5, variantOf: null });
    expect(third.id).not.toBe(rowHit(next, matrixId, 2).id);
    expect(Object.keys(next.loops)).toEqual(Object.keys(project.loops));
  });
});

describe('removal', () => {
  it('removing a matrix takes its pads and hits and keeps its loop and samples', () => {
    const { project, sampleId, matrixId } = amen();
    const loop = project.matrices[matrixId]!.loop!;
    const gone = run(project, remove('matrix', matrixId));
    expect(gone.matrices[matrixId]).toBeUndefined();
    expect(Object.keys(gone.pads)).toHaveLength(0);
    expect(Object.keys(gone.hits)).toHaveLength(0);
    expect(gone.samples[sampleId]).toBeDefined();
    expect(Object.keys(gone.audio)).toHaveLength(1);
    expect(gone.loops[loop]!.steps.every((s) => s.padId === null)).toBe(true);
  });

  it('usages of a matrix are other loops that play its pads and its loop in the song; copies elsewhere are not', () => {
    const { project: p0, matrixId } = amen();
    expect(findUsages(p0, 'matrix', matrixId)).toEqual([]);
    const copied = snares(p0, [rowHit(p0, matrixId, 1).id]).project;
    expect(findUsages(copied, 'matrix', matrixId)).toEqual([]);

    const looped = run(copied, createLoop('L', 'main', 1));
    const other = by(looped.loops, (l) => l.name === 'L');
    const inLoop = run(looped, setStep(other.id, 0, { padId: pads(looped, matrixId)[0]! }), setStep(other.id, 4, { padId: pads(looped, matrixId)[1]! }));
    expect(findUsages(inLoop, 'matrix', matrixId)).toEqual([{ kind: 'loop', id: other.id, name: 'L' }]);
    expect(remove('matrix', matrixId)(inLoop, ctx)).toMatchObject({ ok: false, error: { kind: 'in-use' } });

    const inSong = run(copied, addClip('main', copied.matrices[matrixId]!.loop!, 0));
    expect(findUsages(inSong, 'matrix', matrixId)).toEqual([{ kind: 'song', id: null, name: 'Song' }]);
  });

  it('removed anyway, a matrix goes silent where it was used; copies keep playing', () => {
    const { project: p0, matrixId } = amen();
    const { project: p1, padId } = snares(p0, [rowHit(p0, matrixId, 1).id]);
    const looped = run(p1, createLoop('L', 'main', 1));
    const other = by(looped.loops, (l) => l.name === 'L');
    const own = looped.matrices[matrixId]!.loop!;
    const used = run(looped, setStep(other.id, 0, { padId: pads(looped, matrixId)[0]! }), setStep(other.id, 1, { padId }), addClip('main', own, 0), addClip('main', other.id, 16));
    const gone = run(used, removeAnyway('matrix', matrixId));
    expect(gone.loops[other.id]!.steps[0]!.padId).toBeNull();
    expect(gone.loops[other.id]!.steps[1]!.padId).toBe(padId);
    expect(members(gone, padId)).toHaveLength(1);
    expect(hitSound(gone, gone.hits[members(gone, padId)[0]!]!)).not.toBeNull();
    expect(gone.song.clips.map((c) => c.ref)).toEqual([own, other.id]);
  });

  it('what a matrix takes with it is its pads and hits; a one-shot just its pad and hit', () => {
    const { project, matrixId } = amen();
    expect(matrixTakes(project, matrixId)).toEqual(['16 pads', '16 hits']);
    const shot = run(createProject(), addSample({ name: 'kick.wav', audio: constantAudio(0.2) }));
    expect(matrixTakes(shot, Object.keys(shot.matrices)[0]!)).toEqual(['1 pad', '1 hit']);
  });

  it('removing a pad takes it and its hits out of its matrix; it is in use where a loop plays it', () => {
    const { project, matrixId } = amen();
    const first = pads(project, matrixId)[0]!;
    // Row 06 is silent and in no loop.
    const sixth = pads(project, matrixId)[5]!;
    const hit = members(project, sixth)[0]!;
    const gone = run(project, remove('pad', sixth));
    expect(pads(gone, matrixId)).not.toContain(sixth);
    expect(pads(gone, matrixId)).toHaveLength(15);
    expect(gone.pads[sixth]).toBeUndefined();
    expect(gone.hits[hit]).toBeUndefined();

    const loop = project.matrices[matrixId]!.loop!;
    expect(findUsages(project, 'pad', first)).toEqual([{ kind: 'loop', id: loop, name: 'amen 1' }]);
    expect(remove('pad', first)(project, ctx).ok).toBe(false);
  });

  it('removing a hit takes it out of its pad; a step locked to it is a usage, and falls back to member 1', () => {
    const { project: p0, matrixId } = amen();
    const padId = pads(p0, matrixId)[1]!;
    const original = members(p0, padId)[0]!;
    let project = run(p0, addVariant(original), createLoop('L', 'main', 1));
    const variant = by(project.hits, (h) => h.variantOf === original).id;
    const loop = by(project.loops, (l) => l.name === 'L').id;
    expect(run(project, remove('hit', variant)).pads[padId]!.members).toEqual([original]);
    project = run(project, setStep(loop, 0, { padId, memberId: variant }));
    expect(findUsages(project, 'hit', variant)).toEqual([{ kind: 'loop', id: loop, name: 'L' }]);
    const gone = run(project, removeAnyway('hit', variant));
    expect(gone.pads[padId]!.members).toEqual([original]);
    expect(gone.loops[loop]!.steps[0]).toMatchObject({ padId, memberId: null });
  });

  it('removing a trim removes its hits everywhere; their pads stay empty and steps locked to them fall back to member 1', () => {
    const { project: p0, sampleId, matrixId } = amen();
    const kick = run(p0, addSample({ name: 'kick.wav', audio: constantAudio(0.2) }));
    const kickHit = rowHit(kick, by(kick.matrices, (m) => m.name === 'kick 1').id, 0).id;
    // Snares 01 holds only a copy of amen's slice 2; Snares 02 a kick and a copy of slice 3.
    const { project: p1, matrixId: snaresId, padId: only } = snares(kick, [rowHit(kick, matrixId, 1).id]);
    const p2 = run(p1, addPad(snaresId));
    const mixed = pads(p2, snaresId)[1]!;
    const p3 = run(p2, copyHits([kickHit, rowHit(p2, matrixId, 2).id], mixed), createLoop('L', 'main', 1));
    const loop = by(p3.loops, (l) => l.name === 'L').id;
    const lent = members(p3, mixed)[1]!;
    const project = run(p3, setStep(loop, 0, { padId: mixed, memberId: lent }), setStep(loop, 4, { padId: pads(p3, matrixId)[0]! }));

    expect(findUsages(project, 'sample', sampleId)).toEqual([
      { kind: 'loop', id: loop, name: 'L' },
      { kind: 'pad', id: only, name: 'Snares 01' },
      { kind: 'pad', id: mixed, name: 'Snares 02' },
    ]);
    expect(sampleTakes(project, sampleId)).toEqual(['matrix amen 1', '16 pads', '18 hits']);
    expect(remove('sample', sampleId)(project, ctx).ok).toBe(false);

    const gone = run(project, removeSample(sampleId));
    expect(gone.samples[sampleId]).toBeUndefined();
    expect(gone.matrices[matrixId]).toBeUndefined();
    expect(Object.values(gone.hits).some((h) => h.sampleId === sampleId)).toBe(false);
    expect(members(gone, only)).toEqual([]);
    expect(pads(gone, snaresId)).toEqual([only, mixed]);
    expect(members(gone, mixed)).toHaveLength(1);
    expect(gone.loops[loop]!.steps[0]).toMatchObject({ padId: mixed, memberId: null });
    expect(gone.loops[loop]!.steps[4]!.padId).toBeNull();
    // Its file goes with its last trim; the kick stays.
    expect(Object.keys(gone.audio)).toHaveLength(1);
    expect(Object.values(gone.samples).map((s) => s.name)).toEqual(['kick.wav']);
  });

  it('removeFile takes every trim of it in one step, and leaves other files', () => {
    const { project: p0, sampleId } = amen();
    const audioId = p0.samples[sampleId]!.audioId;
    const project = run(p0, addTrim(sampleId), addSample({ name: 'kick.wav', audio: constantAudio(0.2) }));
    expect(fileSamples(project, audioId).map((s) => s.trim)).toEqual([1, 2]);

    const gone = run(project, removeFile(audioId));
    expect(Object.values(gone.matrices).map((m) => m.name)).toEqual(['kick 1']);
    expect(gone.audio[audioId]).toBeUndefined();
    expect(Object.values(gone.samples).map((s) => s.name)).toEqual(['kick.wav']);
    expect(removeFile(audioId)(gone, ctx).ok).toBe(false);
  });

  it('fileUsages lists each place outside the file once', () => {
    const { project: p0, sampleId, matrixId } = amen();
    const audioId = p0.samples[sampleId]!.audioId;
    const looped = run(p0, addTrim(sampleId), createLoop('L', 'main', 1));
    const trim2 = by(looped.matrices, (m) => m.name === 'amen 2');
    const loop = by(looped.loops, (l) => l.name === 'L');
    // A copy of trim 1 in trim 2's own matrix is inside the file.
    const inFile = run(looped, copyHits([rowHit(looped, matrixId, 1).id], trim2.pads[0]!));
    const project = run(inFile, setStep(loop.id, 0, { padId: pads(inFile, matrixId)[0]! }), setStep(loop.id, 1, { padId: pads(inFile, matrixId)[1]! }));
    expect(fileUsages(project, audioId)).toEqual([{ kind: 'loop', id: loop.id, name: 'L' }]);
  });
});

describe('matrices in loops', () => {
  it('placing a matrix lays its pads out from the step and empties the rest of its length', () => {
    const { project, matrixId } = amen();
    const withLoop = run(project, createLoop('L', 'main', 2));
    const loop = by(withLoop.loops, (l) => l.name === 'L');
    const other = pads(withLoop, matrixId)[3]!;
    const filled = run(withLoop, ...Array.from({ length: 18 }, (_, i) => setStep(loop.id, i, { padId: other })));
    const placed = run(filled, placeMatrix(loop.id, matrixId, 1)).loops[loop.id]!.steps;
    expect(placed[0]!.padId).toBe(other);
    expect([1, 5, 9, 13].map((i) => placed[i]!.padId)).toEqual(pads(withLoop, matrixId).slice(0, 4));
    expect([2, 3, 4, 6, 16].map((i) => placed[i]!.padId)).toEqual([null, null, null, null, null]);
    expect(placed[17]!.padId).toBe(other);
    const empty = run(withLoop, createMatrix('Empty'));
    expect(placeMatrix(loop.id, by(empty.matrices, (m) => m.name === 'Empty').id, 0)(empty, ctx).ok).toBe(false);
  });

  it('swapping matrices maps row N to row N; a row the other lacks is emptied', () => {
    const { project: p0, matrixId: amenId } = amen();
    const { project: p1, matrixId: thinkId } = sliced(p0, 'think.wav', 2);
    const { project: p2, padId: mine } = snares(p1, [rowHit(p1, amenId, 1).id]);
    // Think has rows 01–16 too (made at 1/16); cut it to three to see a row it lacks.
    const think = run(p2, ...pads(p2, thinkId).slice(3).map((p) => remove('pad', p)));
    const project = run(think, createLoop('M', 'main', 1));
    const loop = by(project.loops, (l) => l.name === 'M').id;
    const a = pads(project, amenId);
    const used = run(
      project,
      setStep(loop, 0, { padId: a[0]! }),
      setStep(loop, 4, { padId: a[2]!, memberId: members(project, a[2]!)[0]! }),
      setStep(loop, 8, { padId: mine }),
      setStep(loop, 12, { padId: a[5]! }),
    );
    expect(loopMatrices(used, used.loops[loop]!).map((m) => m.name)).toEqual(['amen 1', 'Snares']);

    const swapped = run(used, swapMatrix(loop, amenId, thinkId));
    const steps = swapped.loops[loop]!.steps;
    const t = pads(swapped, thinkId);
    expect(steps[0]!.padId).toBe(t[0]);
    expect(steps[4]).toMatchObject({ padId: t[2], memberId: null });
    expect(steps[8]!.padId).toBe(mine);
    expect(steps[12]!.padId).toBeNull();
    expect(swapped.matrices[thinkId]!.pads).toEqual(t);

    const back = run(swapped, swapMatrix(loop, thinkId, amenId));
    expect(back.loops[loop]!.steps.slice(0, 9).map((s) => s.padId)).toEqual(used.loops[loop]!.steps.slice(0, 9).map((s) => s.padId));
  });

  it('swapping to a one-shot keeps row 01 and empties the rest', () => {
    const { project: p0, matrixId: amenId } = amen();
    const project = run(p0, addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const snare = by(project.matrices, (m) => m.name === 'snare 1');
    const loop = project.matrices[amenId]!.loop!;
    const steps = run(project, swapMatrix(loop, amenId, snare.id)).loops[loop]!.steps;
    expect(steps[0]!.padId).toBe(snare.pads[0]);
    expect(steps.slice(1).every((s) => s.padId === null)).toBe(true);
  });
});
