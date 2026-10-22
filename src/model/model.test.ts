import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext, Project, StepEffect, TapeEffect } from './index';
import {
  addPad,
  addSample,
  addVariant,
  copyHits,
  createMatrix,
  findUsages,
  setSlicing,
  guessBars,
  unlikelyBpm,
  seal,
  setBpm,
  setLoopLength,
  setSongBars,
  apply,
  createHistory,
  createLoop,
  createMod,
  createProject,
  redo,
  heardInSong,
  remove,
  removeAnyway,
  removePadMember,
  addClip,
  moveSteps,
  addEffect,
  removeEffect,
  replaceEffect,
  copyClip,
  moveClip,
  removeClip,
  loopIndex,
  resizeClip,
  setLoopKind,
  setSongCell,
  setStep,
  undo,
} from './index';

function run(project: Project, ctx: CommandContext, ...commands: Command[]): Project {
  return commands.reduce((p, command) => {
    const result = command(p, ctx);
    if (!result.ok) throw new Error(`Command failed: ${JSON.stringify(result.error)}`);
    return result.project;
  }, project);
}

const only = <T>(record: Readonly<Record<string, T>>): T => {
  const values = Object.values(record);
  expect(values).toHaveLength(1);
  return values[0]!;
};

describe('automatic chain', () => {
  it('addSample creates a sample, its own one-shot matrix, a default hit and a pad with that hit as its only member', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, addSample({ name: 'Kick', audio: constantAudio(0.5) }));

    const sample = only(project.samples);
    const hit = only(project.hits);
    const pad = only(project.pads);
    expect(sample).toMatchObject({ bars: null, markers: [0] });
    expect(sample.duration).toBeCloseTo(0.5);
    const matrix = only(project.matrices);
    expect(matrix).toMatchObject({ sampleId: sample.id, pads: [pad.id], loop: null });
    expect(hit).toMatchObject({
      sampleId: sample.id,
      slice: 0,
      region: { start: 0, end: 1 },
      direction: 'forward',
      pitch: 0,
      volume: 0,
      fadeOut: 0,
    });
    expect(pad.members).toEqual([hit.id]);
  });
});

describe('removal', () => {
  it('a hit in a pad is not in use by it: removing it takes it out of the pad', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const hit = only(project.hits);
    const pad = only(project.pads);
    project = run(project, ctx, addVariant(hit.id));
    const variant = Object.values(project.hits).find((h) => h.variantOf === hit.id)!;

    expect(findUsages(project, 'hit', variant.id)).toEqual([]);
    project = run(project, ctx, remove('hit', variant.id));
    expect(project.pads[pad.id]!.members).toEqual([hit.id]);
    expect(Object.keys(project.hits)).toEqual([hit.id]);
  });

  it('removes an unused object', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }), createMatrix('Mine'));
    const mine = Object.values(project.matrices).find((m) => m.name === 'Mine')!;
    project = run(project, ctx, remove('pad', mine.pads[0]!));
    expect(Object.keys(project.pads)).toHaveLength(1);
    expect(project.matrices[mine.id]!.pads).toEqual([]);
    project = run(project, ctx, remove('matrix', mine.id));
    expect(Object.keys(project.matrices)).toHaveLength(1);
  });

  it("a matrix's own pad is not in use by the matrix: removing it takes it out", () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }));
    const matrix = only(project.matrices);
    project = run(project, ctx, setSlicing(only(project.samples).id, 1));
    // All sixteen rows play in its loop: a pad added last plays in none.
    project = run(project, ctx, addPad(matrix.id));
    const added = project.matrices[matrix.id]!.pads.at(-1)!;
    expect(findUsages(project, 'pad', added)).toEqual([]);
    const gone = run(project, ctx, remove('pad', added));
    expect(gone.matrices[matrix.id]!.pads).toHaveLength(16);
    expect(gone.pads[added]).toBeUndefined();
  });

  it('lists every kind of usage', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const pad = only(project.pads);
    const hit = only(project.hits);
    project = run(project, ctx, createLoop('Beat', 'main', 1));
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 0, { padId: pad.id, memberId: hit.id }), setSongCell('main', 0, loop.id));

    const padResult = remove('pad', pad.id)(project, ctx);
    expect(padResult.ok || padResult.error).toEqual({ kind: 'in-use', usages: [{ kind: 'loop', id: loop.id, name: 'Beat' }] });
    const hitResult = remove('hit', hit.id)(project, ctx);
    expect(hitResult.ok || hitResult.error).toEqual({ kind: 'in-use', usages: [{ kind: 'loop', id: loop.id, name: 'Beat' }] });
    const loopResult = remove('loop', loop.id)(project, ctx);
    expect(loopResult.ok || loopResult.error).toEqual({
      kind: 'in-use',
      usages: [{ kind: 'song', id: null, name: 'Song' }],
    });
  });

  it('removing anyway leaves silence where it was used', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const hit = only(project.hits);
    const mine = only(project.pads);
    project = run(project, ctx, addVariant(hit.id), createLoop('Beat', 'main', 1));
    const copy = Object.values(project.hits).find((h) => h.variantOf === hit.id)!;
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 0, { padId: mine.id, memberId: copy.id }), setStep(loop.id, 1, { padId: mine.id }), setSongCell('main', 0, loop.id));

    const noHit = run(project, ctx, removeAnyway('hit', copy.id));
    expect(noHit.pads[mine.id]!.members).toEqual([hit.id]);
    expect(noHit.loops[loop.id]!.steps[0]).toMatchObject({ padId: mine.id, memberId: null });

    const noPad = run(project, ctx, removeAnyway('pad', mine.id));
    expect(noPad.loops[loop.id]!.steps.slice(0, 2).map((s) => s.padId)).toEqual([null, null]);
    expect(Object.keys(noPad.hits)).toEqual([]);

    const noLoop = run(project, ctx, removeAnyway('loop', loop.id));
    expect(noLoop.song.clips).toEqual([]);
  });

  it("removing a matrix's own loop leaves the matrix without a loop", () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }));
    project = run(project, ctx, setSlicing(only(project.samples).id, 1));
    const matrix = only(project.matrices);
    expect(matrix.loop).not.toBeNull();
    const gone = run(project, ctx, remove('loop', matrix.loop!));
    expect(gone.matrices[matrix.id]!.loop).toBeNull();
  });
});

