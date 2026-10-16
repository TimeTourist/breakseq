import { describe, expect, it } from 'vitest';
import { STEP_TARGETS } from '../model';
import { seededRng } from '../test/fixtures';
import { parseValues, randomMod } from './modText';

describe('random mods', () => {
  const many = Array.from({ length: 2000 }, (_, i) => randomMod(seededRng(i)));

  it('come for every step target', () => {
    expect(new Set(many.map((m) => m.target))).toEqual(new Set(STEP_TARGETS));
  });

  it('only take values their target takes', () => {
    for (const mod of many) {
      if (mod.target === 'direction') continue;
      const shape = mod.shape;
      const values = shape.kind === 'ramp' ? [shape.from, shape.to] : shape.kind === 'random' ? [shape.min, shape.max] : shape.values;
      expect(parseValues(mod.target, values.join(' ')), JSON.stringify(mod)).toMatchObject({ ok: true });
    }
  });

  it('roll the settings of Dist, Filter and Stretch too, and only theirs', () => {
    const of = (target: string) => many.filter((m) => m.target === target);
    expect(new Set(of('dist').map((m) => m.dist?.mode))).toEqual(new Set(['drive', 'crush', 'decimate']));
    expect(new Set(of('filter').map((m) => m.filter?.type))).toEqual(new Set(['lowpass', 'highpass']));
    expect(new Set(of('stretch').map((m) => m.stretch?.combine))).toEqual(new Set(['multiply', 'replace']));
    expect(of('pitch').every((m) => m.dist === undefined && m.filter === undefined && m.stretch === undefined)).toBe(true);
  });
});
