import { describe, expect, it } from 'vitest';
import type { Clip, Command, Id, LaneStep, Mod, Project, StepEffect } from '../model';
import { addClip, addSample, copyHits, createLoop, createMod, createProject, replaceEffect, setBpm, setPadChoice, setSongBars, setStep, upgradeProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { oldShapesSong } from './fixtures/old-shapes';
import golden from './fixtures/old-shapes-triggers.json';
import type { Trigger } from './generate';
import { generateTriggers } from './generate';
import { modPreviewSong } from './generate';
import { modPassRows, padsOnlyUnderStretch } from './mod-pass';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const newest = (before: Readonly<Record<Id, unknown>>, after: Readonly<Record<Id, unknown>>) => Object.keys(after).find((k) => !(k in before))!;

/** A one-bar loop with one hit on every step, a bar of song, and a mod with `effects` over all of it. */
function song(effects: StepEffect[], bars = 1) {
  let project = run(createProject(), setBpm(120));
  const before = project;
  project = run(project, addSample({ name: 'k', audio: constantAudio(0.05) }));
  const pad = newest(before.pads, project.pads);
  const withLoop = run(project, createLoop('M1', 'main', 1));
  const loop = newest(project.loops, withLoop.loops);
  project = run(withLoop, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: pad })), setSongBars(bars));
  const withMod = run(project, createMod('M', effects));
  const mod = newest(project.mods, withMod.mods);
  project = run(withMod, addClip('main', loop, 0, bars * 16), addClip('modA', mod, 0, bars * 16));
  return { project, pad, loop, mod };
}

const fixed = (...values: number[]): LaneStep[] => values.map((v) => ({ v }));
const perStep = (triggers: readonly Trigger[], field: 'volume' | 'pitch') => {
  const out = new Map<number, number>();
  for (const t of triggers) if (!out.has(t.bar * 16 + t.step)) out.set(t.bar * 16 + t.step, t[field]);
  return [...out.values()];
};

