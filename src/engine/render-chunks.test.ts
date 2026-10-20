// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, Project } from '../model';
import { addSample, createProject, hitSound, setBpm, setSongBars, updateHit } from '../model';
import { seededRng, sequentialIds } from '../test/fixtures';
import type { Take, Trigger } from './generate';
import type { Rendered } from './render';
import { createRenderCache, isRenderCancelled, renderTakeWhole, renderTakeWithTail } from './render';
import type { Tape } from './tape';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, command) => {
    const result = command(p, ctx);
    if (!result.ok) throw new Error(`Command failed: ${JSON.stringify(result.error)}`);
    return result.project;
  }, project);
}

/** Stereo noise, the same every time, so any misplaced frame shows. */
function noise(seconds: number, seed: number, channels = 2): AudioData {
  const rng = seededRng(seed);
  const length = Math.round(seconds * SAMPLE_RATE);
  return { sampleRate: SAMPLE_RATE, channels: Array.from({ length: channels }, () => Float32Array.from({ length }, () => rng() * 2 - 1)) };
}

/** A 4-bar song at 120 BPM (8 s) with a hit per audio. */
function setup(audios: readonly AudioData[]): { project: Project; hits: Id[] } {
  let project = run(createProject(), setBpm(120), setSongBars(4));
  const hits: Id[] = [];
  for (const [i, audio] of audios.entries()) {
    const before = project;
    project = run(project, addSample({ name: `S${i}`, audio }));
    hits.push(Object.keys(project.hits).find((k) => !(k in before.hits))!);
  }
  return { project, hits };
}

function trigger(project: Project, hitId: Id, time: number, overrides: Partial<Trigger> = {}): Trigger {
  const hit = project.hits[hitId]!;
  return {
    time,
    bar: 0,
    step: 0,
    hitId,
    pitch: 0,
    volume: 0,
    pan: 0,
    direction: 'forward',
    region: hitSound(project, hit)!.region,
    stretch: null,
    dist: null,
    filter: null,
    reverb: null,
    delay: null,
    ...overrides,
  };
}

/** The largest difference between two renders, frame by frame, in both buffers. */
function difference(a: Rendered, b: Rendered): number {
  let most = 0;
  for (const key of ['buffer', 'full'] as const) {
    expect(a[key].length).toBe(b[key].length);
    for (let c = 0; c < 2; c++) {
      const x = a[key].getChannelData(c);
      const y = b[key].getChannelData(c);
      for (let i = 0; i < x.length; i++) most = Math.max(most, Math.abs(x[i]! - y[i]!));
    }
  }
  return most;
}

const loudness = (r: Rendered) => r.full.getChannelData(0).reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Parts of a quarter second: a 4-bar song is 32 of them, so every seam is crossed. */
const SMALL = { chunkSeconds: 0.25 };

