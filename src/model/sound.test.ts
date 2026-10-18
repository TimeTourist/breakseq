import { describe, expect, it } from 'vitest';
import type { Config, Hit, Matrix, Pad, Project, Sample } from './types';
import { NO_CONFIG } from './types';
import {
  breakBpm,
  effectiveHit,
  gridMarkers,
  hitColour,
  hitSound,
  hitSpace,
  hitStretch,
  markerGrid,
  sliceName,
  sliceWindow,
  slotHit,
  slotName,
  slotStep,
  trimName,
} from './sound';

/** A sample of `duration` seconds, sliced over `bars` bars at `markers`, or unsliced. */
function sample(id: string, duration: number, bars: number | null = null, markers: readonly number[] = [0]): Sample {
  return { id, name: `${id}.wav`, audioId: 'a', offset: 0, duration, channel: 'stereo', trim: 1, bars, markers };
}
const hit = (id: string, sampleId: string, slice: number | null, config: Partial<Hit> = {}): Hit => ({
  ...slotHit(id, id, sampleId, slice),
  ...config,
});
const pad = (id: string, members: readonly string[], config: Partial<Config> = {}): Pad => ({
  id,
  name: id,
  members,
  choice: 'top',
  config: { ...NO_CONFIG, ...config },
});
const matrix = (id: string, pads: readonly string[], config: Partial<Config> = {}, sampleId: string | null = null): Matrix => ({
  id,
  name: id,
  pads,
  config: { ...NO_CONFIG, ...config },
  sampleId,
  loop: null,
});
const byId = <T extends { id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map((x) => [x.id, x]));

/** A project built by hand from its parts. */
function project(parts: { samples?: Sample[]; matrices?: Matrix[]; pads?: Pad[]; hits?: Hit[]; bpm?: number }): Project {
  return {
    audio: {},
    samples: byId(parts.samples ?? []),
    matrices: byId(parts.matrices ?? []),
    pads: byId(parts.pads ?? []),
    hits: byId(parts.hits ?? []),
    loops: {},
    mods: {},
    song: { bpm: parts.bpm ?? 120, bars: 1, clips: [] },
  };
}

/** One hit in one pad in one matrix, each with its own config. */
function layered(h: Partial<Config>, p: Partial<Config>, m: Partial<Config>, extra: { samples?: Sample[]; bpm?: number; sampleId?: string } = {}) {
  const sampleId = extra.sampleId ?? 's';
  const theHit = hit('h', sampleId, 0, h);
  const proj = project({
    samples: extra.samples ?? [sample('s', 2)],
    hits: [theHit],
    pads: [pad('p', ['h'], p)],
    matrices: [matrix('m', ['p'], m)],
    ...(extra.bpm === undefined ? {} : { bpm: extra.bpm }),
  });
  return { project: proj, hit: theHit };
}

describe('config in three layers', () => {
  it('effectiveHit adds pitch, volume and pan from pad and matrix', () => {
    const { project, hit } = layered({ pitch: 1, volume: 1, pan: 0.1 }, { pitch: 2, volume: 2, pan: 0.2 }, { pitch: 3, volume: 3, pan: 0.3 });
    const played = effectiveHit(project, hit);
    expect(played.pitch).toBe(6);
    expect(played.volume).toBe(6);
    expect(played.pan).toBeCloseTo(0.6);
  });

  it('each reverse layer flips the direction', () => {
    const two = layered({ direction: 'reverse' }, { direction: 'reverse' }, {});
    expect(effectiveHit(two.project, two.hit).direction).toBe('forward');
    const three = layered({ direction: 'reverse' }, { direction: 'reverse' }, { direction: 'reverse' });
    expect(effectiveHit(three.project, three.hit).direction).toBe('reverse');
    const matrixOnly = layered({}, {}, { direction: 'reverse' });
    expect(effectiveHit(matrixOnly.project, matrixOnly.hit).direction).toBe('reverse');
  });

  it('fade, dist, filter, reverb and delay come from the nearest layer that has one', () => {
    const { project, hit } = layered(
      { fadeOut: 0, reverb: { amount: 0, size: 0.9 } },
      { fadeOut: 0, dist: { mode: 'crush', amount: 0.7 }, filter: { type: 'highpass', cutoff: 500, resonance: 0.1 } },
      { fadeOut: 40, dist: { mode: 'drive', amount: 0.2 }, reverb: { amount: 0.3, size: 0.4 }, delay: { amount: 0.5, steps: 2, feedback: 0.3 } },
    );
    expect(effectiveHit(project, hit).fadeOut).toBe(40);
    expect(hitColour(project, hit)).toEqual({ dist: { mode: 'crush', amount: 0.7 }, filter: { type: 'highpass', cutoff: 500, resonance: 0.1 } });
    expect(hitSpace(project, hit)).toEqual({ reverb: { amount: 0.3, size: 0.4 }, delay: { amount: 0.5, steps: 2, feedback: 0.3 } });

    // The hit's own wins over its pad's and matrix's.
    const own = layered({ fadeOut: 10, dist: { mode: 'decimate', amount: 0.1 } }, { fadeOut: 20, dist: { mode: 'crush', amount: 0.7 } }, { fadeOut: 40 });
    expect(effectiveHit(own.project, own.hit).fadeOut).toBe(10);
    expect(hitColour(own.project, own.hit).dist).toEqual({ mode: 'decimate', amount: 0.1 });
  });

  it('nothing in any layer plays no dist, filter, reverb or delay', () => {
    const { project, hit } = layered({}, {}, {});
    expect(hitColour(project, hit)).toEqual({ dist: null, filter: null });
    expect(hitSpace(project, hit)).toEqual({ reverb: null, delay: null });
  });

  it('fit to tempo counts once', () => {
    // Four bars at 136 BPM.
    const s = sample('s', breakDuration(4, 136), 4, gridMarkers(4));
    const fit = { mode: 'fit', factor: 1, grain: null, from: null } as const;
    const { project, hit } = layered({ stretch: fit }, { stretch: fit }, { stretch: { mode: 'factor', factor: 2, grain: null, from: null } }, { samples: [s], bpm: 170 });
    expect(hitStretch(project, hit).factor).toBeCloseTo((136 / 170) * 2);
  });

  it("fit takes the tempo of the hit's sample, not the matrix's", () => {
    const snare = sample('snare', breakDuration(1, 136), 1, gridMarkers(1));
    const own = sample('own', breakDuration(1, 170), 1, gridMarkers(1));
    const fit = { mode: 'fit', factor: 1, grain: null, from: null } as const;
    const theHit = hit('h', 'snare', 3, { stretch: fit });
    const proj = project({ samples: [snare, own], hits: [theHit], pads: [pad('p', ['h'])], matrices: [matrix('m', ['p'], {}, 'own')], bpm: 170 });
    expect(hitStretch(proj, theHit).factor).toBeCloseTo(136 / 170);
  });

  it('grain and grid come from the nearest layer that has them, else the defaults', () => {
    const none = layered({}, {}, {});
    expect(hitStretch(none.project, none.hit)).toEqual({ factor: 1, grain: 30, from: 'break' });
    const set = layered(
      { stretch: { mode: 'off', factor: 1, grain: null, from: 'hit' } },
      { stretch: { mode: 'off', factor: 1, grain: 80, from: null } },
      { stretch: { mode: 'off', factor: 1, grain: 200, from: 'break' } },
    );
    expect(hitStretch(set.project, set.hit)).toEqual({ factor: 1, grain: 80, from: 'hit' });
  });

  it('a hit follows the layers where it lives', () => {
    const fields: Partial<Config> = { pitch: 1, volume: -2 };
    const a = hit('a', 's', 0, fields);
    const b = hit('b', 's', 0, fields);
    const proj = project({
      samples: [sample('s', 2)],
      hits: [a, b],
      pads: [pad('pa', ['a'], { pitch: 2 }), pad('pb', ['b'], { volume: 3 })],
      matrices: [matrix('ma', ['pa'], { pitch: 5 }), matrix('mb', ['pb'], { volume: -6 })],
    });
    expect(effectiveHit(proj, a)).toMatchObject({ pitch: 8, volume: -2 });
    expect(effectiveHit(proj, b)).toMatchObject({ pitch: 1, volume: -5 });
  });

  it('a hit in no pad plays as it is', () => {
    const lone = hit('h', 's', 0, { pitch: 4 });
    const proj = project({ samples: [sample('s', 2)], hits: [lone] });
    expect(effectiveHit(proj, lone).pitch).toBe(4);
  });
});

