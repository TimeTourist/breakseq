// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, LaneStep, ModEffect, ModTranceGate, Project, StepEffect } from '../model';
import { DEFAULT_HALFTIME, addClip, addSample, clearTranceGate, createLoop, createMod, createProject, newStepEffect, setBpm, setSongBars, setStep } from '../model';
import { seededRng, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import { readProjectFile, writeProjectFile } from './project-file';
import type { Rendered } from './render';
import { renderTakeWhole, renderTakeWithTail } from './render';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
/** 120 BPM: a step is 0.125 s, a beat 0.5 s. */
const STEP = 0.125;

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const noise = (seconds: number, seed: number): AudioData => {
  const rng = seededRng(seed);
  const length = Math.round(seconds * SAMPLE_RATE);
  return { sampleRate: SAMPLE_RATE, channels: [0, 1].map(() => Float32Array.from({ length }, () => rng() * 2 - 1)) };
};

/** A 2-bar song at 120 BPM whose main plays one sound on the steps in `steps` of a one-bar loop. */
function song(audio: AudioData, steps: readonly number[]): Project {
  let project = run(createProject(), setBpm(120), setSongBars(2), addSample({ name: 's', audio }), createLoop(null, 'main', 1));
  const pad = Object.values(project.pads)[0]!.id;
  const loop = Object.values(project.loops)[0]!.id;
  project = run(project, ...steps.map((i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 32));
  return project;
}

function withMod(project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB' = 'modA'): Project {
  const before = project;
  const made = run(project, createMod('M', effects));
  return run(made, addClip(row, Object.keys(made.mods).find((k) => !(k in before.mods))! as Id, start, length));
}

const render = (project: Project, options = {}) => renderTakeWithTail(generateTake(project), project, SAMPLE_RATE, undefined, 'all', options);

/** Root mean square of channel 0 between two times. */
function rms(r: Rendered, from: number, to: number): number {
  const data = r.full.getChannelData(0);
  let sum = 0;
  const a = Math.round(from * SAMPLE_RATE);
  const b = Math.round(to * SAMPLE_RATE);
  for (let i = a; i < b; i++) sum += data[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** The largest difference between two renders between two times. */
function difference(a: Rendered, b: Rendered, from = 0, to = Infinity): number {
  let most = 0;
  for (let c = 0; c < 2; c++) {
    const x = a.full.getChannelData(c);
    const y = b.full.getChannelData(c);
    for (let i = Math.round(from * SAMPLE_RATE); i < Math.min(x.length, y.length, to * SAMPLE_RATE); i++) most = Math.max(most, Math.abs(x[i]! - y[i]!));
  }
  return most;
}

const lane = (target: StepEffect['target'], step: StepEffect['step'], values: readonly number[], extra: Partial<StepEffect> = {}): StepEffect => ({
  ...newStepEffect(target),
  step,
  lane: values.map((v) => ({ v })),
  ...extra,
});

describe('Tape records what is heard', () => {
  const tape: ModEffect = { target: 'tape', length: 4, direction: 'forward', speed: { from: 1, to: 1 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };
  const reverb: StepEffect = { ...newStepEffect('reverb'), step: 'bar', lane: [{ v: 100 }], reverb: { size: 1 } };

  it('a Tape over a reverb throw records the tail', async () => {
    // A short hit on the first step; the tape repeats the first beat over the bar.
    const dry = song(noise(0.05, 1), [0]);
    const thrown = await render(withMod(dry, [reverb, tape], 0, 16));
    const plain = await render(withMod(dry, [tape], 0, 16));
    // In the second pass of the tape, after the hit: the tail it recorded, or silence without the throw.
    expect(rms(thrown, 0.5 + 0.1, 0.5 + 0.45)).toBeGreaterThan(0.005);
    expect(rms(plain, 0.5 + 0.1, 0.5 + 0.45)).toBe(0);
    // And the hit itself comes round each beat.
    expect(rms(plain, 0.5, 0.55)).toBeGreaterThan(0.1);
  });
});

describe('audio mods in a render', () => {
  // What is heard: noise for the whole first bar, from one hit on step 0.
  const base = song(noise(2.1, 2), [0]);
  const clip = { start: 4, length: 4 };
  const mods: Record<string, ModEffect[]> = {
    Scramble: [lane('scramble', 'beat', [100])],
    Stutter: [lane('stutter', '1/16', [1, 2, 3, 3])],
    Freeze: [lane('freeze', '1/16', [1, 1, 1, 1], { freeze: { grain: 30, spread: 25, level: -3 } })],
    Reverse: [lane('reverse', 'beat', [1])],
    Rewind: [lane('rewind', 'beat', [1], { rewind: { pullBack: 4, curve: 'spinBack' } })],
    Halftime: [{ ...DEFAULT_HALFTIME, keepPitch: true }],
  };

  for (const [name, effects] of Object.entries(mods)) {
    it(`${name} changes what is heard under its clip, and after it the song goes on as heard`, async () => {
      const as = await render(base);
      const got = await render(withMod(base, effects, clip.start, clip.length));
      const under = [clip.start * STEP + 0.01, (clip.start + clip.length) * STEP - 0.01] as const;
      expect(rms(got, ...under)).toBeGreaterThan(0.05);
      expect(difference(got, as, ...under)).toBeGreaterThan(0.1);
      expect(difference(got, as, 0, clip.start * STEP - 0.001)).toBe(0);
      expect(difference(got, as, (clip.start + clip.length) * STEP + 0.004)).toBeLessThan(1e-6);
    });
  }

  it('in parts, as one long render: tapes and every audio mod, Scramble from the whole song, Trance gate over them', async () => {
    const tape: ModEffect = { target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0.5 }, rampOver: null, curve: 'softEnd', wow: 0.3, flutter: 0.2 };
    let project = withMod(base, [lane('scramble', '1/16', [100, 50]), lane('freeze', '1/16', [0, 0, 1, 0]), lane('stutter', '1/16', [0, 3, 0, 0])], 0, 8);
    project = withMod(project, [tape], 10, 6);
    project = withMod(project, [DEFAULT_HALFTIME, lane('rewind', 'beat', [0, 1])], 16, 8);
    project = withMod(project, [{ ...newStepEffect('tranceGate'), lane: [{ v: 1 }, { lo: 0, hi: 1, chance: 50 }, { v: 0 }], tranceGate: { depth: -12, open: 75, smooth: 20 } }], 4, 20, 'modB');
    const take = generateTake(project);
    const whole = await renderTakeWhole(take, project, SAMPLE_RATE);
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', { chunkSeconds: 0.25 });
    expect(rms(whole, 0, 4)).toBeGreaterThan(0.05);
    expect(difference(parts, whole)).toBeLessThan(1e-4);
  });
});

describe('under a Tape, Scratch or audio mod only what it plays is heard (Magnus beslut 2026-10-22)', () => {
  // A short hit on step 0 thrown into a long reverb: the tail rings on into the second beat and past it.
  const reverb: StepEffect = { ...newStepEffect('reverb'), step: 'bar', lane: [{ v: 100 }], reverb: { size: 1 } };
  const thrown = withMod(song(noise(0.05, 3), [0]), [reverb], 0, 4);
  const clip = { start: 8, length: 4 };
  // Inside the 3 ms fades at the edges (a tape lets what is heard back in over its last 3 ms).
  const under = [clip.start * STEP + 0.004, (clip.start + clip.length) * STEP - 0.004] as const;
  const silent: Record<string, ModEffect[]> = {
    // A tape at 0× is silent.
    Tape: [{ target: 'tape', length: 4, direction: 'forward', speed: { from: 0, to: 0 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 }],
    // The fader closed all through.
    Scratch: [{ target: 'scratch', record: 4, step: '1/16', points: [0, 0.25, 0.5, 0.75], fader: [[false], [false], [false], [false]] }],
  };

  it('the reverb tail rings on where the clips go', async () => {
    expect(rms(await render(thrown), ...under)).toBeGreaterThan(0.002);
  });

  for (const [name, effects] of Object.entries(silent)) {
    it(`${name} that plays nothing is silent under its clip, also the reverb that rang in before it`, async () => {
      const got = await render(withMod(thrown, effects, clip.start, clip.length, 'modB'));
      expect(rms(got, ...under)).toBeLessThan(1e-5);
    });
  }

  it('Stutter at Gate 50 % is silent in the gated half of each repeat, also the reverb that rang in before it', async () => {
    const stutter = lane('stutter', '1/16', [1, 1, 1, 1], { stutter: { grabs: 1, pitch: 0, gate: 50 } });
    const got = await render(withMod(thrown, [stutter], clip.start, clip.length, 'modB'));
    for (let k = 0; k < clip.length; k++) {
      const step = (clip.start + k) * STEP;
      expect(rms(got, step + STEP / 2 + 0.004, step + STEP - 0.0005)).toBeLessThan(1e-5);
      expect(rms(got, step + 0.004, step + STEP / 2 - 0.004)).toBeGreaterThan(0.001);
    }
  });
});

describe('Trance gate in a render (Magnus beslut 2026-10-23)', () => {
  // What is heard: noise for the whole first bar, from one hit on step 0.
  const base = song(noise(2.1, 5), [0]);
  const gate = (values: readonly (number | LaneStep)[], settings: Partial<ModTranceGate> = {}): StepEffect => ({
    ...newStepEffect('tranceGate'),
    lane: values.map((v) => (typeof v === 'number' ? { v } : v)),
    tranceGate: { depth: '-inf', open: 50, smooth: 5, ...settings },
  });
  /** The largest difference between `a` and `b` scaled by `g`, between two times. */
  function scaled(a: Rendered, b: Rendered, g: number, from: number, to: number): number {
    let most = 0;
    for (let c = 0; c < 2; c++) {
      const x = a.full.getChannelData(c);
      const y = b.full.getChannelData(c);
      for (let i = Math.round(from * SAMPLE_RATE); i < Math.round(to * SAMPLE_RATE); i++) most = Math.max(most, Math.abs(x[i]! - g * y[i]!));
    }
    return most;
  }

  it('Straight: closed steps are silent at Depth −∞, open steps are heard as they are for Open of their length', async () => {
    const plain = await render(base);
    const got = await render(withMod(base, [newStepEffect('tranceGate')], 0, 16));
    for (let k = 0; k < 16; k++) {
      const step = k * STEP;
      // Open: from the end of the attack to where the open half ends.
      expect(scaled(got, plain, 1, step + 0.005 + 0.0005, step + STEP / 2)).toBeLessThan(1e-6);
      // Closed: from the end of the release to the next step; by the clip's end it is all the way up again.
      expect(rms(got, step + STEP / 2 + 0.005 + 0.0005, step + STEP - (k === 15 ? 0.0055 : 0))).toBe(0);
    }
    expect(rms(got, 0.02, 0.06)).toBeGreaterThan(0.1);
  });

  it('a closed step is at Depth: −12 dB of what is heard there', async () => {
    const plain = await render(base);
    const got = await render(withMod(base, [gate([1, 0, 0, 0], { depth: -12 })], 0, 16));
    expect(scaled(got, plain, 10 ** (-12 / 20), STEP + 0.006, 4 * STEP)).toBeLessThan(1e-6);
  });

  it('the edges go over Smooth: halfway up 10 ms into an open step with Smooth 20 ms', async () => {
    const plain = await render(base);
    const got = await render(withMod(base, [gate([0, 1], { smooth: 20 })], 0, 16));
    const at = STEP + 0.01;
    // Over a 1 ms window round the middle of the attack the level goes from 0.475 to 0.525.
    expect(scaled(got, plain, 0.5, at - 0.0005, at + 0.0005)).toBeLessThan(0.03 * Math.max(...plain.full.getChannelData(0).slice(0, 4000).map(Math.abs)));
    expect(scaled(got, plain, 1, STEP + 0.0205, STEP * 1.5)).toBeLessThan(1e-6);
  });

  it('a long reverb tail is chopped in 1/16 pulses too', async () => {
    const reverb: StepEffect = { ...newStepEffect('reverb'), step: 'bar', lane: [{ v: 100 }], reverb: { size: 1 } };
    const thrown = withMod(song(noise(0.05, 3), [0]), [reverb], 0, 4);
    const got = await render(withMod(thrown, [newStepEffect('tranceGate')], 8, 8, 'modB'));
    for (let k = 8; k < 16; k++) {
      const step = k * STEP;
      expect(rms(got, step + 0.006, step + STEP / 2)).toBeGreaterThan(0.001);
      expect(rms(got, step + STEP / 2 + 0.0055, step + STEP - (k === 15 ? 0.0055 : 0))).toBe(0);
    }
  });

  it('a Stutter under it is chopped: the gate changes the level last', async () => {
    const roll = lane('stutter', '1/16', [1, 2, 3, 3]);
    const stuttered = withMod(base, [roll], 4, 4);
    const plain = await render(stuttered);
    const got = await render(withMod(stuttered, [gate([1, 0])], 4, 4, 'modB'));
    expect(scaled(got, plain, 1, 4 * STEP + 0.0055, 4.5 * STEP)).toBeLessThan(1e-6);
    expect(rms(got, 5 * STEP + 0.0055, 6 * STEP)).toBe(0);
    expect(rms(plain, 5 * STEP + 0.0055, 6 * STEP)).toBeGreaterThan(0.05);
    expect(scaled(got, plain, 1, 6 * STEP + 0.0055, 6.5 * STEP)).toBeLessThan(1e-6);
  });

  it('Clear sounds as without the gate', async () => {
    const plain = await render(base);
    const got = await render(withMod(base, [clearTranceGate(gate([0, 1, { lo: 0, hi: 1, chance: 25 }, 0], { depth: -24, open: 25 }))], 0, 16));
    expect(difference(got, plain)).toBeLessThan(1e-6);
  });

  it('with Trance gate in A and B, B’s is heard where they meet', async () => {
    const plain = await render(base);
    const a = withMod(base, [gate([1], { open: 100 })], 0, 16);
    const got = await render(withMod(a, [gate([0])], 4, 4, 'modB'));
    expect(scaled(got, plain, 1, 0, 4 * STEP - 0.006)).toBeLessThan(1e-6);
    expect(rms(got, 4 * STEP + 0.0055, 8 * STEP - 0.0055)).toBe(0);
    expect(scaled(got, plain, 1, 8 * STEP + 0.0055, 16 * STEP)).toBeLessThan(1e-6);
  });

  it('🎲 steps roll from the seeds: the same sound after Save and Load', async () => {
    const project = withMod(base, [gate([{ lo: 0, hi: 1, chance: 50 }], { open: 100 })], 0, 16);
    const first = await render(project);
    const loaded = await render(readProjectFile(writeProjectFile(project)));
    expect(difference(loaded, first)).toBe(0);
    const levels = Array.from({ length: 16 }, (_, k) => rms(first, k * STEP + 0.006, (k + 1) * STEP - 0.006));
    expect(levels.some((x) => x === 0)).toBe(true);
    expect(levels.some((x) => x > 0.05)).toBe(true);
  });
});
