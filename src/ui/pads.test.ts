import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addPad, addSample, copyHits, createMatrix, setPadChoice, createProject, renameMatrix, setHitSource, setSlicing, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { AUTOSCROLL_EDGE_PX, AUTOSCROLL_MAX_PX, autoscrollStep, dropCommand, dropLabel, dropTarget, hitLabel, nextMatrixName, padsOpen, sideOf, stepSelection, zoneOf } from './pads';
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

  it('show a one-shot named in digits as →808, not as a slice of the trim', () => {
    let p = apply(amen(), addSample({ name: '808.wav', audio: constantAudio(0.2) }));
    const kick = Object.values(p.samples).find((s) => s.name === '808.wav')!;
    const own = Object.values(p.matrices).find((m) => m.sampleId === kick.id)!;
    p = apply(p, renameMatrix(own.id, '808'));
    const m = matrixOf(p, 'amen 1');
    const row = p.pads[m.pads[2]!]!;
    p = apply(p, setHitSource(row.members[0]!, kick.id, null));
    expect(hitLabel(p, row.id, 2, p.hits[row.members[0]!]!)).toBe('→808');
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

/** amen 1 with pad 02 holding a copy of slice 04 under its own, and a hand-built Snares of two one-shots. */
function withSnares(): Project {
  const p = apply(amen(), addSample({ name: 'snare_01.wav', audio: constantAudio(0.1) }), addSample({ name: 'snare_02.wav', audio: constantAudio(0.1) }), createMatrix('Snares'));
  const m = matrixOf(p, 'amen 1');
  const snares = matrixOf(p, 'Snares');
  const oneShots = Object.values(p.hits).filter((h) => h.name.startsWith('snare_')).map((h) => h.id);
  return apply(p, copyHits([p.pads[m.pads[3]!]!.members[0]!], m.pads[1]!), copyHits(oneShots, snares.pads[0]!));
}
const run = (p: Project, c: Command | null) => apply(p, c!);

describe('where a drag drops (Magnus beslut)', () => {
  const p = withSnares();
  const m = matrixOf(p, 'amen 1');
  const pad2 = p.pads[m.pads[1]!]!;
  const pad3 = p.pads[m.pads[2]!]!;
  const [own, copied] = pad2.members as [string, string];
  const snaresPad = p.pads[matrixOf(p, 'Snares').pads[0]!]!;
  const snare = snaresPad.members[0]!;
  const onPad = (padId: string, hitId: string | null = null, zone: 'before' | 'after' = 'after', side: 'before' | 'middle' | 'after' = 'middle') => ({ kind: 'pad' as const, padId, hitId, zone, side });

  it('from the list a pad or a hit always copies onto a pad, on a hit of it or not', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: snare, from: 'list' }, onPad(pad2.id))).toEqual({ kind: 'add', padId: pad2.id, hitIds: [snare] });
    expect(dropTarget(p, { kind: 'hit', hitId: snare, from: 'list' }, onPad(pad2.id, own, 'before', 'before'))).toEqual({ kind: 'add', padId: pad2.id, hitIds: [snare] });
    expect(dropTarget(p, { kind: 'pad', padId: snaresPad.id, from: 'list' }, onPad(pad3.id, null, 'after', 'after'))).toEqual({ kind: 'add', padId: pad3.id, hitIds: snaresPad.members });
    // A hit of the pad itself, from the list, is copied into it too.
    expect(dropTarget(p, { kind: 'hit', hitId: own, from: 'list' }, onPad(pad2.id))).toEqual({ kind: 'add', padId: pad2.id, hitIds: [own] });
  });

  it('a hit from the grid is always copied to another pad: there is no Shift-move', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: own, from: 'grid' }, onPad(pad3.id))).toEqual({ kind: 'add', padId: pad3.id, hitIds: [own] });
  });

  it('within its own pad a hit from the grid reorders, before or after the hit it is over', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: copied, from: 'grid' }, onPad(pad2.id, own, 'before'))).toEqual({ kind: 'reorder', padId: pad2.id, hitId: copied, to: 0 });
    // Where it already is: nothing.
    expect(dropTarget(p, { kind: 'hit', hitId: copied, from: 'grid' }, onPad(pad2.id, own, 'after'))).toBeNull();
    expect(dropTarget(p, { kind: 'hit', hitId: copied, from: 'grid' }, onPad(pad2.id, copied))).toBeNull();
    // Off the hits, on its own pad (its number or the empty part): a variant (Magnus beslut).
    expect(dropTarget(p, { kind: 'hit', hitId: copied, from: 'grid' }, onPad(pad2.id))).toEqual({ kind: 'variant', padId: pad2.id, hitId: copied });
    expect(dropLabel(p, { kind: 'hit', hitId: copied, from: 'grid' }, { kind: 'variant', padId: pad2.id, hitId: copied })).toBe('Variant');
    // From the list, its own pad still gets a copy.
    expect(dropTarget(p, { kind: 'hit', hitId: copied, from: 'list' }, onPad(pad2.id))).toEqual({ kind: 'add', padId: pad2.id, hitIds: [copied] });
    expect(dropTarget(p, { kind: 'hit', hitId: own, from: 'grid' }, onPad(pad2.id, copied, 'after'))).toEqual({ kind: 'reorder', padId: pad2.id, hitId: own, to: 1 });
  });

  it('a pad from the grid moves beside another, copies into the middle of one, and does nothing on itself', () => {
    const pad1 = m.pads[0]!;
    const pad4 = m.pads[3]!;
    const grid = { kind: 'pad' as const, padId: pad1, from: 'grid' as const };
    expect(dropTarget(p, grid, onPad(pad3.id, null, 'after', 'before'))).toEqual({ kind: 'movePad', matrixId: m.id, padId: pad1, to: 1 });
    expect(dropTarget(p, grid, onPad(pad4, null, 'after', 'after'))).toEqual({ kind: 'movePad', matrixId: m.id, padId: pad1, to: 3 });
    expect(dropTarget(p, { kind: 'pad', padId: pad4, from: 'grid' }, onPad(pad1, null, 'after', 'before'))).toEqual({ kind: 'movePad', matrixId: m.id, padId: pad4, to: 0 });
    // Where it is already: beside itself or its neighbour's near side.
    expect(dropTarget(p, grid, onPad(pad1, null, 'after', 'before'))).toBeNull();
    expect(dropTarget(p, grid, onPad(pad2.id, null, 'after', 'before'))).toBeNull();
    expect(dropTarget(p, grid, onPad(pad1))).toBeNull();
    expect(dropTarget(p, grid, onPad(pad3.id))).toEqual({ kind: 'add', padId: pad3.id, hitIds: p.pads[pad1]!.members });
    // A pad of another matrix does not move into this one.
    expect(dropTarget(p, { kind: 'pad', padId: snaresPad.id, from: 'grid' }, onPad(pad3.id, null, 'after', 'before'))).toBeNull();
  });

  it('on the place after the pads a new pad with copies', () => {
    const after = { kind: 'new' as const, matrixId: m.id };
    expect(dropTarget(p, { kind: 'pad', padId: snaresPad.id, from: 'list' }, after)).toEqual({ kind: 'new', matrixId: m.id, hitIds: snaresPad.members });
    expect(dropTarget(p, { kind: 'hit', hitId: own, from: 'grid' }, after)).toEqual({ kind: 'new', matrixId: m.id, hitIds: [own] });
    expect(dropTarget(p, { kind: 'pad', padId: pad2.id, from: 'grid' }, after)).toEqual({ kind: 'new', matrixId: m.id, hitIds: pad2.members });
  });

  it('an empty pad brings nothing', () => {
    const q = apply(p, addPad(m.id));
    const empty = matrixOf(q, 'amen 1').pads.at(-1)!;
    expect(dropTarget(q, { kind: 'pad', padId: empty, from: 'list' }, onPad(pad2.id))).toBeNull();
  });

  it('the target says what happens: Copy, Move pad here, or Copy 2 hits into 03', () => {
    expect(dropLabel(p, { kind: 'pad', padId: snaresPad.id, from: 'list' }, { kind: 'add', padId: pad3.id, hitIds: [snare] })).toBe('Copy');
    expect(dropLabel(p, { kind: 'hit', hitId: own, from: 'grid' }, { kind: 'add', padId: pad3.id, hitIds: [own] })).toBe('Copy');
    expect(dropLabel(p, { kind: 'pad', padId: pad2.id, from: 'grid' }, { kind: 'movePad', matrixId: m.id, padId: pad2.id, to: 3 })).toBe('Move pad here');
    expect(dropLabel(p, { kind: 'pad', padId: pad2.id, from: 'grid' }, { kind: 'add', padId: pad3.id, hitIds: pad2.members })).toBe('Copy 2 hits into 03');
  });

  it('the zone of a hit chip is its upper or lower half, and the side of a pad its outer quarters', () => {
    expect(zoneOf(14, 0, 30)).toBe('before');
    expect(zoneOf(16, 0, 30)).toBe('after');
    expect(zoneOf(0, 0, 0)).toBe('before');
    expect([10, 30, 50, 70, 90].map((x) => sideOf(x, 0, 100))).toEqual(['before', 'middle', 'middle', 'middle', 'after']);
  });
});

