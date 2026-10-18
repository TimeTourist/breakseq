import { describe, expect, it } from 'vitest';
import type { Command, Id, Project, StepEffect } from '../model';
import {
  addClip,
  copyHits,
  addSample,
  createLoop,
  createMod,
  createMatrix,
  createProject,
  effectiveHit,
  placeMatrix,
  setBpm,
  setMatrixConfig,
  setSongBars,
  setSongCell,
  setStep,
  sliceSample,
  stepDuration,
  updateHit,
} from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Trigger } from './generate';
import { generateTriggers } from './generate';

const ctx = sequentialIds();
const STEP = stepDuration(120);

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const newest = (before: Readonly<Record<Id, unknown>>, after: Readonly<Record<Id, unknown>>) =>
  Object.keys(after).find((k) => !(k in before))!;

/**
 * A kit at 120 BPM: kick K and four snares S1–S4, each with its own pad, and a
 * pad Snares with copies of all four snares as members (`snare`).
 */
function kit() {
  let project = run(createProject(), setBpm(120));
  const hit: Record<string, Id> = {};
  const pad: Record<string, Id> = {};
  for (const name of ['K', 'S1', 'S2', 'S3', 'S4']) {
    const before = project;
    project = run(project, addSample({ name, audio: constantAudio(0.05) }));
    hit[name] = newest(before.hits, project.hits);
    pad[name] = newest(before.pads, project.pads);
  }
  const before = project;
  // The pad Snares holds copies of the four snares' hits.
  project = run(project, createMatrix('Snares'));
  pad.Snares = newest(before.pads, project.pads);
  project = run(project, copyHits([hit.S1!, hit.S2!, hit.S3!, hit.S4!], pad.Snares));
  const snare = project.pads[pad.Snares]!.members;
  return { project, hit, pad, snare };
}

/** A main loop from a map of step → pad, placed over the whole song. */
function withLoop(project: Project, steps: Record<number, Id>, bars = 1, songBars = bars): [Project, Id] {
  const before = project;
  let next = run(project, createLoop(null, 'main', bars));
  const loop = newest(before.loops, next.loops);
  next = run(next, ...Object.entries(steps).map(([i, padId]) => setStep(loop, Number(i), { padId })), setSongBars(songBars), setSongCell('main', 0, loop));
  return [next, loop];
}

function withMod(project: Project, fields: Omit<StepEffect, 'sources'> & { sources?: Id[] }, row: 'modA' | 'modB', bars: number[] = [0]): Project {
  const before = project;
  const next = run(project, createMod('mod', [fields]));
  const mod = newest(before.mods, next.mods);
  return run(next, ...bars.map((bar) => setSongCell(row, bar, mod)));
}

const at = (triggers: Trigger[], step: number) => triggers.filter((t) => t.bar === 0 && t.step === step);

describe('fas 7: a mod with several effects', () => {
  it('Pitch and Ratchet in one mod: every step rolls in four and is a fifth up', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, { 0: pad.K!, 4: pad.S1! });
    const before = project;
    project = run(
      project,
      createMod('both', [
        { target: 'pitch', rate: 'step', shape: { kind: 'list', values: [7] } },
        { target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [4] } },
      ]),
    );
    project = run(project, setSongCell('modA', 0, newest(before.mods, project.mods)));

    const triggers = generateTriggers(project, () => 0);

    expect(at(triggers, 0).map((t) => t.pitch)).toEqual([7, 7, 7, 7]);
    expect(at(triggers, 4).map((t) => t.pitch)).toEqual([7, 7, 7, 7]);
  });

  it('effects in A and B on the same target still combine: pitch adds', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, { 0: pad.K! });
    project = withMod(project, { target: 'pitch', rate: 'step', shape: { kind: 'list', values: [3] } }, 'modA');
    project = withMod(project, { target: 'pitch', rate: 'step', shape: { kind: 'list', values: [4] } }, 'modB');
    expect(at(generateTriggers(project, () => 0), 0).map((t) => t.pitch)).toEqual([7]);
  });
});

describe('random pitch', () => {
  it('rolls whole semitones, or any pitch when set to freely', () => {
    const { project: base, pad } = kit();
    const [loop] = withLoop(base, Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, pad.K!])));
    const pitches = (whole: boolean) => {
      const project = withMod(loop, { target: 'pitch', rate: 'step', shape: { kind: 'random', min: 1, max: 4, chance: 100, whole } }, 'modA');
      let seed = 0;
      return generateTriggers(project, () => ((seed = (seed + 0.137) % 1), seed)).map((t) => t.pitch);
    };
    expect(pitches(true).every((p) => Number.isInteger(p) && p >= 1 && p <= 4)).toBe(true);
    expect(pitches(false).some((p) => !Number.isInteger(p))).toBe(true);
    expect(pitches(false).every((p) => p >= 1 && p <= 4)).toBe(true);
  });
});