describe('rendering in parts', () => {
  it('gives the same audio as one long render, with voices ringing on across the seams', async () => {
    const { project, hits } = setup([noise(0.9, 1), noise(0.3, 2, 1)]);
    // Long voices that start just before a seam and are cut, or ring out, well after it.
    const triggers = [0, 0.2, 0.24, 0.7, 1.1, 2.6, 3.0, 5.9].map((time, i) =>
      trigger(project, hits[i % 2]!, time, { pitch: i % 3 === 0 ? -5 : 2, pan: i % 2 === 0 ? -0.4 : 0.7, volume: -3 * (i % 2) }),
    );
    const take: Take = { triggers, tapes: [] };
    const whole = await renderTakeWhole(take, project, SAMPLE_RATE);
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', SMALL);
    expect(loudness(whole)).toBeGreaterThan(0.1);
    expect(difference(parts, whole)).toBeLessThan(1e-5);
  });

  it('carries reverb across the seams and past the end, as one long render', async () => {
    const { project, hits } = setup([noise(0.2, 3)]);
    const triggers = [0.1, 1.3, 7.8].map((time, i) => trigger(project, hits[0]!, time, { reverb: i === 2 ? null : { amount: 0.8, size: 0.5 } }));
    const take: Take = { triggers, tapes: [] };
    for (const mix of ['all', 'dry', 'space'] as const) {
      const whole = await renderTakeWhole(take, project, SAMPLE_RATE, undefined, mix);
      const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, mix, SMALL);
      expect(loudness(whole)).toBeGreaterThan(0.01);
      expect(difference(parts, whole)).toBeLessThan(1e-4);
    }
  });

  it('carries delay across the seams: small parts give what one part does, each echo a delay later', async () => {
    const { project, hits } = setup([noise(0.2, 3)]);
    const delay = { amount: 0.6, steps: 3, feedback: 0.5 } as const;
    const triggers = [0.1, 1.3].map((time) => trigger(project, hits[0]!, time, { delay, reverb: { amount: 0.3, size: 0.2 } }));
    const take: Take = { triggers, tapes: [] };
    const one = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'space', { chunkSeconds: 100 });
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'space', SMALL);
    expect(difference(parts, one)).toBeLessThan(1e-5);
    // Without the reverb: the first echo is the hit itself, at the amount, 3 steps (0.375 s) on.
    const echoes = await renderTakeWithTail({ triggers: [trigger(project, hits[0]!, 0.1, { delay })], tapes: [] }, project, SAMPLE_RATE, undefined, 'space', SMALL);
    const data = echoes.full.getChannelData(0);
    const sample = project.audio[Object.values(project.samples)[0]!.audioId]!.channels[0]!;
    // 0.475 s is 20947.5 frames: halfway between two frames, Web Audio's delay interpolates.
    expect(data[20947]).toBeCloseTo(0.6 * 0.5 * sample[0]!, 4);
    expect(data[20948 + 100]).toBeCloseTo(0.6 * 0.5 * (sample[100]! + sample[101]!), 4);
    expect(data.slice(0, 20947).every((v) => v === 0)).toBe(true);
  });

  it('gives the same stretched, distorted and filtered voices', async () => {
    const { project, hits } = setup([noise(0.5, 4)]);
    const triggers = [0.05, 0.9, 1.7].map((time, i) =>
      trigger(project, hits[0]!, time, {
        stretch: { factor: 1.7, grain: 30, from: i === 1 ? 'hit' : 'sample' },
        dist: i === 0 ? { mode: 'drive', amount: 0.6 } : null,
        filter: { type: i === 2 ? 'highpass' : 'lowpass', cutoff: 900, resonance: 0.8 },
      }),
    );
    const take: Take = { triggers, tapes: [] };
    const whole = await renderTakeWhole(take, project, SAMPLE_RATE);
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', SMALL);
    expect(difference(parts, whole)).toBeLessThan(1e-4);
  });

  it('gives the same tape, which plays on past the seams it starts before', async () => {
    const { project, hits } = setup([noise(0.25, 5), noise(2, 6)]);
    const tape: Tape = {
      time: 1.1,
      end: 2.9,
      start: 1.1,
      source: [trigger(project, hits[0]!, 0)],
      length: 0.25,
      direction: 'pingpong',
      speed: { from: 1, to: 0.5, ramp: 1.5, curve: 'softEnd' },
      wobble: [],
    };
    // A long voice is cut by the tape; another starts after it.
    const take: Take = { triggers: [trigger(project, hits[1]!, 0.3), trigger(project, hits[0]!, 3.2)], tapes: [tape] };
    const whole = await renderTakeWhole(take, project, SAMPLE_RATE);
    const parts = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', SMALL);
    expect(difference(parts, whole)).toBeLessThan(1e-4);
  });

  it('takes the parts it has rendered before from the cache, and renders only the ones that changed', async () => {
    const { project, hits } = setup([noise(0.2, 7)]);
    const triggers = Array.from({ length: 16 }, (_, i) => trigger(project, hits[0]!, i * 0.5, { pitch: i }));
    const cache = createRenderCache();
    const first = await renderTakeWithTail({ triggers, tapes: [] }, project, SAMPLE_RATE, undefined, 'all', { cache, chunkSeconds: 1 });
    expect(cache.chunks.size).toBe(8);

    // The same take again is the same render.
    expect(await renderTakeWithTail({ triggers, tapes: [] }, project, SAMPLE_RATE, undefined, 'all', { cache, chunkSeconds: 1 })).toBe(first);

    // One trigger in the third part changes: one new part, and the rest as it was.
    const changed = triggers.map((t, i) => (i === 5 ? { ...t, pitch: 7 } : t));
    const second = await renderTakeWithTail({ triggers: changed, tapes: [] }, project, SAMPLE_RATE, undefined, 'all', { cache, chunkSeconds: 1 });
    expect(cache.chunks.size).toBe(9);
    expect(second).not.toBe(first);
    expect(difference(second, await renderTakeWhole({ triggers: changed, tapes: [] }, project, SAMPLE_RATE))).toBeLessThan(1e-5);
  });

  it('renders a part again when the sample under a hit changes, though its triggers are the same', async () => {
    const { project, hits } = setup([noise(0.2, 8)]);
    const take: Take = { triggers: [trigger(project, hits[0]!, 0)], tapes: [] };
    const cache = createRenderCache();
    const before = await renderTakeWithTail(take, project, SAMPLE_RATE, undefined, 'all', { cache });
    const faded = run(project, updateHit(hits[0]!, { fadeOut: 100 }));
    const after = await renderTakeWithTail(take, faded, SAMPLE_RATE, undefined, 'all', { cache });
    expect(after).not.toBe(before);
    expect(difference(after, await renderTakeWhole(take, faded, SAMPLE_RATE))).toBeLessThan(1e-6);
  });

  it('keeps no more parts than its limit, dropping the least recently used', async () => {
    const { project, hits } = setup([noise(0.2, 9)]);
    const triggers = Array.from({ length: 16 }, (_, i) => trigger(project, hits[0]!, i * 0.5, { pitch: i }));
    // Room for about three parts of a second (2 channels × 44100 frames, and a little ring).
    const cache = createRenderCache(3 * 2 * 46000);
    await renderTakeWithTail({ triggers, tapes: [] }, project, SAMPLE_RATE, undefined, 'all', { cache, chunkSeconds: 1 });
    expect(cache.chunks.size).toBeLessThanOrEqual(3);
    expect(cache.size).toBeLessThanOrEqual(cache.limit);
  });

  it('gives up once its signal aborts, and says so', async () => {
    const { project, hits } = setup([noise(0.2, 10)]);
    const controller = new AbortController();
    controller.abort();
    const rendering = renderTakeWithTail({ triggers: [trigger(project, hits[0]!, 0)], tapes: [] }, project, SAMPLE_RATE, undefined, 'all', { signal: controller.signal });
    const error = await rendering.catch((e: unknown) => e);
    expect(isRenderCancelled(error)).toBe(true);
    expect(isRenderCancelled(new Error('other'))).toBe(false);
  });
});
