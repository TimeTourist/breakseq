import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command } from './command';
import {
  addSample,
  addTrim,
  cueMarkers,
  fileSamples,
  isUnsliced,
  makeOneShot,
  markUnsliced,
  markersForBars,
  ownMatrix,
  renameMatrix,
  renumberConflict,
  setGrid,
  setHitSource,
  setMarkers,
  setSampleBars,
  setSlicing,
  sliceSample,
  trimSample,
  unsliceTakes,
  unsliceUsages,
} from './chain';
import { createLoop, setStep, updateHit } from './commands';
import { addClip } from './clips';
import { matrixSequence } from './lengths';
import { sampleBpm } from './owners';
import { emptySong } from './project';
import { hitSound, sliceName, slotHit as newHit, trimName } from './sound';
import type { Hit, Id, Matrix, Pad, Project } from './types';
import { NO_CONFIG } from './types';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const emptyProject = (): Project => ({ audio: {}, samples: {}, matrices: {}, hits: {}, pads: {}, loops: {}, mods: {}, song: emptySong() });

/** A 2 s one-bar sample of `slices` equal slices (a quarter is 0.5 s), its id and its own matrix's. */
function amen(slices = 4, seconds = 2) {
  const start = run(emptyProject(), addSample({ name: 'amen.wav', audio: constantAudio(seconds) }));
  const sampleId = Object.keys(start.samples)[0]!;
  const project = run(start, setSlicing(sampleId, 1), setMarkers(sampleId, Array.from({ length: slices }, (_, i) => i / slices)));
  return { project, sampleId, matrixId: ownMatrix(project, sampleId)!.id };
}

/** The top hit of row `row` of a matrix. */
const rowHit = (project: Project, matrixId: Id, row: number): Hit => project.hits[project.pads[project.matrices[matrixId]!.pads[row]!]!.members[0]!]!;
/** Where a hit sounds, in seconds of its sample, rounded to ms; null when silent. */
const heard = (project: Project, hit: Hit) => {
  const sound = hitSound(project, hit);
  return sound === null ? null : [+sound.region.start.toFixed(3), +sound.region.end.toFixed(3)];
};
const by = <T,>(record: Readonly<Record<Id, T>>, test: (x: T) => boolean): T => Object.values(record).find(test)!;

/** A matrix "Snares" built by hand, with one pad per [sampleId, slice] given, each a copy (decision 8). */
function withSnares(project: Project, ...plays: (readonly [Id, number])[]): { project: Project; matrixId: Id; hits: Id[]; pads: Id[] } {
  const hits: Hit[] = plays.map(([sampleId, slice], i) => newHit(`snare-hit-${i}`, `snare ${i}`, sampleId, slice));
  const pads: Pad[] = hits.map((h, i) => ({ id: `snare-pad-${i}`, name: `Snares 0${i + 1}`, members: [h.id], choice: 'top', config: NO_CONFIG }));
  const matrix: Matrix = { id: 'snares', name: 'Snares', pads: pads.map((p) => p.id), config: NO_CONFIG, sampleId: null, loop: null };
  return {
    project: {
      ...project,
      hits: { ...project.hits, ...Object.fromEntries(hits.map((h) => [h.id, h])) },
      pads: { ...project.pads, ...Object.fromEntries(pads.map((p) => [p.id, p])) },
      matrices: { ...project.matrices, [matrix.id]: matrix },
    },
    matrixId: matrix.id,
    hits: hits.map((h) => h.id),
    pads: pads.map((p) => p.id),
  };
}

