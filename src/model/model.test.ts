import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext, Project } from './index';
import {
  addPadMember,
  addSample,
  duplicateHit,
  gridMarkers,
  seal,
  setMarkers,
  sliceAtMarkers,
  trimSample,
  unsliceBreak,
  setBpm,
  setLoopBars,
  setSongBars,
  upgradeProject,
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
  setFillWindow,
  setSongCell,
  updateHit,
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
    expect(asBreak.samples[id]!.break).toEqual({ bars: 4, bpm: breakBpm(4 * 1.75, 4), sliced: false, markers: gridMarkers(4 * 1.75, 4), loop: null });

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

describe('fas 3 model', () => {
  it('duplicateHit marks the variant; chain pads are auto and built pads are not', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const hit = only(project.hits);
    expect(hit.variantOf).toBeNull();
    expect(only(project.pads).auto).toBe(true);

    project = run(project, ctx, duplicateHit(hit.id), createPad('Mine', [hit.id]));
    const variant = Object.values(project.hits).find((h) => h.id !== hit.id)!;
    expect(variant.variantOf).toBe(hit.id);
    expect(Object.values(project.pads).find((p) => p.name === 'Mine')!.auto).toBe(false);
  });

  it('setLoopBars lengthens with empty bars and shortens, keeping the steps that remain', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createLoop(null, 'main', 2));
    const pad = only(project.pads);
    const loop = only(project.loops);
    project = run(project, ctx, setStep(loop.id, 3, { padId: pad.id }), setStep(loop.id, 20, { padId: pad.id }));

    const longer = run(project, ctx, setLoopBars(loop.id, 3)).loops[loop.id]!;
    expect(longer.steps).toHaveLength(48);
    expect(longer.steps.filter((s) => s.padId !== null)).toHaveLength(2);
    expect(longer.steps[3]!.padId).toBe(pad.id);
    expect(longer.steps[20]!.padId).toBe(pad.id);
    expect(longer.steps.slice(32).every((s) => s.padId === null)).toBe(true);

    const shorter = run(project, ctx, setLoopBars(loop.id, 1)).loops[loop.id]!;
    expect(shorter.steps).toHaveLength(16);
    expect(shorter.steps[3]!.padId).toBe(pad.id);
  });

  it('createLoop without a name takes the next free M or F number', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, createLoop(null, 'main', 1), createLoop(null, 'main', 1), createLoop(null, 'fill', 1));
    expect(Object.values(project.loops).map((l) => l.name)).toEqual(['M1', 'M2', 'F1']);
  });

  it('commands with the same merge key share one undo step until another command or a seal', () => {
    const ctx = sequentialIds();
    let history = createHistory(createProject(ctx));
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
    const project = run(createProject(ctx), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }));
    const old = structuredClone(project) as { hits: Record<string, { variantOf?: unknown }>; pads: Record<string, { auto?: unknown }> };
    Object.values(old.hits).forEach((h) => delete h.variantOf);
    Object.values(old.pads).forEach((p) => delete p.auto);
    expect(upgradeProject(old as unknown as Project)).toEqual(project);
  });
});

