import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../test/fixtures';
import type { Command, CommandContext } from './command';
import { addClip } from './clips';
import { addEffect, cloneMod, createMod, remove, removeAnyway, removeEffect, renameMod, replaceEffect } from './commands';
import { apply, createHistory, undo } from './history';
import { laneProblem } from './lanes';
import { MOD_PRESETS, START_FROM_PRESETS, addMissingPresets, startFromPreset } from './presets';
import { createProject, newProject, upgradeProject } from './project';
import { rerollAll, rerollMod } from './reroll';
import type { Id, Mod, Project, StepEffect } from './types';
import { isStepEffect } from './types';

const run = (project: Project, command: Command, ctx: CommandContext): Project => {
  const result = command(project, ctx);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.project;
};
const presetNamed = (project: Project, name: string): Mod => Object.values(project.mods).find((m) => m.isPreset === true && m.name === name)!;
const own = (project: Project): Mod[] => Object.values(project.mods).filter((m) => m.isPreset !== true);

const EXTREME = ['Tape rock', 'Tape stop', 'Slip 1/3', 'Pitch dive', 'Reverse roll', 'Snare roll', 'Crush build', 'Stretch smear', 'Scratch Baby', 'Freeze', 'Rewind', 'Halftime', 'Scramble'];
const SUBTLE = [
  'Stutter',
  'Pitch stair',
  'Random reverse',
  'Gate',
  'Hat bounce',
  'Ping-pong roll',
  'Filter rise',
  'Thin out',
  'SP grit',
  'Radio',
  'Reverb throw',
  'Delay throw',
  'Random verb',
  'Stutter Roll',
  'Reverse',
  'Trance gate Straight',
];

describe('the mod presets (Mod-förval)', () => {
  it('are those under Start from plus one per audio mod, each with a name of its own', () => {
    expect(START_FROM_PRESETS.map((p) => p.name)).toEqual([
      'Tape rock',
      'Tape stop',
      'Stutter',
      'Pitch stair',
      'Reverse roll',
      'Slip 1/3',
      'Snare roll',
      'Pitch dive',
      'Random reverse',
      'Gate',
      'Hat bounce',
      'Ping-pong roll',
      'Filter rise',
      'Thin out',
      'Crush build',
      'SP grit',
      'Radio',
      'Stretch smear',
      'Reverb throw',
      'Delay throw',
      'Random verb',
    ]);
    expect(MOD_PRESETS.slice(START_FROM_PRESETS.length).map((p) => p.name)).toEqual([
      'Stutter Roll',
      'Scratch Baby',
      'Freeze',
      'Reverse',
      'Rewind',
      'Halftime',
      'Scramble',
      'Trance gate Straight',
    ]);
    expect(new Set(MOD_PRESETS.map((p) => p.name)).size).toBe(MOD_PRESETS.length);
  });

  it('are each extreme or subtle, as the spec lists them', () => {
    expect(MOD_PRESETS.filter((p) => p.strength === 'extreme').map((p) => p.name).sort()).toEqual([...EXTREME].sort());
    expect(MOD_PRESETS.filter((p) => p.strength === 'subtle').map((p) => p.name).sort()).toEqual([...SUBTLE].sort());
  });

  it('each makes a valid mod, its lanes within range', () => {
    const project = createProject();
    for (const preset of MOD_PRESETS) {
      const effects = preset.effects(project);
      expect(effects.length).toBeGreaterThan(0);
      expect(createMod(preset.name, effects)(project, sequentialIds()).ok, preset.name).toBe(true);
      for (const e of effects) if (isStepEffect(e)) expect(laneProblem(e), `${preset.name}: ${e.target}`).toBeNull();
    }
  });

  it('the audio presets are heard at once: Stutter Roll rolls, and Freeze, Reverse and Rewind have steps on', () => {
    const project = createProject();
    const effect = (name: string) => MOD_PRESETS.find((p) => p.name === name)!.effects(project)[0] as StepEffect;
    expect(effect('Stutter Roll')).toMatchObject({ target: 'stutter', step: '1/16', lane: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 3 }] });
    for (const name of ['Freeze', 'Reverse', 'Rewind']) expect(effect(name).lane.some((s) => 'v' in s && s.v === 1), name).toBe(true);
    expect(effect('Trance gate Straight').lane).toHaveLength(16);
  });
});

