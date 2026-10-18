import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createMatrix, createProject, renameMatrix, setHitSource, setSlicing, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { EMPTY_COLUMN_PX, MIN_COLUMN_PX, hitLabel, nextMatrixName, padsOpen, timelineLayout } from './pads';
import { initialState } from './store';

const ctx = sequentialIds();

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** amen, one bar in four slices, as its own matrix "amen 1". */
function amen(): Project {
  const p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  return apply(p, setSlicing(Object.keys(p.samples)[0]!, 1, [0, 0.25, 0.5, 0.75]));
}
const matrixOf = (p: Project, name: string) => Object.values(p.matrices).find((m) => m.name === name)!;

describe('what is open in Pads', () => {
  const p = amen();
  const m = matrixOf(p, 'amen 1');
  const sel = initialState(p).selection;
  const pad = p.pads[m.pads[1]!]!;

  it('is nothing without a focus matrix', () => {
    expect(padsOpen(p, null, sel)).toBeNull();
  });

  it('is the matrix in focus, a pad of it, or a hit of it', () => {
    expect(padsOpen(p, m.id, sel)).toMatchObject({ kind: 'matrix', matrix: { id: m.id } });
    expect(padsOpen(p, m.id, { ...sel, pad: pad.id })).toMatchObject({ kind: 'pad', pad: { id: pad.id } });
    expect(padsOpen(p, m.id, { ...sel, pad: pad.id, hit: pad.members[0]! })).toMatchObject({ kind: 'hit', pad: { id: pad.id }, hit: { id: pad.members[0] } });
  });

  it('is the matrix when what is selected is in another matrix', () => {
    const q = apply(p, createMatrix('Snares'));
    const snares = matrixOf(q, 'Snares');
    expect(padsOpen(q, snares.id, { ...sel, pad: pad.id, hit: pad.members[0]! })).toMatchObject({ kind: 'matrix', matrix: { id: snares.id } });
  });
});

describe('the timeline layout', () => {
  it('makes each pad as wide as its steps, and an empty pad narrow', () => {
    const { columns, stepPx } = timelineLayout([4, 2, 0, 6, 4], 'fit', 640);
    expect(stepPx).toBeCloseTo((640 - EMPTY_COLUMN_PX) / 16);
    expect(columns.map((c) => c.width / stepPx)).toEqual([4, 2, EMPTY_COLUMN_PX / stepPx, 6, 4]);
    expect(columns.map((c) => c.start)).toEqual([0, 4, 6, 6, 12]);
    expect(columns[2]!.width).toBe(EMPTY_COLUMN_PX);
  });

  it('shows one bar per width at 1 bar', () => {
    const { stepPx } = timelineLayout([16, 16], '1 bar', 800);
    expect(stepPx).toBe(50);
  });

  it('fits 64 pads in 400 px with readable columns, scrolling in its own box', () => {
    const { columns, total } = timelineLayout(Array.from({ length: 64 }, () => 1), 'fit', 400);
    expect(columns).toHaveLength(64);
    expect(Math.min(...columns.map((c) => c.width))).toBeGreaterThanOrEqual(MIN_COLUMN_PX);
    // Wider than the box: the box scrolls, not the page.
    expect(total).toBeGreaterThan(400);
  });
});

describe('hit labels', () => {
  it('show a replaced slice as 15→07 and another trim as →think 07', () => {
    let p = apply(amen(), addSample({ name: 'think.wav', audio: constantAudio(2) }));
    const think = Object.values(p.samples).find((s) => s.name === 'think.wav')!;
    p = apply(p, sliceSample(think.id, 1));
    p = apply(p, renameMatrix(matrixOf(p, 'think 1').id, 'think'));
    const m = matrixOf(p, 'amen 1');
    const amenSample = p.samples[m.sampleId!]!;
    const row = (i: number) => p.pads[m.pads[i]!]!;
    // Row 04 plays slice 02 of its own trim; row 03 plays think 07.
    p = apply(p, setHitSource(row(3).members[0]!, amenSample.id, 1), setHitSource(row(2).members[0]!, think.id, 6));
    const label = (i: number) => hitLabel(p, row(i).id, i, p.hits[row(i).members[0]!]!);
    expect(label(0)).toBe('01');
    expect(label(3)).toBe('04→02');
    expect(label(2)).toBe('→think 07');
  });

  it('show a hit of a matrix built by hand by its name', () => {
    let p = apply(amen(), addSample({ name: 'snare.wav', audio: constantAudio(0.2) }), createMatrix('Snares'));
    const snares = matrixOf(p, 'Snares');
    const snare = Object.values(p.hits).find((h) => h.name.startsWith('snare'))!;
    p = apply(p, copyHits([snare.id], snares.pads[0]!));
    const copy = p.hits[p.pads[snares.pads[0]!]!.members[0]!]!;
    expect(hitLabel(p, snares.pads[0]!, 0, copy)).toBe(snare.name);
    expect(snare.name).toMatch(/^snare/);
  });
});

describe('a new matrix', () => {
  it('is Matrix 1, then the next number free', () => {
    const p = amen();
    expect(nextMatrixName(p)).toBe('Matrix 1');
    expect(nextMatrixName(apply(p, createMatrix('Matrix 1')))).toBe('Matrix 2');
    expect(nextMatrixName(apply(p, createMatrix('Matrix 2')))).toBe('Matrix 1');
  });
});