describe('pad members', () => {
  it('steps that chose a removed member fall back to member 1', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), addSample({ name: 'S2', audio: constantAudio(0.1) }), createMatrix('Snares'));
    const [h1, h2] = Object.keys(project.hits) as [string, string];
    const snares = Object.values(project.pads).find((p) => p.name === 'Snares 01')!;
    project = run(project, ctx, copyHits([h1, h2], snares.id), createLoop('Beat', 'main', 1));
    const [c1, c2] = project.pads[snares.id]!.members as [string, string];
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 4, { padId: snares.id, memberId: c2 }));

    project = run(project, ctx, removePadMember(snares.id, c2));

    expect(project.pads[snares.id]!.members).toEqual([c1]);
    expect(project.hits[c2]).toBeUndefined();
    expect(project.loops[loop.id]!.steps[4]).toMatchObject({ padId: snares.id, memberId: null });
  });

  it('a hit sits in one pad: adding it to another pad adds a copy', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createMatrix('Mine'));
    const hit = only(project.hits);
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine 01')!;
    project = run(project, ctx, copyHits([hit.id], mine.id));
    expect(Object.values(project.pads).filter((p) => p.members.includes(hit.id))).toHaveLength(1);
    expect(project.pads[mine.id]!.members).toHaveLength(1);
    expect(project.pads[mine.id]!.members[0]).not.toBe(hit.id);
  });
});

describe('no tags', () => {
  it('a new project has no tags', () => {
    expect('tags' in createProject()).toBe(false);
  });
});

describe('undo', () => {
  it('undo and redo restore exactly the earlier state', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject());
    const states = [history.present];

    for (const command of [
      addSample({ name: 'Amen', audio: constantAudio(1) }),
      createLoop('Fill', 'fill', 1),
    ]) {
      const result = apply(history, command, ctx);
      expect(result.ok).toBe(true);
      history = result.history;
      states.push(history.present);
    }

    history = undo(history);
    expect(history.present).toBe(states[1]);
    history = undo(history);
    expect(history.present).toBe(states[0]);
    expect(undo(history)).toBe(history);

    history = redo(history);
    expect(history.present).toBe(states[1]);
    history = redo(history);
    expect(history.present).toBe(states[2]);
    expect(redo(history)).toBe(history);
  });

  it('never mutates earlier states', () => {
    const ctx = sequentialIds();
    const start = createProject();
    const snapshot = structuredClone(start);
    const result = apply(createHistory(start), addSample({ name: 'Amen', audio: constantAudio(1) }), ctx);
    expect(result.ok).toBe(true);
    expect(start).toEqual(snapshot);
  });

  it('a failed command leaves the history unchanged', () => {
    const ctx = sequentialIds();
    const history = createHistory(createProject());
    const result = apply(history, remove('hit', 'missing'), ctx);
    expect(result.ok).toBe(false);
    expect(result.history).toBe(history);
  });

  it('a new command clears redo', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject());
    history = apply(history, createLoop('A', 'main', 1), ctx).history;
    history = undo(history);
    history = apply(history, createLoop('B', 'main', 1), ctx).history;
    expect(history.future).toEqual([]);
  });
});

