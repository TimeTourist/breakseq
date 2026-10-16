import type { EffectTarget, ModShape, StepEffect, StepTarget } from '../model';
import { MAX_CUTOFF, MAX_STRETCH, MIN_CUTOFF, MIN_STRETCH, STEP_TARGETS } from '../model';

export const TARGET_LABELS: Record<EffectTarget, string> = {
  tape: 'Tape',
  swap: 'Swap',
  padMember: 'Pad member',
  ratchet: 'Ratchet',
  pitch: 'Pitch',
  volume: 'Volume',
  pan: 'Pan',
  direction: 'Direction',
  stretch: 'Stretch',
  dist: 'Dist',
  filter: 'Filter',
  tempo: 'Tempo (slip)',
};

/** How values read for each target, for the input's hint. */
export const VALUE_HINTS: Record<StepTarget, string> = {
  padMember: 'member numbers, e.g. 1 2 3',
  ratchet: 'repeats per step, 1–8, e.g. 2 4',
  pitch: 'semitones, e.g. 0 3 5 7',
  volume: 'dB, e.g. 0 -6',
  pan: 'percent, −100 left to 100 right, e.g. -50 50',
  direction: 'F or R, e.g. F R',
  stretch: 'length factor, e.g. 2 1/2 4',
  dist: 'amount 0–1, e.g. 0.2 0.8',
  filter: 'cutoff in Hz, e.g. 200 2000 8000',
  tempo: 'speed, e.g. 1/3 1/2 2',
};

export type Parsed = { readonly ok: true; readonly values: number[] } | { readonly ok: false; readonly error: string };

const number = (word: string): number | null => {
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(word);
  if (fraction !== null) return Number(fraction[1]) / Number(fraction[2]);
  const value = Number(word.replace(/^\+/, ''));
  return Number.isFinite(value) ? value : null;
};

/**
 * Reads the values typed for a target.
 */
export function parseValues(target: StepTarget, text: string): Parsed {
  const words = text.split(/[\s,]+/).filter((w) => w !== '');
  const values: number[] = [];
  for (const word of words) {
    if (target === 'direction') {
      const w = word.toLowerCase();
      if (w === 'f' || w === '0' || w === 'fwd' || w === 'forward') values.push(0);
      else if (w === 'r' || w === '1' || w === 'rev' || w === 'reverse') values.push(1);
      else return { ok: false, error: `${word} is not F or R` };
      continue;
    }
    const value = number(word);
    if (value === null) return { ok: false, error: `${word} is not a number` };
    if (target === 'ratchet' && !(Number.isInteger(value) && value >= 1 && value <= 8)) return { ok: false, error: 'Ratchet is a whole number from 1 to 8' };
    if (target === 'padMember' && !(Number.isInteger(value) && value >= 1)) return { ok: false, error: 'Members count from 1' };
    if (target === 'tempo' && !(value > 0)) return { ok: false, error: 'Tempo is a speed above 0, e.g. 1/3' };
    if (target === 'stretch' && !(value >= MIN_STRETCH && value <= MAX_STRETCH)) return { ok: false, error: 'Stretch is a factor from 1/16 to 16, e.g. 2' };
    if (target === 'pan' && !(value >= -100 && value <= 100)) return { ok: false, error: 'Pan is a percent from −100 (left) to 100 (right), e.g. -50' };
    if (target === 'dist' && !(value >= 0 && value <= 1)) return { ok: false, error: 'Dist is an amount from 0 to 1, e.g. 0.5' };
    if (target === 'filter' && !(value >= MIN_CUTOFF && value <= MAX_CUTOFF)) return { ok: false, error: 'Filter is a cutoff from 20 to 20000 Hz, e.g. 2000' };
    values.push(value);
  }
  return { ok: true, values };
}

const fractions: [number, string][] = [
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [1 / 2, '1/2'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [3 / 2, '3/2'],
];

const formatNumber = (target: StepTarget, value: number): string => {
  if (target === 'tempo' || target === 'stretch') {
    const known = fractions.find(([f]) => Math.abs(f - value) < 1e-6);
    if (known !== undefined) return known[1];
  }
  const rounded = Math.round(value * 1000) / 1000;
  return (target === 'pitch' || target === 'volume' || target === 'pan') && rounded > 0 ? `+${rounded}` : String(rounded);
};

/** Values written back the way they are typed. */
export function formatValues(mod: Pick<StepEffect, 'target'>, values: readonly number[]): string {
  return values
    .map((v) => {
      if (mod.target === 'direction') return v === 1 ? 'R' : 'F';
      return formatNumber(mod.target, v);
    })
    .join(' ');
}

const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: () => number, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const several = (rng: () => number, count: [number, number], make: () => number) =>
  Array.from({ length: between(rng, count[0], count[1]) }, make);

/**
 * A step effect picked at random within ranges that sound like something: a
 * starting point to tweak, not a random number soup. Targets in `taken` are
 * left out, unless that leaves none.
 */
export function randomMod(rng: () => number = Math.random, taken: readonly EffectTarget[] = []): StepEffect {
  const free = STEP_TARGETS.filter((t) => !taken.includes(t));
  const target = pick(rng, free.length > 0 ? free : STEP_TARGETS);

  const rate = pick(rng, ['step', 'beat', 'bar'] as const);
  const value: Record<StepTarget, () => number> = {
    padMember: () => between(rng, 1, 4),
    ratchet: () => pick(rng, [2, 2, 3, 4, 4, 6, 8]),
    pitch: () => pick(rng, [-12, -7, -5, -3, 0, 3, 5, 7, 12]),
    volume: () => pick(rng, [-12, -6, -3, 0]),
    pan: () => pick(rng, [-100, -50, -25, 25, 50, 100]),
    direction: () => between(rng, 0, 1),
    tempo: () => pick(rng, [1 / 3, 1 / 2, 2 / 3, 3 / 2, 2]),
    stretch: () => pick(rng, [1 / 2, 3 / 2, 2, 2, 4]),
    dist: () => pick(rng, [0.2, 0.4, 0.6, 0.8, 1]),
    filter: () => pick(rng, [200, 500, 1000, 2000, 5000, 10000]),
  };
  const kinds: ModShape['kind'][] =
    target === 'direction' ? ['list', 'cycle', 'random'] : target === 'tempo' ? ['list', 'list', 'ramp'] : ['list', 'cycle', 'ramp', 'random'];
  const kind = pick(rng, kinds);
  const random = (): ModShape => {
    const [min, max] =
      target === 'direction' ? [0, 1]
      : target === 'ratchet' ? [between(rng, 1, 2), between(rng, 3, 6)]
      : target === 'padMember' ? [1, 4]
      : target === 'volume' ? [-12, 0]
      : target === 'pan' ? [-100, 100]
      : target === 'tempo' ? [1 / 3, 1]
      : target === 'stretch' ? [1, 4]
      : target === 'dist' ? [0, 1]
      : target === 'filter' ? [200, 8000]
      : [-between(rng, 2, 12), between(rng, 2, 12)];
    return { kind: 'random', min, max, chance: pick(rng, [15, 25, 33, 50, 75]), whole: target === 'pitch' };
  };
  const shape: ModShape =
    kind === 'random'
      ? random()
      : kind === 'ramp'
        ? { kind: 'ramp', from: value[target](), to: value[target]() }
        : { kind, values: target === 'padMember' && kind === 'cycle' && rng() < 0.5 ? [] : several(rng, [1, 4], value[target]) };
  return { target, rate, shape };
}
