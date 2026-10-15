import type { Id, Mod, ModTarget, Project } from '../model';

export const TARGET_LABELS: Record<ModTarget, string> = {
  sourceLoop: 'Borrow',
  padMember: 'Pad member',
  ratchet: 'Ratchet',
  pitch: 'Pitch',
  volume: 'Volume',
  direction: 'Direction',
  tempo: 'Tempo (slip)',
};

/** How values read for each target, for the input's hint. */
export const VALUE_HINTS: Record<ModTarget, string> = {
  sourceLoop: 'loop names, e.g. F1 F2',
  padMember: 'member numbers, e.g. 1 2 3',
  ratchet: 'repeats per step, 1–8, e.g. 2 4',
  pitch: 'semitones, e.g. 0 3 5 7',
  volume: 'dB, e.g. 0 -6',
  direction: 'F or R, e.g. F R',
  tempo: 'speed, e.g. 1/3 1/2 2',
};

export type Parsed = { readonly ok: true; readonly values: number[]; readonly sources: Id[] } | { readonly ok: false; readonly error: string };

const number = (word: string): number | null => {
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(word);
  if (fraction !== null) return Number(fraction[1]) / Number(fraction[2]);
  const value = Number(word.replace(/^\+/, ''));
  return Number.isFinite(value) ? value : null;
};

/**
 * Reads the values typed for a target. Borrow values are loop names, which become
 * the mod's sources and indexes into them.
 */
export function parseValues(target: ModTarget, text: string, project: Project): Parsed {
  const words = text.split(/[\s,]+/).filter((w) => w !== '');
  const values: number[] = [];
  const sources: Id[] = [];
  for (const word of words) {
    if (target === 'sourceLoop') {
      const loop = Object.values(project.loops).find((l) => l.name.toLowerCase() === word.toLowerCase());
      if (loop === undefined) return { ok: false, error: `No loop called ${word}` };
      if (!sources.includes(loop.id)) sources.push(loop.id);
      values.push(sources.indexOf(loop.id));
      continue;
    }
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
    values.push(value);
  }
  return { ok: true, values, sources };
}

const fractions: [number, string][] = [
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [1 / 2, '1/2'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [3 / 2, '3/2'],
];

const formatNumber = (target: ModTarget, value: number): string => {
  if (target === 'tempo') {
    const known = fractions.find(([f]) => Math.abs(f - value) < 1e-6);
    if (known !== undefined) return known[1];
  }
  const rounded = Math.round(value * 1000) / 1000;
  return (target === 'pitch' || target === 'volume') && rounded > 0 ? `+${rounded}` : String(rounded);
};

/** Values written back the way they are typed. */
export function formatValues(mod: Pick<Mod, 'target' | 'sources'>, values: readonly number[], project: Project): string {
  return values
    .map((v) => {
      if (mod.target === 'sourceLoop') return project.loops[mod.sources[v] ?? '']?.name ?? '?';
      if (mod.target === 'direction') return v === 1 ? 'R' : 'F';
      return formatNumber(mod.target, v);
    })
    .join(' ');
}