describe('fas 3 model', () => {
  it('addVariant marks the variant; a copy is no variant', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createMatrix('Mine'));
    const hit = only(project.hits);
    expect(hit.variantOf).toBeNull();
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine 01')!;

    project = run(project, ctx, addVariant(hit.id), copyHits([hit.id], mine.id));
    const variant = Object.values(project.hits).find((h) => h.variantOf === hit.id)!;
    expect(variant.id).not.toBe(hit.id);
    expect(project.hits[project.pads[mine.id]!.members[0]!]!.variantOf).toBeNull();
  });

  it('setLoopLength lengthens with empty steps and shortens, keeping the steps that remain', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createLoop(null, 'main', 2));
    const pad = only(project.pads);
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 3, { padId: pad.id }), setStep(loop.id, 20, { padId: pad.id }));

    const longer = run(project, ctx, setLoopLength(loop.id, 48)).loops[loop.id]!;
    expect(longer.steps).toHaveLength(48);
    expect(longer.steps.filter((s) => s.padId !== null)).toHaveLength(2);
    expect(longer.steps[3]!.padId).toBe(pad.id);
    expect(longer.steps[20]!.padId).toBe(pad.id);
    expect(longer.steps.slice(32).every((s) => s.padId === null)).toBe(true);

    const shorter = run(project, ctx, setLoopLength(loop.id, 6)).loops[loop.id]!;
    expect(shorter.steps).toHaveLength(6);
    expect(shorter.steps[3]!.padId).toBe(pad.id);

    expect(setLoopLength(loop.id, 0)(project, ctx).ok).toBe(false);
    expect(setLoopLength(loop.id, 16 * 16 + 1)(project, ctx).ok).toBe(false);
  });

  it('createLoop without a name takes the next free M or F number', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, createLoop(null, 'main', 1), createLoop(null, 'main', 1), createLoop(null, 'fill', 1));
    expect(Object.values(project.loops).map((l) => l.name)).toEqual(['M1', 'M2', 'F1']);
  });

  it('commands with the same merge key share one undo step until another command or a seal', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject());
    const start = history.present;
    const step = (command: Command, key: string | null = null) => {
      const result = apply(history, command, ctx, key);
      expect(result.ok).toBe(true);
      history = result.history;
    };

    step(setBpm(150), 'bpm');
    step(setBpm(160), 'bpm');
    step(setBpm(170), 'bpm');
    expect(history.past).toHaveLength(1);
    expect(undo(history).present).toBe(start);

    step(setSongBars(4));
    step(setBpm(120), 'bpm');
    expect(history.past).toHaveLength(3);

    history = seal(history);
    step(setBpm(125), 'bpm');
    expect(history.past).toHaveLength(4);
    expect(undo(history).present.song.bpm).toBe(120);
  });

});

describe('loop kind is a tag', () => {
  it('any loop can go in the Main or the Fill row, and setLoopKind retags it', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, createLoop(null, 'main', 1), createLoop(null, 'fill', 1));
    const [main, fill] = Object.values(project.loops);
    project = run(project, ctx, setSongCell('fill', 0, main!.id), setSongCell('main', 1, fill!.id));
    expect(project.song.clips.map((c) => [c.row, c.ref, c.start])).toEqual([
      ['fill', main!.id, 0],
      ['main', fill!.id, 16],
    ]);

    project = run(project, ctx, setLoopKind(main!.id, 'fill'));
    expect(project.loops[main!.id]).toMatchObject({ kind: 'fill', name: 'M1' });
  });
});

describe('break length', () => {
  it('guesses the bars that give a tempo from 70 to 180 BPM', () => {
    expect(guessBars(6.94)).toBe(4); // Four bars of Amen at 138 BPM.
    expect(guessBars(6.94 / 4)).toBe(1);
    expect(guessBars(6.94 / 2)).toBe(2);
    expect(unlikelyBpm(552)).toBe(true);
    expect(unlikelyBpm(138)).toBe(false);
  });
});

