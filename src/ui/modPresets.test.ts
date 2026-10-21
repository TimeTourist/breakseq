import { describe, expect, it } from 'vitest';
import { createMod, createProject, isStepEffect, laneProblem } from '../model';
import { sequentialIds } from '../test/fixtures';
import { MOD_PRESETS } from './modPresets';

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

  it('every step effect is a lane within its range, as a new mod would draw it', () => {
    for (const preset of MOD_PRESETS) {
      for (const effect of preset.effects(createProject())) {
        if (!isStepEffect(effect)) continue;
        expect(laneProblem(effect), `${preset.name}: ${effect.target}`).toBeNull();
      }
    }
  });
});
