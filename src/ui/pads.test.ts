import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addPad, addSample, copyHits, createMatrix, setPadChoice, createProject, renameMatrix, setHitSource, setSlicing, sliceSample } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { AUTOSCROLL_EDGE_PX, AUTOSCROLL_MAX_PX, EMPTY_COLUMN_PX, MIN_COLUMN_PX, autoscrollStep, dropCommand, dropTarget, hitLabel, nextMatrixName, padsOpen, stepSelection, timelineLayout, zoneOf } from './pads';
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

describe('where a drag drops', () => {
  const p = withSnares();
  const m = matrixOf(p, 'amen 1');
  const pad2 = p.pads[m.pads[1]!]!;
  const [own, copied] = pad2.members as [string, string];
  const snare = p.pads[matrixOf(p, 'Snares').pads[0]!]!.members[0]!;

  it('on a pad adds; on a hit replaces it; a hit on itself does nothing', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: snare }, { padId: pad2.id, hitId: null, zone: 'on' })).toEqual({ kind: 'add', padId: pad2.id });
    expect(dropTarget(p, { kind: 'hit', hitId: snare }, { padId: pad2.id, hitId: own, zone: 'on' })).toEqual({ kind: 'replace', padId: pad2.id, hitId: own });
    expect(dropTarget(p, { kind: 'hit', hitId: own }, { padId: pad2.id, hitId: own, zone: 'on' })).toBeNull();
  });

  it('between hits of its own pad moves; from another pad the edges of a hit still replace it', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: copied }, { padId: pad2.id, hitId: own, zone: 'before' })).toEqual({ kind: 'move', padId: pad2.id, hitId: copied, to: 0 });
    expect(dropTarget(p, { kind: 'hit', hitId: snare }, { padId: pad2.id, hitId: own, zone: 'before' })).toEqual({ kind: 'replace', padId: pad2.id, hitId: own });
    // Where it already is: nothing to do.
    expect(dropTarget(p, { kind: 'hit', hitId: copied }, { padId: pad2.id, hitId: own, zone: 'after' })).toBeNull();
  });

  it('a hit dropped on the empty part of its own pad moves last; already last, nothing', () => {
    expect(dropTarget(p, { kind: 'hit', hitId: own }, { padId: pad2.id, hitId: null, zone: 'on' })).toEqual({ kind: 'move', padId: pad2.id, hitId: own, to: 1 });
    expect(dropTarget(p, { kind: 'hit', hitId: copied }, { padId: pad2.id, hitId: null, zone: 'on' })).toBeNull();
  });

  it('all hits of a matrix add, also dropped on a hit', () => {
    const snares = matrixOf(p, 'Snares').id;
    expect(dropTarget(p, { kind: 'matrix', matrixId: snares }, { padId: pad2.id, hitId: own, zone: 'on' })).toEqual({ kind: 'add', padId: pad2.id });
  });

  it('the zone of a hit: its top and bottom edges are between hits', () => {
    expect(zoneOf(2, 0, 30)).toBe('before');
    expect(zoneOf(15, 0, 30)).toBe('on');
    expect(zoneOf(28, 0, 30)).toBe('after');
    expect(zoneOf(0, 0, 0)).toBe('on');
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
    const after = run(p, dropCommand({ kind: 'hit', hitId: snare }, { kind: 'add', padId: pad3.id }));
    const members = after.pads[pad3.id]!.members;
    expect(members).toHaveLength(2);
    expect(members[0]).toBe(pad3.members[0]);
    expect(after.hits[members[1]!]).toMatchObject({ sampleId: p.hits[snare]!.sampleId, name: p.hits[snare]!.name });
    expect(members[1]).not.toBe(snare);
    expect(after.pads[pad3.id]!.choice).toBe('roundRobin');
  });

  it('keeps a choice other than Top, and an empty pad given one hit stays on Top', () => {
    const empty = apply(p, setPadChoice(pad3.id, 'random'));
    expect(run(empty, dropCommand({ kind: 'hit', hitId: snare }, { kind: 'add', padId: pad3.id })).pads[pad3.id]!.choice).toBe('random');
    const withEmpty = apply(p, addPad(m.id));
    const newPad = matrixOf(withEmpty, 'amen 1').pads.at(-1)!;
    expect(run(withEmpty, dropCommand({ kind: 'hit', hitId: snare }, { kind: 'add', padId: newPad })).pads[newPad]!.choice).toBe('top');
  });

  it('all hits of a matrix are copied last, pad by pad', () => {
    const after = run(p, dropCommand({ kind: 'matrix', matrixId: matrixOf(p, 'Snares').id }, { kind: 'add', padId: pad3.id }));
    expect(after.pads[pad3.id]!.members.slice(1).map((h) => after.hits[h]!.name)).toEqual(snaresPad.members.map((h) => p.hits[h]!.name));
  });

  it('replaces a hit with a copy in its place', () => {
    const after = run(p, dropCommand({ kind: 'hit', hitId: snare }, { kind: 'replace', padId: pad2.id, hitId: pad2.members[0]! }));
    const members = after.pads[pad2.id]!.members;
    expect(members[1]).toBe(pad2.members[1]);
    expect(after.hits[members[0]!]!.name).toBe(p.hits[snare]!.name);
    expect(after.hits[pad2.members[0]!]).toBeUndefined();
  });

  it('moves a hit within its pad, also to first', () => {
    const after = run(p, dropCommand({ kind: 'hit', hitId: pad2.members[1]! }, { kind: 'move', padId: pad2.id, hitId: pad2.members[1]!, to: 0 }));
    expect(after.pads[pad2.id]!.members).toEqual([pad2.members[1], pad2.members[0]]);
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
