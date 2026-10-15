import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext, Project } from './index';
import {
  addPadMember,
  addSample,
  addTag,
  apply,
  breakBpm,
  createHistory,
  createLoop,
  createPad,
  createProject,
  redo,
  remove,
  removePadMember,
  setBreak,
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
  it('addSample creates a sample, a default hit and a pad with that hit as its only member', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, addSample({ name: 'Kick', audio: constantAudio(0.5) }));

    const sample = only(project.samples);
    const hit = only(project.hits);
    const pad = only(project.pads);
    expect(sample.duration).toBeCloseTo(0.5);
    expect(hit).toMatchObject({
      sampleId: sample.id,
      region: { start: 0, end: sample.duration },
      direction: 'forward',
      pitch: 0,
      volume: 0,
      fadeOut: 0,
    });
    expect(pad.members).toEqual([hit.id]);
  });

  it('sliceBreak with 4 bars and 1/16 gives 64 samples, hits and pads, and M1 playing the pads in order', () => {
    const ctx = sequentialIds();
    const imported = run(createProject(ctx), ctx, addSample({ name: 'Amen', audio: constantAudio(4 * 1.75) }));
    const amen = only(imported.samples);
    const sliced = run(imported, ctx, sliceBreak(amen.id, 4, 16));

    const newSamples = Object.values(sliced.samples).filter((s) => !(s.id in imported.samples));
    const newHits = Object.values(sliced.hits).filter((h) => !(h.id in imported.hits));
    const newPads = Object.values(sliced.pads).filter((p) => !(p.id in imported.pads));
    expect(newSamples).toHaveLength(64);
    expect(newHits).toHaveLength(64);
    expect(newPads).toHaveLength(64);

    const m1 = only(sliced.loops);
    expect(m1).toMatchObject({ name: 'M1', kind: 'main', bars: 4 });
    expect(m1.steps).toHaveLength(64);
    // Step i plays the pad of slice i, and slices follow each other through the break.
    m1.steps.forEach((step, i) => {
      const pad = sliced.pads[step.padId!]!;
      const sample = sliced.samples[sliced.hits[pad.members[0]!]!.sampleId]!;
      expect(sample.offset).toBeCloseTo((i * amen.duration) / 64);
      expect(sample.duration).toBeCloseTo(amen.duration / 64);
      expect(sample.audioId).toBe(amen.audioId);
    });
  });

  it('a coarser grid leaves gaps between slices in M1', () => {
    const ctx = sequentialIds();
    const imported = run(createProject(ctx), ctx, addSample({ name: 'Amen', audio: constantAudio(1) }));
    const sliced = run(imported, ctx, sliceBreak(only(imported.samples).id, 1, 4));
    const m1 = only(sliced.loops);
    expect(m1.steps.map((s) => s.padId !== null)).toEqual(
      Array.from({ length: 16 }, (_, i) => i % 4 === 0),
    );
  });

  it('works out the BPM of a break from its length and bars', () => {
    expect(breakBpm(4 * 1.75, 4)).toBeCloseTo(137.142857);

    const ctx = sequentialIds();
    const imported = run(createProject(ctx), ctx, addSample({ name: 'Amen', audio: constantAudio(4 * 1.75) }));
    const id = only(imported.samples).id;
    const sliced = run(imported, ctx, sliceBreak(id, 4));
    expect(sliced.samples[id]!.break?.bpm).toBeCloseTo(137.142857);
    expect(sliced.samples[id]!.break?.bars).toBe(4);
  });
});

describe('breaks', () => {
  it('setBreak works out the BPM, and null makes the sample a one-shot again', () => {
    const ctx = sequentialIds();
    const imported = run(createProject(ctx), ctx, addSample({ name: 'Amen', audio: constantAudio(4 * 1.75) }));
    const id = only(imported.samples).id;

    const asBreak = run(imported, ctx, setBreak(id, 4));
    expect(asBreak.samples[id]!.break).toEqual({ bars: 4, bpm: breakBpm(4 * 1.75, 4), sliced: false });

    const asShot = run(asBreak, ctx, setBreak(id, null));
    expect(asShot.samples[id]!.break).toBeNull();
  });

  it('sliceBreak marks the slices and the break, and refuses to slice it twice', () => {
    const ctx = sequentialIds();
    const imported = run(createProject(ctx), ctx, addSample({ name: 'Amen', audio: constantAudio(1) }));
    const id = only(imported.samples).id;
    const sliced = run(imported, ctx, setBreak(id, 1), sliceBreak(id, 1, 16));

    const slices = Object.values(sliced.samples).filter((s) => s.id !== id);
    expect(slices).toHaveLength(16);
    expect(slices.every((s) => s.sliceOf === id)).toBe(true);
    expect(sliced.samples[id]!.sliceOf).toBeNull();
    expect(sliced.samples[id]!.break?.sliced).toBe(true);

    expect(sliceBreak(id, 1, 16)(sliced, ctx)).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    expect(setBreak(id, 2)(sliced, ctx).ok).toBe(false);
  });
});

describe('removal', () => {
  it('fails to remove a hit used in a pad and lists the pad', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
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
    let project = run(createProject(ctx), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const pad = only(project.pads);
    project = run(project, ctx, remove('pad', pad.id), remove('hit', pad.members[0]!));
    expect(project.pads).toEqual({});
    expect(project.hits).toEqual({});
  });

  it('lists every kind of usage', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'Snare', audio: constantAudio(0.2) }));
    const pad = only(project.pads);
    project = run(project, ctx, createLoop('Beat', 'main', 1));
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id));

    const padResult = remove('pad', pad.id)(project, ctx);
    expect(padResult.ok || padResult.error).toEqual({
      kind: 'in-use',
      usages: [{ kind: 'loop', id: loop.id, name: 'Beat' }],
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
      createProject(ctx),
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
    let project = run(createProject(ctx), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const hit = only(project.hits);
    project = run(project, ctx, createPad('Mine'));
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine')!;
    project = run(project, ctx, addPadMember(mine.id, hit.id));
    expect(Object.values(project.pads).filter((p) => p.members.includes(hit.id))).toHaveLength(2);
  });
});

describe('tags', () => {
  it('starts with K, S, H, R, G and allows at most 8 tags', () => {
    const ctx = sequentialIds();
    const project = createProject(ctx);
    expect(Object.values(project.tags).map((t) => t.name)).toEqual(['K', 'S', 'H', 'R', 'G']);
    const full = run(project, ctx, addTag('A'), addTag('B'), addTag('C'));
    expect(addTag('D')(full, ctx).ok).toBe(false);
  });
});

describe('undo', () => {
  it('undo and redo restore exactly the earlier state', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject(ctx));
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
    const start = createProject(ctx);
    const snapshot = structuredClone(start);
    const result = apply(createHistory(start), addSample({ name: 'Amen', audio: constantAudio(1) }), ctx);
    expect(result.ok).toBe(true);
    expect(start).toEqual(snapshot);
  });

  it('a failed command leaves the history unchanged', () => {
    const ctx = sequentialIds();
    const history = createHistory(createProject(ctx));
    const result = apply(history, remove('hit', 'missing'), ctx);
    expect(result.ok).toBe(false);
    expect(result.history).toBe(history);
  });

  it('a new command clears redo', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject(ctx));
    history = apply(history, createLoop('A', 'main', 1), ctx).history;
    history = undo(history);
    history = apply(history, createLoop('B', 'main', 1), ctx).history;
    expect(history.future).toEqual([]);
  });
});
