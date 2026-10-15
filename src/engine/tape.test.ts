import { describe, expect, it } from 'vitest';
import type { Command, Id, ModEffect, Project, TapeCurve, TapeEffect } from '../model';
import { addClip, addSample, createLoop, createMod, createProject, resizeClip, setBpm, setSongBars, setStep, stepDuration } from '../model';
import { constantAudio, seededRng, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import type { Tape } from './tape';
import { tapePasses, tapeSpeed, wobbles } from './tape';

const ctx = sequentialIds();
const STEP = stepDuration(120);

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const BAR = 16 * STEP;

/** A tape over one bar from 0, a segment of 2/16, at a speed from `from` to `to` over the whole bar. */
const tape = (fields: Partial<Tape>, from = 1, to = 1): Tape => ({
  time: 0,
  end: BAR,
  start: 0,
  source: [],
  length: 2 * STEP,
  direction: 'forward',
  speed: { from, to, ramp: BAR, curve: 'linear' },
  wobble: [],
  ...fields,
});

/** Where a linear speed from s0 to s1 over T reaches each multiple of L: the exact answer. */
function exactBoundaries(s0: number, s1: number, T: number, L: number): number[] {
  const a = (s1 - s0) / (2 * T);
  const times: number[] = [];
  for (let n = 1; ; n++) {
    const target = n * L;
    const t = Math.abs(a) < 1e-12 ? target / s0 : (-s0 + Math.sqrt(s0 * s0 + 4 * a * target)) / (2 * a);
    if (!(t < T)) return times;
    times.push(t);
  }
}

describe('tapePasses', () => {
  it('at a steady 1× a segment of 2/16 comes round every two steps; ping-pong turns each time', () => {
    const passes = tapePasses(tape({ direction: 'pingpong' }));
    expect(passes).toHaveLength(8);
    passes.forEach((pass, i) => {
      expect(pass.time).toBeCloseTo(i * 2 * STEP, 6);
      expect(pass.end).toBeCloseTo((i + 1) * 2 * STEP, 6);
      expect(pass.direction).toBe(i % 2 === 0 ? 'forward' : 'reverse');
      expect(pass.from).toBeCloseTo(0, 6);
    });
  });

  it('forward and reverse play every pass the same way', () => {
    expect(tapePasses(tape({ direction: 'forward' })).every((p) => p.direction === 'forward')).toBe(true);
    expect(tapePasses(tape({ direction: 'reverse' })).every((p) => p.direction === 'reverse')).toBe(true);
  });

  it('the passes of a linear speed match the exact solution to well within the 1 ms grid', () => {
    for (const [s0, s1] of [
      [2, 0.5],
      [1, 0],
      [0.5, 3],
    ] as const) {
      const ends = tapePasses(tape({}, s0, s1)).map((p) => p.end).slice(0, -1);
      const exact = exactBoundaries(s0, s1, BAR, 2 * STEP);
      expect(ends).toHaveLength(exact.length);
      ends.forEach((t, i) => expect(Math.abs(t - exact[i]!)).toBeLessThan(1e-4));
    }
  });

  it('slowing from 1× to 0× makes each pass longer, and no pass starts once it has stopped', () => {
    const passes = tapePasses(tape({}, 1, 0));
    const lengths = passes.map((p) => p.end - p.time);
    for (let i = 1; i < lengths.length - 1; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!);
    // ∫ of a speed from 1 to 0 over 16 steps is 8 steps of tape: four times round 2/16.
    expect(passes).toHaveLength(4);
    expect(passes.at(-1)!.end).toBeCloseTo(BAR, 9);
    expect(passes.every((p) => p.speedStart > 0)).toBe(true);
    expect(passes.at(-1)!.speedEnd).toBeCloseTo(0, 9);
  });

  it('a tape heard from part way through its clip starts inside its pass', () => {
    const passes = tapePasses(tape({ time: 3 * STEP, direction: 'pingpong' }));
    // 3 steps in: pass 1 (backwards), 1 step into the segment, ending at step 4.
    expect(passes[0]).toMatchObject({ direction: 'reverse' });
    expect(passes[0]!.time).toBeCloseTo(3 * STEP, 9);
    expect(passes[0]!.from).toBeCloseTo(STEP, 6);
    expect(passes[0]!.end).toBeCloseTo(4 * STEP, 6);
  });
});

describe('tapeSpeed', () => {
  it('ramps over its ramp time and then holds the end value', () => {
    const ramped = tape({ speed: { from: 1, to: 0.25, ramp: 4 * STEP, curve: 'linear' } });
    expect(tapeSpeed(ramped, 0)).toBe(1);
    expect(tapeSpeed(ramped, 2 * STEP)).toBeCloseTo(0.625, 9);
    expect(tapeSpeed(ramped, 4 * STEP)).toBeCloseTo(0.25, 9);
    expect(tapeSpeed(ramped, 12 * STEP)).toBeCloseTo(0.25, 9);
  });

  it('half way up a rise: hard end < soft start < linear < soft end < hard start, and all end at the end value', () => {
    const at = (curve: TapeCurve, t = BAR / 2) => tapeSpeed(tape({ speed: { from: 0, to: 1, ramp: BAR, curve } }), t);
    expect(at('linear')).toBeCloseTo(0.5, 9);
    expect(at('hardEnd')).toBeLessThan(at('softStart'));
    expect(at('softStart')).toBeLessThan(0.5);
    expect(at('softEnd')).toBeGreaterThan(0.5);
    expect(at('hardStart')).toBeGreaterThan(at('softEnd'));
    for (const curve of ['linear', 'softStart', 'softEnd', 'hardStart', 'hardEnd'] as const) {
      expect(at(curve, 0)).toBeCloseTo(0, 9);
      expect(at(curve, BAR)).toBeCloseTo(1, 9);
    }
  });

  it('wow sways the speed within ±25 %, flutter within ±6 %, and the same rng gives the same sway', () => {
    const sway = (wow: number, flutter: number, seed: number) => {
      const wobbly = tape({ wobble: wobbles({ wow, flutter }, seededRng(seed)) });
      return Array.from({ length: 2000 }, (_, i) => tapeSpeed(wobbly, (i / 2000) * 4));
    };
    const wow = sway(1, 0, 1);
    expect(Math.max(...wow)).toBeLessThanOrEqual(1.25 + 1e-9);
    expect(Math.min(...wow)).toBeGreaterThanOrEqual(0.75 - 1e-9);
    expect(Math.max(...wow) - Math.min(...wow)).toBeGreaterThan(0.2);
    const flutter = sway(0, 1, 1);
    expect(Math.max(...flutter.map((v) => Math.abs(v - 1)))).toBeLessThanOrEqual(0.06 + 1e-9);
    expect(sway(1, 1, 7)).toEqual(sway(1, 1, 7));
    expect(sway(1, 1, 7)).not.toEqual(sway(1, 1, 8));
    expect(wobbles({ wow: 0, flutter: 0 }, seededRng(1))).toEqual([]);
  });
});

describe('generateTake', () => {
  /** A 4-bar song at 120 BPM with a one-bar main playing on every step, and a mod with `effects`. */
  function song(effects: readonly ModEffect[]) {
    let project = run(createProject(ctx), setBpm(120), setSongBars(4), addSample({ name: 'k', audio: constantAudio(0.05) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!.id;
    const loop = Object.values(project.loops)[0]!.id;
    project = run(project, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 64), createMod('T', effects));
    return { project, mod: Object.values(project.mods)[0]!.id as Id };
  }
  const brake: TapeEffect = { target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };

  it('under a Tape clip the song is not heard: the tape plays a recording of the segment', () => {
    const { project: base, mod } = song([brake]);
    const project = run(base, addClip('modA', mod, 16, 16));

    const take = generateTake(project, () => 0);
    const steps = take.triggers.map((t) => t.bar * 16 + t.step);

    expect(steps).toEqual([...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 32 }, (_, i) => 32 + i)]);
    expect(take.tapes).toHaveLength(1);
    const [only] = take.tapes;
    expect(only!.time).toBeCloseTo(16 * STEP, 9);
    expect(only!.end).toBeCloseTo(32 * STEP, 9);
    expect(only!.length).toBeCloseTo(2 * STEP, 9);
    expect(only!.source.map((t) => [t.step, +(t.time / STEP).toFixed(6)])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(only!.speed).toEqual({ from: 1, to: 0, ramp: 16 * STEP, curve: 'linear' });
    expect(only!.start).toBeCloseTo(16 * STEP, 9);
    expect(only!.direction).toBe('pingpong');
  });

  it('records what is heard, with the step effects of the same mod', () => {
    const { project: base, mod } = song([{ target: 'pitch', scope: { kind: 'all' }, rate: 'step', shape: { kind: 'list', values: [5] }, sources: [] }, brake]);
    const project = run(base, addClip('modA', mod, 0, 16));
    expect(generateTake(project, () => 0).tapes[0]!.source.map((t) => t.pitch)).toEqual([5, 5]);
  });

  it('a Tape clip from step 3 records steps 3 and 4, whether dropped there or trimmed to there', () => {
    const { project: base, mod } = song([{ ...brake, speed: { from: 1, to: 0 } }]);
    const dropped = run(base, addClip('modA', mod, 3, 13));
    const placed = run(base, addClip('modA', mod, 0, 16));
    const trimmed = run(placed, resizeClip(placed.song.clips.find((c) => c.row === 'modA')!.id, 'start', 3));
    for (const project of [dropped, trimmed]) {
      const [only] = generateTake(project, () => 0).tapes;
      expect(only!.time).toBeCloseTo(3 * STEP, 9);
      expect(only!.source.map((t) => t.step)).toEqual([3, 4]);
      expect(only!.source[0]!.time).toBeCloseTo(0, 9);
      // The ramp runs over the clip as it stands, from where it starts.
      expect(only!.start).toBeCloseTo(3 * STEP, 9);
      expect(only!.speed.ramp).toBeCloseTo(13 * STEP, 9);
    }
  });

  it("with Tape in both rows, B's plays", () => {
    const { project: base, mod } = song([brake]);
    let project = run(base, createMod('U', [{ ...brake, direction: 'forward' }]));
    const other = Object.keys(project.mods).find((k) => k !== mod)!;
    project = run(project, addClip('modA', mod, 0, 32), addClip('modB', other, 16, 16));
    const tapes = generateTake(project, () => 0).tapes;
    expect(tapes.map((t) => [t.direction, Math.round(t.time / STEP), Math.round(t.end / STEP)])).toEqual([
      ['pingpong', 0, 16],
      ['forward', 16, 32],
    ]);
  });
});
