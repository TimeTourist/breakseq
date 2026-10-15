import { describe, expect, it } from 'vitest';
import type { Command, Id, Mod, Project } from '../model';
import {
  addSample,
  createLoop,
  createMod,
  createPad,
  createProject,
  setBpm,
  setSongBars,
  setSongCell,
  setStep,
  stepDuration,
  updateHit,
  updateSample,
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
 * A kit at 120 BPM: kick K and four snares S1–S4 tagged K and S, each with its
 * own pad, and a pad Snares with all four snares as members.
 */
function kit() {
  let project = run(createProject(ctx), setBpm(120));
  const tag = (name: string) => Object.values(project.tags).find((t) => t.name === name)!.id;
  const hit: Record<string, Id> = {};
  const pad: Record<string, Id> = {};
  for (const name of ['K', 'S1', 'S2', 'S3', 'S4']) {
    const before = project;
    project = run(project, addSample({ name, audio: constantAudio(0.05) }));
    const sample = newest(before.samples, project.samples);
    hit[name] = newest(before.hits, project.hits);
    pad[name] = newest(before.pads, project.pads);
    project = run(project, updateSample(sample, { mainTag: tag(name[0]!) }));
  }
  const before = project;
  project = run(project, createPad('Snares', [hit.S1!, hit.S2!, hit.S3!, hit.S4!]));
  pad.Snares = newest(before.pads, project.pads);
  return { project, hit, pad, tag };
}

/** A main loop from a map of step → pad, placed over the whole song. */
function withLoop(project: Project, steps: Record<number, Id>, bars = 1, songBars = bars): [Project, Id] {
  const before = project;
  let next = run(project, createLoop(null, 'main', bars));
  const loop = newest(before.loops, next.loops);
  next = run(next, ...Object.entries(steps).map(([i, padId]) => setStep(loop, Number(i), { padId })), setSongBars(songBars), setSongCell('main', 0, loop));
  return [next, loop];
}

function withMod(project: Project, fields: Omit<Mod, 'id' | 'name' | 'sources'> & { sources?: Id[] }, row: 'modA' | 'modB', bars: number[] = [0]): Project {
  const before = project;
  const next = run(project, createMod({ name: 'mod', ...fields }));
  const mod = newest(before.mods, next.mods);
  return run(next, ...bars.map((bar) => setSongCell(row, bar, mod)));
}

const at = (triggers: Trigger[], step: number) => triggers.filter((t) => t.bar === 0 && t.step === step);
const all = { kind: 'all' } as const;

describe('fas 4: mods', () => {
  it('stutter: Ratchet 4 on snares gives four even triggers per snare step, and only there', () => {
    const { project: base, pad, tag } = kit();
    let [project] = withLoop(base, { 0: pad.K!, 4: pad.S1!, 8: pad.K!, 12: pad.S2! });
    project = withMod(project, { target: 'ratchet', scope: { kind: 'tag', tagId: tag('S') }, rate: 'step', shape: { kind: 'list', values: [4] } }, 'modA');

    const triggers = generateTriggers(project, () => 0);

    expect(at(triggers, 0)).toHaveLength(1);
    expect(at(triggers, 4).map((t) => t.time)).toEqual([0, 1, 2, 3].map((i) => 4 * STEP + (i * STEP) / 4));
    expect(at(triggers, 12)).toHaveLength(4);
  });

  it('pitch stairs: Ramp 0 → 12 per beat over a bar gives 0, 4, 8, 12, held within each beat', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, pad.S1!])));
    project = withMod(project, { target: 'pitch', scope: all, rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } }, 'modA');

    expect(generateTriggers(project, () => 0).map((t) => t.pitch)).toEqual([0, 4, 8, 12].flatMap((p) => [p, p, p, p]));
  });

  it('1/3 tempo: a bar of slip plays content steps 0–5 every third step, and the next bar starts on time', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, pad.S1!])), 2);
    project = withMod(project, { target: 'tempo', scope: all, rate: 'bar', shape: { kind: 'list', values: [1 / 3] } }, 'modA');

    const triggers = generateTriggers(project, () => 0);
    const slipped = triggers.filter((t) => t.time < 16 * STEP - 1e-9);

    expect(slipped.map((t) => [t.bar, t.step])).toEqual([0, 1, 2, 3, 4, 5].map((s) => [0, s]));
    slipped.forEach((t, k) => expect(t.time).toBeCloseTo(k * 3 * STEP));
    const next = triggers.find((t) => t.time >= 16 * STEP - 1e-9)!;
    expect([next.bar, next.step]).toEqual([1, 0]);
    expect(next.time).toBeCloseTo(16 * STEP);
  });

  it('slip over adjacent bars is one run: the local playhead does not restart', () => {
    const { project: base, pad } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 48 }, (_, i) => [i, pad.S1!])), 3);
    project = withMod(project, { target: 'tempo', scope: all, rate: 'bar', shape: { kind: 'list', values: [1 / 3] } }, 'modA', [0, 1]);

    const slipped = generateTriggers(project, () => 0).filter((t) => t.time < 32 * STEP - 1e-9);

    // Eleven content steps (0–10) over two bars, all from bar 1 of the content.
    expect(slipped.map((t) => t.bar * 16 + t.step)).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });

  it('Borrow swaps the step for the same step in the source loop, with its pad, member and locks', () => {
    const { project: base, pad, hit } = kit();
    let [project] = withLoop(base, Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, pad.K!])));
    let source: Id;
    [project, source] = withLoop(project, {}, 1);
    project = run(
      project,
      setSongCell('main', 0, Object.values(project.loops)[0]!.id),
      setStep(source, 3, { padId: pad.Snares!, memberId: hit.S3! }),
      setStep(source, 5, { padId: pad.Snares!, ignoreMods: true }),
    );
    project = withMod(project, { target: 'sourceLoop', scope: { kind: 'range', from: 3, to: 5 }, rate: 'step', shape: { kind: 'list', values: [0] }, sources: [source] }, 'modA');
    project = withMod(project, { target: 'pitch', scope: all, rate: 'bar', shape: { kind: 'list', values: [5] } }, 'modB');

    const triggers = generateTriggers(project, () => 0);

    expect(at(triggers, 3).map((t) => [t.hitId, t.pitch])).toEqual([[hit.S3, 5]]);
    // Step 4 is empty in the source: borrowing silences it.
    expect(at(triggers, 4)).toEqual([]);
    // Step 5's borrowed lock ignores mods: no pitch from B.
    expect(at(triggers, 5).map((t) => [t.hitId, t.pitch])).toEqual([[hit.S1, 0]]);
    expect(at(triggers, 6).map((t) => t.hitId)).toEqual([hit.K]);
  });

  it('Pad member List 2 plays member 2, and numbers past the pad wrap round', () => {
    const { project: base, pad, hit } = kit();
    let [project] = withLoop(base, { 0: pad.Snares!, 4: pad.Snares! });
    const two = withMod(project, { target: 'padMember', scope: all, rate: 'step', shape: { kind: 'list', values: [2] } }, 'modA');
    expect(generateTriggers(two, () => 0).map((t) => t.hitId)).toEqual([hit.S2, hit.S2]);

    project = withMod(project, { target: 'padMember', scope: all, rate: 'step', shape: { kind: 'list', values: [5] } }, 'modA');
    expect(generateTriggers(project, () => 0).map((t) => t.hitId)).toEqual([hit.S1, hit.S1]);
  });

  it('Cycle with no values on snares, per step, goes round the members: 1, 2, 3, 4, 1', () => {
    const { project: base, pad, hit, tag } = kit();
    let [project] = withLoop(base, { 0: pad.K!, 2: pad.Snares!, 6: pad.Snares!, 8: pad.K!, 10: pad.Snares!, 14: pad.Snares!, 18: pad.Snares! }, 2);
    project = withMod(project, { target: 'padMember', scope: { kind: 'tag', tagId: tag('S') }, rate: 'step', shape: { kind: 'cycle', values: [] } }, 'modA', [0, 1]);

    const snares = generateTriggers(project, () => 0).filter((t) => t.hitId !== hit.K);

    expect(snares.map((t) => t.hitId)).toEqual([hit.S1, hit.S2, hit.S3, hit.S4, hit.S1]);
  });

  it('volume from A and B adds, on top of the hit; for direction B wins', () => {
    const { project: base, pad, hit } = kit();
    let [project] = withLoop(run(base, updateHit(hit.S1!, { volume: -2 })), { 0: pad.S1! });
    project = withMod(project, { target: 'volume', scope: all, rate: 'bar', shape: { kind: 'list', values: [-6] } }, 'modA');
    project = withMod(project, { target: 'volume', scope: all, rate: 'bar', shape: { kind: 'list', values: [3] } }, 'modB');
    expect(generateTriggers(project, () => 0).map((t) => t.volume)).toEqual([-5]);

    let [dir] = withLoop(base, { 0: pad.S1! });
    dir = withMod(dir, { target: 'direction', scope: all, rate: 'bar', shape: { kind: 'list', values: [1] } }, 'modA');
    expect(generateTriggers(dir, () => 0).map((t) => t.direction)).toEqual(['reverse']);
    dir = withMod(dir, { target: 'direction', scope: all, rate: 'bar', shape: { kind: 'list', values: [0] } }, 'modB');
    expect(generateTriggers(dir, () => 0).map((t) => t.direction)).toEqual(['forward']);
  });

  it('Borrow comes before member, and scope is tested after Borrow', () => {
    const { project: base, pad, hit, tag } = kit();
    let [project] = withLoop(base, { 0: pad.K! });
    let source: Id;
    [project, source] = withLoop(project, { 0: pad.Snares! });
    project = run(project, setSongCell('main', 0, Object.values(project.loops)[0]!.id));
    project = withMod(project, { target: 'sourceLoop', scope: all, rate: 'step', shape: { kind: 'list', values: [0] }, sources: [source] }, 'modA');
    // In B, a member mod for snares: the kick step only becomes a snare through Borrow.
    project = withMod(project, { target: 'padMember', scope: { kind: 'tag', tagId: tag('S') }, rate: 'step', shape: { kind: 'list', values: [3] } }, 'modB');

    expect(generateTriggers(project, () => 0).map((t) => t.hitId)).toEqual([hit.S3]);
  });
});
