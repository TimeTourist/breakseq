import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command, Hit, Project } from './index';
import {
  addSample,
  bpmOf,
  breakSequence,
  createLoop,
  createPad,
  createProject,
  hitSound,
  placeBreak,
  replaceSample,
  replaceSampleWithFile,
  setBreak,
  setBreakBars,
  setHitSource,
  setMarkers,
  setStep,
  sliceBreak,
  swapBreak,
  trimSample,
  updateHit,
  upgradeProject,
} from './index';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A 2 s one-bar break of `slices` equal slices (a quarter is 0.5 s), and its id. */
function amen(slices = 4, seconds = 2) {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(seconds) }));
  const id = Object.keys(start.breaks)[0]!;
  const project = run(start, setMarkersAfterBreak(id, slices));
  return { project, id };
}
const setMarkersAfterBreak =
  (id: string, slices: number): Command =>
  (p, c) => {
    const asBreak = setBreak(id, 1)(p, c);
    if (!asBreak.ok) return asBreak;
    return setMarkers(id, Array.from({ length: slices }, (_, i) => i / slices))(asBreak.project, c);
  };

/** The hit on top of slot `slot`'s pad. */
const slotHit = (project: Project, id: string, slot: number): Hit => project.hits[project.pads[project.breaks[id]!.pads[slot]!]!.members[0]!]!;
/** Where a hit sounds, in seconds of its sample, rounded to ms; null when silent. */
const heard = (project: Project, hit: Hit) => {
  const sound = hitSound(project, hit);
  return sound === null ? null : [+sound.region.start.toFixed(3), +sound.region.end.toFixed(3)];
};

