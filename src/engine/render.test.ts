// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, Project } from '../model';
import { addSample, createProject, setBpm, setSongBars, songDuration, updateHit } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Trigger } from './generate';
import { CHOKE_FADE, renderTriggers } from './render';

const SAMPLE_RATE = 44100;
const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, command) => {
    const result = command(p, ctx);
    if (!result.ok) throw new Error(`Command failed: ${JSON.stringify(result.error)}`);
    return result.project;
  }, project);
}

/** A 2-bar song at 120 BPM (4 s) with one hit per audio. */
function setup(audios: readonly AudioData[]): { project: Project; hits: Id[] } {
  let project = run(createProject(ctx), setBpm(120), setSongBars(2));
  const hits: Id[] = [];
  audios.forEach((audio, i) => {
    const before = project;
    project = run(project, addSample({ name: `S${i}`, audio }));
    hits.push(Object.keys(project.hits).find((k) => !(k in before.hits))!);
  });
  return { project, hits };
}

function trigger(project: Project, hitId: Id, time: number, overrides: Partial<Trigger> = {}): Trigger {
  const hit = project.hits[hitId]!;
  return {
    time,
    bar: 0,
    step: 0,
    hitId,
    pitch: hit.pitch,
    volume: hit.volume,
    direction: hit.direction,
    region: hit.region,
    ...overrides,
  };
}

const firstSound = (data: Float32Array) => data.findIndex((v) => Math.abs(v) > 1e-6);
const lastSound = (data: Float32Array) => data.findLastIndex((v) => Math.abs(v) > 1e-6);

describe('renderTriggers', () => {
  it('is exactly as long as the song, in stereo', async () => {
    const { project } = setup([]);
    const buffer = await renderTriggers([], project, SAMPLE_RATE);
    expect(buffer.length).toBe(Math.round(songDuration(project.song) * SAMPLE_RATE));
    expect(buffer.length).toBe(4 * SAMPLE_RATE);
    expect(buffer.numberOfChannels).toBe(2);
  });

  it('starts a trigger on the right sample (±1)', async () => {
    const { project, hits } = setup([constantAudio(0.05, [1, 1])]);
    const time = 0.1234;
    const buffer = await renderTriggers([trigger(project, hits[0]!, time)], project, SAMPLE_RATE);
    expect(Math.abs(firstSound(buffer.getChannelData(0)) - time * SAMPLE_RATE)).toBeLessThanOrEqual(1);
  });

  it('a new trigger fades out the previous one within the fade time, and stereo is kept', async () => {
    // A is left-only, B is right-only, so each channel shows one voice.
    const { project, hits } = setup([constantAudio(1, [1, 0]), constantAudio(1, [0, 1])]);
    const cut = 0.5;
    const buffer = await renderTriggers(
      [trigger(project, hits[0]!, 0), trigger(project, hits[1]!, cut)],
      project,
      SAMPLE_RATE,
    );
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    expect(left[Math.round((cut - 0.01) * SAMPLE_RATE)]).toBeCloseTo(1, 5);
    expect(lastSound(left)).toBeLessThanOrEqual(Math.ceil((cut + CHOKE_FADE) * SAMPLE_RATE) + 1);
    expect(firstSound(right)).toBeGreaterThanOrEqual(Math.round(cut * SAMPLE_RATE) - 1);
    expect(right[Math.round((cut + 0.1) * SAMPLE_RATE)]).toBeCloseTo(1, 5);
  });

  it('applies volume in dB', async () => {
    const { project, hits } = setup([constantAudio(0.5, [1, 1])]);
    const buffer = await renderTriggers([trigger(project, hits[0]!, 0, { volume: -6 })], project, SAMPLE_RATE);
    expect(buffer.getChannelData(0)[1000]).toBeCloseTo(10 ** (-6 / 20), 4);
  });

  it('pitch changes playback speed and so the length', async () => {
    const { project, hits } = setup([constantAudio(0.1, [1, 1])]);
    const buffer = await renderTriggers([trigger(project, hits[0]!, 0, { pitch: 12 })], project, SAMPLE_RATE);
    expect(lastSound(buffer.getChannelData(0)) / SAMPLE_RATE).toBeCloseTo(0.05, 3);
  });

  it('plays only the region, backwards for reverse', async () => {
    // A ramp from 0 to 1 over one second.
    const ramp = Float32Array.from({ length: SAMPLE_RATE }, (_, i) => i / SAMPLE_RATE);
    const { project, hits } = setup([{ sampleRate: SAMPLE_RATE, channels: [ramp, ramp] }]);
    const region = { start: 0.2, end: 0.4 };

    const forward = (await renderTriggers([trigger(project, hits[0]!, 0, { region })], project, SAMPLE_RATE)).getChannelData(0);
    expect(forward[0]).toBeCloseTo(0.2, 3);
    expect(lastSound(forward) / SAMPLE_RATE).toBeCloseTo(0.2, 3);

    const reverse = (
      await renderTriggers([trigger(project, hits[0]!, 0, { region, direction: 'reverse' })], project, SAMPLE_RATE)
    ).getChannelData(0);
    expect(reverse[0]).toBeCloseTo(0.4, 3);
    expect(reverse[Math.round(0.19 * SAMPLE_RATE)]).toBeCloseTo(0.21, 2);
  });

  it('fades out over the hit fade time', async () => {
    const { project, hits } = setup([constantAudio(0.5, [1, 1])]);
    const withFade = run(project, updateHit(hits[0]!, { fadeOut: 100 }));
    const data = (await renderTriggers([trigger(withFade, hits[0]!, 0)], withFade, SAMPLE_RATE)).getChannelData(0);
    expect(data[Math.round(0.35 * SAMPLE_RATE)]).toBeCloseTo(1, 3);
    expect(data[Math.round(0.45 * SAMPLE_RATE)]).toBeCloseTo(0.5, 1);
  });
});
