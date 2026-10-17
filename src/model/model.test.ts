import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext, Project, StepEffect, TapeEffect } from './index';
import {
  addPadMember,
  addSample,
  addVariant,
  guessBars,
  unlikelyBpm,
  duplicateHit,
  seal,
  setBpm,
  setLoopLength,
  setSongBars,
  upgradeProject,
  apply,
  createHistory,
  createLoop,
  createMod,
  createPad,
  createProject,
  redo,
  remove,
  removePadMember,
  setBreak,
  addClip,
  moveSteps,
  addEffect,
  removeEffect,
  replaceEffect,
  copyClip,
  moveClip,
  removeClip,
  resizeClip,
  setLoopKind,
  setSongCell,
  setStep,
  sliceBreak,
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
  it('addSample creates a sample, a one-shot break over it, a default hit and a pad with that hit as its only member', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, addSample({ name: 'Kick', audio: constantAudio(0.5) }));

    const sample = only(project.samples);
    const hit = only(project.hits);
    const pad = only(project.pads);
    expect(sample.duration).toBeCloseTo(0.5);
    const brk = only(project.breaks);
    expect(brk).toMatchObject({ sampleId: sample.id, bars: null, markers: [0], pads: [pad.id], parent: null });
    expect(hit).toMatchObject({
      breakId: brk.id,
      slot: 0,
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
  it('fails to remove a hit used in a pad and lists the pad', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const hit = only(project.hits);
    const pad = only(project.pads);

    const result = remove('hit', hit.id)(project, ctx);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'in-use', usages: [{ kind: 'pad', id: pad.id, name: pad.name }] },
    });
  });

  it('removes an unused object', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const hit = only(project.hits);
    project = run(project, ctx, duplicateHit(hit.id), createPad('Mine'));
    const copy = Object.values(project.hits).find((h) => h.variantOf === hit.id)!;
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine')!;
    project = run(project, ctx, remove('pad', mine.id), remove('hit', copy.id));
    expect(Object.keys(project.pads)).toHaveLength(1);
    expect(Object.keys(project.hits)).toEqual([hit.id]);
  });

  it("a break's pads and parent are in use by the break", () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }));
    const brk = only(project.breaks);
    project = run(project, ctx, setBreak(brk.id, 1));
    const result = remove('pad', project.breaks[brk.id]!.pads[0]!)(project, ctx);
    expect(result.ok || result.error).toMatchObject({ kind: 'in-use', usages: expect.arrayContaining([{ kind: 'break', id: brk.id, name: 'amen 1' }]) });
    expect(remove('hit', project.breaks[brk.id]!.parent!)(project, ctx).ok).toBe(false);
  });

  it('lists every kind of usage', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const pad = only(project.pads);
    project = run(project, ctx, createLoop('Beat', 'main', 1));
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id));

    const padResult = remove('pad', pad.id)(project, ctx);
    expect(padResult.ok || padResult.error).toEqual({
      kind: 'in-use',
      usages: [
        { kind: 'break', id: only(project.breaks).id, name: 'Snare 1' },
        { kind: 'loop', id: loop.id, name: 'Beat' },
      ],
    });
    const loopResult = remove('loop', loop.id)(project, ctx);
    expect(loopResult.ok || loopResult.error).toEqual({
      kind: 'in-use',
      usages: [{ kind: 'song', id: null, name: 'Song' }],
    });
  });
});

describe('pad members', () => {
  it('steps that chose a removed member fall back to member 1', () => {
    const ctx = sequentialIds();
    let project = run(
      createProject(),
      ctx,
      addSample({ name: 'S1', audio: constantAudio(0.1) }),
      addSample({ name: 'S2', audio: constantAudio(0.1) }),
    );
    const [h1, h2] = Object.keys(project.hits) as [string, string];
    project = run(project, ctx, createPad('Snares', [h1, h2]));
    const snares = Object.values(project.pads).find((p) => p.name === 'Snares')!;
    project = run(project, ctx, createLoop('Beat', 'main', 1));
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 4, { padId: snares.id, memberId: h2 }));

    project = run(project, ctx, removePadMember(snares.id, h2));

    expect(project.pads[snares.id]!.members).toEqual([h1]);
    expect(project.loops[loop.id]!.steps[4]).toMatchObject({ padId: snares.id, memberId: null });
  });

  it('a hit can be a member of several pads', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const hit = only(project.hits);
    project = run(project, ctx, createPad('Mine'));
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine')!;
    project = run(project, ctx, addPadMember(mine.id, hit.id));
    expect(Object.values(project.pads).filter((p) => p.members.includes(hit.id))).toHaveLength(2);
  });
});