describe('a break', () => {
  it('a one-shot becomes a break with markers on 1/16, a parent, a pad per slot and M1, made once', () => {
    const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(start.breaks)[0]!;
    const project = run(start, setBreak(id, 1));
    const brk = project.breaks[id]!;
    expect(brk.markers).toHaveLength(16);
    expect(brk.pads).toHaveLength(16);
    expect(project.hits[brk.parent!]).toMatchObject({ breakId: id, slot: null });
    // The one-shot's pad is slot 01 now.
    expect(brk.pads[0]).toBe(start.breaks[id]!.pads[0]);
    expect(project.pads[brk.pads[0]!]!.name).toBe('amen 01');
    expect(bpmOf(project, brk)).toBeCloseTo(120);
    expect(Object.values(project.loops).map((l) => l.name)).toEqual(['amen']);

    const again = run(project, setBreak(id, null), setBreak(id, 1));
    expect(Object.values(again.loops)).toHaveLength(1);
  });

  it('removing a marker counts the slices again by number: everything after moves down one, and the last slot goes silent', () => {
    const { project, id } = amen(4);
    expect(heard(project, slotHit(project, id, 2))).toEqual([1, 1.5]);

    const fewer = run(project, setMarkers(id, [0, 0.25, 0.75]));
    expect(heard(fewer, slotHit(fewer, id, 1))).toEqual([0.5, 1.5]);
    expect(heard(fewer, slotHit(fewer, id, 2))).toEqual([1.5, 2]);
    expect(heard(fewer, slotHit(fewer, id, 3))).toBeNull();
    // Its pad stays, to sound again when there are more slices. The break began
    // with 16 slots on 1/16, so a 17th is new.
    expect(fewer.breaks[id]!.pads).toEqual(project.breaks[id]!.pads);
    const more = run(fewer, setMarkers(id, Array.from({ length: 17 }, (_, i) => i / 17)));
    expect(heard(more, slotHit(more, id, 3))).not.toBeNull();
    expect(more.breaks[id]!.pads).toHaveLength(17);
  });

  it("a hit's region is a part of its slice and follows it", () => {
    const { project, id } = amen(4);
    const hit = slotHit(project, id, 1);
    const half = run(project, updateHit(hit.id, { region: { start: 0.5, end: 1 } }));
    expect(heard(half, half.hits[hit.id]!)).toEqual([0.75, 1]);
    const longer = run(half, setMarkers(id, [0, 0.25, 0.75]));
    expect(heard(longer, longer.hits[hit.id]!)).toEqual([1, 1.5]);
  });

  it('trimming the sample takes the markers and regions along', () => {
    const { project, id } = amen(4);
    const sampleId = project.breaks[id]!.sampleId;
    const trimmed = run(project, trimSample(sampleId, 0, 1));
    expect(heard(trimmed, slotHit(trimmed, id, 1))).toEqual([0.25, 0.5]);
    expect(bpmOf(trimmed, trimmed.breaks[id]!)).toBeCloseTo(240);
  });

  it('a new sample under a break keeps the markers on their steps; the old sample stays', () => {
    const { project, id } = amen(4);
    const old = project.breaks[id]!.sampleId;
    const think = run(project, replaceSampleWithFile(id, { name: 'think.wav', audio: constantAudio(1.6) }));
    const brk = think.breaks[id]!;
    expect(brk.sampleId).not.toBe(old);
    expect(brk.markers).toEqual(project.breaks[id]!.markers);
    expect(heard(think, slotHit(think, id, 1))).toEqual([0.4, 0.8]);
    expect(think.samples[old]).toBeDefined();
    expect(run(think, replaceSample(id, old)).breaks[id]!.sampleId).toBe(old);
  });

  it('a hit can play another slot or a one-shot, keeping its settings', () => {
    let { project, id } = amen(4);
    project = run(project, addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const snare = Object.values(project.breaks).find((b) => b.name === 'snare.wav')!;
    const hit = slotHit(project, id, 0);
    project = run(project, updateHit(hit.id, { pitch: -3, fadeOut: 20 }), setHitSource(hit.id, snare.id, 0));
    expect(project.hits[hit.id]).toMatchObject({ breakId: snare.id, slot: 0, pitch: -3, fadeOut: 20 });
    expect(heard(project, project.hits[hit.id]!)).toEqual([0, 0.3]);
  });

  it('M1 follows the break while it is as the break made it, and not once it is edited', () => {
    const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(start.breaks)[0]!;
    let project = run(start, sliceBreak(id, 4, 4));
    const m1 = Object.values(project.loops)[0]!.id;
    expect(project.loops[m1]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i]))).toEqual(Array.from({ length: 16 }, (_, i) => i * 4));
    // Four bars was a mistake: one bar it is, and M1 follows.
    project = run(project, setBreakBars(id, 1));
    expect(project.loops[m1]!.steps).toHaveLength(16);
    expect(breakSequence(project, id).map((s) => s.step)).toEqual([0, 4, 8, 12]);
    // Edited by hand, it stays as it is.
    project = run(project, setStep(m1, 1, { padId: project.breaks[id]!.pads[3]! }), setMarkers(id, [0, 0.5]));
    expect(project.loops[m1]!.steps.filter((s) => s.padId !== null)).toHaveLength(5);
  });

  it('a file with cues imports as a break with its bars guessed and markers at the cues', () => {
    const project = run(createProject(), addSample({ name: 'one-bar.wav', audio: constantAudio(1.7), cues: [0, 0.4, 0.85] }));
    const brk = Object.values(project.breaks)[0]!;
    expect(brk.bars).toBe(1);
    expect(brk.markers.map((m) => +(m * 1.7).toFixed(3))).toEqual([0, 0.4, 0.85]);
    expect(brk.pads).toHaveLength(3);
  });
});

