import { describe, expect, it } from 'vitest';
import type { Trigger } from '../engine';
import { auditionPosition, fitLoop, nextLoopBoundary, nextRunBoundary, playheadTrigger, runPosition, startOffset } from './playback';

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

describe('nextLoopBoundary', () => {
  it('schedules a new take at the end of the current loop', () => {
    // Loops of 4 s started at t = 10; now is 1.5 s into the third loop.
    expect(nextLoopBoundary(19.5, 10, 4)).toBe(22);
  });

  it('skips to the following loop when the end is too close to schedule', () => {
    expect(nextLoopBoundary(21.99, 10, 4)).toBe(26);
  });

  it('waits for a take that has not started yet', () => {
    expect(nextLoopBoundary(9, 10, 4)).toBe(10);
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

  it('swaps takes where it next reaches the loop end', () => {
    const run = { startTime: 10, offset: 1, loop };
    expect(nextRunBoundary(12, run)).toBe(17);
    expect(nextRunBoundary(18, run)).toBe(21);
    expect(nextRunBoundary(20.99, run)).toBe(25);
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
