import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, Project } from './index';
import { addSample, createLoop, createProject, loopReach, reach, setBpm, setBreak, setMarkers, setStep, sliceAtMarkers, slicePlaces, updateHit } from './index';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** One bar of 2 s (a step is 0.125 s at 120 BPM), split +-|+-|+-----------: slices of 2, 2 and 12 steps. */
function sliced(bpm: number) {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(bpm));
  const id = Object.keys(start.samples)[0]!;
  const project = run(start, setBreak(id, 1), setMarkers(id, [0, 0.25, 0.5]), sliceAtMarkers(id));
  const m1 = Object.values(project.loops)[0]!;
  return { project, id, m1 };
}

const round = (xs: readonly number[]) => xs.map((x) => +x.toFixed(3));

describe('hit lengths', () => {
  it('a sound covers the steps after it until it ends', () => {
    expect(reach([2, null, null, 1.5, null, null, null])).toEqual([1, 1, 0, 1, 0.5, 0, 0]);
    expect(reach([null, 0.25, null])).toEqual([0, 0.25, 0]);
  });

  it('the next hit cuts a sound, and it does not wrap round', () => {
    expect(reach([3, null, 1, null])).toEqual([1, 1, 1, 0]);
    expect(reach([null, null, 4])).toEqual([0, 0, 1]);
  });

  it('the parent laid out in a loop shows each slice as long as it was in the break, at the break tempo', () => {
    const { project, m1 } = sliced(120);
    const covered = loopReach(project, m1);
    expect(round(covered)).toEqual(Array.from({ length: 16 }, () => 1));
    // Without the third slice, the second rings for its own two steps only.
    const gap = run(project, setStep(m1.id, 4, { padId: null }));
    expect(round(loopReach(gap, gap.loops[m1.id]!))).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('lengths are counted at the song tempo, with the hit and parent pitch', () => {
    const { project, m1, id } = sliced(60);
    // At 60 BPM a step is 0.25 s: the 0.25 s slices take one step each.
    const gap = run(project, setStep(m1.id, 4, { padId: null }));
    expect(round(loopReach(gap, gap.loops[m1.id]!)).slice(0, 6)).toEqual([1, 0, 1, 0, 0, 0]);
    // Up an octave on the parent, they play in half the time.
    const parent = Object.values(project.hits).find((h) => h.sampleId === id)!;
    const up = run(gap, setBpm(120), updateHit(parent.id, { pitch: 12 }));
    expect(round(loopReach(up, up.loops[m1.id]!)).slice(0, 6)).toEqual([1, 0, 1, 0, 0, 0]);
  });

  it('a one-shot shows its length too', () => {
    const start = run(createProject(), addSample({ name: 'crash.wav', audio: constantAudio(0.3) }), setBpm(120), createLoop('L', 'main', 1));
    const pad = Object.values(start.pads)[0]!;
    const loop = Object.values(start.loops)[0]!;
    const project = run(start, setStep(loop.id, 0, { padId: pad.id }));
    expect(round(loopReach(project, project.loops[loop.id]!)).slice(0, 4)).toEqual([1, 1, 0.4, 0]);
  });

  it('in Slice, each slice lands on its nearest step and a second slice on the same step is dropped', () => {
    // A step is 0.125 s: 0.3 and 0.31 both round to step 2.
    const places = slicePlaces([0, 0.3, 0.31, 1.06], 2, 16);
    expect(places.map((p) => p.slice)).toEqual([0, null, 1, null, null, null, null, null, 3, null, null, null, null, null, null, null]);
    expect(places[2]!.dropped).toEqual([2]);
    expect(places.filter((p) => p.dropped.length > 0)).toHaveLength(1);
    // Slice 0 is 0.3 s = 2.4 steps; slice 1 (0.01 s) is cut short at once.
    expect(round(places.map((p) => p.reach)).slice(0, 4)).toEqual([1, 1, 0.08, 0]);
  });
});
