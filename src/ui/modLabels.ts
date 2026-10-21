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
};

/** The order of + Add effect and of a new mod's cards (see Sidan). Scratch and the audio mods come in later phases. */
export const ADD_ORDER: readonly EffectTarget[] = ['swap', 'padMember', 'ratchet', 'pitch', 'volume', 'pan', 'direction', 'stretch', 'dist', 'filter', 'reverb', 'delay', 'tempo', 'tape'];
