import { describe, expect, it } from 'vitest';
import { grainCurve, grainPlan } from './stretch';

const base = { start: 0, end: 1, rate: 1, factor: 2, grain: 0.04, origin: 0, limit: 10 };

/** The sum of every grain's level at output time t. */
function coverage(plan: ReturnType<typeof grainPlan>, t: number): number {
  return plan.grains.reduce((sum, g) => {
    const x = (t - g.at) / g.length;
    if (x < 0 || x >= 1) return sum;
    return sum + (g.shape === 'flatStart' && x < 0.5 ? 1 : Math.sin(Math.PI * x) ** 2);
  }, 0);
}

describe('grains', () => {
  it('a stretch changes the length by its factor, and pitch still changes it too', () => {
    expect(grainPlan(base).length).toBeCloseTo(2);
    expect(grainPlan({ ...base, factor: 0.5 }).length).toBeCloseTo(0.5);
    // Twice as long and an octave up: the length it had, an octave higher.
    expect(grainPlan({ ...base, rate: 2 }).length).toBeCloseTo(1);
  });

  it('grains start half a grain apart and move through the sound slower than they play', () => {
    const { grains } = grainPlan({ ...base, start: 0.5, origin: 0.5 });
    expect(grains[1]!.at - grains[0]!.at).toBeCloseTo(0.02);
    // At 2× the grid moves half as fast through the buffer as the grains play.
    expect(grains[1]!.from - grains[0]!.from).toBeCloseTo(0.01);
  });

  it('the grains add up to an even level all through the sound', () => {
    for (const origin of [0, 0.5]) {
      const plan = grainPlan({ ...base, start: 0.5, origin });
      for (let t = 0; t < plan.length; t += 0.0037) expect(coverage(plan, t)).toBeCloseTo(1, 6);
    }
  });

  it('from the hit, the first grain starts with the hit at full level and nothing before it is read', () => {
    const { grains } = grainPlan({ ...base, start: 0.3, origin: 0.3 });
    expect(grains[0]).toMatchObject({ at: 0, from: 0.3, shape: 'flatStart' });
    expect(grains.every((g) => g.at >= 0 && g.from >= 0.3)).toBe(true);
  });

  it('near the end, grains read the last of the sound rather than past it', () => {
    const { grains } = grainPlan({ ...base, start: 0.3, end: 0.4, origin: 0.3, limit: 0.4 });
    expect(grains.every((g) => g.from + g.length * base.rate <= 0.4 + 1e-12)).toBe(true);
    expect(grains.at(-1)!.from).toBeCloseTo(0.36);
  });

  it('from the break, a slice gets the grains a stretch of the whole break has there', () => {
    const whole = grainPlan({ ...base, start: 0, end: 1 });
    const slice = grainPlan({ ...base, start: 0.25, end: 0.5 });
    // Each of the slice's grains is one of the whole break's, moved to the slice's start (0.25 s in at 2× = 0.5 s).
    for (const g of slice.grains) {
      expect(whole.grains.some((w) => Math.abs(w.from - g.from) < 1e-9 && Math.abs(w.at - 0.5 - g.at) < 1e-9)).toBe(true);
    }
    // The grain already under way when the slice starts is there too.
    expect(slice.grains[0]!.at).toBeLessThan(0);
  });

  it('a grain rises and falls; a flat start starts at full level', () => {
    const hann = grainCurve('hann');
    expect(hann[0]).toBeCloseTo(0);
    expect(Math.max(...hann)).toBeCloseTo(1, 2);
    expect(grainCurve('flatStart')[0]).toBe(1);
    // Starting halfway, a curve starts at the top.
    expect(grainCurve('hann', 0.5)[0]).toBeCloseTo(1);
  });
});