describe('fas 3b: trimming, markers and re-slicing', () => {
  /** A 2 s one-shot or break at 44.1 kHz. */
  function imported(seconds = 2) {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, addSample({ name: 'amen.wav', audio: constantAudio(seconds) }));
    return { ctx, project, id: only(project.samples).id };
  }

  it('trimSample sets the window and BPM, keeps whole hits whole and cuts the rest', () => {
    const { ctx, project: start, id } = imported();
    const defaultHit = only(start.hits);
    let project = run(start, ctx, duplicateHit(defaultHit.id));
    const variant = Object.values(project.hits).find((h) => h.id !== defaultHit.id)!;
    project = run(project, ctx, updateHit(variant.id, { region: { start: 0.1, end: 0.5 } }), setBreak(id, 1));

    project = run(project, ctx, trimSample(id, 0.25, 1.85));

    const sample = project.samples[id]!;
    expect(sample.offset).toBeCloseTo(0.25);
    expect(sample.duration).toBeCloseTo(1.6);
    expect(sample.break?.bpm).toBeCloseTo(breakBpm(1.6, 1));
    expect(sample.break?.markers).toEqual(gridMarkers(sample.duration, 1));
    expect(project.hits[defaultHit.id]!.region.start).toBeCloseTo(0);
    expect(project.hits[defaultHit.id]!.region.end).toBeCloseTo(1.6);
    // The variant played 0.1–0.5 s of the file; it now starts at the trim.
    expect(project.hits[variant.id]!.region.start).toBeCloseTo(0);
    expect(project.hits[variant.id]!.region.end).toBeCloseTo(0.25);
  });

  it('trimSample is refused for a sliced break', () => {
    const { ctx, project, id } = imported();
    const sliced = run(project, ctx, sliceBreak(id, 1, 4));
    expect(trimSample(id, 0.1, 1)(sliced, ctx).ok).toBe(false);
  });

  it('slices at its own markers and puts each slice on the nearest 1/16', () => {
    const { ctx, project: start, id } = imported(2);
    // One bar of 2 s: a step is 0.125 s. 0.3 rounds to step 2; 0.31 also does and is left out.
    const project = run(start, ctx, setBreak(id, 1), setMarkers(id, [0.3, 0.31, 1.06]), sliceAtMarkers(id));

    const slices = Object.values(project.samples).filter((s) => s.sliceOf === id);
    expect(slices.map((s) => [+s.offset.toFixed(3), +s.duration.toFixed(3)])).toEqual([
      [0, 0.3],
      [0.3, 0.01],
      [0.31, 0.75],
      [1.06, 0.94],
    ]);
    const m1 = Object.values(project.loops)[0]!;
    const filled = m1.steps.flatMap((s, i) => (s.padId === null ? [] : [i]));
    expect(filled).toEqual([0, 2, 8]);
  });

  it('setMarkers keeps the first marker at 0 and refuses markers too close together', () => {
    const { ctx, project, id } = imported();
    const withBreak = run(project, ctx, setBreak(id, 1));
    expect(run(withBreak, ctx, setMarkers(id, [1, 0.5])).samples[id]!.break!.markers).toEqual([0, 0.5, 1]);
    expect(setMarkers(id, [0.5, 0.5005])(withBreak, ctx).ok).toBe(false);
  });

  it('unsliceBreak takes back everything the slicing made', () => {
    const { ctx, project: start, id } = imported();
    const before = run(start, ctx, setBreak(id, 1));
    const sliced = run(before, ctx, sliceAtMarkers(id));

    const back = run(sliced, ctx, unsliceBreak(id));

    expect(back.samples).toEqual(before.samples);
    expect(back.hits).toEqual(before.hits);
    expect(back.pads).toEqual(before.pads);
    expect(back.loops).toEqual({});
  });

  it('unsliceBreak is refused while M1 is in the song or a slice pad is in another loop', () => {
    const { ctx, project: start, id } = imported();
    const sliced = run(start, ctx, sliceBreak(id, 1, 4));
    const m1 = only(sliced.loops);

    const inSong = run(sliced, ctx, setSongCell('main', 0, m1.id));
    expect(unsliceBreak(id)(inSong, ctx)).toMatchObject({ ok: false, error: { kind: 'in-use', usages: [{ kind: 'song' }] } });

    const slicePad = m1.steps[0]!.padId!;
    const other = run(sliced, ctx, createLoop('Mine', 'main', 1));
    const mine = Object.values(other.loops).find((l) => l.name === 'Mine')!;
    const borrowed = run(other, ctx, setStep(mine.id, 0, { padId: slicePad }));
    expect(unsliceBreak(id)(borrowed, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'in-use', usages: [{ kind: 'loop', name: 'Mine' }] },
    });
  });

  it('an older break without markers loads with markers on 1/16', () => {
    const { ctx, project, id } = imported();
    const withBreak = run(project, ctx, setBreak(id, 2));
    const old = structuredClone(withBreak) as unknown as { samples: Record<string, { break: { markers?: unknown; loop?: unknown } }> };
    delete old.samples[id]!.break.markers;
    delete old.samples[id]!.break.loop;
    expect(upgradeProject(old as unknown as Project).samples[id]!.break!.markers).toEqual(gridMarkers(2, 2));
  });
});

describe('fill window (model)', () => {
  it('defaults to the whole loop and can only be set on a fill, within its steps', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, createLoop(null, 'fill', 1), createLoop(null, 'main', 1));
    const [fill, main] = Object.values(project.loops);
    expect(fill!.window).toEqual({ start: 0, end: 16 });
    expect(run(project, ctx, setFillWindow(fill!.id, 8, 16)).loops[fill!.id]!.window).toEqual({ start: 8, end: 16 });
    expect(setFillWindow(main!.id, 8, 16)(project, ctx).ok).toBe(false);
    expect(setFillWindow(fill!.id, 8, 8)(project, ctx).ok).toBe(false);
    expect(setFillWindow(fill!.id, 0, 17)(project, ctx).ok).toBe(false);
  });

  it('setLoopBars keeps a whole window whole and cuts a partial one', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, createLoop(null, 'fill', 2), createLoop(null, 'fill', 2));
    const [whole, part] = Object.values(project.loops);
    project = run(project, ctx, setFillWindow(part!.id, 12, 28), setLoopBars(whole!.id, 1), setLoopBars(part!.id, 1));
    expect(project.loops[whole!.id]!.window).toEqual({ start: 0, end: 16 });
    expect(project.loops[part!.id]!.window).toEqual({ start: 12, end: 16 });
  });
});