describe('what a drop does', () => {
  const p = withSnares();
  const m = matrixOf(p, 'amen 1');
  const pad2 = p.pads[m.pads[1]!]!;
  const pad3 = p.pads[m.pads[2]!]!;
  const snaresPad = p.pads[matrixOf(p, 'Snares').pads[0]!]!;
  const snare = snaresPad.members[0]!;

  it('adds copies last, and a pad on Top with more than one hit turns Round robin', () => {
    const after = run(p, dropCommand({ kind: 'add', padId: pad3.id, hitIds: [snare] }));
    const members = after.pads[pad3.id]!.members;
    expect(members).toHaveLength(2);
    expect(members[0]).toBe(pad3.members[0]);
    expect(after.hits[members[1]!]).toMatchObject({ sampleId: p.hits[snare]!.sampleId, name: p.hits[snare]!.name });
    expect(members[1]).not.toBe(snare);
    expect(after.pads[pad3.id]!.choice).toBe('roundRobin');
    expect(after.pads[snaresPad.id]!.members).toEqual(snaresPad.members);
  });

  it('keeps a choice other than Top, and an empty pad given one hit stays on Top', () => {
    const empty = apply(p, setPadChoice(pad3.id, 'random'));
    expect(run(empty, dropCommand({ kind: 'add', padId: pad3.id, hitIds: [snare] })).pads[pad3.id]!.choice).toBe('random');
    const withEmpty = apply(p, addPad(m.id));
    const newPad = matrixOf(withEmpty, 'amen 1').pads.at(-1)!;
    expect(run(withEmpty, dropCommand({ kind: 'add', padId: newPad, hitIds: [snare] })).pads[newPad]!.choice).toBe('top');
  });

  it('makes a variant of a hit, last in its pad, as the Variant button does', () => {
    const hit = p.hits[pad2.members[0]!]!;
    const after = run(p, dropCommand({ kind: 'variant', padId: pad2.id, hitId: hit.id }));
    const members = after.pads[pad2.id]!.members;
    expect(members).toHaveLength(3);
    expect(after.hits[members[2]!]).toMatchObject({ name: `${hit.name} var`, variantOf: hit.id, sampleId: hit.sampleId });
  });

  it('reorders a hit within its pad, also to first', () => {
    const after = run(p, dropCommand({ kind: 'reorder', padId: pad2.id, hitId: pad2.members[1]!, to: 0 }));
    expect(after.pads[pad2.id]!.members).toEqual([pad2.members[1], pad2.members[0]]);
  });

  it('moves a pad with its hits to another place in the matrix', () => {
    const after = run(p, dropCommand({ kind: 'movePad', matrixId: m.id, padId: m.pads[0]!, to: 2 }));
    expect(matrixOf(after, 'amen 1').pads).toEqual([m.pads[1], m.pads[2], m.pads[0], m.pads[3]]);
    expect(after.pads[m.pads[0]!]!.members).toEqual(p.pads[m.pads[0]!]!.members);
  });

  it('makes a new pad last with copies', () => {
    const copied = run(p, dropCommand({ kind: 'new', matrixId: m.id, hitIds: [snare] }));
    const made = copied.pads[matrixOf(copied, 'amen 1').pads.at(-1)!]!;
    expect(made.members).toHaveLength(1);
    expect(copied.hits[made.members[0]!]!.sampleId).toBe(p.hits[snare]!.sampleId);
    expect(copied.pads[snaresPad.id]!.members).toEqual(snaresPad.members);
  });
});