describe('step lanes', () => {
  it('a Volume of 3 steps of 1/16 falls differently on every beat', () => {
    const { project } = song([{ target: 'volume', step: '1/16', lane: fixed(0, -6, -12) }]);
    const volumes = perStep(generateTriggers(project), 'volume');
    expect(volumes).toEqual([0, -6, -12, 0, -6, -12, 0, -6, -12, 0, -6, -12, 0, -6, -12, 0]);
    // Each beat starts on another step of the lane.
    expect([volumes[0], volumes[4], volumes[8], volumes[12]]).toEqual([0, -6, -12, 0]);
  });

  it('holds a step’s value over its whole size: 2 steps of a beat', () => {
    const { project } = song([{ target: 'volume', step: 'beat', lane: fixed(0, -6) }]);
    expect(perStep(generateTriggers(project), 'volume')).toEqual([0, 0, 0, 0, -6, -6, -6, -6, 0, 0, 0, 0, -6, -6, -6, -6]);
  });

  it('starts at the clip’s content start: a clip trimmed by 1 step starts on the lane’s second step', () => {
    const { project, mod } = song([{ target: 'volume', step: '1/16', lane: fixed(0, -6, -12) }]);
    const clips = project.song.clips.map((c) => (c.ref === mod ? { ...c, offset: 1, length: 15, start: 1 } : c));
    const volumes = perStep(generateTriggers({ ...project, song: { ...project.song, clips } }), 'volume');
    expect(volumes.slice(0, 4)).toEqual([0, -6, -12, 0]);
  });

  it('a dice step on Pitch gives different values in pass 1 and 2, and the same values in Song every time', () => {
    const dice: StepEffect = { target: 'pitch', step: '1/16', lane: [{ lo: -12, hi: 12, chance: 100 }], pitch: { values: 'semitones' } };
    const { project, mod, loop } = song([dice]);
    const pass = (n: number) => perStep(generateTriggers(modPreviewSong(project, mod, loop, 1, n)), 'pitch');
    expect(pass(0)).not.toEqual(pass(1));
    // Whole semitones within the band.
    for (const p of [...pass(0), ...pass(1)]) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(-12);
      expect(p).toBeLessThanOrEqual(12);
    }
    // Song sounds the same every time it is generated.
    expect(perStep(generateTriggers(project), 'pitch')).toEqual(perStep(generateTriggers(project), 'pitch'));
    // And every time its values roll anew along the clip: not one value held.
    expect(new Set(perStep(generateTriggers(project), 'pitch')).size).toBeGreaterThan(3);
  });

  it('a dice step whose chance does not come up does nothing', () => {
    const { project } = song([{ target: 'volume', step: '1/16', lane: [{ lo: -24, hi: -20, chance: 25 }] }]);
    const volumes = perStep(generateTriggers(project), 'volume');
    expect(volumes.some((v) => v === 0)).toBe(true);
    expect(volumes.some((v) => v <= -20)).toBe(true);
    expect(volumes.every((v) => v === 0 || (v >= -24 && v <= -20))).toBe(true);
  });

  it('on an on/off lane the chance is how likely the step is on: Direction 0–1 at 100 % is always backwards', () => {
    const { project } = song([{ target: 'direction', step: '1/16', lane: [{ lo: 0, hi: 1, chance: 100 }, { v: 0 }] }]);
    const dirs = generateTriggers(project).map((t) => t.direction);
    expect(dirs.filter((_, i) => i % 2 === 0).every((d) => d === 'reverse')).toBe(true);
    // Off leaves the hit as it is.
    expect(dirs.filter((_, i) => i % 2 === 1).every((d) => d === 'forward')).toBe(true);
  });

  it('Pad member: a member the pad does not have plays member 1', () => {
    let { project, pad } = song([{ target: 'padMember', step: '1/16', lane: fixed(2, 5) }]);
    const first = project.pads[pad]!.members[0]!;
    project = run(project, copyHits([first], pad));
    const second = project.pads[pad]!.members[1]!;
    const hits = generateTriggers(project).map((t) => t.hitId);
    expect(hits.slice(0, 4)).toEqual([second, first, second, first]);
  });

  it('Pad member off lets the pad choose as usual: Round robin, Random', () => {
    for (const choice of ['roundRobin', 'random'] as const) {
      // One song, three members in the pad, and its mod's effect swapped: the seeds stay the same.
      const base = song([{ target: 'volume', step: 'beat', lane: fixed(0) }]);
      const first = base.project.pads[base.pad]!.members[0]!;
      const project = run(base.project, copyHits([first], base.pad), copyHits([first], base.pad), setPadChoice(base.pad, choice));
      const members = project.pads[base.pad]!.members;
      const hits = (effect: StepEffect) => generateTriggers(run(project, replaceEffect(base.mod, 'volume', effect))).map((t) => members.indexOf(t.hitId) + 1);
      const plain = hits({ target: 'volume', step: 'beat', lane: fixed(0) });
      expect(new Set(plain).size).toBeGreaterThan(1);
      expect(hits({ target: 'padMember', step: 'beat', lane: fixed(0, 0, 0, 0) })).toEqual(plain);
      // Off and a member mixed: member steps play that member.
      const mixed = hits({ target: 'padMember', step: 'beat', lane: fixed(0, 2) });
      expect(mixed.slice(4, 8)).toEqual([2, 2, 2, 2]);
      expect(mixed.slice(0, 4)).toEqual(plain.slice(0, 4));
    }
  });

  it('Pad member: B off lets A’s member through; A off and B off let the pad choose (Magnus beslut 2026-10-22)', () => {
    const base = song([{ target: 'padMember', step: 'bar', lane: fixed(2) }]);
    const first = base.project.pads[base.pad]!.members[0]!;
    const withMembers = run(base.project, copyHits([first], base.pad), copyHits([first], base.pad), setPadChoice(base.pad, 'roundRobin'));
    const members = withMembers.pads[base.pad]!.members;
    const withB = run(withMembers, createMod('B', [{ target: 'padMember', step: 'bar', lane: fixed(0) }]));
    const modB = newest(withMembers.mods, withB.mods);
    const both = run(withB, addClip('modB', modB, 0, 16));
    const hits = (project: Project) => generateTriggers(project).map((t) => members.indexOf(t.hitId) + 1);
    expect(hits(both)).toEqual(Array.from({ length: 16 }, () => 2));
    // A off too: the pad's own choice, as without mods.
    const plain = hits(run(withMembers, replaceEffect(base.mod, 'padMember', { target: 'volume', step: 'bar', lane: fixed(0) })));
    expect(new Set(plain).size).toBeGreaterThan(1);
    expect(hits(run(both, replaceEffect(base.mod, 'padMember', { target: 'padMember', step: 'bar', lane: fixed(0) })))).toEqual(plain);
  });

  it('Dist values are the amount in percent', () => {
    const { project } = song([{ target: 'dist', step: 'bar', lane: fixed(50), dist: { mode: 'crush' } }]);
    expect(generateTriggers(project)[0]!.dist).toEqual({ mode: 'crush', amount: 0.5 });
  });
});

