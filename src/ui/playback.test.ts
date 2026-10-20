import { describe, expect, it } from 'vitest';
import type { Trigger } from '../engine';
import type { Take } from './playback';
import { SWAP_FADE, auditionPosition, createPlayer, fitLoop, playheadTrigger, runPosition, startOffset, swapPoint } from './playback';

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