describe('fas 4: mods', () => {
  it('stutter: Ratchet 4 in a clip over the snares gives four even triggers per step there, and only there', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, { 0: pad.K!, 4: pad.S1!, 8: pad.K!, 12: pad.S2! });
    project = withMod(project, { target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [4] } }, 'modA', []);
    const roll = Object.keys(project.mods).at(-1)!;
    // Clips over steps 5 and 13, where the snares are.
    project = run(project, addClip('modA', roll, 4, 1), addClip('modA', roll, 12, 1));

    const triggers = generateTriggers(project, () => 0);

    expect(at(triggers, 0)).toHaveLength(1);
    expect(at(triggers, 4).map((t) => t.time)).toEqual([0, 1, 2, 3].map((i) => 4 * STEP + (i * STEP) / 4));
    expect(at(triggers, 12)).toHaveLength(4);
  });

  it('pitch stairs: Ramp 0 → 12 per beat over a bar gives 0, 4, 8, 12, held within each beat', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, pad.S1!])));
    project = withMod(project, { target: 'pitch', rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } }, 'modA');

    expect(generateTriggers(project, () => 0).map((t) => t.pitch)).toEqual([0, 4, 8, 12].flatMap((p) => [p, p, p, p]));
  });

  it('1/3 tempo: a bar of slip plays content steps 0–5 every third step, and the next bar starts on time', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, pad.S1!])), 2);
    project = withMod(project, { target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } }, 'modA');

    const triggers = generateTriggers(project, () => 0);
    const slipped = triggers.filter((t) => t.time < 16 * STEP - 1e-9);

    expect(slipped.map((t) => [t.bar, t.step])).toEqual([0, 1, 2, 3, 4, 5].map((s) => [0, s]));
    slipped.forEach((t, k) => expect(t.time).toBeCloseTo(k * 3 * STEP));
    const next = triggers.find((t) => t.time >= 16 * STEP - 1e-9)!;
    expect([next.bar, next.step]).toEqual([1, 0]);
    expect(next.time).toBeCloseTo(16 * STEP);
  });

  it('slip over a clip of two bars is one run: the local playhead does not restart', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 48 }, (_, i) => [i, pad.S1!])), 3);
    project = withMod(project, { target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } }, 'modA', []);
    project = run(project, addClip('modA', Object.keys(project.mods)[0]!, 0, 32));

    const slipped = generateTriggers(project, () => 0).filter((t) => t.time < 32 * STEP - 1e-9);

    // Eleven content steps (0–10) over one clip of two bars, all from the start of the content.
    expect(slipped.map((t) => t.bar * 16 + t.step)).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });

  it('slip in a clip that starts mid-bar runs from there to the clip\'s end', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, pad.S1!])), 2);
    project = withMod(project, { target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 2] } }, 'modA', []);
    project = run(project, addClip('modA', Object.keys(project.mods)[0]!, 4, 8));

    const triggers = generateTriggers(project, () => 0);
    const steps = triggers.filter((t) => t.time < 16 * STEP - 1e-9).map((t) => [t.step, +(t.time / STEP).toFixed(3)]);

    // Steps 0–3 on time; from step 4 at half speed until step 12 on the clock; then on time from 12.
    expect(steps).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 6], [6, 8], [7, 10], [12, 12], [13, 13], [14, 14], [15, 15]]);
  });

  it('Pad member List 2 plays member 2, and numbers past the pad wrap round', () => {
    const { project: base, pad, snare } = kit();
    let [project] = withLoop(base, { 0: pad.Snares!, 4: pad.Snares! });
    const two = withMod(project, { target: 'padMember', rate: 'step', shape: { kind: 'list', values: [2] } }, 'modA');
    expect(generateTriggers(two, () => 0).map((t) => t.hitId)).toEqual([snare[1], snare[1]]);

    project = withMod(project, { target: 'padMember', rate: 'step', shape: { kind: 'list', values: [5] } }, 'modA');
    expect(generateTriggers(project, () => 0).map((t) => t.hitId)).toEqual([snare[0], snare[0]]);
  });

  it('Cycle with no values, per step, goes round the members where it hits a step: 1, 2, 3, 4, 1', () => {
    const { project: base, pad, hit, snare } = kit();
    let [project] = withLoop(base, { 2: pad.Snares!, 6: pad.Snares!, 10: pad.Snares!, 14: pad.Snares!, 18: pad.Snares! }, 2);
    project = withMod(project, { target: 'padMember', rate: 'step', shape: { kind: 'cycle', values: [] } }, 'modA', [0, 1]);

    const snares = generateTriggers(project, () => 0).filter((t) => t.hitId !== hit.K);

    expect(snares.map((t) => t.hitId)).toEqual([snare[0], snare[1], snare[2], snare[3], snare[0]]);
  });

  it('volume from A and B adds, on top of the hit; for direction B wins', () => {
    const { project: base, pad, hit } = kit();
    let [project] = withLoop(run(base, updateHit(hit.S1!, { volume: -2 })), { 0: pad.S1! });
    project = withMod(project, { target: 'volume', rate: 'bar', shape: { kind: 'list', values: [-6] } }, 'modA');
    project = withMod(project, { target: 'volume', rate: 'bar', shape: { kind: 'list', values: [3] } }, 'modB');
    expect(generateTriggers(project, () => 0).map((t) => t.volume)).toEqual([-5]);

    let [dir] = withLoop(base, { 0: pad.S1! });
    dir = withMod(dir, { target: 'direction', rate: 'bar', shape: { kind: 'list', values: [1] } }, 'modA');
    expect(generateTriggers(dir, () => 0).map((t) => t.direction)).toEqual(['reverse']);
    dir = withMod(dir, { target: 'direction', rate: 'bar', shape: { kind: 'list', values: [0] } }, 'modB');
    expect(generateTriggers(dir, () => 0).map((t) => t.direction)).toEqual(['forward']);
  });

});