describe('old projects (Gamla projekt)', () => {
  const upgraded = () => {
    const { project } = oldShapesSong(sequentialIds());
    return upgradeProject(project)!;
  };
  const bars = (triggers: readonly unknown[], from: number, to: number) =>
    (triggers as { bar: number }[]).filter((t) => t.bar >= from && t.bar < to).map((t) => JSON.parse(JSON.stringify(t)) as unknown);
  const now = () =>
    generateTriggers(upgraded()).map((t) => ({
      time: t.time,
      bar: t.bar,
      step: t.step,
      hitId: t.hitId,
      pitch: t.pitch,
      volume: t.volume,
      pan: t.pan,
      direction: t.direction,
      filter: t.filter,
    }));

  it('turn List, Cycle, Ramp and Random into lanes', () => {
    const mods = upgraded().mods as Record<Id, Mod>;
    const lane = (id: string, target: string) => (mods[id]!.effects.find((e) => e.target === target) as StepEffect);
    expect(lane('old-list', 'pitch')).toMatchObject({ step: 'beat', lane: fixed(0, 3, 5, 7), pitch: { values: 'semitones' } });
    expect(lane('old-cycle', 'ratchet')).toMatchObject({ step: '1/16', lane: fixed(1, 2, 3) });
    // Ramp: a line over as many steps as its clip has of its rate.
    expect(lane('old-ramp', 'pitch')).toMatchObject({ step: 'beat', lane: fixed(0, 4, 8, 12) });
    expect(lane('old-ramp', 'filter').lane).toHaveLength(16);
    // Random: dice steps with the same band and the nearest chance.
    expect(lane('old-random', 'pan').lane[0]).toEqual({ lo: -100, hi: 100, chance: 100 });
    expect(lane('old-nearest', 'volume').lane[0]).toEqual({ lo: -12, hi: 0, chance: 25 });
    // Direction rolled forward or backwards when its chance came up: on half as often.
    expect(lane('old-nearest', 'direction').lane[0]).toEqual({ lo: 0, hi: 1, chance: 25 });
  });

  it('give the same triggers as before for List and Cycle (exact), Ramp and Random (here exact too)', () => {
    // Bars 0–4: List (two clips, the second trimmed), Cycle, Ramp, Random.
    expect(bars(now(), 0, 5)).toEqual(bars(golden, 0, 5));
  });

  it('come as near as they can where a chance was not 100, 75, 50 or 25 %', () => {
    const before = bars(golden, 5, 6) as Trigger[];
    const after = bars(now(), 5, 6) as Trigger[];
    expect(after.map((t) => [t.time, t.hitId])).toEqual(before.map((t) => [t.time, t.hitId]));
    // Volume rolled at 30 % now rolls at 25 %: where it rolls in both it is the same value.
    const same = before.filter((t, i) => t.volume !== 0 && after[i]!.volume !== 0);
    expect(same.length).toBeGreaterThan(0);
    for (const t of same) expect(after[before.indexOf(t)]!.volume).toBe(t.volume);
  });

  it('Random with whole numbers rolls whole numbers in the lane too, exactly as before', () => {
    const mods = upgraded().mods as Record<Id, Mod>;
    const lane = (target: string) => (mods['old-whole']!.effects.find((e) => e.target === target) as StepEffect).lane[0];
    expect(lane('volume')).toEqual({ lo: -12, hi: 0, chance: 100, whole: true });
    expect(lane('pan')).toEqual({ lo: -50, hi: 50, chance: 50, whole: true });
    // Bar 6: Whole.
    expect(bars(now(), 6, 7)).toEqual(bars(golden, 6, 7));
  });

  it('an empty List did nothing and goes', () => {
    const mods = upgraded().mods as Record<Id, Mod>;
    expect(mods['old-empty']!.effects).toEqual([]);
    // Bar 7: Empty.
    expect(bars(now(), 7, 8)).toEqual(bars(golden, 7, 8));
  });

  it('an empty Cycle counted 1, 2, 3 … and does so in the lane, exactly as before (Magnus beslut 2026-10-22)', () => {
    const mods = upgraded().mods as Record<Id, Mod>;
    const lane = (target: string) => (mods['old-counting']!.effects.find((e) => e.target === target) as StepEffect);
    // As many steps of its rate as its clip has, as Ramp.
    expect(lane('volume')).toMatchObject({ step: 'beat', lane: fixed(1, 2, 3, 4) });
    expect(lane('pitch')).toMatchObject({ step: '1/16', lane: fixed(...Array.from({ length: 16 }, (_, i) => i + 1)), pitch: { values: 'semitones' } });
    // Bar 8: Counting.
    expect(bars(now(), 8, 9)).toEqual(bars(golden, 8, 9));
  });

  it('an empty Cycle without a clip has 16 steps, within the lane’s range; on Pad member it is In turn', () => {
    const project = oldShapesSong(sequentialIds()).project;
    const cycles = {
      x: {
        id: 'x',
        name: 'X',
        seed: 1,
        effects: [
          { target: 'volume', rate: 'step', shape: { kind: 'cycle', values: [] } },
          { target: 'padMember', rate: 'step', shape: { kind: 'cycle', values: [] } },
          { target: 'pitch', rate: 'step', shape: { kind: 'list', values: [] } },
        ],
      },
    } as unknown as Project['mods'];
    const out = upgradeProject({ ...project, mods: cycles, song: { ...project.song, clips: [] } })!;
    expect((out.mods.x!.effects as StepEffect[]).map((e) => [e.target, e.lane])).toEqual([
      ['volume', fixed(...Array.from({ length: 16 }, (_, i) => Math.min(6, i + 1)))],
      ['padMember', fixed(1, 2, 3, 4)],
    ]);
  });

  it('leave a project with lanes as it is', () => {
    const { project } = song([{ target: 'volume', step: '1/16', lane: fixed(0, -6) }]);
    const own = Object.fromEntries(Object.entries(upgradeProject(project)!.mods).filter(([, m]) => m.isPreset !== true));
    expect(own).toEqual(project.mods);
  });

  it('keep values within the lane’s range, and Dist in percent', () => {
    const project = oldShapesSong(sequentialIds()).project;
    const mods = {
      x: {
        id: 'x',
        name: 'X',
        seed: 1,
        effects: [
          { target: 'volume', rate: 'step', shape: { kind: 'list', values: [0, -40] } },
          { target: 'dist', rate: 'bar', shape: { kind: 'list', values: [0.5] } },
        ],
      },
    } as unknown as Project['mods'];
    const clips: Clip[] = [];
    const out = upgradeProject({ ...project, mods, song: { ...project.song, clips } })!;
    const effects = out.mods.x!.effects as StepEffect[];
    expect(effects[0]!.lane).toEqual(fixed(0, -24));
    expect(effects[1]!.lane).toEqual(fixed(50));
  });

  it('keep Pad member values 1–8: off is new, and an old 0 or a Random from 0 is member 1', () => {
    const project = oldShapesSong(sequentialIds()).project;
    const mods = {
      x: {
        id: 'x',
        name: 'X',
        seed: 1,
        effects: [{ target: 'padMember', rate: 'step', shape: { kind: 'list', values: [0, 2, 9] } }],
      },
      y: {
        id: 'y',
        name: 'Y',
        seed: 2,
        effects: [{ target: 'padMember', rate: 'step', shape: { kind: 'random', min: 0, max: 3, chance: 100, whole: true } }],
      },
    } as unknown as Project['mods'];
    const out = upgradeProject({ ...project, mods, song: { ...project.song, clips: [] } })!;
    expect((out.mods.x!.effects[0] as StepEffect).lane).toEqual(fixed(1, 2, 8));
    expect((out.mods.y!.effects[0] as StepEffect).lane[0]).toEqual({ lo: 1, hi: 3, chance: 100 });
  });
});

