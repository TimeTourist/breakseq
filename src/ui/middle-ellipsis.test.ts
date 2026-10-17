import { describe, expect, it } from 'vitest';
import { middleEllipsis } from './labels';

describe('long file names in Import', () => {
  it('are shortened in the middle, keeping the start and the extension', () => {
    const name = 'Alvin_Cash_Scott_Bros_Orch._-_Keep_On_Dancing_(Instrumental).Wav';
    const short = middleEllipsis(name);
    expect(short).toHaveLength(32);
    expect(short.startsWith('Alvin_Cash_Scott_')).toBe(true);
    expect(short.endsWith('ental).Wav')).toBe(true);
    expect(short).toContain('…');
    expect(middleEllipsis('amen.wav')).toBe('amen.wav');
  });
});