/** A 1 s sample at 120 BPM sliced over one bar in four, its loop in a one-bar song. */
function slicedSample() {
  let project = run(createProject(), setBpm(120), addSample({ name: 'amen.wav', audio: constantAudio(1) }));
  const sampleId = Object.keys(project.samples)[0]!;
  project = run(project, sliceSample(sampleId, 1, 4));
  const matrix = Object.values(project.matrices)[0]!;
  const m1 = project.loops[matrix.loop!]!;
  const sliceHit = (i: number) => project.pads[m1.steps[i * 4]!.padId!]!.members[0]!;
  return { project: run(project, setSongBars(1), setSongCell('main', 0, m1.id)), matrix, sampleId, sliceHit };
}

describe("a matrix's config", () => {
  it("adds its pitch and volume to every slice, on top of the slice's own", () => {
    const { project: base, matrix, sliceHit } = slicedSample();
    const project = run(base, setMatrixConfig(matrix.id, { pitch: 1, volume: -3 }), updateHit(sliceHit(1), { pitch: 1 }));

    const triggers = generateTriggers(project, () => 0);

    expect(triggers.map((t) => t.pitch)).toEqual([1, 2, 1, 1]);
    expect(triggers.map((t) => t.volume)).toEqual([-3, -3, -3, -3]);
  });

  it('reverse on the matrix turns each slice round; a reversed slice plays forward again', () => {
    const { project: base, matrix, sliceHit } = slicedSample();
    const project = run(base, setMatrixConfig(matrix.id, { direction: 'reverse' }), updateHit(sliceHit(2), { direction: 'reverse' }));
    expect(generateTriggers(project, () => 0).map((t) => t.direction)).toEqual(['reverse', 'reverse', 'forward', 'reverse']);
  });

  it("the matrix's fade applies where a slice has none", () => {
    const { project: base, matrix, sliceHit } = slicedSample();
    const project = run(base, setMatrixConfig(matrix.id, { fadeOut: 8 }), updateHit(sliceHit(1), { fadeOut: 20 }));
    expect([0, 1].map((i) => effectiveHit(project, project.hits[sliceHit(i)]!).fadeOut)).toEqual([8, 20]);
  });

  it('placing the matrix lays its slices out from a step, each on its own step', () => {
    const { project: base, matrix, sliceHit } = slicedSample();
    let project = run(base, createLoop('Mine', 'main', 1));
    const mine = Object.values(project.loops).find((l) => l.name === 'Mine')!;
    project = run(project, placeMatrix(mine.id, matrix.id, 2));
    const padsAt = project.loops[mine.id]!.steps.flatMap((s, i) => (s.padId === null ? [] : [[i, project.pads[s.padId]!.members[0]]]));
    // Slices start on steps 0, 4, 8 and 12 of the matrix, so from step 2 they land on 2, 6, 10 and 14.
    expect(padsAt).toEqual([
      [2, sliceHit(0)],
      [6, sliceHit(1)],
      [10, sliceHit(2)],
      [14, sliceHit(3)],
    ]);
  });
});