describe('swapping a break in a loop', () => {
  function twoBreaks() {
    let { project, id: amenId } = amen(4);
    project = run(project, addSample({ name: 'think.wav', audio: constantAudio(2) }));
    const thinkId = Object.values(project.breaks).find((b) => b.name === 'think.wav')!.id;
    project = run(project, setMarkersAfterBreak(thinkId, 2), createPad('Mine'), createLoop('L', 'main', 1));
    const loop = Object.values(project.loops).find((l) => l.name === 'L')!.id;
    const mine = Object.values(project.pads).find((p) => p.name === 'Mine')!.id;
    const a = project.breaks[amenId]!;
    project = run(
      project,
      setStep(loop, 0, { padId: a.pads[0]! }),
      setStep(loop, 4, { padId: a.pads[3]!, memberId: project.pads[a.pads[3]!]!.members[0]! }),
      setStep(loop, 8, { padId: mine }),
    );
    return { project, amenId, thinkId, loop, mine };
  }

  it('slot N plays slot N of the other break; a slot it lacks gets a silent pad; built pads stay', () => {
    const { project, amenId, thinkId, loop, mine } = twoBreaks();
    const swapped = run(project, swapBreak(loop, amenId, thinkId));
    const think = swapped.breaks[thinkId]!;
    const steps = swapped.loops[loop]!.steps;
    expect(steps[0]!.padId).toBe(think.pads[0]);
    expect(steps[4]).toMatchObject({ padId: think.pads[3], memberId: null });
    expect(steps[8]!.padId).toBe(mine);
    // Think has two slices: slot 04 is silent until it has more.
    expect(hitSound(swapped, slotHit(swapped, thinkId, 3))).toBeNull();
    const more = run(swapped, setMarkers(thinkId, [0, 0.25, 0.5, 0.75]));
    expect(heard(more, slotHit(more, thinkId, 3))).toEqual([1.5, 2]);

    // And back again.
    const back = run(swapped, swapBreak(loop, thinkId, amenId));
    expect(back.loops[loop]!.steps.map((s) => s.padId)).toEqual(project.loops[loop]!.steps.map((s) => s.padId));
  });

  it('a one-shot is a break with one slot: swapping to it keeps slot 01 and silences the rest', () => {
    let { project, amenId, loop } = twoBreaks();
    project = run(project, addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    const snare = Object.values(project.breaks).find((b) => b.name === 'snare.wav')!;
    const swapped = run(project, swapBreak(loop, amenId, snare.id));
    const steps = swapped.loops[loop]!.steps;
    expect(steps[0]!.padId).toBe(snare.pads[0]);
    expect(hitSound(swapped, swapped.hits[swapped.pads[steps[4]!.padId!]!.members[0]!]!)).toBeNull();
  });
});

describe('upgrading a project saved before breaks', () => {
  /** A project as fas 12 saved it: a break sliced in two (one slice with a trimmed variant), an unsliced break and a one-shot. */
  function legacy(): Project {
    const hit = (id: string, sampleId: string, end: number, variantOf: string | null = null, start = 0) => ({
      id,
      name: id,
      sampleId,
      region: { start, end },
      direction: 'forward',
      pitch: 0,
      volume: 0,
      fadeOut: 0,
      variantOf,
    });
    const sample = (id: string, offset: number, duration: number, brk: unknown, sliceOf: string | null) => ({ id, name: `${id}.wav`, audioId: 'a', offset, duration, break: brk, sliceOf });
    const step = (padId: string | null) => ({ padId, memberId: null, ignoreMods: false, nudge: 0 });
    return {
      audio: { a: constantAudio(2) },
      samples: {
        amen: sample('amen', 0, 2, { bars: 1, bpm: 120, sliced: true, markers: [0, 0.5], loop: 'm1' }, null),
        s1: sample('s1', 0, 0.5, null, 'amen'),
        s2: sample('s2', 0.5, 1.5, null, 'amen'),
        think: sample('think', 0, 2, { bars: 1, bpm: 120, sliced: false, markers: [0, 1], loop: null }, null),
        snare: sample('snare', 0, 0.3, null, null),
      },
      hits: {
        hAmen: hit('hAmen', 'amen', 2),
        h1: hit('h1', 's1', 0.5),
        h2: hit('h2', 's2', 1.5),
        h2v: hit('h2v', 's2', 0.75, 'h2', 0.375),
        hThink: hit('hThink', 'think', 2),
        hSnare: hit('hSnare', 'snare', 0.3),
      },
      pads: {
        pAmen: { id: 'pAmen', name: 'amen', members: ['hAmen'], auto: true, choice: 'top' },
        p1: { id: 'p1', name: 'amen 1', members: ['h1'], auto: true, choice: 'top' },
        p2: { id: 'p2', name: 'amen 2', members: ['h2', 'h2v'], auto: true, choice: 'top' },
        pThink: { id: 'pThink', name: 'think', members: ['hThink'], auto: true, choice: 'top' },
        pSnare: { id: 'pSnare', name: 'snare', members: ['hSnare'], auto: true, choice: 'top' },
      },
      loops: { m1: { id: 'm1', name: 'M1', kind: 'main', steps: [step('p1'), step(null), step(null), step(null), step('p2'), ...Array.from({ length: 11 }, () => step(null))] } },
      mods: {},
      song: { bpm: 120, bars: 1, clips: [] },
    } as unknown as Project;
  }

  it('every file becomes a sample and a break; slices become slots with their pads and hits, and sound where they did', () => {
    const project = upgradeProject(legacy());
    expect(Object.keys(project.samples).sort()).toEqual(['amen', 'snare', 'think']);
    const amenBrk = Object.values(project.breaks).find((b) => b.sampleId === 'amen')!;
    expect(amenBrk).toMatchObject({ bars: 1, markers: [0, 0.25], pads: ['p1', 'p2'], parent: 'hAmen', loop: 'm1' });
    expect(heard(project, project.hits.h1!)).toEqual([0, 0.5]);
    expect(heard(project, project.hits.h2!)).toEqual([0.5, 2]);
    expect(heard(project, project.hits.h2v!)).toEqual([0.875, 1.25]);
    expect(project.hits.hAmen).toMatchObject({ breakId: amenBrk.id, slot: null });
    // Loops are untouched.
    expect(project.loops.m1).toEqual(legacy().loops.m1);

    const think = Object.values(project.breaks).find((b) => b.sampleId === 'think')!;
    expect(think.markers).toEqual([0, 0.5]);
    expect(think.pads).toHaveLength(2);
    expect(think.loop).toBeNull();

    const snare = Object.values(project.breaks).find((b) => b.sampleId === 'snare')!;
    expect(snare).toMatchObject({ bars: null, markers: [0], pads: ['pSnare'], parent: null });
    expect(heard(project, project.hits.hSnare!)).toEqual([0, 0.3]);
  });

  it('upgrades the same way every time', () => {
    expect(upgradeProject(legacy())).toEqual(upgradeProject(legacy()));
  });
});

describe('placing a break in a loop', () => {
  it('writes over its whole length, emptying the steps no slice lands on', () => {
    const { project, id } = amen(4);
    const withLoop = run(project, createLoop('L', 'main', 2));
    const loop = Object.values(withLoop.loops).find((l) => l.name === 'L')!;
    const other = withLoop.breaks[id]!.pads[3]!;
    // Something on every step the break covers, and on the step after it.
    const filled = run(withLoop, ...Array.from({ length: 18 }, (_, i) => setStep(loop.id, i, { padId: other })));
    const placed = run(filled, placeBreak(loop.id, id, 1)).loops[loop.id]!.steps;
    const pads = withLoop.breaks[id]!.pads.slice(0, 4);
    expect(placed[0]!.padId).toBe(other);
    expect([1, 5, 9, 13].map((i) => placed[i]!.padId)).toEqual(pads);
    expect([2, 3, 4, 6, 16].map((i) => placed[i]!.padId)).toEqual([null, null, null, null, null]);
    expect(placed[17]!.padId).toBe(other);
  });
});