describe('the automatic chain', () => {
  it('a new file is a sample and a one-shot matrix', () => {
    const project = run(emptyProject(), addSample({ name: 'kick.wav', audio: constantAudio(0.5) }));
    const sample = Object.values(project.samples)[0]!;
    expect(sample).toMatchObject({ name: 'kick.wav', trim: 1, bars: null, markers: [0] });
    const matrix = Object.values(project.matrices)[0]!;
    expect(matrix).toMatchObject({ name: 'kick 1', sampleId: sample.id, loop: null, config: NO_CONFIG });
    expect(matrix.pads).toHaveLength(1);
    const pad = project.pads[matrix.pads[0]!]!;
    expect(pad).toMatchObject({ name: 'kick 1', choice: 'top', config: NO_CONFIG });
    expect(pad.members).toHaveLength(1);
    expect(project.hits[pad.members[0]!]).toMatchObject({ name: 'kick 1', sampleId: sample.id, slice: 0, variantOf: null });
    expect(ownMatrix(project, sample.id)).toBe(matrix);
  });

  it('slicing makes the own matrix one pad per slice and a loop the first time', () => {
    const start = run(emptyProject(), addSample({ name: 'amen.wav', audio: constantAudio(8) }));
    const sampleId = Object.keys(start.samples)[0]!;
    const project = run(start, sliceSample(sampleId, 4));
    const matrix = ownMatrix(project, sampleId)!;
    expect(project.samples[sampleId]!.markers).toHaveLength(64);
    expect(matrix.pads).toHaveLength(64);
    expect(sampleBpm(project.samples[sampleId]!)).toBeCloseTo(120);
    const loop = project.loops[matrix.loop!]!;
    expect(loop).toMatchObject({ name: 'amen 1', kind: 'main' });
    expect(loop.steps).toHaveLength(64);
    expect(loop.steps.map((s) => s.padId)).toEqual(matrix.pads);
    // Not sliced and sliced again: still one loop.
    const again = run(project, setSlicing(sampleId, null), setSlicing(sampleId, 4));
    expect(Object.values(again.loops)).toHaveLength(1);
  });

  it('slicing a one-shot keeps pad 01 as the first slice row', () => {
    const start = run(emptyProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const sampleId = Object.keys(start.samples)[0]!;
    const before = ownMatrix(start, sampleId)!;
    const project = run(start, setSlicing(sampleId, 1));
    const matrix = ownMatrix(project, sampleId)!;
    expect(project.samples[sampleId]!.markers).toHaveLength(16);
    expect(matrix.pads).toHaveLength(16);
    expect(matrix.pads[0]).toBe(before.pads[0]);
    expect(project.pads[matrix.pads[0]!]!.name).toBe('amen 1 01');
    const first = rowHit(project, matrix.id, 0);
    expect(first).toMatchObject({ id: rowHit(start, matrix.id, 0).id, name: 'amen 1 01', slice: 0 });
    expect(rowHit(project, matrix.id, 6)).toMatchObject({ name: 'amen 1 07', sampleId, slice: 6 });
  });

  it('moving a marker changes the sound of every hit of that slice, copies too', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    const { project, hits } = withSnares(p0, [sampleId, 1]);
    expect(heard(project, project.hits[hits[0]!]!)).toEqual([0.5, 1]);
    const moved = run(project, setMarkers(sampleId, [0, 0.3, 0.5, 0.75]));
    expect(heard(moved, moved.hits[hits[0]!]!)).toEqual([0.6, 1]);
    expect(heard(moved, rowHit(moved, matrixId, 1))).toEqual([0.6, 1]);
  });

  it('more slices give the own matrix new pads; fewer leave the last silent', () => {
    const { project, sampleId, matrixId } = amen(4);
    expect(heard(project, rowHit(project, matrixId, 2))).toEqual([1, 1.5]);

    const fewer = run(project, setMarkers(sampleId, [0, 0.25, 0.75]));
    expect(heard(fewer, rowHit(fewer, matrixId, 1))).toEqual([0.5, 1.5]);
    expect(heard(fewer, rowHit(fewer, matrixId, 2))).toEqual([1.5, 2]);
    expect(heard(fewer, rowHit(fewer, matrixId, 3))).toBeNull();
    // Its pad stays, to sound again with more slices. Sliced first on 1/16, it has 16 rows, so a 17th is new.
    expect(fewer.matrices[matrixId]!.pads).toEqual(project.matrices[matrixId]!.pads);
    const more = run(fewer, setMarkers(sampleId, Array.from({ length: 17 }, (_, i) => i / 17)));
    expect(heard(more, rowHit(more, matrixId, 3))).not.toBeNull();
    expect(more.matrices[matrixId]!.pads).toHaveLength(17);
    expect(rowHit(more, matrixId, 16)).toMatchObject({ name: 'amen 1 17', sampleId, slice: 16 });
  });

  it('only the own matrix gets rows; other matrices keep theirs', () => {
    const { project: p0, sampleId } = amen(4);
    const { project, matrixId } = withSnares(p0, [sampleId, 1]);
    const more = run(project, setMarkers(sampleId, Array.from({ length: 20 }, (_, i) => i / 20)));
    expect(more.matrices[matrixId]).toEqual(project.matrices[matrixId]);
  });

  it("a hit's region is a part of its slice and follows it", () => {
    const { project, sampleId, matrixId } = amen(4);
    const hit = rowHit(project, matrixId, 1);
    const half = run(project, updateHit(hit.id, { region: { start: 0.5, end: 1 } }));
    expect(heard(half, half.hits[hit.id]!)).toEqual([0.75, 1]);
    const longer = run(half, setMarkers(sampleId, [0, 0.25, 0.75]));
    expect(heard(longer, longer.hits[hit.id]!)).toEqual([1, 1.5]);
  });

  it('trimming the sample takes the markers and regions along', () => {
    const { project, sampleId, matrixId } = amen(4);
    const trimmed = run(project, trimSample(sampleId, 0, 1));
    expect(heard(trimmed, rowHit(trimmed, matrixId, 1))).toEqual([0.25, 0.5]);
    expect(sampleBpm(trimmed.samples[sampleId]!)).toBeCloseTo(240);
  });

  it('a hit can play another slice or sample, keeping its settings', () => {
    let { project, matrixId } = amen(4);
    project = run(project, addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const snare = by(project.samples, (s) => s.name === 'snare.wav');
    const hit = rowHit(project, matrixId, 0);
    project = run(project, updateHit(hit.id, { pitch: -3, fadeOut: 20 }), setHitSource(hit.id, snare.id, 0));
    expect(project.hits[hit.id]).toMatchObject({ sampleId: snare.id, slice: 0, pitch: -3, fadeOut: 20 });
    expect(heard(project, project.hits[hit.id]!)).toEqual([0, 0.3]);
    expect(setHitSource(hit.id, 'nothing', 0)(project, ctx).ok).toBe(false);
    expect(setHitSource(hit.id, snare.id, -1)(project, ctx).ok).toBe(false);
  });
});

/** Adds a pad by hand, last in a matrix, with one hit playing `[sampleId, slice]`. */
function handPad(project: Project, matrixId: Id, sampleId: Id, slice: number | null, id = 'hand'): Project {
  const hit = newHit(`${id}-hit`, id, sampleId, slice);
  const pad: Pad = { id, name: id, members: [hit.id], choice: 'top', config: NO_CONFIG };
  const matrix = project.matrices[matrixId]!;
  return {
    ...project,
    hits: { ...project.hits, [hit.id]: hit },
    pads: { ...project.pads, [pad.id]: pad },
    matrices: { ...project.matrices, [matrixId]: { ...matrix, pads: [...matrix.pads, pad.id] } },
  };
}

/** The slice each pad of a matrix plays by its top hit, or 'x' for another sample's. */
const rowSlices = (project: Project, matrixId: Id, sampleId: Id) =>
  project.matrices[matrixId]!.pads.map((p) => {
    const hit = project.hits[project.pads[p]!.members[0]!]!;
    return hit.sampleId === sampleId ? hit.slice : 'x';
  });

describe('rows follow what pads play, in a matrix edited by hand (decision 12)', () => {
  it('a pad added by hand to a one-shot is no row: slicing gives every slice a row, after it', () => {
    let project = run(emptyProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const amenId = by(project.samples, (s) => s.name === 'amen.wav').id;
    const snareId = by(project.samples, (s) => s.name === 'snare.wav').id;
    const matrixId = ownMatrix(project, amenId)!.id;
    project = run(handPad(project, matrixId, snareId, 0), setSlicing(amenId, 1));
    expect(rowSlices(project, matrixId, amenId)).toEqual([0, 'x', ...Array.from({ length: 15 }, (_, i) => i + 1)]);
  });

  it('a row removed by hand is not made again, and a new slice gets one row', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    const matrix = p0.matrices[matrixId]!;
    const project = { ...p0, matrices: { ...p0.matrices, [matrixId]: { ...matrix, pads: matrix.pads.filter((_, i) => i !== 2) } } };
    const more = run(project, setMarkers(sampleId, Array.from({ length: 17 }, (_, i) => i / 17)));
    const slices = rowSlices(more, matrixId, sampleId);
    expect(slices.filter((s) => s === 15)).toHaveLength(1);
    expect(slices.filter((s) => s === 16)).toHaveLength(1);
    expect(slices).not.toContain(2);
    expect(slices).toHaveLength(16);
  });

  it("un-slicing keeps pads added by hand with another sample's hits", () => {
    let { project, sampleId, matrixId } = amen(4);
    project = run(project, addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const snareId = by(project.samples, (s) => s.name === 'snare.wav').id;
    project = handPad(project, matrixId, snareId, 0);
    const first = project.matrices[matrixId]!.pads[0]!;
    expect(unsliceTakes(project, sampleId)).toEqual(['15 pads', '15 hits', 'loop amen 1']);
    const after = run(project, setSlicing(sampleId, null));
    expect(after.matrices[matrixId]!.pads).toEqual([first, 'hand']);
    expect(after.hits['hand-hit']).toBeDefined();
    expect(heard(after, after.hits['hand-hit']!)).toEqual([0, 0.3]);
  });
});

describe('the automatic loop', () => {
  it('the automatic loop follows until edited by hand', () => {
    const start = run(emptyProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const sampleId = Object.keys(start.samples)[0]!;
    let project = run(start, sliceSample(sampleId, 4, 4));
    const matrixId = ownMatrix(project, sampleId)!.id;
    const m1 = project.matrices[matrixId]!.loop!;
    expect(project.loops[m1]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual(Array.from({ length: 16 }, (_, i) => i * 4));
    // Four bars was a mistake: one bar it is, and the loop follows.
    project = run(project, setSampleBars(sampleId, 1));
    expect(project.loops[m1]!.steps).toHaveLength(16);
    expect(matrixSequence(project, matrixId).map((s) => s.step)).toEqual([0, 4, 8, 12]);
    expect(project.loops[m1]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual([0, 4, 8, 12]);
    // Edited by hand, it stays as it is.
    project = run(project, setStep(m1, 1, { padId: project.matrices[matrixId]!.pads[3]! }), setMarkers(sampleId, [0, 0.5]));
    expect(project.loops[m1]!.steps.filter((s) => s.padId !== null)).toHaveLength(5);
  });

  it('other loops stay as laid out', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    let project = run(p0, createLoop('L', 'main', 1));
    const loop = by(project.loops, (l) => l.name === 'L').id;
    const pads = project.matrices[matrixId]!.pads;
    project = run(project, ...[0, 4, 8, 12].map((step, i) => setStep(loop, step, { padId: pads[i]! })));
    const moved = run(project, setMarkers(sampleId, [0, 0.5]));
    expect(moved.loops[loop]).toEqual(project.loops[loop]);
    // The automatic one followed.
    expect(moved.loops[moved.matrices[matrixId]!.loop!]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual([0, 8]);
  });
});

describe('numbering', () => {
  const sixteen = Array.from({ length: 16 }, (_, i) => i / 16);

  it('renumberConflict is null when a marker only moves', () => {
    const { project: p0, sampleId } = amen(16);
    const { project } = withSnares(p0, [sampleId, 6]);
    expect(renumberConflict(project, sampleId, sixteen.map((m, i) => (i === 6 ? m + 0.01 : m)))).toBeNull();
  });

  it('renumberConflict is null when markers are added but each slice concerned is played by one hit', () => {
    const { project, sampleId } = amen(16);
    expect(renumberConflict(project, sampleId, [...sixteen, 0.97])).toBeNull();
    expect(renumberConflict(project, sampleId, sixteen.filter((_, i) => i !== 6))).toBeNull();
  });

  it('renumberConflict lists slices played by more than one hit, and their pads', () => {
    const { project: p0, sampleId, matrixId } = amen(16);
    // A copy of slice 07 in Snares, and a variant of slice 09 in the same matrix (q4).
    const { project: p1, pads } = withSnares(p0, [sampleId, 6]);
    const row9 = p1.matrices[matrixId]!.pads[8]!;
    const variant = { ...rowHit(p1, matrixId, 8), id: 'variant', variantOf: rowHit(p1, matrixId, 8).id };
    const project: Project = {
      ...p1,
      hits: { ...p1.hits, variant },
      pads: { ...p1.pads, [row9]: { ...p1.pads[row9]!, members: [...p1.pads[row9]!.members, 'variant'] } },
    };
    // Removing the marker of slice 06 renumbers 06 to the last.
    const conflict = renumberConflict(project, sampleId, sixteen.filter((_, i) => i !== 5));
    expect(conflict).not.toBeNull();
    expect(conflict!.slices).toEqual([6, 8]);
    expect([...conflict!.pads].sort()).toEqual([project.matrices[matrixId]!.pads[6]!, row9, pads[0]!].sort());
    // Changing only slices after them asks nothing.
    expect(renumberConflict(project, sampleId, [...sixteen.slice(0, 15)])).toBeNull();
  });

  it('newTrim moves the edited matrix and its hits to a new trim, copies stay on the old', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    const { project, hits } = withSnares(p0, [sampleId, 2]);
    const own = project.matrices[matrixId]!;
    const next = run(project, setMarkers(sampleId, [0, 0.5], true));
    const fresh = by(next.samples, (s) => s.id !== sampleId);
    expect(fresh).toMatchObject({ audioId: project.samples[sampleId]!.audioId, trim: 2, bars: 1, markers: [0, 0.5] });
    expect(next.samples[sampleId]!.markers).toEqual([0, 0.25, 0.5, 0.75]);
    expect(next.matrices[matrixId]).toMatchObject({ sampleId: fresh.id, name: own.name, loop: own.loop });
    expect(ownMatrix(next, sampleId)).toBeUndefined();
    expect(ownMatrix(next, fresh.id)!.id).toBe(matrixId);
    for (const padId of own.pads) for (const h of next.pads[padId]!.members) expect(next.hits[h]!.sampleId).toBe(fresh.id);
    expect(heard(next, rowHit(next, matrixId, 1))).toEqual([1, 2]);
    // The copy in Snares plays as before.
    expect(next.hits[hits[0]!]!.sampleId).toBe(sampleId);
    expect(heard(next, next.hits[hits[0]!]!)).toEqual([1, 1.5]);
    // The own loop followed the move.
    expect(next.loops[own.loop!]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual([0, 8]);
  });

  it('markersForBars gives the markers a change of bars would set, for renumberConflict', () => {
    const { project: p0, sampleId } = amen(4);
    // On 1/4 they follow the bars; placed by hand they stay.
    expect(markersForBars(p0.samples[sampleId]!, 2)).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
    const byHand = run(p0, setMarkers(sampleId, [0, 0.3]));
    expect(markersForBars(byHand.samples[sampleId]!, 2)).toEqual([0, 0.3]);
    expect(run(p0, setSampleBars(sampleId, 2)).samples[sampleId]!.markers).toEqual(markersForBars(p0.samples[sampleId]!, 2));
    const { project } = withSnares(p0, [sampleId, 3]);
    expect(renumberConflict(project, sampleId, markersForBars(project.samples[sampleId]!, 2))).toMatchObject({ slices: [3] });
  });

  it('setSampleBars can make a new trim too', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    const { project, hits } = withSnares(p0, [sampleId, 3]);
    const next = run(project, setSampleBars(sampleId, 2, true));
    const fresh = by(next.samples, (s) => s.id !== sampleId);
    expect(fresh).toMatchObject({ trim: 2, bars: 2 });
    expect(fresh.markers).toHaveLength(8);
    expect(next.samples[sampleId]).toEqual(project.samples[sampleId]);
    expect(next.matrices[matrixId]!.sampleId).toBe(fresh.id);
    expect(heard(next, next.hits[hits[0]!]!)).toEqual([1.5, 2]);
    // The own loop followed: 2 bars of 1/4.
    expect(next.loops[next.matrices[matrixId]!.loop!]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it('setGrid can make a new trim too', () => {
    const { project, sampleId, matrixId } = amen(4);
    const next = run(project, setGrid(sampleId, 8, true));
    const fresh = by(next.samples, (s) => s.id !== sampleId);
    expect(fresh.markers).toHaveLength(8);
    expect(next.samples[sampleId]!.markers).toHaveLength(4);
    expect(next.matrices[matrixId]!.sampleId).toBe(fresh.id);
  });

  it('a new trim gets the next free number of its file', () => {
    const { project: p0, sampleId } = amen(4);
    const withTrims = run(p0, addTrim(sampleId), addTrim(sampleId));
    const trim2 = by(withTrims.samples, (s) => s.trim === 2);
    const { [trim2.id]: _gone, ...samples } = withTrims.samples;
    void _gone;
    const project = { ...withTrims, samples };
    const next = run(project, setMarkers(sampleId, [0, 0.5], true));
    const fresh = by(next.samples, (s) => !(s.id in project.samples));
    expect(fresh.trim).toBe(4);
    expect(trimName(fresh)).toBe('amen trim 4');
  });

  it('without newTrim, slices count by number', () => {
    const { project: p0, sampleId, matrixId } = amen(4);
    const { project, hits } = withSnares(p0, [sampleId, 2]);
    const next = run(project, setMarkers(sampleId, [0, 0.5, 0.75]));
    expect(Object.keys(next.samples)).toEqual([sampleId]);
    // What was slice 04 is slice 03 now, wherever it is played.
    expect(heard(next, next.hits[hits[0]!]!)).toEqual([1.5, 2]);
    expect(heard(next, rowHit(next, matrixId, 2))).toEqual([1.5, 2]);
    expect(heard(next, rowHit(next, matrixId, 3))).toBeNull();
  });
});

describe('importing and slicing', () => {
  it('a file with cues imports unsliced: nothing guessed or made, its cues kept for Slice', () => {
    const project = run(emptyProject(), addSample({ name: 'one-bar.wav', audio: constantAudio(1.7), cues: [0.85, 0, 0.4] }));
    const sample = Object.values(project.samples)[0]!;
    expect(sample).toMatchObject({ bars: null, markers: [0], unsliced: true, cues: [0, 0.4, 0.85] });
    expect(isUnsliced(sample)).toBe(true);
    const matrix = ownMatrix(project, sample.id)!;
    expect(matrix).toMatchObject({ loop: null });
    expect(matrix.pads).toHaveLength(1);
    expect(Object.keys(project.loops)).toHaveLength(0);
    expect(cueMarkers(sample)!.map((m) => +(m * 1.7).toFixed(3))).toEqual([0, 0.4, 0.85]);
  });

  it('sliced at its cues, it gets its slices and loop, and is no longer unsliced', () => {
    let project = run(emptyProject(), addSample({ name: 'one-bar.wav', audio: constantAudio(1.7), cues: [0, 0.4, 0.85] }));
    const id = Object.keys(project.samples)[0]!;
    project = run(project, setSlicing(id, 1, cueMarkers(project.samples[id]!)!));
    const sample = project.samples[id]!;
    expect(sample.bars).toBe(1);
    expect(sample.markers).toHaveLength(3);
    expect(ownMatrix(project, id)!.pads).toHaveLength(3);
    expect(ownMatrix(project, id)!.loop).not.toBeNull();
    expect(isUnsliced(sample)).toBe(false);
    expect('unsliced' in sample).toBe(false);
  });

  it('cue markers are those inside the trim, as parts of it; none inside gives null', () => {
    const sample = { id: 's', name: 'a.wav', audioId: 'a', offset: 1, duration: 2, channel: 'stereo' as const, trim: 2, bars: null, markers: [0], cues: [0.5, 1.5, 2, 3.5] };
    expect(cueMarkers(sample)).toEqual([0, 0.25, 0.5]);
    expect(cueMarkers({ ...sample, cues: [0.2, 3.2] })).toBeNull();
    const { cues: _, ...none } = sample;
    void _;
    expect(cueMarkers(none)).toBeNull();
  });

  it("marking to slice in Import only marks: no bars guessed, nothing made; Don't slice takes it back", () => {
    let project = run(emptyProject(), addSample({ name: 'long.wav', audio: constantAudio(16) }));
    const id = Object.keys(project.samples)[0]!;
    const before = project;
    project = run(project, markUnsliced(id));
    expect(project.samples[id]).toMatchObject({ bars: null, markers: [0], unsliced: true });
    expect(project.matrices).toEqual(before.matrices);
    expect(project.pads).toEqual(before.pads);
    expect(project.hits).toEqual(before.hits);
    expect(run(project, setSlicing(id, null)).samples[id]).toEqual(before.samples[id]);
    expect(markUnsliced(id)(run(project, setSlicing(id, 1)), ctx).ok).toBe(false);
  });

  it("a new trim keeps the file's cues", () => {
    let project = run(emptyProject(), addSample({ name: 'cued.wav', audio: constantAudio(2), cues: [0.5, 1] }));
    const sample = Object.values(project.samples)[0]!;
    project = run(project, addTrim(sample.id));
    expect(Object.values(project.samples).map((s) => s.cues)).toEqual([
      [0.5, 1],
      [0.5, 1],
    ]);
  });
});

describe('files, trims, slices and matrices', () => {
  it('an imported file is trim 1, its matrix is named without the extension, and its slice after the trim', () => {
    const { project, sampleId, matrixId } = amen(4);
    const sample = project.samples[sampleId]!;
    expect(sample).toMatchObject({ name: 'amen.wav', trim: 1 });
    expect(trimName(sample)).toBe('amen trim 1');
    expect(sliceName(sample)).toBe('amen slice 1');
    expect(project.matrices[matrixId]!.name).toBe('amen 1');
  });

  it('a new trim of the same file is a row of its own, the old matrix untouched', () => {
    const { project, sampleId, matrixId } = amen(4);
    const sample = project.samples[sampleId]!;
    const next = run(project, addTrim(sampleId));
    const trim = by(next.samples, (s) => s.id !== sampleId);
    expect(trim).toMatchObject({ name: 'amen.wav', audioId: sample.audioId, trim: 2, offset: 0, bars: null, markers: [0] });
    expect(ownMatrix(next, trim.id)).toMatchObject({ name: 'amen 2' });
    expect(Object.keys(next.audio)).toHaveLength(1);
    expect(next.matrices[matrixId]).toEqual(project.matrices[matrixId]);
    expect(fileSamples(next, sample.audioId).map((s) => s.trim)).toEqual([1, 2]);
  });

  it('a slice becomes a one-shot: a new trim over just that slice', () => {
    const { project, sampleId, matrixId } = amen(4);
    const sample = project.samples[sampleId]!;
    const next = run(project, makeOneShot(sampleId, 2));
    const shot = by(next.samples, (s) => s.id !== sampleId);
    expect(shot).toMatchObject({ trim: 2, offset: sample.offset + 1, duration: 0.5, bars: null });
    expect(ownMatrix(next, shot.id)!.pads).toHaveLength(1);
    expect(next.matrices[matrixId]).toEqual(project.matrices[matrixId]);
    expect(makeOneShot(sampleId, 9)(project, ctx).ok).toBe(false);
  });

  it('renaming a matrix renames its own pads and hits and its loop; file, trim and slice stay', () => {
    const { project, sampleId, matrixId } = amen(4);
    const next = run(project, renameMatrix(matrixId, 'think'));
    const matrix = next.matrices[matrixId]!;
    expect(matrix.name).toBe('think');
    expect(next.pads[matrix.pads[6]!]!.name).toBe('think 07');
    expect(rowHit(next, matrixId, 1).name).toBe('think 02');
    expect(next.loops[matrix.loop!]!.name).toBe('think');
    expect(trimName(next.samples[sampleId]!)).toBe('amen trim 1');
    expect(sliceName(next.samples[sampleId]!)).toBe('amen slice 1');
    expect(renameMatrix(matrixId, ' ')(next, ctx).ok).toBe(false);
  });

  it("renaming leaves names that are not the matrix's own", () => {
    const { project: p0, sampleId } = amen(4);
    const { project, matrixId, pads } = withSnares(p0, [sampleId, 1]);
    const next = run(project, renameMatrix(matrixId, 'Hats'));
    expect(next.pads[pads[0]!]!.name).toBe('Hats 01');
    expect(next.hits['snare-hit-0']!.name).toBe('snare 0');
  });
});

describe("Don't slice on a sliced sample", () => {
  it('loses its slicing: pad 01 stays and plays the whole sample; the other rows, their hits and its loop go', () => {
    const { project, sampleId, matrixId } = amen(4);
    const first = project.matrices[matrixId]!.pads[0]!;
    // Rows made at 1/16 stay with the matrix, so 15 pads go.
    expect(unsliceTakes(project, sampleId)).toEqual(['15 pads', '15 hits', 'loop amen 1']);
    const after = run(project, setSlicing(sampleId, null));
    expect(after.samples[sampleId]).toMatchObject({ bars: null, markers: [0] });
    expect(after.matrices[matrixId]).toMatchObject({ pads: [first], loop: null });
    expect(Object.keys(after.loops)).toHaveLength(0);
    expect(Object.keys(after.pads)).toEqual([first]);
    const hit = after.hits[after.pads[first]!.members[0]!]!;
    expect(hit).toMatchObject({ name: 'amen 1', slice: 0 });
    expect(heard(after, hit)).toEqual([0, 2]);
    expect(after.pads[first]!.name).toBe('amen 1');
    expect(Object.keys(after.hits)).toHaveLength(1);
  });

  it('where its slices were used goes silent, and is listed first', () => {
    let { project, sampleId, matrixId } = amen(4);
    project = run(project, createLoop('Mine', 'main', 1));
    const mine = by(project.loops, (l) => l.name === 'Mine').id;
    const [p1, p2] = project.matrices[matrixId]!.pads;
    project = run(project, setStep(mine, 0, { padId: p1! }), setStep(mine, 4, { padId: p2! }), addClip('main', project.matrices[matrixId]!.loop!, 0));
    const withCopy = withSnares(project, [sampleId, 2]);
    expect(unsliceUsages(withCopy.project, sampleId)).toEqual([
      { kind: 'loop', id: mine, name: 'Mine' },
      { kind: 'song', id: null, name: 'Song' },
      { kind: 'pad', id: withCopy.pads[0], name: 'Snares 01' },
    ]);
    const after = run(withCopy.project, setSlicing(sampleId, null));
    const steps = after.loops[mine]!.steps;
    expect(steps[0]!.padId).toBe(p1);
    expect(steps[4]!.padId).toBeNull();
    expect(after.song.clips).toEqual([]);
    // The copy is silent: its slice is past the last marker.
    expect(heard(after, after.hits[withCopy.hits[0]!]!)).toBeNull();
  });

  it('an unsliced sample cannot be unsliced again', () => {
    const start = run(emptyProject(), addSample({ name: 'hit.wav', audio: constantAudio(1) }));
    const id = Object.keys(start.samples)[0]!;
    expect(setSlicing(id, null)(start, ctx).ok).toBe(false);
    expect(unsliceTakes(start, id)).toEqual([]);
    expect(unsliceUsages(start, id)).toEqual([]);
  });
});
