import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, CommandContext, Project } from './index';
import {
  addPadMember,
  addSample,
  addVariant,
  breakSequence,
  guessBars,
  setBreakBars,
  unlikelyBpm,
  confirmTags,
  duplicateHit,
  gridMarkers,
  guessTags,
  removeTag,
  seal,
  setMarkers,
  sliceAtMarkers,
  trimSample,
  unsliceBreak,
  setBpm,
  setLoopLength,
  setSongBars,
  upgradeProject,
  addTag,
  apply,
  breakBpm,
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
  copyClip,
  moveClip,
  removeClip,
  resizeClip,
  setLoopKind,
  updateSample,
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
    expect(m1).toMatchObject({ name: 'M1', kind: 'main' });
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

  it('setLoopLength lengthens with empty steps and shortens, keeping the steps that remain', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'S1', audio: constantAudio(0.1) }), createLoop(null, 'main', 2));
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
    const project = run(createProject(ctx), ctx, createLoop(null, 'main', 1));
    const loop = only(project.loops);
    const legacy = { ...project, loops: { [loop.id]: { ...loop, bars: 1 } } } as unknown as Project;
    expect('bars' in upgradeProject(legacy).loops[loop.id]!).toBe(false);
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

describe('fas 5: tags and kept markers', () => {
  const tagId = (project: Project, name: string) => Object.values(project.tags).find((t) => t.name === name)!.id;

  it('guessTags marks guesses on untagged samples only; confirmTags and a tag set by hand clear the mark', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'a', audio: constantAudio(0.1) }), addSample({ name: 'b', audio: constantAudio(0.1) }));
    const [a, b] = Object.keys(project.samples) as [string, string];
    project = run(project, ctx, updateSample(b, { mainTag: tagId(project, 'K') }));

    project = run(project, ctx, guessTags([a, b], () => 'S'));
    expect(project.samples[a]).toMatchObject({ mainTag: tagId(project, 'S'), tagGuessed: true });
    expect(project.samples[b]).toMatchObject({ mainTag: tagId(project, 'K'), tagGuessed: false });

    expect(run(project, ctx, confirmTags([a])).samples[a]!.tagGuessed).toBe(false);
    expect(run(project, ctx, updateSample(a, { mainTag: tagId(project, 'H') })).samples[a]!.tagGuessed).toBe(false);
  });

  it('setBreak and trimSample keep markers placed by hand, but move grid markers to the new grid', () => {
    const ctx = sequentialIds();
    const { project: start, id } = (() => {
      const p = run(createProject(ctx), ctx, addSample({ name: 'amen.wav', audio: constantAudio(2) }));
      return { project: p, id: only(p.samples).id };
    })();
    let project = run(start, ctx, setBreak(id, 1), setMarkers(id, [0.3, 1.1]));

    expect(run(project, ctx, setBreak(id, 2)).samples[id]!.break!.markers).toEqual([0, 0.3, 1.1]);

    project = run(project, ctx, trimSample(id, 0.2, 1.2));
    // 0.3 and 1.1 s in the file are 0.1 and 0.9 s into the trimmed sample.
    const markers = project.samples[id]!.break!.markers;
    expect(markers).toHaveLength(3);
    expect(markers[1]).toBeCloseTo(0.1);
    expect(markers[2]).toBeCloseTo(0.9);

    const grid = run(start, ctx, setBreak(id, 1), setBreak(id, 2));
    expect(grid.samples[id]!.break!.markers).toEqual(gridMarkers(2, 2));
  });

  it('a file with cues imports as a break with markers at the cues', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, addSample({ name: 'cued.wav', audio: constantAudio(2), cues: [0, 0.5, 1.25] }));
    // Two seconds is one bar at 120 BPM.
    expect(only(project.samples).break).toMatchObject({ bars: 1, markers: [0, 0.5, 1.25], sliced: false });
  });

  it('removeTag refuses the defaults and tags in use, and removes your own', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addTag('P'), addSample({ name: 'a', audio: constantAudio(0.1) }));
    const p = tagId(project, 'P');
    expect(removeTag(tagId(project, 'K'))(project, ctx)).toMatchObject({ ok: false, error: { kind: 'invalid' } });

    const tagged = run(project, ctx, updateSample(only(project.samples).id, { mainTag: p }));
    expect(removeTag(p)(tagged, ctx)).toMatchObject({ ok: false, error: { kind: 'in-use' } });

    project = run(project, ctx, removeTag(p));
    expect(Object.values(project.tags).map((t) => t.name)).toEqual(['K', 'S', 'H', 'R', 'G']);
  });
});

describe('loop kind is a tag', () => {
  it('any loop can go in the Main or the Fill row, and setLoopKind retags it', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, createLoop(null, 'main', 1), createLoop(null, 'fill', 1));
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
    let project = run(createProject(ctx), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1) }));
    const id = only(project.samples).id;
    project = run(project, ctx, sliceBreak(id, 1, 4));
    const slicePad = Object.values(project.pads).find((p) => p.auto && project.samples[project.hits[p.members[0]!]!.sampleId]!.sliceOf === id)!;
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

  it('a file with cues gets its bars guessed', () => {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, addSample({ name: 'one-bar.wav', audio: constantAudio(1.7), cues: [0, 0.4] }));
    expect(only(project.samples).break?.bars).toBe(1);
  });

  it('bars can change after slicing: the BPM and where the slices land follow', () => {
    const ctx = sequentialIds();
    let project = run(createProject(ctx), ctx, addSample({ name: 'amen.wav', audio: constantAudio(1.75) }));
    const id = only(project.samples).id;
    // Sliced as 4 bars by mistake: one bar of 1/4 slices lands 4 times too far apart.
    project = run(project, ctx, setBreak(id, 4), setMarkers(id, [0.4375, 0.875, 1.3125]), sliceAtMarkers(id));
    expect(breakSequence(project, id).map((s) => s.step)).toEqual([0, 16, 32, 48]);

    project = run(project, ctx, setBreakBars(id, 1));

    expect(project.samples[id]!.break).toMatchObject({ bars: 1, sliced: true });
    expect(project.samples[id]!.break!.bpm).toBeCloseTo(breakBpm(1.75, 1));
    expect(breakSequence(project, id).map((s) => s.step)).toEqual([0, 4, 8, 12]);
  });
});

describe('clips', () => {
  /** A song of 4 bars with a one-bar loop L and a mod D. */
  function song() {
    const ctx = sequentialIds();
    const project = run(createProject(ctx), ctx, setSongBars(4), createLoop('L', 'main', 1), createMod({ name: 'D', target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [1] } }));
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
    const base = run(createProject(ctx), ctx, createLoop('M', 'main', 2), createLoop('F', 'fill', 1), createMod({ name: 'D', target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [1] } }));
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
