import type { EffectTarget } from '../model';

/** What each effect is called in Mods and Song. */
export const TARGET_LABELS: Record<EffectTarget, string> = {
  swap: 'Swap',
  padMember: 'Pad member',
  ratchet: 'Ratchet',
  pitch: 'Pitch',
  volume: 'Volume',
  pan: 'Pan',
  direction: 'Direction',
  stretch: 'Stretch',
  dist: 'Dist',
  filter: 'Filter cutoff',
  reverb: 'Reverb',
  delay: 'Delay',
  tempo: 'Tempo (slip)',
  tape: 'Tape',
  scramble: 'Scramble',
  stutter: 'Stutter',
  freeze: 'Freeze',
  reverse: 'Reverse',
  rewind: 'Rewind',
  halftime: 'Halftime',
};

/** The order of + Add effect and of a new mod's cards (see Sidan). Scratch comes in a later phase (24d). */
export const ADD_ORDER: readonly EffectTarget[] = [
  'swap',
  'padMember',
  'ratchet',
  'pitch',
  'volume',
  'pan',
  'direction',
  'stretch',
  'dist',
  'filter',
  'reverb',
  'delay',
  'tempo',
  'tape',
  'scramble',
  'stutter',
  'freeze',
  'reverse',
  'rewind',
  'halftime',
];
