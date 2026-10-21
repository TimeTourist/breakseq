// Web Audio in Node, with views that keep their buffers alive.
import '../test/web-audio';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, ModEffect, Project, ScratchEffect, StepEffect } from '../model';
import {
  SCRATCH_PRESETS,
  addClip,
  addSample,
  clearScratch,
  createLoop,
  createMod,
  createProject,
  newScratch,
  newStepEffect,
  setBpm,
  setScratchLength,
  setSongBars,
  setStep,
} from '../model';
import { seededRng, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import type { Rendered } from './render';
import { renderTakeWhole, renderTakeWithTail } from './render';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
/** 120 BPM: a step is 0.125 s, a bar 2 s. */
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

/** A 3-bar song at 120 BPM: noise all through, a new hit of it on every beat, so every part of it sounds different. */
function song(): Project {
  let project = run(createProject(), setBpm(120), setSongBars(3), addSample({ name: 's', audio: noise(0.6, 4) }), createLoop(null, 'main', 1));
  const pad = Object.values(project.pads)[0]!.id;
  const loop = Object.values(project.loops)[0]!.id;
  project = run(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), addClip('main', loop, 0, 48));
  return project;
}

function withMod(project: Project, effects: readonly ModEffect[], start: number, length: number, row: 'modA' | 'modB' = 'modA'): Project {
  const before = project;
  const made = run(project, createMod('M', effects));
  return run(made, addClip(row, Object.keys(made.mods).find((k) => !(k in before.mods))! as Id, start, length));
}

const render = (project: Project) => renderTakeWithTail(generateTake(project), project, SAMPLE_RATE, undefined, 'all', {});

function rms(r: Rendered, from: number, to: number): number {
  const data = r.full.getChannelData(0);
  let sum = 0;
  const a = Math.round(from * SAMPLE_RATE);
  const b = Math.round(to * SAMPLE_RATE);
  for (let i = a; i < b; i++) sum += data[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, b - a));
}

function difference(a: Rendered, b: Rendered, from = 0, to = Infinity): number {
  let most = 0;
  for (let c = 0; c < 2; c++) {
    const x = a.full.getChannelData(c);
    const y = b.full.getChannelData(c);
    for (let i = Math.round(from * SAMPLE_RATE); i < Math.min(x.length, y.length, to * SAMPLE_RATE); i++) most = Math.max(most, Math.abs(x[i]! - y[i]!));
  }
  return most;
}

const preset = (name: string): ScratchEffect => SCRATCH_PRESETS.find((p) => p.name === name)!.draw(newScratch());
/** Clear over a whole bar: 16 steps of 1/16 through 1 bar recorded. */
const cleared = clearScratch(setScratchLength(newScratch(), 16));
const BAR = 16;

