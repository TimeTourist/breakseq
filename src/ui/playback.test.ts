import { describe, expect, it } from 'vitest';
import type { Trigger } from '../engine';
import type { Take } from './playback';
import { SWAP_FADE, afterTail, auditionPosition, createPlayer, fitLoop, playheadTrigger, runPosition, startOffset, swapPoint } from './playback';

const at = (time: number, bar: number): Trigger => ({
  time,
  bar,
  step: 0,
  hitId: 'h',
  pitch: 0,
  volume: 0,
  pan: 0,
  direction: 'forward',
  region: { start: 0, end: 0.1 },
  stretch: null,
  dist: null,
  filter: null,
  reverb: null,
  delay: null,
});

describe('playheadTrigger', () => {
  const triggers = [at(0.5, 0), at(1.2, 1), at(2.4, 3)];

  it('picks the trigger most recently passed', () => {
    expect(playheadTrigger(triggers, 0.4)).toBeNull();
    expect(playheadTrigger(triggers, 0.5)?.bar).toBe(0);
    expect(playheadTrigger(triggers, 2.39)?.bar).toBe(1);
    expect(playheadTrigger(triggers, 10)).toBe(triggers[2]);
  });
});

describe('auditionPosition', () => {
  // A region of 2 s starting 0.5 s into the audio, started at t = 10.
  const once = { startTime: 10, offset: 0.5, duration: 2, loop: false };
  const looped = { ...once, loop: true };

  it('runs through the region once, then is over', () => {
    expect(auditionPosition(10, once)).toBe(0.5);
    expect(auditionPosition(11.25, once)).toBe(1.75);
    expect(auditionPosition(12.5, once)).toBeNull();
  });

  it('wraps to the start of the region when looping', () => {
    expect(auditionPosition(12.5, looped)).toBeCloseTo(1);
    expect(auditionPosition(15.25, looped)).toBeCloseTo(1.75);
  });
});

describe('a run with a loop', () => {
  const loop = { start: 4, end: 8 };

  it('plays on from where it starts, then round the loop', () => {
    const run = { startTime: 10, offset: 1, loop };
    expect(runPosition(9, run)).toBeNull();
    expect(runPosition(12, run)).toBe(3);
    expect(runPosition(17, run)).toBe(4);
    expect(runPosition(19.5, run)).toBe(6.5);
  });

  it('fits the loop to the take, or loops the whole take', () => {
    expect(fitLoop(null, 16)).toEqual({ start: 0, end: 16 });
    expect(fitLoop({ start: 4, end: 20 }, 16)).toEqual({ start: 4, end: 16 });
    expect(fitLoop({ start: 18, end: 20 }, 16)).toEqual({ start: 0, end: 16 });
  });

  it('starts at the cursor, or at the loop start from past the loop', () => {
    expect(startOffset(2, loop)).toBe(2);
    expect(startOffset(6, loop)).toBe(6);
    expect(startOffset(9, loop)).toBe(4);
  });
});

describe('swapPoint: a change is heard as soon as possible (Magnus beslut)', () => {
  // Steps of 0.25 s; a 4 s take looped whole, started at t = 10 from its start.
  const run = { startTime: 10, offset: 0, loop: { start: 0, end: 4 } };
  const looped = { loop: { start: 0, end: 4 }, once: false };

  it('takes over at the next step, at the same step of the new take', () => {
    // At 11.1 the playhead is 1.1 s in; the next step is at 1.25 s.
    const swap = swapPoint(11.1, run, 0.25, 0.25, looped)!;
    expect(swap.at).toBeCloseTo(11.25);
    expect(swap.offset).toBeCloseTo(1.25);
  });

  it('on a step it takes over there, unless that is too soon to schedule', () => {
    expect(swapPoint(10.98, run, 0.25, 0.25, looped)!.offset).toBeCloseTo(1);
    expect(swapPoint(10.995, run, 0.25, 0.25, looped)!.offset).toBeCloseTo(1.25);
  });

  it('goes round to the first step after the last one of the loop', () => {
    const swap = swapPoint(13.9, run, 0.25, 0.25, looped)!;
    expect(swap.at).toBeCloseTo(14);
    expect(swap.offset).toBe(0);
  });

  it('is the same step when the tempo changes', () => {
    // Step 5 at 0.25 s a step is step 5 at 0.2 s a step.
    expect(swapPoint(11.1, run, 0.25, 0.2, { loop: { start: 0, end: 3.2 }, once: false })!.offset).toBeCloseTo(1);
  });

  it('a new take shorter than where the playhead is goes on as far into its turn', () => {
    // 32 bars cut to 4: at 21 s in (on a step) of a 45 s take, a take of 5 s goes on from 1 s.
    const long = { startTime: 0, offset: 0, loop: { start: 0, end: 45 } };
    expect(swapPoint(20.97, long, 0.25, 0.25, { loop: { start: 0, end: 5 }, once: false })!.offset).toBeCloseTo(1);
  });

  it('within a loop region, round the region', () => {
    const region = { startTime: 10, offset: 2, loop: { start: 2, end: 4 } };
    expect(swapPoint(11.1, region, 0.25, 0.25, { loop: { start: 2, end: 3 }, once: false })!.offset).toBeCloseTo(2.25);
  });

  it('played once, it goes on to the end, and a take already over there stops', () => {
    const once = { startTime: 10, offset: 0, loop: { start: 0, end: 4 } };
    expect(swapPoint(11.1, once, 0.25, 0.25, { loop: { start: 0, end: 4 }, once: true })!.offset).toBeCloseTo(1.25);
    expect(swapPoint(11.1, once, 0.25, 0.25, { loop: { start: 0, end: 1 }, once: true })).toBeNull();
  });

  it('a sample, without steps, takes over at once at the same second', () => {
    const swap = swapPoint(11.1, run, undefined, undefined, looped)!;
    expect(swap.at).toBeCloseTo(11.12);
    expect(swap.offset).toBeCloseTo(1.12);
  });
});

