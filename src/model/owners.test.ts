import { describe, expect, it } from 'vitest';
import type { Matrix, Pad, Project, Sample } from './types';
import { NO_CONFIG } from './types';
import { matrixKind, matrixOfPad, padOfHit, sampleBpm } from './owners';

const pad = (id: string, members: readonly string[]): Pad => ({ id, name: id, members, choice: 'top', config: NO_CONFIG });
const matrix = (id: string, pads: readonly string[]): Matrix => ({ id, name: id, pads, config: NO_CONFIG, sampleId: null, loop: null });
const byId = <T extends { id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map((x) => [x.id, x]));

/** A project built by hand from its pads and matrices. */
function project(parts: { pads?: Pad[]; matrices?: Matrix[] }): Project {
  return {
    audio: {},
    samples: {},
    matrices: byId(parts.matrices ?? []),
    pads: byId(parts.pads ?? []),
    hits: {},
    loops: {},
    mods: {},
    song: { bpm: 120, bars: 1, clips: [] },
  };
}

describe('who owns what', () => {
  const p = project({ pads: [pad('p1', ['a', 'b']), pad('p2', ['c'])], matrices: [matrix('m', ['p1', 'p2'])] });

  it('a hit belongs to the pad that has it', () => {
    expect(padOfHit(p, 'b')?.id).toBe('p1');
    expect(padOfHit(p, 'c')?.id).toBe('p2');
    expect(padOfHit(p, 'x')).toBeUndefined();
  });

  it('a pad belongs to the matrix that has it', () => {
    expect(matrixOfPad(p, 'p2')?.id).toBe('m');
    expect(matrixOfPad(p, 'x')).toBeUndefined();
  });

  it('follows a new project, not the one it looked up before', () => {
    const moved = { ...p, pads: { ...p.pads, p1: pad('p1', ['a']), p2: pad('p2', ['c', 'b']) } };
    expect(padOfHit(p, 'b')?.id).toBe('p1');
    expect(padOfHit(moved, 'b')?.id).toBe('p2');
    const other = { ...p, matrices: { n: matrix('n', ['p2']) } };
    expect(matrixOfPad(other, 'p2')?.id).toBe('n');
  });

  it('matrixKind: one pad is a one-shot, more is a break', () => {
    expect(matrixKind(matrix('m', ['p1']))).toBe('one-shot');
    expect(matrixKind(matrix('m', ['p1', 'p2']))).toBe('break');
    expect(matrixKind(matrix('m', []))).toBe('one-shot');
  });
});

describe('the tempo of a sample', () => {
  const s: Sample = { id: 's', name: 'amen.wav', audioId: 'a', offset: 0, duration: 2, channel: 'stereo', trim: 1, bars: 1, markers: [0] };

  it('comes from its length and bars', () => {
    expect(sampleBpm(s)).toBeCloseTo(120);
  });

  it('is null when it is not sliced', () => {
    expect(sampleBpm({ ...s, bars: null })).toBeNull();
  });
});
