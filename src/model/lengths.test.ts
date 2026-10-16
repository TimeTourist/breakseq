import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, Project } from './index';
import { addSample, createProject, holds, holdsIn, setBpm, setBreak, setMarkers, setStep, slicePlaces } from './index';

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
  const id = Object.keys(start.breaks)[0]!;
  const project = run(start, setBreak(id, 1), setMarkers(id, [0, 0.125, 0.25]));
  const m1 = Object.values(project.loops)[0]!;
  return { project, id, m1 };
}


describe('hit lengths', () => {
  it('a hit holds the steps up to the next hit, or the end, however long it rings', () => {
    expect(holds([true, false, true, false, true, false, false, false])).toEqual([
      { start: 0, length: 2 },
      { start: 2, length: 2 },
      { start: 4, length: 4 },
    ]);
    // Steps before the first hit are held by none.
    expect(holds([false, false, true, false])).toEqual([{ start: 2, length: 2 }]);
    expect(holds([false, false])).toEqual([]);
  });

  it('a hold over the end of a row goes on in the next', () => {
    const all = [{ start: 14, length: 4 }];
    expect(holdsIn(all, 0, 16)).toEqual([{ start: 14, length: 2 }]);
    expect(holdsIn(all, 16, 32)).toEqual([{ start: 16, length: 2 }]);
  });

  it('the parent laid out in a loop holds 2, 2 and 12 steps for a split +-|+-|+-----------', () => {
    const { project, m1 } = sliced(120);
    expect(holds(project.loops[m1.id]!.steps.map((s) => s.padId != null))).toEqual([
      { start: 0, length: 2 },
      { start: 2, length: 2 },
      { start: 4, length: 12 },
    ]);
    // Without the third slice, the second holds the rest of the loop.
    const gap = run(project, setStep(m1.id, 4, { padId: null }));
    expect(holds(gap.loops[m1.id]!.steps.map((s) => s.padId != null)).at(-1)).toEqual({ start: 2, length: 14 });
  });

  it('in Slice, each slice lands on its nearest step and a second slice on the same step is dropped', () => {
    // In a 2 s bar a step is 0.125 s: 0.3 and 0.31 s both round to step 2.
    const places = slicePlaces([0, 0.3, 0.31, 1.06].map((s) => s / 2), 16);
    expect(places.map((p) => p.slice)).toEqual([0, null, 1, null, null, null, null, null, 3, null, null, null, null, null, null, null]);
    expect(places[2]!.dropped).toEqual([2]);
    expect(places.filter((p) => p.dropped.length > 0)).toHaveLength(1);
  });
});
