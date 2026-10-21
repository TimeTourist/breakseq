// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Hit, Project, StepEffect } from '../model';
import { addSample, createLoop, createMod, createProject, hitColour, setBpm, setMatrixConfig, setSlicing, setSongCell, setStep, updateHit } from '../model';
import { sequentialIds, withRng } from '../test/fixtures';
import { rms } from './colour';
import { generateTriggers } from './generate';
import { midiPlan } from './midi';
import { renderTriggers } from './render';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A sine of `hz` at 0.3 for `seconds`. */
function sine(hz: number, seconds: number): AudioData {
  const data = Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
  return { sampleRate: SAMPLE_RATE, channels: [data, data.slice()] };
}

/** One 0.4 s sine one-shot on step 1 of a one-bar song at 60 BPM. */
function shot(hz: number, change: Partial<Hit> = {}) {
  let project = run(createProject(), setBpm(60), addSample({ name: 's.wav', audio: sine(hz, 0.4) }), createLoop('L', 'main', 1));
  const hit = Object.values(project.hits)[0]!;
  const loop = Object.values(project.loops)[0]!;
  project = run(project, updateHit(hit.id, change), setStep(loop.id, 0, { padId: Object.values(project.pads)[0]!.id }), setSongCell('main', 0, loop.id));
  return { project, hit, loop };
}

/** The RMS of the first 0.3 s heard. */
async function heard(project: Project) {
  const buffer = await renderTriggers(generateTriggers(project, withRng(() => 0)), project, SAMPLE_RATE);
  return rms([buffer.getChannelData(0)], Math.round(0.05 * SAMPLE_RATE), Math.round(0.3 * SAMPLE_RATE));
}

describe('dist and filter on a hit', () => {
  it('dist changes the sound but keeps its level', async () => {
    const clean = await heard(shot(220).project);
    for (const mode of ['drive', 'crush', 'decimate'] as const) {
      expect(await heard(shot(220, { dist: { mode, amount: 0.9 } }).project)).toBeCloseTo(clean, 2);
    }
  });

  it('a low-pass below a sine takes it away; a high-pass below it lets it through', async () => {
    const clean = await heard(shot(5000).project);
    expect(await heard(shot(5000, { filter: { type: 'lowpass', cutoff: 200, resonance: 0 } }).project)).toBeLessThan(clean * 0.05);
    expect(await heard(shot(5000, { filter: { type: 'highpass', cutoff: 200, resonance: 0 } }).project)).toBeCloseTo(clean, 1);
  });

  it("a slice with none of its own takes its matrix's, as with fade", () => {
    const start = run(createProject(), addSample({ name: 'amen.wav', audio: sine(100, 2) }));
    const id = Object.keys(start.samples)[0]!;
    let project = run(start, setSlicing(id, 1));
    const matrix = Object.values(project.matrices)[0]!;
    const slice = Object.values(project.hits).find((h) => h.slice === 2)!;
    project = run(project, setMatrixConfig(matrix.id, { dist: { mode: 'crush', amount: 0.5 }, filter: { type: 'lowpass', cutoff: 800, resonance: 0.1 } }));
    expect(hitColour(project, project.hits[slice.id]!)).toEqual({ dist: { mode: 'crush', amount: 0.5 }, filter: { type: 'lowpass', cutoff: 800, resonance: 0.1 } });
    project = run(project, updateHit(slice.id, { dist: { mode: 'drive', amount: 0.2 } }));
    expect(hitColour(project, project.hits[slice.id]!).dist).toEqual({ mode: 'drive', amount: 0.2 });
  });
});

describe('Dist and Filter mods', () => {
  const withMod = (project: Project, effect: StepEffect) => {
    const next = run(project, createMod('m', [effect]));
    return run(next, setSongCell('modA', 0, Object.keys(next.mods).find((k) => !(k in project.mods))!));
  };

  it('a Ramp crushes more and more, in place of the hit dist, and each step is its own sound in a MIDI export', () => {
    const { project, loop } = shot(220, { dist: { mode: 'drive', amount: 0.5 } });
    const p = run(project, ...[4, 8, 12].map((s) => setStep(loop.id, s, { padId: Object.values(project.pads)[0]!.id })));
    const ramp = withMod(p, { target: 'dist', rate: 'beat', shape: { kind: 'ramp', from: 0, to: 1 }, dist: { mode: 'crush' } });
    const triggers = generateTriggers(ramp, withRng(() => 0));
    expect(triggers.map((t) => t.dist)).toEqual([0, 1 / 3, 2 / 3, 1].map((amount) => ({ mode: 'crush', amount })));
    expect(midiPlan(ramp, { triggers, tapes: [] }).pieces).toHaveLength(4);
  });

  it('a Filter mod sweeps the cutoff with its type and resonance', () => {
    const { project } = shot(220);
    const sweep = withMod(project, { target: 'filter', rate: 'step', shape: { kind: 'list', values: [300] }, filter: { type: 'highpass', resonance: 0.5 } });
    expect(generateTriggers(sweep, withRng(() => 0))[0]!.filter).toEqual({ type: 'highpass', cutoff: 300, resonance: 0.5 });
  });
});
