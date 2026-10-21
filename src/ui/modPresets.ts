import type { LaneStep, ModEffect, Project, StepEffect, TapeEffect, TempoEffect } from '../model';

/** A ready mod to start from: a name and its effects. */
export interface ModPreset {
  readonly name: string;
  /** What it does, in a few words, for its tooltip. */
  readonly does: string;
  readonly effects: (project: Project) => readonly ModEffect[];
}

const step = (fields: StepEffect): StepEffect => fields;
const fixed = (...values: number[]): LaneStep[] => values.map((v) => ({ v }));
/** A line of `n` steps from `from` to `to`, rounded to `places` decimals: as the presets ramped over a bar before lanes. */
const line = (n: number, from: number, to: number, places = 0): LaneStep[] =>
  Array.from({ length: n }, (_, k) => ({ v: Math.round((from + ((to - from) * k) / (n - 1)) * 10 ** places) / 10 ** places }));
const tempo = (fields: TempoEffect): TempoEffect => fields;

const tape = (fields: Partial<TapeEffect>): TapeEffect => ({
  target: 'tape',
  length: 2,
  direction: 'pingpong',
  speed: { from: 1, to: 0.25 },
  rampOver: null,
  curve: 'linear',
  wow: 0,
  flutter: 0,
  ...fields,
});

/** Repeat the first 2/16, back and forth, slowing to a quarter: tape being braked. */
export const DEFAULT_TAPE: TapeEffect = tape({});

/** The presets as before lanes (Start from, as today), drawn as lanes over a bar. */
export const MOD_PRESETS: readonly ModPreset[] = [
  { name: 'Tape rock', does: 'The first 2/16 back and forth, slowing to a quarter', effects: () => [DEFAULT_TAPE] },
  {
    name: 'Tape stop',
    does: 'A bar of tape slowing gently to a stop',
    effects: () => [tape({ length: 16, direction: 'forward', speed: { from: 1, to: 0 }, curve: 'softStart', wow: 0.1 })],
  },
  { name: 'Stutter', does: 'Every step under the clip rolls in fours', effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(4) })] },
  {
    name: 'Pitch stair',
    does: 'Pitch climbs 0, 3, 5, 7 a beat at a time',
    effects: () => [step({ target: 'pitch', step: 'beat', lane: fixed(0, 3, 5, 7), pitch: { values: 'semitones' } })],
  },
  {
    name: 'Reverse roll',
    does: 'Every other step backwards, in twos',
    effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(2) }), step({ target: 'direction', step: '1/16', lane: fixed(0, 1) })],
  },
  {
    name: 'Slip 1/3',
    does: 'The layer at a third of the tempo, back in time after',
    effects: () => [tempo({ target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } })],
  },
  {
    name: 'Snare roll',
    does: 'Rolls from single hits to eights, climbing an octave',
    effects: () => [
      step({ target: 'ratchet', step: 'beat', lane: line(4, 1, 8) }),
      step({ target: 'pitch', step: '1/16', lane: line(16, 0, 12), pitch: { values: 'semitones' } }),
    ],
  },
  {
    name: 'Pitch dive',
    does: 'Pitch falls an octave over a bar',
    effects: () => [step({ target: 'pitch', step: '1/16', lane: line(16, 0, -12), pitch: { values: 'semitones' } })],
  },
  {
    name: 'Random reverse',
    does: 'A quarter of the steps backwards, at random',
    effects: () => [step({ target: 'direction', step: '1/16', lane: [{ lo: 0, hi: 1, chance: 25 }] })],
  },
  { name: 'Gate', does: 'Every other step all but silent', effects: () => [step({ target: 'volume', step: '1/16', lane: fixed(0, -24) })] },
  {
    name: 'Hat bounce',
    does: 'Every step somewhere between left and right, at random',
    effects: () => [step({ target: 'pan', step: '1/16', lane: [{ lo: -100, hi: 100, chance: 100 }] })],
  },
  {
    name: 'Ping-pong roll',
    does: 'Steps in twos, left and right in turn',
    effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(2) }), step({ target: 'pan', step: '1/16', lane: fixed(-80, 80) })],
  },
  {
    name: 'Filter rise',
    does: 'A low-pass opening from 200 Hz to 12 kHz over a bar',
    effects: () => [step({ target: 'filter', step: '1/16', lane: line(16, 200, 12000, -1), filter: { type: 'lowpass', resonance: 0.3 } })],
  },
  {
    name: 'Thin out',
    does: 'A high-pass rising to 2 kHz, taking the bottom away',
    effects: () => [step({ target: 'filter', step: '1/16', lane: line(16, 60, 2000, -1), filter: { type: 'highpass', resonance: 0.3 } })],
  },
  {
    name: 'Crush build',
    does: 'Fewer and fewer bits, a beat at a time, at the same level',
    effects: () => [step({ target: 'dist', step: 'beat', lane: fixed(0, 35, 65, 100), dist: { mode: 'crush' } })],
  },
  {
    name: 'SP grit',
    does: 'Lower sample rate, gritty and metallic like an old sampler',
    effects: () => [step({ target: 'dist', step: 'bar', lane: fixed(50), dist: { mode: 'decimate' } })],
  },
  {
    name: 'Radio',
    does: 'Thin and driven, like a small speaker',
    effects: () => [
      step({ target: 'dist', step: 'bar', lane: fixed(60), dist: { mode: 'drive' } }),
      step({ target: 'filter', step: 'bar', lane: fixed(1200), filter: { type: 'highpass', resonance: 0.6 } }),
    ],
  },
  {
    name: 'Stretch smear',
    does: 'Each hit stretched to twice its length in short metallic grains',
    effects: () => [step({ target: 'stretch', step: 'bar', lane: fixed(2), stretch: { grain: 12, combine: 'multiply' } })],
  },
  {
    name: 'Reverb throw',
    does: 'Every hit under it into a large hall, ringing out after it',
    effects: () => [step({ target: 'reverb', step: 'bar', lane: fixed(100), reverb: { size: 0.85 } })],
  },
  {
    name: 'Delay throw',
    does: 'Every hit under it echoing at 3/16, dying away slowly',
    effects: () => [step({ target: 'delay', step: 'bar', lane: fixed(80), delay: { steps: 3, feedback: 0.7 } })],
  },
  {
    name: 'Random verb',
    does: 'Now and then a hit into the reverb, about one in four',
    effects: () => [step({ target: 'reverb', step: '1/16', lane: [{ lo: 60, hi: 100, chance: 25 }], reverb: { size: 0.6 } })],
  },
];
