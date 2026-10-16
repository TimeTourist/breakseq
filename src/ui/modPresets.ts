import type { ModEffect, Project, StepEffect, TapeEffect } from '../model';

/** A ready mod to start from: a name and its effects. */
export interface ModPreset {
  readonly name: string;
  /** What it does, in a few words, for its tooltip. */
  readonly does: string;
  readonly effects: (project: Project) => readonly ModEffect[];
}

const step = (fields: StepEffect): StepEffect => fields;

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

export const MOD_PRESETS: readonly ModPreset[] = [
  {
    name: 'Tape rock',
    does: 'The first 2/16 back and forth, slowing to a quarter',
    effects: () => [DEFAULT_TAPE],
  },
  {
    name: 'Tape stop',
    does: 'A bar of tape slowing gently to a stop',
    effects: () => [tape({ length: 16, direction: 'forward', speed: { from: 1, to: 0 }, curve: 'softStart', wow: 0.1 })],
  },
  {
    name: 'Stutter',
    does: 'Every step under the clip rolls in fours',
    effects: () => [step({ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [4] } })],
  },
  {
    name: 'Pitch stair',
    does: 'Pitch climbs 0, 3, 5, 7 a beat at a time',
    effects: () => [step({ target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } })],
  },
  {
    name: 'Reverse roll',
    does: 'Every other step backwards, in twos',
    effects: () => [
      step({ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }),
      step({ target: 'direction', rate: 'step', shape: { kind: 'list', values: [0, 1] } }),
    ],
  },
  {
    name: 'Slip 1/3',
    does: 'The layer at a third of the tempo, back in time after',
    effects: () => [step({ target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } })],
  },
  {
    name: 'Snare roll',
    does: 'Rolls from single hits to eights, climbing an octave',
    effects: () => [
      step({ target: 'ratchet', rate: 'beat', shape: { kind: 'ramp', from: 1, to: 8 } }),
      step({ target: 'pitch', rate: 'step', shape: { kind: 'ramp', from: 0, to: 12 } }),
    ],
  },
  {
    name: 'Pitch dive',
    does: 'Pitch falls an octave over the clip',
    effects: () => [step({ target: 'pitch', rate: 'step', shape: { kind: 'ramp', from: 0, to: -12 } })],
  },
  {
    name: 'Random reverse',
    does: 'A quarter of the steps backwards, at random',
    effects: () => [step({ target: 'direction', rate: 'step', shape: { kind: 'random', min: 0, max: 1, chance: 25, whole: true } })],
  },
  {
    name: 'Gate',
    does: 'Every other step all but silent',
    effects: () => [step({ target: 'volume', rate: 'step', shape: { kind: 'list', values: [0, -40] } })],
  },
  {
    name: 'Hat bounce',
    does: 'Every step somewhere between left and right, at random',
    effects: () => [step({ target: 'pan', rate: 'step', shape: { kind: 'random', min: -100, max: 100, chance: 100, whole: true } })],
  },
  {
    name: 'Ping-pong roll',
    does: 'Steps in twos, left and right in turn',
    effects: () => [
      step({ target: 'ratchet', rate: 'step', shape: { kind: 'list', values: [2] } }),
      step({ target: 'pan', rate: 'step', shape: { kind: 'list', values: [-80, 80] } }),
    ],
  },
  {
    name: 'Filter rise',
    does: 'A low-pass opening from 200 Hz to 12 kHz over the clip',
    effects: () => [step({ target: 'filter', rate: 'step', shape: { kind: 'ramp', from: 200, to: 12000 }, filter: { type: 'lowpass', resonance: 0.4 } })],
  },
  {
    name: 'Thin out',
    does: 'A high-pass rising to 2 kHz, taking the bottom away',
    effects: () => [step({ target: 'filter', rate: 'step', shape: { kind: 'ramp', from: 20, to: 2000 }, filter: { type: 'highpass', resonance: 0.2 } })],
  },
  {
    name: 'Crush build',
    does: 'Fewer and fewer bits, a beat at a time, at the same level',
    effects: () => [step({ target: 'dist', rate: 'beat', shape: { kind: 'ramp', from: 0, to: 1 }, dist: { mode: 'crush' } })],
  },
  {
    name: 'SP grit',
    does: 'Lower sample rate, gritty and metallic like an old sampler',
    effects: () => [step({ target: 'dist', rate: 'bar', shape: { kind: 'list', values: [0.5] }, dist: { mode: 'decimate' } })],
  },
  {
    name: 'Radio',
    does: 'Thin and driven, like a small speaker',
    effects: () => [
      step({ target: 'dist', rate: 'bar', shape: { kind: 'list', values: [0.6] }, dist: { mode: 'drive' } }),
      step({ target: 'filter', rate: 'bar', shape: { kind: 'list', values: [1200] }, filter: { type: 'highpass', resonance: 0.5 } }),
    ],
  },
  {
    name: 'Stretch smear',
    does: 'Each hit stretched to twice its length in short metallic grains',
    effects: () => [step({ target: 'stretch', rate: 'bar', shape: { kind: 'list', values: [2] }, stretch: { grain: 12, combine: 'multiply' } })],
  },
];
