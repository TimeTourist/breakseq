import { describe, expect, it } from 'vitest';
import type { Hit, Matrix, Pad, Project, Sample } from './types';
import { NO_CONFIG } from './types';
import { gridMarkers, slotHit } from './sound';
import { holds, holdsIn, hitSteps, matrixSequence, matrixSteps, padSteps, slicePlaces } from './lengths';

/** A sample of `duration` seconds, sliced over `bars` bars at `markers`, or unsliced. */
function sample(id: string, duration: number, bars: number | null = null, markers: readonly number[] = [0]): Sample {
  return { id, name: `${id}.wav`, audioId: 'a', offset: 0, duration, channel: 'stereo', trim: 1, bars, markers };
}
const byId = <T extends { id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map((x) => [x.id, x]));

/** One pad per hit, all in one matrix 'm'; hits are given as [sampleId, slice]. */
function laidOut(samples: Sample[], hits: readonly (readonly [string, number | null])[], bpm = 120): Project {
  const theHits: Hit[] = hits.map(([sampleId, slice], i) => slotHit(`h${i}`, `h${i}`, sampleId, slice));
  const pads: Pad[] = theHits.map((h) => ({ id: `p${h.id}`, name: h.id, members: [h.id], choice: 'top', config: NO_CONFIG }));
  const m: Matrix = { id: 'm', name: 'm', pads: pads.map((p) => p.id), config: NO_CONFIG, sampleId: null, loop: null };
  return {
    audio: {},
    samples: byId(samples),
    matrices: { m },
    pads: byId(pads),
    hits: byId(theHits),
    loops: {},
    mods: {},
    song: { bpm, bars: 1, clips: [] },
  };
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

  it('in Slice, each slice lands on its nearest step and a second slice on the same step is dropped', () => {
    // In a 2 s bar a step is 0.125 s: 0.3 and 0.31 s both round to step 2.
    const places = slicePlaces([0, 0.3, 0.31, 1.06].map((s) => s / 2), 16);
    expect(places.map((p) => p.slice)).toEqual([0, null, 1, null, null, null, null, null, 3, null, null, null, null, null, null, null]);
    expect(places[2]!.dropped).toEqual([2]);
    expect(places.filter((p) => p.dropped.length > 0)).toHaveLength(1);
  });

  // A step is 0.125 s at 120 BPM; 4 s hits take 32 steps, so use whole-step lengths: 0.25 s = 2 steps, 0.5 s = 4.
  it('lays pads out one after another by their first hit', () => {
    const project = laidOut([sample('a', 0.25), sample('b', 0.25), sample('c', 0.5)], [['a', null], ['b', null], ['c', null]]);
    expect(matrixSequence(project, 'm')).toEqual([
      { padId: 'ph0', step: 0, length: 2 },
      { padId: 'ph1', step: 2, length: 2 },
      { padId: 'ph2', step: 4, length: 4 },
    ]);
    expect(matrixSteps(project, 'm')).toBe(8);
  });

  it('a sliced sample lays out as today', () => {
    // Amen: 4 bars at 120 BPM is 8 s, sliced on the 1/16 grid.
    const amen = sample('amen', 8, 4, gridMarkers(4, 16));
    const project = laidOut([amen], amen.markers.map((_, i) => ['amen', i] as const));
    const seq = matrixSequence(project, 'm');
    expect(seq).toHaveLength(64);
    expect(seq.map((s) => s.step)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(seq.every((s) => s.length === 1)).toBe(true);
    expect(matrixSteps(project, 'm')).toBe(64);
  });

  it('a slice takes the steps up to the next slice, and the last up to the end', () => {
    // One bar, slices at steps 0, 2 and 4: 2, 2 and 12 steps.
    const s = sample('s', 2, 1, [0, 0.125, 0.25]);
    const project = laidOut([s], [['s', 0], ['s', 1], ['s', 2]]);
    expect(matrixSequence(project, 'm').map((x) => x.length)).toEqual([2, 2, 12]);
  });

  it('two slices on one step: only the first comes along', () => {
    // Markers 0.3 s and 0.31 s of 2 s both round to step 2 of 16.
    const s = sample('s', 2, 1, [0, 0.15, 0.155, 0.5]);
    const project = laidOut([s], [['s', 0], ['s', 1], ['s', 2], ['s', 3]]);
    expect(hitSteps(project, project.hits.h1!)).toBe(6);
    expect(hitSteps(project, project.hits.h2!)).toBe(0);
    expect(matrixSequence(project, 'm').map((x) => x.padId)).toEqual(['ph0', 'ph1', 'ph3']);
    expect(matrixSteps(project, 'm')).toBe(16);
  });

  it('a slice past the last marker is silent and takes no steps', () => {
    const s = sample('s', 2, 1, [0, 0.5]);
    const project = laidOut([s], [['s', 0], ['s', 2]]);
    expect(hitSteps(project, project.hits.h1!)).toBe(0);
    expect(matrixSequence(project, 'm')).toEqual([{ padId: 'ph0', step: 0, length: 8 }]);
  });

  it('a whole-sample hit takes its sound in the song tempo, rounded up, at least one step', () => {
    const project = laidOut([sample('s', 0.2), sample('t', 0.001)], [['s', null], ['t', null]]);
    expect(hitSteps(project, project.hits.h0!)).toBe(2);
    expect(hitSteps(project, project.hits.h1!)).toBe(1);
  });

  it('removing a pad moves everything after it forward', () => {
    const project = laidOut([sample('a', 0.25), sample('b', 0.25), sample('c', 0.5)], [['a', null], ['b', null], ['c', null]]);
    const m = project.matrices.m!;
    const without = { ...project, matrices: { m: { ...m, pads: ['ph0', 'ph2'] } } };
    expect(matrixSequence(without, 'm')).toEqual([
      { padId: 'ph0', step: 0, length: 2 },
      { padId: 'ph2', step: 2, length: 4 },
    ]);
  });

  it('an empty pad and an empty matrix take no steps', () => {
    const project = laidOut([], []);
    const empty: Pad = { id: 'e', name: 'e', members: [], choice: 'top', config: NO_CONFIG };
    expect(padSteps(project, empty)).toBe(0);
    expect(matrixSequence(project, 'm')).toEqual([]);
    expect(matrixSteps(project, 'm')).toBe(0);
  });
});
