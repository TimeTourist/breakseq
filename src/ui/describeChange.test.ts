import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import {
  addSample,
  addSlicedSample,
  addTrim,
  cloneMatrix,
  copyHits,
  copyPad,
  createMatrix,
  createProject,
  ownMatrix,
  removeAnyway,
  replaceHit,
  replaceProject,
  setBpm,
  setMarkers,
  setSlicing,
  setSongBars,
  sliceSample,
  updateHit,
} from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { describeChange } from './describeChange';

const ctx = sequentialIds();
const apply = (project: Project, command: Command) => {
  const r = command(project, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
};
/** What the undo button says after `command`. */
const said = (project: Project, command: Command) => describeChange(project, apply(project, command));

/** amen.wav sliced in four over one bar, and snare.wav. */
function amenAndSnare() {
  const start = apply(apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) })), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
  const amen = Object.values(start.samples).find((s) => s.name === 'amen.wav')!;
  const project = apply(start, sliceSample(amen.id, 1, 4));
  const snare = ownMatrix(project, Object.values(project.samples).find((s) => s.name === 'snare.wav')!.id)!;
  return { project, amen: project.samples[amen.id]!, matrix: ownMatrix(project, amen.id)!, snare };
}

describe('describeChange', () => {
  it('names what changed, in a few words', () => {
    const empty = createProject();
    const one = apply(empty, addSample({ name: 'amen.wav', audio: constantAudio(0.1) }));
    const hit = Object.values(one.hits)[0]!;
    expect(describeChange(one, apply(one, updateHit(hit.id, { pitch: 2 })))).toBe('change hit amen 1');
    expect(describeChange(one, apply(one, setBpm(140)))).toBe('change the tempo');
    expect(describeChange(one, apply(one, setSongBars(4)))).toBe('change the song');
  });
});

describe('describeChange for a matrix', () => {
  it('names the matrix, not its pads and hits, when one is made, cloned or removed', () => {
    const one = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(0.5) }));
    const id = Object.keys(one.matrices)[0]!;
    expect(describeChange(one, apply(one, removeAnyway('matrix', id)))).toBe('remove matrix amen 1');
    expect(describeChange(one, apply(one, cloneMatrix(id)))).toBe('new matrix amen 1 copy');
    expect(describeChange(one, apply(one, createMatrix('Snares')))).toBe('new matrix Snares');
  });
});

describe('describeChange says what happened (U14)', () => {
  it('importing a file names the file; a project file is a project', () => {
    const empty = createProject();
    expect(said(empty, addSample({ name: 'amen.wav', audio: constantAudio(0.1) }))).toBe('import amen.wav');
    expect(said(empty, addSlicedSample({ name: '120Stereo.rx2', audio: constantAudio(2), bars: 1, markers: [0, 0.5] }))).toBe('import 120Stereo.rx2');
    const { project } = amenAndSnare();
    expect(said(empty, replaceProject(project))).toBe('import project');
  });

  it('slicing, moving a marker and renumbering name the trim or the marker', () => {
    const one = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const sample = Object.values(one.samples)[0]!;
    expect(said(one, sliceSample(sample.id, 1, 4))).toBe('slice amen 1');
    const { project, amen, matrix } = amenAndSnare();
    expect(said(project, setSlicing(amen.id, null))).toBe("don't slice amen 1");
    expect(said(project, setMarkers(amen.id, [0, 0.3, 0.5, 0.75]))).toBe('move marker');
    expect(said(project, setMarkers(amen.id, [0, 0.25, 0.5, 0.75, 0.9]))).toBe('add marker');
    expect(said(project, setMarkers(amen.id, [0, 0.25, 0.5]))).toBe('remove marker');
    // Slice 3 played twice: a marker before it renumbers a used slice.
    const pad3 = project.pads[matrix.pads[2]!]!;
    const twice = apply(project, copyHits([pad3.members[0]!], matrix.pads[0]!));
    expect(said(twice, setMarkers(amen.id, [0, 0.1, 0.25, 0.5, 0.75]))).toBe('renumber amen 1');
    expect(said(twice, setMarkers(amen.id, [0, 0.1, 0.25, 0.5, 0.75], true))).toBe('new sample amen 2');
  });

  it('a new trim names it', () => {
    const { project, amen } = amenAndSnare();
    expect(said(project, addTrim(amen.id, { offset: 0, duration: 0.2 }))).toBe('new sample amen 2');
  });

  it('copying a pad names its row; a hit dropped on a hit replaces it', () => {
    const { project, matrix, snare } = amenAndSnare();
    // amen 1 has 4 pads: a copy of snare's pad becomes row 05.
    expect(said(project, copyPad(snare.pads[0]!, matrix.id))).toBe('copy pad 05');
    const target = project.pads[matrix.pads[1]!]!.members[0]!;
    const source = project.pads[snare.pads[0]!]!.members[0]!;
    expect(said(project, replaceHit(target, source))).toBe('replace hit');
    expect(said(project, copyHits([source], matrix.pads[1]!))).toBe('copy hit snare 1');
  });
});