/** A stand-in AudioContext that records what is started and stopped when. */
function fakeContext() {
  const sources: { buffer: AudioBuffer | null; started: [number, number] | undefined; stopped: number | undefined; loop: boolean; onended: (() => void) | null }[] = [];
  const ramps: { to: number; at: number }[][] = [];
  const param = () => {
    const calls: { to: number; at: number }[] = [];
    ramps.push(calls);
    return { setValueAtTime: (to: number, at: number) => calls.push({ to, at }), linearRampToValueAtTime: (to: number, at: number) => calls.push({ to, at }) };
  };
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBufferSource: () => {
      const source = {
        buffer: null as AudioBuffer | null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null as (() => void) | null,
        connect: (node: unknown) => node,
        start: (at: number, offset: number) => {
          source.started = [at, offset];
        },
        stop: (at = context.currentTime) => {
          source.stopped = at;
        },
        started: undefined as [number, number] | undefined,
        stopped: undefined as number | undefined,
      };
      sources.push(source);
      return source;
    },
    createGain: () => ({ gain: param(), connect: (node: unknown) => node }),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c]!, copyToChannel: (from: Float32Array, c: number) => data[c]!.set(from) };
    },
  };
  return { context, sources, ramps };
}

const takeOf = (seconds: number, step: number): Take => ({ buffer: { duration: seconds } as AudioBuffer, triggers: [], tapes: [], step });

describe('the player swaps in a new take', () => {
  it('looped: at the next step, fading the old take out and the new one in', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25));
    const [first] = sources;
    expect(first!.started![0]).toBeCloseTo(0.02);
    context.currentTime = 1.1;
    player.replace(takeOf(4, 0.25));
    const second = sources[1]!;
    // The playhead is 1.08 s in at 1.1; the next step, 1.25 s in, is at 1.27.
    expect(second.started![0]).toBeCloseTo(1.27);
    expect(second.started![1]).toBeCloseTo(1.25);
    expect(first!.stopped).toBeCloseTo(1.27 + SWAP_FADE);
    context.currentTime = 1.3;
    expect(player.isPlaying()).toBe(true);
    expect(player.currentPosition()).toBeCloseTo(1.28);
  });

  it('a newer take before the swap takes its place, at the same time', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25));
    context.currentTime = 1.1;
    player.replace(takeOf(4, 0.25));
    player.replace(takeOf(4, 0.25));
    expect(sources).toHaveLength(3);
    expect(sources[1]!.stopped).toBeCloseTo(1.1);
    expect(sources[2]!.started![0]).toBeCloseTo(1.27);
    expect(sources[2]!.started![1]).toBeCloseTo(1.25);
  });

  it('played once (Loop off): it swaps too, and goes on to the end', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25), 0, true);
    context.currentTime = 1.1;
    player.replace(takeOf(4, 0.25));
    expect(sources[1]!.started![1]).toBeCloseTo(1.25);
    expect(sources[1]!.loop).toBe(false);
    // The old take ends where the new one has taken over; the new one plays on.
    sources[0]!.onended?.();
    expect(player.isPlaying()).toBe(true);
  });

  it('played once, a new take that is over where the playhead is stops it', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25), 0, true);
    context.currentTime = 2.1;
    player.replace(takeOf(1, 0.25));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.stopped).toBeCloseTo(2.12 + SWAP_FADE);
    sources[0]!.onended?.();
    expect(player.isPlaying()).toBe(false);
  });
});