describe('no tags', () => {
  it('a new project has no tags, and an old one loses its tags and the samples\' tag fields', () => {
    expect('tags' in createProject()).toBe(false);
    const ctx = sequentialIds();
    const base = run(createProject(), ctx, addSample({ name: 'a', audio: constantAudio(0.1) }));
    const id = only(base.samples).id;
    const legacy = {
      ...base,
      tags: { k: { id: 'k', name: 'K' } },
      samples: { [id]: { ...base.samples[id]!, mainTag: 'k', extraTags: [], tagGuessed: true } },
    } as unknown as Project;
    const upgraded = upgradeProject(legacy);
    expect('tags' in upgraded).toBe(false);
    expect(upgraded.samples[id]).toEqual(base.samples[id]);
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
  it('duplicateHit marks the variant; chain pads are auto and built pads are not', () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const hit = only(project.hits);
    expect(hit.variantOf).toBeNull();
    expect(only(project.pads).auto).toBe(true);

    project = run(project, ctx, duplicateHit(hit.id), createPad('Mine', [hit.id]));
    const variant = Object.values(project.hits).find((h) => h.id !== hit.id)!;
    expect(variant.variantOf).toBe(hit.id);
    expect(Object.values(project.pads).find((p) => p.name === 'Mine')!.auto).toBe(false);
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

  it('an older loop with a bars field loses it: its length is its steps', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, createLoop(null, 'main', 1));
    const loop = only(project.loops);
    const legacy = { ...project, loops: { [loop.id]: { ...loop, bars: 1 } } } as unknown as Project;
    expect('bars' in upgradeProject(legacy).loops[loop.id]!).toBe(false);
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

  it('upgradeProject fills in fields that older saves lack', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const old = structuredClone(project) as { hits: Record<string, { variantOf?: unknown }>; pads: Record<string, { auto?: unknown }> };
    Object.values(old.hits).forEach((h) => delete h.variantOf);
    Object.values(old.pads).forEach((p) => delete p.auto);
    expect(upgradeProject(old as unknown as Project)).toEqual(project);
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

describe('addVariant', () => {
  it("adds the variant last to the original's own pad; a variant of a variant goes there too", () => {
    const ctx = sequentialIds();
    let project = run(createProject(), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }));
    const id = only(project.breaks).id;
    project = run(project, ctx, sliceBreak(id, 1, 4));
    const slicePad = project.pads[project.breaks[id]!.pads[1]!]!;
    const original = slicePad.members[0]!;

    project = run(project, ctx, addVariant(original));
    const variant = Object.values(project.hits).find((h) => h.variantOf === original)!;
    project = run(project, ctx, addVariant(variant.id));
    const second = Object.values(project.hits).find((h) => h.variantOf === variant.id)!;

    expect(project.pads[slicePad.id]!.members).toEqual([original, variant.id, second.id]);
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
    const project = run(createProject(), ctx, setSongBars(4), createLoop('L', 'main', 1), createMod('D', [{ target: 'pitch', rate: 'bar', shape: { kind: 'list', values: [1] } }]));
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
      [28, 36, 12],
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
    // Pulled out past its start, the loop wraps round: 4 steps earlier is offset 8.
    expect(spans(run(next, ctx, resizeClip(id, 'start', 24)))).toEqual([[24, 8, 8]]);
    expect(spans(run(next, ctx, resizeClip(id, 'end', 0)))).toEqual([[28, 1, 12]]);
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

  it('a song saved with rows becomes clips that play the same', () => {
    const ctx = sequentialIds();
    const base = run(createProject(), ctx, createLoop('M', 'main', 2), createLoop('F', 'fill', 1), createMod('D', [{ target: 'pitch', rate: 'bar', shape: { kind: 'list', values: [1] } }]));
    const [m, f] = Object.keys(base.loops) as [string, string];
    const d = Object.keys(base.mods)[0]!;
    const legacy = {
      ...base,
      loops: { ...base.loops, [f]: { ...base.loops[f]!, window: { start: 8, end: 16 } } },
      song: { bpm: 170, bars: 6, rows: { main: [m, null, null, null, m, null], fill: [null, null, f, null, null, null], modA: [d, d, null, d, null, null], modB: [null, null, null, null, null, null] } },
    } as unknown as Project;

    const clips = upgradeProject(legacy).song.clips.map((c) => [c.row, c.ref, c.start, c.length, c.offset]);

    expect(clips).toEqual([
      ['main', m, 0, 64, 0],
      ['main', m, 64, 32, 0],
      ['fill', f, 40, 8, 8],
      ['modA', d, 0, 32, 0],
      ['modA', d, 48, 16, 0],
    ]);
    expect('window' in upgradeProject(legacy).loops[f]!).toBe(false);
  });
});

describe('mods with effects', () => {
  const pitch: StepEffect = { target: 'pitch', rate: 'bar', shape: { kind: 'list', values: [1] } };
  const tape: TapeEffect = { target: 'tape', length: 6, direction: 'pingpong', speed: { from: 1, to: 0 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };

  it('a mod has at most one effect per target, and may have none', () => {
    const ctx = sequentialIds();
    const project = run(createProject(), ctx, createMod('M', [pitch]));
    const id = only(project.mods).id;
    expect(createMod('X', [])(project, ctx).ok).toBe(true);
    expect(addEffect(id, { ...pitch, rate: 'step' })(project, ctx).ok).toBe(false);
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

  it('a tape saved before ramp time, curve, wow and flutter gets their defaults', () => {
    const base = createProject();
    const old = { target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0 } };
    const legacy = { ...base, mods: { m: { id: 'm', name: 'Old', effects: [old] } } } as unknown as Project;
    expect(upgradeProject(legacy).mods.m!.effects).toEqual([{ ...old, rampOver: null, curve: 'linear', wow: 0, flutter: 0 }]);
  });

  it('a saved scope goes: a mod acts on everything under its clip in Song', () => {
    const base = createProject();
    const effect = { target: 'pitch', scope: { kind: 'range', from: 4, to: 7 }, rate: 'bar', shape: { kind: 'list', values: [12] } };
    const legacy = { ...base, mods: { m: { id: 'm', name: 'Old', effects: [effect] }, n: { id: 'n', name: 'Older', ...effect } } } as unknown as Project;
    const upgraded = upgradeProject(legacy);
    expect(upgraded.mods.m!.effects[0]).toEqual({ target: 'pitch', rate: 'bar', shape: { kind: 'list', values: [12] } });
    expect(upgraded.mods.n!.effects[0]).toEqual({ target: 'pitch', rate: 'bar', shape: { kind: 'list', values: [12] } });
  });

  it('a saved random shape gets whole numbers for pitch and stays free elsewhere', () => {
    const base = createProject();
    const random = (target: string) => ({ target, rate: 'bar', shape: { kind: 'random', min: 0, max: 4, chance: 50 } });
    const legacy = { ...base, mods: { m: { id: 'm', name: 'Old', effects: [random('pitch'), random('volume')] } } } as unknown as Project;
    expect(upgradeProject(legacy).mods.m!.effects.map((e) => 'shape' in e && e.shape.kind === 'random' && e.shape.whole)).toEqual([true, false]);
  });

  it('a saved Borrow becomes Swap from the stack, at random, at its rate', () => {
    const base = createProject();
    const oldest = { id: 'm', name: 'Old', target: 'sourceLoop', rate: 'beat', shape: { kind: 'list', values: [0, 1] }, sources: ['a', 'b'] };
    const newer = { target: 'sourceLoop', rate: 'step', sources: ['a'], pick: { kind: 'every', n: 2 }, skipEmpty: true };
    const legacy = { ...base, mods: { m: oldest, n: { id: 'n', name: 'Newer', effects: [newer] } } } as unknown as Project;
    const upgraded = upgradeProject(legacy);
    expect(upgraded.mods.m!.effects).toEqual([{ target: 'swap', rate: 'beat', mode: { kind: 'stack', pick: 'random' } }]);
    expect(upgraded.mods.n!.effects).toEqual([{ target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } }]);
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

  it('a mod saved before effects becomes a mod with that one effect', () => {
    const base = createProject();
    const legacy = { ...base, mods: { m: { id: 'm', name: 'Old', target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } } } } as unknown as Project;
    expect(upgradeProject(legacy).mods.m).toEqual({
      id: 'm',
      name: 'Old',
      effects: [{ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }],
    });
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
