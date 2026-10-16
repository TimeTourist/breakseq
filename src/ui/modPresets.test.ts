import { describe, expect, it } from 'vitest';
import { createMod, createProject } from '../model';
import { sequentialIds } from '../test/fixtures';
import { MOD_PRESETS } from './modPresets';
import { parseValues } from './modText';

describe('mod presets', () => {
  it('each makes a mod, with a name of its own and at most one effect per target', () => {
    const project = createProject();
    expect(new Set(MOD_PRESETS.map((p) => p.name)).size).toBe(MOD_PRESETS.length);
    for (const preset of MOD_PRESETS) {
      const effects = preset.effects(project);
      expect(new Set(effects.map((e) => e.target)).size).toBe(effects.length);
      expect(createMod(preset.name, effects)(project, sequentialIds()).ok).toBe(true);
    }
  });

  it('every value is one the target takes', () => {
    for (const preset of MOD_PRESETS) {
      for (const effect of preset.effects(createProject())) {
        if (effect.target === 'tape' || effect.target === 'swap') continue;
        const shape = effect.shape;
        const values = shape.kind === 'ramp' ? [shape.from, shape.to] : shape.kind === 'random' ? [shape.min, shape.max] : shape.values;
        if (effect.target === 'direction') continue;
        expect(parseValues(effect.target, values.join(' ')), `${preset.name}: ${effect.target}`).toMatchObject({ ok: true });
      }
    }
  });
});
