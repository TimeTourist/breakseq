import { describe, expect, it } from 'vitest';
import type { Command, Id, ModEffect, Project, TapeEffect } from '../model';
import { addClip, addSample, createLoop, createMod, createProject, resizeClip, setBpm, setSongBars, setStep, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import type { Tape } from './tape';
import { tapePasses } from './tape';

const ctx = sequentialIds();
const STEP = stepDuration(120);

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const tape = (fields: Partial<Tape>): Tape => ({
  time: 0,
  end: 16 * STEP,
  source: [],
  length: 2 * STEP,
  direction: 'forward',
  speed: { start: 1, end: 1 },
  position: 0,
  ...fields,
});

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('tapePasses', () => {
  it('at a steady 1× a segment of 2/16 comes round every two steps; ping-pong turns each time', () => {
    const passes = tapePasses(tape({ direction: 'pingpong' }));
    expect(passes).toHaveLength(8);
    passes.forEach((pass, i) => {
      expect(pass.time).toBeCloseTo(i * 2 * STEP, 9);
      expect(pass.end).toBeCloseTo((i + 1) * 2 * STEP, 9);
      expect(pass.direction).toBe(i % 2 === 0 ? 'forward' : 'reverse');
      expect(pass.from).toBeCloseTo(0, 9);
    });
  });

  it('forward and reverse play every pass the same way', () => {
    expect(tapePasses(tape({ direction: 'forward' })).every((p) => p.direction === 'forward')).toBe(true);
    expect(tapePasses(tape({ direction: 'reverse' })).every((p) => p.direction === 'reverse')).toBe(true);
  });

  it('slowing from 1× to 0× makes each pass longer, and no pass starts once it has stopped', () => {
    const passes = tapePasses(tape({ speed: { start: 1, end: 0 } }));
    const lengths = passes.map((p) => p.end - p.time);
    for (let i = 1; i < lengths.length - 1; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!);
    // The tape covers ∫ of a speed from 1 to 0 over 16 steps: 8 steps of tape, four times round 2/16.
    expect(passes).toHaveLength(4);
    expect(passes.at(-1)!.end).toBeCloseTo(16 * STEP, 9);
    expect(passes.every((p) => p.speedStart > 0)).toBe(true);
    expect(passes.at(-1)!.speedEnd).toBeCloseTo(0, 9);
  });

  it('the speed of each pass follows the ramp, joined end to start', () => {
    const passes = tapePasses(tape({ speed: { start: 2, end: 0.5 } }));
    expect(passes[0]!.speedStart).toBe(2);
    passes.slice(1).forEach((p, i) => expect(close(p.speedStart, passes[i]!.speedEnd)).toBe(true));
    expect(passes.at(-1)!.speedEnd).toBeCloseTo(0.5, 9);
  });

  it('a tape part way through starts inside its pass', () => {
    const passes = tapePasses(tape({ position: 3 * STEP, direction: 'pingpong' }));
    // 3 steps in: pass 1 (backwards), 1 step into the segment.
    expect(passes[0]).toMatchObject({ direction: 'reverse' });
    expect(passes[0]!.from).toBeCloseTo(STEP, 9);
    expect(passes[0]!.end).toBeCloseTo(STEP, 9);
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
  const brake: TapeEffect = { target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0 } };

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
    expect(only!.speed).toEqual({ start: 1, end: 0 });
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
      // The ramp runs over the clip as it stands: it starts at 1 and there is no tape behind it.
      expect(only!.speed.start).toBe(1);
      expect(only!.position).toBe(0);
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