describe('the player queues the next block of passes (Varv i loop)', () => {
  it('takes over when the take playing reaches its end, without looping it again', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    const first = takeOf(4, 0.25);
    const next = takeOf(4, 0.25);
    player.play(first);
    context.currentTime = 1;
    let started = 0;
    player.queue(next, () => started++);
    const [playing, queued] = sources;
    // The take playing plays to its end and stops there; the next starts then, from its start, and loops until another follows.
    expect(playing!.loop).toBe(false);
    expect(queued!.started![0]).toBeCloseTo(4.02);
    expect(queued!.started![1]).toBe(0);
    expect(queued!.loop).toBe(true);
    context.currentTime = 4;
    expect(player.currentPosition()).toBeCloseTo(3.98);
    expect(started).toBe(0);
    context.currentTime = 4.5;
    expect(player.currentPosition()).toBeCloseTo(0.48);
    expect(started).toBe(1);
    expect(player.isPlaying()).toBe(true);
  });

  it('a block that has gone round already takes over at the end of its turn', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25));
    context.currentTime = 9;
    player.queue(takeOf(4, 0.25));
    expect(sources[1]!.started![0]).toBeCloseTo(12.02);
  });

  it('null takes the queued block away, and the take playing loops again', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25));
    context.currentTime = 1;
    player.queue(takeOf(4, 0.25));
    player.queue(null);
    expect(sources[0]!.loop).toBe(true);
    expect(sources[1]!.stopped).toBeDefined();
  });

  it('a change (replace), Stop or Play takes the queued block away', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25));
    context.currentTime = 1;
    let started = 0;
    player.queue(takeOf(4, 0.25), () => started++);
    player.replace(takeOf(4, 0.25));
    expect(sources[1]!.stopped).toBeDefined();
    context.currentTime = 5;
    player.isPlaying();
    expect(started).toBe(0);
  });

  it('played once (Loop off) nothing is queued', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(takeOf(4, 0.25), 0, true);
    player.queue(takeOf(4, 0.25));
    expect(sources).toHaveLength(1);
  });
});

/** A stand-in AudioBuffer of one channel at 1 frame a second, so frames are seconds. */
const bufferOf = (frames: readonly number[]): AudioBuffer => {
  const data = Float32Array.from(frames);
  return { numberOfChannels: 1, length: data.length, sampleRate: 1, duration: data.length, getChannelData: () => data } as unknown as AudioBuffer;
};
/** A take of `frames`, `rings` more ringing past its end; its buffer has them folded in at its start. */
const ringing = (frames: readonly number[], rings: readonly number[]): Take => {
  const folded = frames.map((f, i) => f + (rings[i] ?? 0));
  return { buffer: bufferOf(folded), full: bufferOf([...frames, ...rings]), triggers: [], tapes: [], step: 0.25 };
};

describe('the tail at a block boundary (Svansen)', () => {
  it('the next block starts with what rings past the end of the one before, not with its own tail', () => {
    const a = ringing([1, 1, 1, 1], [0.5, 0.25]);
    const b = ringing([2, 2, 2, 2], [0.1]);
    expect(Array.from(afterTail(a, b)![0]!)).toEqual([2.5, 2.25, 2, 2]);
    // Nothing rings past either: the next block plays as it is.
    expect(afterTail(takeOf(4, 0.25), takeOf(4, 0.25))).toBeNull();
  });

  it('the player plays the first turn of the queued block with the tail before it, and then loops it with its own', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    const a = ringing([1, 1, 1, 1], [0.5]);
    const b = ringing([2, 2, 2, 2], [0.25]);
    player.play(a);
    context.currentTime = 1;
    player.queue(b);
    const [playing, own, lead] = sources;
    expect(playing!.loop).toBe(false);
    // Its first turn: its own frames and the tail of the block before.
    expect(lead!.started).toEqual([4.02, 0]);
    expect(lead!.loop).toBe(false);
    expect(Array.from(lead!.buffer!.getChannelData(0))).toEqual([2.5, 2, 2, 2]);
    // After it, its own buffer loops: what rings past its end at its start.
    expect(own!.buffer).toBe(b.buffer);
    expect(own!.started).toEqual([8.02, 0]);
    expect(own!.loop).toBe(true);
    context.currentTime = 9;
    expect(player.currentPosition()).toBeCloseTo(0.98);
  });

  it('a block queued after one still in its first turn takes over at the end of that turn', () => {
    const { context, sources } = fakeContext();
    const player = createPlayer(() => context as unknown as AudioContext);
    player.play(ringing([1, 1, 1, 1], [0.5]));
    context.currentTime = 1;
    player.queue(ringing([2, 2, 2, 2], [0.25]));
    context.currentTime = 5;
    expect(player.isPlaying()).toBe(true);
    const c = ringing([3, 3, 3, 3], [0.125]);
    player.queue(c);
    const [, own, , , lead] = sources;
    // The block before loops no more: its own buffer never starts, and the next takes over at 8.02.
    expect(own!.stopped).toBeCloseTo(8.02);
    expect(lead!.started).toEqual([8.02, 0]);
    expect(Array.from(lead!.buffer!.getChannelData(0))).toEqual([3.25, 3, 3, 3]);
    // Taken away again, the block playing loops on with its own buffer.
    player.queue(null);
    const again = sources.at(-1)!;
    expect(again.started).toEqual([8.02, 0]);
    expect(again.loop).toBe(true);
  });
});