describe('the preview grid (modPassRows)', () => {
  it('shows what each step does in a pass: the same values as the triggers of that pass', () => {
    const effects: StepEffect[] = [
      { target: 'pitch', step: '1/16', lane: [{ lo: -12, hi: 12, chance: 75 }, { v: 3 }], pitch: { values: 'semitones' } },
      { target: 'volume', step: 'beat', lane: fixed(0, -6, -12) },
    ];
    const { project, mod, loop } = song(effects);
    for (const pass of [0, 1, 5]) {
      const rows = modPassRows(project, mod, loop, pass);
      const triggers = generateTriggers(modPreviewSong(project, mod, loop, 1, pass));
      const pitch = rows.find((r) => r.target === 'pitch')!;
      const volume = rows.find((r) => r.target === 'volume')!;
      if (pitch.kind !== 'lane' || volume.kind !== 'lane') throw new Error();
      expect(pitch.cells.map((c) => c.value ?? 0)).toEqual(perStep(triggers, 'pitch'));
      expect(volume.cells.map((c) => c.value)).toEqual(perStep(triggers, 'volume'));
      expect(volume.cells.filter((c) => c.restart).map((c) => volume.cells.indexOf(c))).toEqual([0, 12]);
      expect(pitch.cells[0]!.band).toEqual({ lo: -12, hi: 12 });
    }
  });
});

describe('pads only under a Stretch mod', () => {
  it('are those whose every step in the song has a Stretch mod over it', () => {
    const { project, pad, mod } = song([{ target: 'stretch', step: 'bar', lane: fixed(2) }]);
    expect(padsOnlyUnderStretch(project).has(pad)).toBe(true);
    // Half the song without the mod: the hit's own grain is heard there.
    const clips = project.song.clips.map((c) => (c.ref === mod ? { ...c, length: 8 } : c));
    expect(padsOnlyUnderStretch({ ...project, song: { ...project.song, clips } }).has(pad)).toBe(false);
  });
});