describe('Scratch in a render', () => {
  it('Clear sounds as without Scratch under the clip', async () => {
    const as = await render(song());
    const got = await render(withMod(song(), [cleared], BAR, BAR));
    expect(rms(got, 2, 4)).toBeGreaterThan(0.1);
    expect(difference(got, as)).toBeLessThan(1e-4);
  });

  it('Baby plays backwards on every other step: a backward step plays the recording the other way', async () => {
    const as = await render(song());
    const got = await render(withMod(song(), [preset('Baby')], BAR, 8));
    const heard = as.full.getChannelData(0);
    const out = got.full.getChannelData(0);
    // Step 1 (backward) goes from 0.25 to 0.1 of the bar recorded from 2 s. Round its middle, the output is what is
    // heard where the curve puts the needle, read between frames; read the other way round it is not.
    const take = generateTake(withMod(song(), [preset('Baby')], BAR, 8));
    const splice = take.scratches!.find((x) => Math.abs(x.time - (BAR + 1) * STEP) < 1e-9)!;
    const [a, b, c, d] = splice.source;
    const needle = (u: number) => a + u * (b + u * (c + u * d));
    expect(needle(1)).toBeLessThan(needle(0));
    const read = (seconds: number) => {
      const f = seconds * SAMPLE_RATE;
      const i = Math.floor(f);
      return heard[i]! + (heard[i + 1]! - heard[i]!) * (f - i);
    };
    let backward = 0;
    let forward = 0;
    const s = Math.round((BAR + 1.5) * STEP * SAMPLE_RATE);
    const middle = needle(0.5);
    for (let k = -40; k <= 40; k++) {
      const u = (s + k) / SAMPLE_RATE;
      const p = needle((u - splice.time) / splice.length);
      backward += Math.abs(out[s + k]! - read(p));
      forward += Math.abs(out[s + k]! - read(2 * middle - p));
    }
    expect(backward / 81).toBeLessThan(1e-4);
    expect(forward / 81).toBeGreaterThan(0.1);
    // Before the clip all is as heard.
    expect(difference(got, as, 0, BAR * STEP - 0.001)).toBe(0);
  });

  it('Chirp is silent where the fader is closed, and sounds where it is open', async () => {
    const got = await render(withMod(song(), [preset('Chirp')], BAR, 8));
    for (const k of [1, 3, 5, 7]) {
      // The closed second half of the step, after the open half has faded out.
      expect(rms(got, (BAR + k + 0.5) * STEP + 0.0035, (BAR + k + 1) * STEP)).toBeLessThan(1e-4);
      expect(rms(got, (BAR + k) * STEP, (BAR + k + 0.5) * STEP)).toBeGreaterThan(0.02);
    }
  });

  it('a held step is silent', async () => {
    const held: ScratchEffect = { ...newScratch(), points: [0.25, 0.25, 0.5, 0.6], fader: [[true], [true], [true], [true]] };
    const got = await render(withMod(song(), [held], BAR, 4));
    expect(rms(got, BAR * STEP + 0.0035, (BAR + 1) * STEP)).toBeLessThan(1e-4);
    expect(rms(got, (BAR + 1) * STEP + 0.0035, (BAR + 2) * STEP)).toBeGreaterThan(0.05);
  });

  it('records what is heard without Tape, and where both play Scratch is heard', async () => {
    const tape: ModEffect = { target: 'tape', length: 4, direction: 'reverse', speed: { from: 0.5, to: 0.5 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };
    const as = await render(song());
    const taped = withMod(song(), [tape], BAR, BAR);
    expect(difference(await render(taped), as, 2.01, 3.99)).toBeGreaterThan(0.1);
    const both = await render(withMod(taped, [cleared], BAR, BAR, 'modB'));
    // Where both start, the tape cross-fades to the Scratch over 3 ms; after that only the Scratch is heard.
    expect(difference(both, as, 0, BAR * STEP)).toBe(0);
    expect(difference(both, as, BAR * STEP + 0.0035)).toBeLessThan(1e-4);
  });

  it('the audio mods hear Scratch: Reverse over a Scratch with the fader closed is silent', async () => {
    const shut: ScratchEffect = { ...cleared, fader: cleared.fader.map(() => [false] as const) };
    const reverse: StepEffect = { ...newStepEffect('reverse'), step: 'bar', lane: [{ v: 1 }] };
    const got = await render(withMod(withMod(song(), [shut], BAR, BAR), [reverse], BAR, BAR, 'modB'));
    // Not the first cell, whose fade out reads from before the clip, nor the last.
    expect(rms(got, (BAR + 1) * STEP + 0.0035, (2 * BAR - 1) * STEP)).toBeLessThan(1e-4);
  });

  it('in parts, as one long render', async () => {
    const project = withMod(withMod(song(), [preset('Transformer')], BAR, BAR), [preset('Tear')], 4, 8, 'modB');
    const take = generateTake(project);
    const whole = await renderTakeWhole(take, project, SAMPLE_RATE);
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', { chunkSeconds: 0.25 });
    expect(rms(whole, 2, 4)).toBeGreaterThan(0.02);
    expect(difference(parts, whole)).toBeLessThan(1e-4);
  });
});
