import { describe, expect, it } from 'vitest';
import { upgradeProject } from '../model';
import { randomSong } from './fixtures/random-song';
import { generateTake } from './generate';

describe('an old project without presets, at Load (Mod-förval)', () => {
  it('gets the presets and sounds the same', () => {
    const { project } = randomSong();
    const loaded = upgradeProject(JSON.parse(JSON.stringify(project)))!;
    expect(Object.values(loaded.mods).some((m) => m.isPreset === true)).toBe(true);
    expect(generateTake(loaded)).toEqual(generateTake(project));
  });
});