describe('clips', () => {
  /** A song of 4 bars with a one-bar loop L and a mod D. */
  function song() {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, setSongBars(4), createLoop('L', 'main', 1), createMod('D', [{ target: 'pitch', step: 'bar', lane: [{ v: 1 }] }]));
    return { ctx, project, loop: only(project.loops).id, mod: only(project.mods).id };
  }
  const spans = (project: Project, row = 'main') =>
    project.song.clips.filter((c) => c.row === row).map((c) => [c.start, c.length, c.offset]);

  it("a dropped clip gets its loop's length, a mod one bar, cut at the song's end", () => {
    const { ctx, project, loop, mod } = song();
    const next = run(project, ctx, addClip('main', loop, 4), addClip('modA', mod, 56));
    expect(spans(next)).toEqual([[4, 16, 0]]);
    expect(spans(next, 'modA')).toEqual([[56, 8, 0]]);
    expect(addClip('modA', loop, 0)(project, ctx).ok).toBe(false);
  });

  it('a new clip removes what it covers, splits what it falls inside, and cuts what it overlaps', () => {
    const { ctx, project, loop } = song();
    const long = run(project, ctx, addClip('main', loop, 0, 64));
    expect(spans(run(long, ctx, addClip('main', loop, 20, 8)))).toEqual([
      [0, 20, 0],
      [20, 8, 0],
      // The other half keeps its place in the loop unwrapped, so its random choices stay.
      [28, 36, 28],
    ]);
    const two = run(project, ctx, addClip('main', loop, 0, 16), addClip('main', loop, 16, 16));
    expect(spans(run(two, ctx, addClip('main', loop, 8, 16)))).toEqual([
      [0, 8, 0],
      [8, 16, 0],
      [24, 8, 8],
    ]);
    expect(spans(run(two, ctx, addClip('main', loop, 0, 32)))).toEqual([[0, 32, 0]]);
  });

  it('resizing from the left moves the start and the offset; a clip is at least one step', () => {
    const { ctx, project, loop } = song();
    let next = run(project, ctx, addClip('main', loop, 16));
    const id = next.song.clips[0]!.id;
    next = run(next, ctx, resizeClip(id, 'start', 28));
    expect(spans(next)).toEqual([[28, 4, 12]]);
    // Pulled out past its start, the offset goes below 0 (the loop wraps round where it is read).
    expect(spans(run(next, ctx, resizeClip(id, 'start', 12)))).toEqual([[12, 20, -4]]);
    expect(spans(run(next, ctx, resizeClip(id, 'end', 0)))).toEqual([[28, 1, 12]]);
  });

  it('a loop clip reads its loop wrapped round, also with an offset past its length or below 0', () => {
    expect([0, 3, 4, 7].map((t) => loopIndex({ start: 0, offset: 10 }, t, 4))).toEqual([2, 1, 2, 1]);
    expect([0, 1, 4].map((t) => loopIndex({ start: 0, offset: -1 }, t, 4))).toEqual([3, 0, 3]);
  });

  it('moving and copying keep length and offset, and stay with their kind of row', () => {
    const { ctx, project, loop, mod } = song();
    let next = run(project, ctx, addClip('main', loop, 0), addClip('modA', mod, 0));
    const [l, m] = next.song.clips;
    next = run(next, ctx, moveClip(l!.id, 'fill', 32), copyClip(m!.id, 'modB', 16));
    expect(spans(next, 'fill')).toEqual([[32, 16, 0]]);
    expect(spans(next, 'main')).toEqual([]);
    expect(spans(next, 'modB')).toEqual([[16, 16, 0]]);
    expect(moveClip(l!.id, 'modA', 0)(next, ctx).ok).toBe(false);
    expect(run(next, ctx, removeClip(m!.id)).song.clips).toHaveLength(2);
  });

  it('setSongBars drops clips past the end and shortens clips across it', () => {
    const { ctx, project, loop } = song();
    const next = run(project, ctx, addClip('main', loop, 0, 40), addClip('fill', loop, 48));
    expect(run(next, ctx, setSongBars(2)).song.clips.map((c) => [c.row, c.start, c.length])).toEqual([['main', 0, 32]]);
  });

});