describe('autoscroll while dragging', () => {
  it('scrolls back near the start, on near the end, faster closer to the edge, and not in the middle', () => {
    expect(autoscrollStep(500, 0, 1000)).toBe(0);
    expect(autoscrollStep(AUTOSCROLL_EDGE_PX + 1, 0, 1000)).toBe(0);
    expect(autoscrollStep(0, 0, 1000)).toBe(-AUTOSCROLL_MAX_PX);
    expect(autoscrollStep(1000, 0, 1000)).toBe(AUTOSCROLL_MAX_PX);
    expect(autoscrollStep(990, 0, 1000)).toBeGreaterThan(autoscrollStep(980, 0, 1000));
    expect(autoscrollStep(980, 0, 1000)).toBeGreaterThan(0);
    // Past the box, as the pointer leaves it, at full speed.
    expect(autoscrollStep(1100, 0, 1000)).toBe(AUTOSCROLL_MAX_PX);
  });
});

describe('arrow keys in Pads', () => {
  const p = withSnares();
  const m = matrixOf(p, 'amen 1');
  const pad = (i: number) => p.pads[m.pads[i]!]!;
  const open = (padIndex: number | null, hit: number | null) => padsOpen(p, m.id, { pad: padIndex === null ? null : m.pads[padIndex]!, hit: padIndex === null || hit === null ? null : pad(padIndex).members[hit]! })!;

  it('←/→ go from pad to pad, from the matrix to the first or last, and stop at the ends', () => {
    expect(stepSelection(open(null, null), 'ArrowRight')).toEqual({ pad: m.pads[0], hit: null });
    expect(stepSelection(open(null, null), 'ArrowLeft')).toEqual({ pad: m.pads[3], hit: null });
    expect(stepSelection(open(1, 1), 'ArrowRight')).toEqual({ pad: m.pads[2], hit: null });
    expect(stepSelection(open(1, null), 'ArrowLeft')).toEqual({ pad: m.pads[0], hit: null });
    expect(stepSelection(open(0, null), 'ArrowLeft')).toBeNull();
    expect(stepSelection(open(3, null), 'ArrowRight')).toBeNull();
  });

  it('↑/↓ go through the hits of the pad, ↑ from the first back to the pad', () => {
    expect(stepSelection(open(1, null), 'ArrowDown')).toEqual({ pad: m.pads[1], hit: pad(1).members[0] });
    expect(stepSelection(open(1, 0), 'ArrowDown')).toEqual({ pad: m.pads[1], hit: pad(1).members[1] });
    expect(stepSelection(open(1, 1), 'ArrowDown')).toBeNull();
    expect(stepSelection(open(1, 1), 'ArrowUp')).toEqual({ pad: m.pads[1], hit: pad(1).members[0] });
    expect(stepSelection(open(1, 0), 'ArrowUp')).toEqual({ pad: m.pads[1], hit: null });
    expect(stepSelection(open(1, null), 'ArrowUp')).toBeNull();
    expect(stepSelection(open(null, null), 'ArrowDown')).toBeNull();
  });
});
