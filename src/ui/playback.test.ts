import { describe, expect, it } from 'vitest';
import type { Trigger } from '../engine';
import { nextLoopBoundary, playheadTrigger } from './playback';

const at = (time: number, bar: number): Trigger => ({
  time,
  bar,
  step: 0,
  hitId: 'h',
  pitch: 0,
  volume: 0,
  direction: 'forward',
  region: { start: 0, end: 0.1 },
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