/** Seconds that `bars` bars last at `bpm`. */
const breakDuration = (bars: number, bpm: number): number => (bars * 4 * 60) / bpm;

describe('what a hit sounds', () => {
  const amen = sample('amen', 2, 1, [0, 0.25, 0.5, 0.75]);

  it('hitSound plays a slice of the sample', () => {
    const h = hit('h', 'amen', 1, { region: { start: 0.5, end: 1 } });
    const sound = hitSound(project({ samples: [amen], hits: [h] }), h);
    expect(sound?.sample).toBe(amen);
    expect(sound?.region).toEqual({ start: 0.75, end: 1 });

    const whole = hit('w', 'amen', null);
    expect(hitSound(project({ samples: [amen], hits: [whole] }), whole)?.region).toEqual({ start: 0, end: 2 });
  });

  it('a slice past the last marker is silent', () => {
    const h = hit('h', 'amen', 4);
    expect(hitSound(project({ samples: [amen], hits: [h] }), h)).toBeNull();
    const missing = hit('m', 'gone', 0);
    expect(hitSound(project({ samples: [amen], hits: [missing] }), missing)).toBeNull();
  });

  it('sliceWindow is where a slice lies in its sample, in seconds', () => {
    expect(sliceWindow(amen, 3)).toEqual({ start: 1.5, end: 2 });
    expect(sliceWindow(amen, null)).toEqual({ start: 0, end: 2 });
    expect(sliceWindow(amen, 4)).toBeNull();
  });
});

describe('grids, tempo and names', () => {
  it('grid markers are equal parts, and a grid is found from its markers', () => {
    expect(gridMarkers(1, 4)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(markerGrid(gridMarkers(2, 8), 2)).toBe(8);
    expect(markerGrid([0, 0.3], 1)).toBeNull();
  });

  it('a slice lands on its nearest step', () => {
    expect(slotStep(0.26, 16)).toBe(4);
  });

  it('a sample of 4 bars over 7.06 s is about 136 BPM', () => {
    expect(breakBpm(breakDuration(4, 136), 4)).toBeCloseTo(136);
  });

  it('names a trim, its slicing, and its rows', () => {
    const s = { ...sample('s', 2), name: 'amen.wav', trim: 2 };
    expect(trimName(s)).toBe('amen trim 2');
    expect(sliceName(s)).toBe('amen slice 2');
    expect(slotName('amen 2', { ...s, bars: 1 }, 4)).toBe('amen 2 05');
    expect(slotName('snare.wav', s, 0)).toBe('snare');
  });

  it('slotHit plays a whole slice unchanged', () => {
    expect(slotHit('h', 'amen 01', 's', 0)).toEqual({ ...NO_CONFIG, id: 'h', name: 'amen 01', sampleId: 's', slice: 0, region: { start: 0, end: 1 }, variantOf: null });
  });
});
