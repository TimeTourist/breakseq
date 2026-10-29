import { describe, expect, it } from 'vitest';
import { dropEffectFor } from './dnd';

describe('dropEffectFor', () => {
  it('asks only for an effect the drag allows, or the browser refuses the drop', () => {
    // Library chips allow copying only: a drop must ask for copy, with or without Alt.
    expect(dropEffectFor('copy', false)).toBe('copy');
    expect(dropEffectFor('copy', true)).toBe('copy');
    // Placed cells and steps allow both: they move, and copy with Alt.
    expect(dropEffectFor('copyMove', false)).toBe('move');
    expect(dropEffectFor('copyMove', true)).toBe('copy');
    expect(dropEffectFor('move', true)).toBe('move');
  });
});
