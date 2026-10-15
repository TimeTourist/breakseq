import type { ModEffect, Project, StepEffect, TapeEffect } from '../model';

/** A ready mod to start from: a name and its effects. */
export interface ModPreset {
  readonly name: string;
  /** What it does, in a few words, for its tooltip. */
  readonly does: string;
  readonly effects: (project: Project) => readonly ModEffect[];
}

const step = (fields: Omit<StepEffect, 'sources' | 'scope'> & Partial<Pick<StepEffect, 'scope'>>): StepEffect => ({
  scope: { kind: 'all' },
  sources: [],
  ...fields,
});

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

/** The snares if there is an S tag, else every step. */
const snares = (project: Project): StepEffect['scope'] => {
  const tag = Object.values(project.tags).find((t) => t.name === 'S');
  return tag === undefined ? { kind: 'all' } : { kind: 'tag', tagId: tag.id };
};

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
    does: 'Snares roll in fours',
    effects: (project) => [step({ target: 'ratchet', scope: snares(project), rate: 'step', shape: { kind: 'list', values: [4] } })],
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
];