describe('a new project', () => {
  it('has every preset as a mod with isPreset, an id of its own and a seed', () => {
    const ctx = sequentialIds();
    const project = newProject(ctx);
    const mods = Object.values(project.mods);
    expect(mods.map((m) => m.name)).toEqual(MOD_PRESETS.map((p) => p.name));
    expect(mods.every((m) => m.isPreset === true)).toBe(true);
    expect(new Set(mods.map((m) => m.id)).size).toBe(mods.length);
    for (const [id, m] of Object.entries(project.mods)) expect(m.id).toBe(id);
    expect(presetNamed(project, 'Gate').effects).toEqual(MOD_PRESETS.find((p) => p.name === 'Gate')!.effects(project));
    expect(project.song.clips).toEqual([]);
  });

  it('a mod made by hand has no flag', () => {
    const ctx = sequentialIds();
    const made = run(newProject(ctx), createMod('Mine', []), ctx);
    expect(own(made)).toHaveLength(1);
    expect('isPreset' in own(made)[0]!).toBe(false);
  });
});

describe('an old project at Load', () => {
  const oldProject = (): { project: Project; mod: Id } => {
    const ctx = sequentialIds();
    const withMod = run(createProject(), createMod('Mine', MOD_PRESETS[0]!.effects(createProject())), ctx);
    const mod = Object.keys(withMod.mods)[0]!;
    return { project: run(withMod, addClip('modA', mod, 0, 16), ctx), mod };
  };

  it('gets the presets, its own mods and clips as they were', () => {
    const { project, mod } = oldProject();
    const loaded = upgradeProject(JSON.parse(JSON.stringify(project)))!;
    expect(Object.values(loaded.mods).filter((m) => m.isPreset === true).map((m) => m.name)).toEqual(MOD_PRESETS.map((p) => p.name));
    expect(loaded.mods[mod]).toEqual(project.mods[mod]);
    expect(loaded.song).toEqual(project.song);
  });

  it('keeps the presets it has, and gets only those it lacks', () => {
    const ctx = sequentialIds();
    const project = newProject(ctx);
    const gate = presetNamed(project, 'Gate');
    const lacking: Project = { ...project, mods: Object.fromEntries(Object.entries(project.mods).filter(([, m]) => m.name !== 'Radio')) };
    // The project's own Gate is kept, even if the app's Gate would be drawn otherwise.
    const changedGate: Project = { ...lacking, mods: { ...lacking.mods, [gate.id]: { ...gate, effects: [] } } };
    const upgraded = addMissingPresets(changedGate, ctx);
    expect(upgraded.mods[gate.id]).toEqual({ ...gate, effects: [] });
    expect(Object.values(upgraded.mods).filter((m) => m.name === 'Radio' && m.isPreset === true)).toHaveLength(1);
    expect(Object.keys(upgraded.mods)).toHaveLength(MOD_PRESETS.length);
    expect(addMissingPresets(project, ctx)).toBe(project);
  });
});