describe('mods with effects', () => {
  const pitch: StepEffect = { target: 'pitch', step: 'bar', lane: [{ v: 1 }] };
  const tape: TapeEffect = { target: 'tape', length: 6, direction: 'pingpong', speed: { from: 1, to: 0 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };

  it('a mod has at most one effect per target, and may have none', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, createMod('M', [pitch]));
    const id = only(project.mods).id;
    expect(createMod('X', [])(project, ctx).ok).toBe(true);
    expect(addEffect(id, { ...pitch, step: '1/16' })(project, ctx).ok).toBe(false);
    const both = run(project, ctx, addEffect(id, tape));
    expect(only(both.mods).effects.map((e) => e.target)).toEqual(['pitch', 'tape']);
    expect(only(run(both, ctx, removeEffect(id, 'tape'), removeEffect(id, 'pitch')).mods).effects).toEqual([]);
    expect(replaceEffect(id, 'pitch', { ...pitch, target: 'ratchet' })(both, ctx).ok).toBe(true);
    expect(addEffect(id, { ...tape, length: 0 })(project, ctx).ok).toBe(false);
    expect(addEffect(id, { ...tape, speed: { from: 1, to: 5 } })(project, ctx).ok).toBe(false);
  });

  it('a clip of a mod with Tape is at least as long as its segment', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, setSongBars(4), createMod('T', [{ ...tape, length: 20 }]));
    const id = only(project.mods).id;
    const placed = run(project, ctx, addClip('modA', id, 0));
    // One bar is too short for 20 steps, so it gets 20.
    expect(placed.song.clips[0]).toMatchObject({ start: 0, length: 20 });
    const clip = placed.song.clips[0]!.id;
    expect(run(placed, ctx, resizeClip(clip, 'end', 4)).song.clips[0]!.length).toBe(20);
    expect(run(placed, ctx, resizeClip(clip, 'start', 16)).song.clips[0]).toMatchObject({ start: 0, length: 20 });
    expect(addClip('modA', id, 50)(project, ctx).ok).toBe(false);
    expect(addClip('modA', id, 0, 8)(project, ctx).ok).toBe(true);
    expect(run(project, ctx, addClip('modA', id, 0, 8)).song.clips[0]!.length).toBe(20);
  });

  it('Shuffle rotates by 1 to 15', () => {
    const ctx = sequentialIds();
    const rotate = (by: number) => createMod('S', [{ target: 'swap', rate: 'step', mode: { kind: 'shuffle', pick: { kind: 'rotate', by } } }])(createProject(), ctx).ok;
    expect([0, 1, 15, 16, 1.5].map(rotate)).toEqual([false, true, true, false, false]);
  });

  it('wow, flutter and ramp time are checked', () => {
    const ctx = sequentialIds();
    expect(createMod('T', [{ ...tape, wow: 1.5 }])(createProject(), ctx).ok).toBe(false);
    expect(createMod('T', [{ ...tape, rampOver: 0 }])(createProject(), ctx).ok).toBe(false);
    expect(createMod('T', [{ ...tape, rampOver: 4, wow: 0.5, flutter: 1 }])(createProject(), ctx).ok).toBe(true);
  });

});

describe('moving steps', () => {
  it('moves a block of steps, copies it, and leaves out what falls outside the loop', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
    const pad = only(project.pads).id;
    const loop = only(project.loops).id;
    project = run(project, ctx, setStep(loop, 5, { padId: pad }), setStep(loop, 7, { padId: pad }));
    const filled = (p: Project) => p.loops[loop]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]));

    expect(filled(run(project, ctx, moveSteps(loop, 5, 3, 9, false)))).toEqual([9, 11]);
    expect(filled(run(project, ctx, moveSteps(loop, 5, 3, 6, false)))).toEqual([6, 8]);
    expect(filled(run(project, ctx, moveSteps(loop, 5, 3, 9, true)))).toEqual([5, 7, 9, 11]);
    expect(filled(run(project, ctx, moveSteps(loop, 5, 3, 14, false)))).toEqual([14]);
    expect(moveSteps(loop, 15, 3, 0, false)(project, ctx).ok).toBe(false);
  });
});

describe('heard in the song', () => {
  it('follows the song down: loop in the song, pads on its steps, their hits, and their matrices', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }), addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const amen = Object.values(project.matrices).find((m) => m.name === 'amen 1')!;
    project = run(project, ctx, setSlicing(amen.sampleId!, 1), createLoop('Beat', 'main', 1));
    const beat = Object.values(project.loops).find((l) => l.name === 'Beat')!;
    const slot = project.matrices[amen.id]!.pads[2]!;
    expect(heardInSong(project).loops.size).toBe(0);

    project = run(project, ctx, setStep(beat.id, 0, { padId: slot }), setSongCell('main', 0, beat.id));
    const heard = heardInSong(project);
    expect([...heard.loops]).toEqual([beat.id]);
    expect([...heard.pads]).toEqual([slot]);
    expect(heard.hits.has(project.pads[slot]!.members[0]!)).toBe(true);
    expect([...heard.matrices]).toEqual([amen.id]);
    // The snare is in no loop in the song.
    const snare = Object.values(project.matrices).find((m) => m.name === 'Snare 1')!;
    expect(heard.matrices.has(snare.id)).toBe(false);
  });
});
