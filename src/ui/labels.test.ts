import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, ownMatrix, setHitSource, setMarkers, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { padGroups, padLabel, replacedBy } from './labels';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** amen.wav sliced in four over one bar, and a one-shot snare.wav. */
function amenAndSnare() {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
  const amen = Object.values(start.samples).find((s) => s.name === 'amen.wav')!;
  const project = run(start, sliceSample(amen.id, 1, 4));
  return { project, amen: ownMatrix(project, amen.id)!, sample: amen };
}

describe('pads grouped in the shelf', () => {
  it('each break by its matrix, its pads in order; matrices with one pad under One-shots', () => {
    const { project, amen } = amenAndSnare();
    const groups = padGroups(project);
    expect(groups.map((g) => [g.name, g.items.map((p) => p.name), g.matrixId])).toEqual([
      ['amen 1', ['amen 1 01', 'amen 1 02', 'amen 1 03', 'amen 1 04'], amen.id],
      ['One-shots', ['snare 1'], undefined],
    ]);
    expect(groups[0]!.items.map(padLabel)).toEqual(['01', '02', '03', '04']);
  });

  it('a pad past its sample’s last slice is left out while no loop plays it', () => {
    const { project, sample } = amenAndSnare();
    const fewer = run(project, setMarkers(sample.id, [0, 0.25, 0.5]));
    const loop = Object.values(fewer.loops)[0]!;
    const unplayed = { ...fewer, loops: { [loop.id]: { ...loop, steps: loop.steps.map((s) => ({ ...s, padId: null })) } } };
    expect(padGroups(unplayed)[0]!.items.map((p) => p.name)).toEqual(['amen 1 01', 'amen 1 02', 'amen 1 03']);
  });
});

describe('a hit that plays another slice than its row', () => {
  it('reads as the slice it plays: "02", or another sample’s matrix and slice', () => {
    const { project, amen, sample } = amenAndSnare();
    const row4 = project.pads[amen.pads[3]!]!;
    const hit = project.hits[row4.members[0]!]!;
    expect(replacedBy(project, row4.id, hit)).toBeNull();
    const moved = run(project, setHitSource(hit.id, sample.id, 1));
    expect(replacedBy(moved, row4.id, moved.hits[hit.id]!)).toBe('02');
    const snare = Object.values(project.samples).find((s) => s.name === 'snare.wav')!;
    const other = run(project, setHitSource(hit.id, snare.id, null));
    expect(replacedBy(other, row4.id, other.hits[hit.id]!)).toBe('snare 1');
  });
});
