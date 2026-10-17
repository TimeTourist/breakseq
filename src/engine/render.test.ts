// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';
import { describe, expect, it } from 'vitest';
import type { AudioData, Command, Id, Project } from '../model';
import { addSample, createProject, hitSound, setBpm, setSongBars, songDuration, updateHit } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Trigger } from './generate';
import { CHOKE_FADE, renderTake, renderTriggers } from './render';
import type { Tape } from './tape';
import { wobbles } from './tape';

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
  let project = run(createProject(), setBpm(120), setSongBars(2));
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
    pan: 0,
    direction: hit.direction,
    region: hitSound(project, hit)!.region,
    stretch: null,
    dist: null,
    filter: null,
    reverb: null,
    delay: null,
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

describe('tapes', () => {
  const SEGMENT = 0.25;
  const frames = Math.round(SEGMENT * SAMPLE_RATE);
  /** Rises from 0 to 1 over the segment, so order and direction can be told apart. */
  const rising: AudioData = { sampleRate: SAMPLE_RATE, channels: [0, 1].map(() => Float32Array.from({ length: frames }, (_, i) => i / frames)) };

  function tapeTake(fields: Partial<Tape>) {
    const { project, hits } = setup([rising]);
    const tape: Tape = {
      time: 0,
      end: 2,
      start: 0,
      source: [trigger(project, hits[0]!, 0)],
      length: SEGMENT,
      direction: 'forward',
      speed: { from: 1, to: 1, ramp: 2, curve: 'linear' },
      wobble: [],
      ...fields,
    };
    return { project, take: { triggers: [], tapes: [tape] } };
  }

  it('at 1× forward it plays the recorded segment round and round', async () => {
    const { project, take } = tapeTake({});
    const data = (await renderTake(take, project, SAMPLE_RATE)).getChannelData(0);
    for (const pass of [0, 1, 5]) {
      for (const j of [10, Math.floor(frames / 2), frames - 10]) expect(data[pass * frames + j]).toBeCloseTo(j / frames, 2);
    }
  });

  it('in ping-pong every other pass plays backwards', async () => {
    const { project, take } = tapeTake({ direction: 'pingpong' });
    const data = (await renderTake(take, project, SAMPLE_RATE)).getChannelData(0);
    for (const j of [10, Math.floor(frames / 2), frames - 10]) {
      expect(data[j]).toBeCloseTo(j / frames, 2);
      expect(data[frames + j]).toBeCloseTo((frames - j) / frames, 2);
    }
  });

  it('slowing to 0× gets quieter and ends in silence, and nothing plays after the tape', async () => {
    const { project, take } = tapeTake({ speed: { from: 1, to: 0, ramp: 1, curve: 'linear' }, end: 1 });
    const data = (await renderTake(take, project, SAMPLE_RATE)).getChannelData(0);
    const peak = (from: number, to: number) => data.slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(0.9, 0.99)).toBeLessThan(peak(0, 0.25) / 4);
    expect(Math.abs(data[Math.round(0.9995 * SAMPLE_RATE)]!)).toBeLessThan(0.01);
    expect(peak(1.01, 4)).toBe(0);
  });

  it('a tape cuts the trigger before it', async () => {
    const { project, hits } = setup([constantAudio(3)]);
    const { take } = tapeTake({ time: 1, start: 1, end: 2, source: [] });
    const data = (await renderTake({ ...take, triggers: [trigger(project, hits[0]!, 0)] }, project, SAMPLE_RATE)).getChannelData(0);
    expect(lastSound(data)).toBeLessThanOrEqual(Math.round((1 + CHOKE_FADE) * SAMPLE_RATE) + 1);
  });

  it('flutter changes the sound but not where the passes turn', async () => {
    const { project, take } = tapeTake({});
    const plain = (await renderTake(take, project, SAMPLE_RATE)).getChannelData(0);
    const fluttered = { ...take, tapes: [{ ...take.tapes[0]!, wobble: wobbles({ wow: 0, flutter: 1 }, () => 0.5) }] };
    const wobbly = (await renderTake(fluttered, project, SAMPLE_RATE)).getChannelData(0);
    // Both start the first pass from the top of the recording.
    expect(wobbly[10]).toBeCloseTo(plain[10]!, 2);
    let differs = 0;
    for (let i = 0; i < plain.length; i += 100) if (Math.abs(plain[i]! - wobbly[i]!) > 0.01) differs++;
    expect(differs).toBeGreaterThan(100);
  });
});
