// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBpm, setSongBars, setSongCell, sliceSample, sampleBpm } from '../model';
import { seededRng, sequentialIds, withRng } from '../test/fixtures';
import { generateTriggers } from './generate';
import { renderTriggers } from './render';

const SAMPLE_RATE = 44100;

// One id counter per file, so ids never repeat between calls.
const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, command) => {
    const result = command(p, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.project;
  }, project);
}

/** Stereo noise, the hardest material to reproduce: every sample differs. */
function noiseBreak(seconds: number): Float32Array[] {
  const rng = seededRng(7);
  const length = Math.round(seconds * SAMPLE_RATE);
  return [0, 1].map(() => Float32Array.from({ length }, () => rng() * 2 - 1));
}

describe('a sliced break played at its own tempo', () => {
  it.each([16, 8, 4] as const)('sounds like the original break (1/%i grid)', async (grid) => {
    const bars = 4;
    const bpm = 136;
    const channels = noiseBreak((bars * 4 * 60) / bpm);

    let project = run(createProject(), addSample({ name: 'break', audio: { sampleRate: SAMPLE_RATE, channels } }));
    const id = Object.keys(project.samples)[0]!;
    project = run(project, sliceSample(id, bars, grid));
    const m1 = Object.values(project.loops)[0]!.id;
    // Its own tempo is worked out from its length, which is a whole number of samples.
    const ownBpm = sampleBpm(project.samples[id]!)!;
    expect(ownBpm).toBeCloseTo(bpm, 3);
    project = run(project, setBpm(ownBpm), setSongBars(bars), setSongCell('main', 0, m1));

    const triggers = generateTriggers(project, withRng(seededRng(1)));
    const rendered = await renderTriggers(triggers, project, SAMPLE_RATE);

    // Starts land on sample frames and neighbouring slices share their boundaries,
    // so every sample comes back as it was.
    for (const [c, original] of channels.entries()) {
      const out = rendered.getChannelData(c);
      let maxError = 0;
      for (let i = 0; i < original.length; i++) maxError = Math.max(maxError, Math.abs((out[i] ?? 0) - original[i]!));
      expect(maxError, `channel ${c}`).toBeLessThan(1e-6);
    }
  });
});
