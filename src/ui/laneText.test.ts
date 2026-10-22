import { describe, expect, it } from 'vitest';
import type { LaneStep, StepEffect } from '../model';
import { dragText, fullValue, laneSentence, shortValue, stepTitle } from './laneText';

const fixed = (...values: number[]): LaneStep[] => values.map((v) => ({ v }));

describe('the sentence on a card', () => {
  it('reads like the spec: Volume · 4 steps of 1 beat (1 bar), loops · 0 to −12 dB', () => {
    const volume: StepEffect = { target: 'volume', step: 'beat', lane: fixed(0, -6, -3, -12) };
    expect(laneSentence(volume)).toBe('Volume · 4 steps of 1 beat (1 bar), loops · 0 to −12 dB');
  });

  it('Pitch · 3 steps of 1/16 (3/16), loops · +5 to −7 st, 1 dice step', () => {
    const pitch: StepEffect = { target: 'pitch', step: '1/16', lane: [{ v: 0 }, { lo: -7, hi: 5, chance: 75 }, { v: -5 }] };
    expect(laneSentence(pitch)).toBe('Pitch · 3 steps of 1/16 (3/16), loops · +5 to −7 st, 1 dice step');
  });

  it('one value reads "at": Reverb · 4 steps of 1 beat (1 bar), loops · at 100%', () => {
    expect(laneSentence({ target: 'reverb', step: 'beat', lane: fixed(100, 100, 100, 100) })).toBe('Reverb · 4 steps of 1 beat (1 bar), loops · at 100%');
  });

  it('Filter in Hz and kHz, Direction on and off, Pad member as members', () => {
    expect(laneSentence({ target: 'filter', step: 'bar', lane: fixed(18000, 300) })).toBe('Filter cutoff · 2 steps of 1 bar, loops · 18 kHz to 300 Hz');
    expect(laneSentence({ target: 'direction', step: '1/16', lane: fixed(0, 1, 0, 0) })).toBe('Direction · 4 steps of 1/16 (1 beat), loops · reversed on 1 of 4');
    expect(laneSentence({ target: 'padMember', step: '1/16', lane: fixed(1, 2, 3) })).toBe('Pad member · 3 steps of 1/16 (3/16), loops · members 1 to 3');
    // Off lets the pad choose.
    expect(laneSentence({ target: 'padMember', step: 'beat', lane: fixed(0, 0, 0, 0) })).toBe('Pad member · 4 steps of 1 beat (1 bar), loops · at off');
    expect(laneSentence({ target: 'padMember', step: '1/16', lane: fixed(0, 3) })).toBe('Pad member · 2 steps of 1/16 (2/16), loops · off to member 3');
    expect(fullValue({ target: 'padMember' }, 0)).toBe('off');
    expect(shortValue({ target: 'padMember' }, 0)).toBe('off');
  });

  it('16 steps of 1/16 make a bar; 8 make 2 beats', () => {
    expect(laneSentence({ target: 'pan', step: '1/16', lane: fixed(...Array<number>(16).fill(0)) })).toContain('16 steps of 1/16 (1 bar)');
    expect(laneSentence({ target: 'pan', step: '1/16', lane: fixed(...Array<number>(8).fill(0)) })).toContain('8 steps of 1/16 (2 beats)');
  });
});

describe('a step’s title and drag text', () => {
  it('say the value, or the band and chance', () => {
    expect(stepTitle({ target: 'volume' }, { v: -6 }, 1)).toBe('Step 2: −6 dB');
    expect(stepTitle({ target: 'pitch' }, { lo: -7, hi: 5, chance: 75 }, 2)).toBe('Step 3: 🎲 −7 st to +5 st, 75% chance');
    expect(dragText({ target: 'pitch' }, { lo: -7, hi: 5, chance: 100 })).toBe('🎲 −7 st to +5 st');
    expect(fullValue({ target: 'stretch' }, 2)).toBe('2×');
  });
});
