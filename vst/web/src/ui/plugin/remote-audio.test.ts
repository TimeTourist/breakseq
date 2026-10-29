import { describe, expect, it } from 'vitest';
import type { Bridge } from './bridge';
import type { MixerCommand } from './remote-audio';
import { FloatBuffer, clockNow, remoteAudio } from './remote-audio';
import { createPlayer } from '../playback';
import type { Take } from '../playback';

/** A bridge that records the mixer commands sent and lets a test emit events. */
function fakeBridge() {
  const sent: MixerCommand[][] = [];
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const bridge: Bridge = {
    call: (name, ...params) => {
      if (name === 'audio') sent.push(params[0] as MixerCommand[]);
      return Promise.resolve(null);
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {};
    },
  };
  const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((l) => l(payload));
  return { bridge, sent, emit, all: () => sent.flat() };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const bufferOf = (seconds: number, rate = 100) => new FloatBuffer(2, Math.round(seconds * rate), rate) as unknown as AudioBuffer;

describe('clockNow', () => {
  it('moves the last report on by the time since, and never goes back', () => {
    expect(clockNow(null, 0, 500, 0)).toBe(0);
    expect(clockNow({ time: 10, rate: 48000 }, 1000, 1250, 0)).toBeCloseTo(10.25);
    expect(clockNow({ time: 10, rate: 48000 }, 1000, 1000, 10.5)).toBe(10.5);
  });
});

describe('remoteAudio', () => {
  it('sends a buffer once, then starts its sources through their gain, in one batch per task', async () => {
    const { bridge, sent, all } = fakeBridge();
    const { context } = remoteAudio(bridge);
    const buffer = bufferOf(1);
    const gain = context.createGain();
    gain.connect(context.destination);
    for (const when of [1, 2]) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(when, 0.5);
    }
    await tick();
    expect(sent).toHaveLength(1);
    expect(all().filter((c) => c.op === 'buffer')).toHaveLength(1);
    const gainId = (gain as unknown as { id: number }).id;
    const starts = all().filter((c) => c.op === 'start');
    expect(starts.map((c) => c.op === 'start' && [c.when, c.offset, c.gain])).toEqual([
      [1, 0.5, gainId],
      [2, 0.5, gainId],
    ]);
  });

  it('sends loop changes made while a source plays, and gain ramps', async () => {
    const { bridge, all } = fakeBridge();
    const { context } = remoteAudio(bridge);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, 1);
    gain.gain.linearRampToValueAtTime(1, 1.003);
    const source = context.createBufferSource();
    source.buffer = bufferOf(2);
    source.loop = true;
    source.connect(gain);
    source.start(1, 0);
    source.loopEnd = 1.5;
    await tick();
    expect(all().map((c) => c.op)).toEqual(['gain', 'gainSet', 'gainRamp', 'buffer', 'start', 'loop']);
    expect(all().at(-1)).toMatchObject({ op: 'loop', loop: true, loopEnd: 1.5 });
  });

  it('calls onended when the mixer says a source has ended', () => {
    const { bridge, emit } = fakeBridge();
    const { context } = remoteAudio(bridge);
    const source = context.createBufferSource();
    source.buffer = bufferOf(1);
    let ended = 0;
    source.onended = () => ended++;
    source.start(0);
    emit('ended', { ids: [999] });
    expect(ended).toBe(0);
    emit('ended', { ids: [(source as unknown as { id: number }).id] });
    expect(ended).toBe(1);
  });

  it('takes its time and sample rate from the clock', () => {
    const { bridge, emit } = fakeBridge();
    let now = 0;
    const { context } = remoteAudio(bridge, () => now);
    emit('clock', { time: 3, rate: 48000 });
    now = 100;
    expect(context.currentTime).toBeCloseTo(3.1);
    expect(context.sampleRate).toBe(48000);
  });

  it("drives the web app's player: play starts the take, replace fades it out and the new one in on the next step", async () => {
    const { bridge, emit, all } = fakeBridge();
    let now = 0;
    const { context } = remoteAudio(bridge, () => now);
    emit('clock', { time: 0, rate: 100 });
    const player = createPlayer(() => context);
    const take = (seconds: number): Take => ({ buffer: bufferOf(seconds), triggers: [], tapes: [], step: 0.25 });
    player.play(take(2));
    now = 100;
    player.replace(take(2));
    await tick();
    const starts = all().filter((c) => c.op === 'start');
    expect(starts).toHaveLength(2);
    // The swap waits for the next step: 0.25 s into the take, from the same step in the new one.
    expect(starts[1]).toMatchObject({ when: expect.closeTo(0.27, 5) as number, offset: expect.closeTo(0.25, 5) as number });
    expect(all().some((c) => c.op === 'stop')).toBe(true);
  });
});