describe('a change to a preset', () => {
  const setup = () => {
    const ctx = sequentialIds();
    const fresh = newProject(ctx);
    const gate = presetNamed(fresh, 'Gate');
    const project = run(run(fresh, addClip('modA', gate.id, 0, 16), ctx), addClip('modB', gate.id, 16, 16), ctx);
    return { ctx, project, gate };
  };
  const louder = (e: StepEffect): StepEffect => ({ ...e, lane: [{ v: 0 }, { v: -12 }] });

  const changes: [string, (gate: Mod) => Command][] = [
    ['replaceEffect', (gate) => replaceEffect(gate.id, 'volume', louder(gate.effects[0] as StepEffect))],
    ['addEffect', (gate) => addEffect(gate.id, { target: 'pan', step: '1/16', lane: [{ v: 50 }] })],
    ['removeEffect', (gate) => removeEffect(gate.id, 'volume')],
    ['rerollMod', (gate) => rerollMod(gate.id)],
  ];

  it.each(changes)('%s makes a mod of its own with the change, and moves the preset’s clips to it', (_, change) => {
    const { ctx, project, gate } = setup();
    const changed = run(project, change(gate), ctx);
    expect(changed.mods[gate.id]).toEqual(gate);
    const [made] = own(changed);
    expect(made).toBeDefined();
    expect(made!.name).toBe('Gate 2');
    expect('isPreset' in made!).toBe(false);
    expect(changed.song.clips.map((c) => c.ref)).toEqual([made!.id, made!.id]);
    expect(Object.keys(changed.mods)).toHaveLength(Object.keys(project.mods).length + 1);
    // The same change done to the new mod.
    const asOwn = run({ ...project, mods: { ...project.mods, [gate.id]: { id: gate.id, name: gate.name, effects: gate.effects, seed: gate.seed } } }, change(gate), ctx);
    expect(made!.effects).toEqual(asOwn.mods[gate.id]!.effects);
  });

  it('keeps the preset’s seed on an edit, so only the change is heard; 🎲 gives a new one', () => {
    const { ctx, project, gate } = setup();
    expect(own(run(project, changes[0]![1](gate), ctx))[0]!.seed).toBe(gate.seed);
    expect(own(run(project, rerollMod(gate.id), ctx))[0]!.seed).not.toBe(gate.seed);
  });

  it('is one command: Undo takes it all back', () => {
    const { ctx, project, gate } = setup();
    const applied = apply(createHistory(project), changes[0]![1](gate), ctx);
    expect(applied.ok).toBe(true);
    expect(undo(applied.history).present).toBe(project);
  });

  it('is named with the next free number', () => {
    const { ctx, project, gate } = setup();
    const named = run(project, createMod('Gate 2', []), ctx);
    expect(own(run(named, rerollMod(gate.id), ctx)).map((m) => m.name)).toEqual(['Gate 2', 'Gate 3']);
  });

  it('that changes nothing makes no mod', () => {
    const { ctx, project, gate } = setup();
    expect(run(project, replaceEffect(gate.id, 'volume', gate.effects[0]!), ctx)).toBe(project);
  });

  it('a change to a mod of one’s own changes it in place, as before', () => {
    const { ctx, project } = setup();
    const mine = run(project, createMod('Mine', [{ target: 'pan', step: '1/16', lane: [{ v: 0 }] }]), ctx);
    const id = own(mine)[0]!.id;
    const changed = run(mine, replaceEffect(id, 'pan', { target: 'pan', step: '1/16', lane: [{ v: 50 }] }), ctx);
    expect(own(changed)).toHaveLength(1);
    expect(changed.mods[id]!.effects).toEqual([{ target: 'pan', step: '1/16', lane: [{ v: 50 }] }]);
  });
});

describe('what a preset cannot do', () => {
  it('cannot be renamed or deleted', () => {
    const ctx = sequentialIds();
    const project = newProject(ctx);
    const gate = presetNamed(project, 'Gate');
    expect(renameMod(gate.id, 'Mine')(project, ctx).ok).toBe(false);
    expect(remove('mod', gate.id)(project, ctx).ok).toBe(false);
    expect(removeAnyway('mod', gate.id)(project, ctx).ok).toBe(false);
  });

  it('Clone makes a mod of one’s own, as before', () => {
    const ctx = sequentialIds();
    const project = newProject(ctx);
    const gate = presetNamed(project, 'Gate');
    const cloned = run(project, cloneMod(gate.id), ctx);
    expect(own(cloned).map((m) => [m.name, 'isPreset' in m])).toEqual([['Gate copy', false]]);
  });

  it('Start from makes a mod of one’s own from a preset, named as it with a number', () => {
    const ctx = sequentialIds();
    const project = newProject(ctx);
    const gate = presetNamed(project, 'Gate');
    const started = run(project, startFromPreset(gate.id), ctx);
    const [made] = own(started);
    expect(made).toMatchObject({ name: 'Gate 2', effects: gate.effects });
    expect('isPreset' in made!).toBe(false);
    expect(started.mods[gate.id]).toBe(gate);
  });

  it('Reroll everything leaves the presets as they are', () => {
    const ctx = sequentialIds();
    const project = run(newProject(ctx), createMod('Mine', []), ctx);
    const rerolled = run(project, rerollAll(), ctx);
    for (const m of Object.values(project.mods)) {
      if (m.isPreset === true) expect(rerolled.mods[m.id]).toBe(m);
      else expect(rerolled.mods[m.id]!.seed).not.toBe(m.seed);
    }
  });
});
