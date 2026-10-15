import { useState } from 'react';
import type { EffectTarget, Id, Mod, ModEffect, ModRate, ModShape, ModTarget, Project, StepEffect } from '../model';
import { MOD_TARGETS, STEPS_PER_BAR, addEffect, createMod, remove, removeEffect, renameMod, replaceEffect, stepDuration } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { StepGraph, TapeGraph } from './ModGraph';
import { MOD_PRESETS, DEFAULT_TAPE } from './modPresets';
import { StepSentence, TapeSentence } from './ModSentence';
import { TARGET_LABELS, randomMod } from './modText';
import type { Selection } from './store';

/** The mod open in Mods: the selected one, else the first. */
export function currentModId(project: Project, selection: Selection): Id | null {
  if (selection.mod !== null && project.mods[selection.mod] !== undefined) return selection.mod;
  return Object.keys(project.mods)[0] ?? null;
}

/** The loop a mod is tried on: the chosen one, else the first main. */
export function previewLoopId(project: Project, selection: Selection): Id | null {
  if (selection.previewLoop !== null && project.loops[selection.previewLoop] !== undefined) return selection.previewLoop;
  const loops = Object.values(project.loops);
  return (loops.find((l) => l.kind === 'main') ?? loops[0])?.id ?? null;
}

/** A useful starting point for each target. */
const DEFAULTS: Record<ModTarget, { rate: ModRate; shape: ModShape }> = {
  sourceLoop: { rate: 'bar', shape: { kind: 'list', values: [] } },
  padMember: { rate: 'step', shape: { kind: 'cycle', values: [] } },
  ratchet: { rate: 'step', shape: { kind: 'random', min: 2, max: 4, chance: 30, whole: true } },
  pitch: { rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } },
  volume: { rate: 'step', shape: { kind: 'list', values: [0, -6] } },
  direction: { rate: 'step', shape: { kind: 'random', min: 0, max: 1, chance: 25, whole: true } },
  tempo: { rate: 'bar', shape: { kind: 'list', values: [1 / 3] } },
};

/** A new step effect for a target, acting on every step. */
const stepEffect = (target: ModTarget): StepEffect => ({ target, scope: { kind: 'all' }, ...DEFAULTS[target], sources: [] });

const newEffect = (target: EffectTarget): ModEffect => (target === 'tape' ? DEFAULT_TAPE : stepEffect(target));

/** Every target, in the order effects apply: the step targets, then Tape. */
const EFFECT_TARGETS: readonly EffectTarget[] = [...MOD_TARGETS, 'tape'];

/** A mod's effects in short: "Pitch + Ratchet". */
export const effectsLabel = (mod: Mod) => mod.effects.map((e) => TARGET_LABELS[e.target]).join(' + ');

export function ModsView() {
  const project = useProject();
  const { store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  const modId = currentModId(project, selection);
  const mod = modId === null ? undefined : project.mods[modId];
  const previewId = previewLoopId(project, selection);
  const [selectedTarget, setSelectedTarget] = useState<EffectTarget | null>(null);
  const [exampleSeed, setExampleSeed] = useState(1);

  /** A new mod, plain or from a preset, opened straight away. */
  const newMod = (name: string | null, effects: readonly ModEffect[]) => {
    const before = store.getState().history.present.mods;
    if (run(createMod(name ?? `Mod ${Object.keys(before).length + 1}`, effects)) === null) {
      const id = Object.keys(store.getState().history.present.mods).find((k) => !(k in before));
      if (id !== undefined) open({ mod: id }, 'mods');
    }
  };

  const sidebar = (
    <aside className="sidebar narrow" aria-label="Mods">
      <section className="stack-tight">
        <h2 className="label">Mods</h2>
        {Object.values(project.mods).map((m) => (
          <button
            key={m.id}
            type="button"
            className="list-item"
            aria-current={m.id === modId ? 'true' : undefined}
            onClick={() => open({ mod: m.id }, 'mods')}
          >
            <span className="mono mod-name grow ellipsis">{m.name}</span>
            <span className="muted small ellipsis">{effectsLabel(m)}</span>
          </button>
        ))}
        <button type="button" className="dashed" onClick={() => newMod(null, [stepEffect('ratchet')])}>
          + New mod
        </button>
      </section>
      <section className="stack-tight">
        <h2 className="label">Start from</h2>
        <div className="row wrap" role="group" aria-label="Start from">
          {MOD_PRESETS.map((preset) => (
            <button key={preset.name} type="button" className="chip" title={preset.does} onClick={() => newMod(preset.name, preset.effects(project))}>
              {preset.name}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );

  if (mod === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Mods</h1>
            <p className="muted">No mods yet. A mod changes steps as the song plays: stutters, pitch stairs, slower tempo.</p>
          </div>
        </main>
      </div>
    );
  }

  const usedIn = project.song.clips.filter((c) => c.ref === mod.id && (c.row === 'modA' || c.row === 'modB')).length;
  const taken = mod.effects.map((e) => e.target);
  const effect = mod.effects.find((e) => e.target === selectedTarget) ?? mod.effects[0]!;
  /** Puts a changed version of the effect being edited in its place. */
  const change = (next: ModEffect, key?: string) =>
    setError(run(replaceEffect(mod.id, effect.target, next), key === undefined ? undefined : `mod:${mod.id}:${effect.target}:${key}`));

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        <div className="view-head row">
          <label className="sr-only" htmlFor="mod-name">
            Mod name
          </label>
          <input
            id="mod-name"
            className="title-input mono mod-name"
            value={mod.name}
            onChange={(e) => setError(run(renameMod(mod.id, e.target.value), `mod:${mod.id}:name`))}
            onBlur={seal}
          />
          <span className="muted">{effectsLabel(mod)}</span>
          <div className="row push">
            <button
              type="button"
              disabled={effect.target === 'tape'}
              title="Pick this effect's target, scope, rate and shape at random. Undo takes it back."
              onClick={() => change(randomMod(project, Math.random, taken.filter((t) => t !== effect.target)))}
            >
              Randomize
            </button>
            <label className="field">
              Try on
              <select value={previewId ?? ''} onChange={(e) => open({ previewLoop: e.target.value }, 'mods')}>
                {Object.values(project.loops).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={usedIn > 0}
              title={usedIn > 0 ? 'In use: take it out of the song first' : undefined}
              onClick={() => {
                const failed = run(remove('mod', mod.id));
                if (failed === null) open({ mod: null }, 'mods');
                else setError(failed);
              }}
            >
              Delete
            </button>
          </div>
        </div>
        <p className="muted small">Play tries the mod on {previewId === null ? 'a loop (make one first)' : project.loops[previewId]?.name}, over the whole loop.</p>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <section className="panel row effects-bar">
          <h2 className="label">Effects</h2>
          <div className="segmented" role="group" aria-label="Effects">
            {mod.effects.map((e) => (
              <button key={e.target} type="button" aria-pressed={e.target === effect.target} onClick={() => setSelectedTarget(e.target)}>
                {TARGET_LABELS[e.target]}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="sr-only">Add effect</span>
            <select
              aria-label="Add effect"
              value=""
              onChange={(e) => {
                const target = e.target.value as EffectTarget;
                if (target === undefined || (e.target.value as string) === '') return;
                const failed = run(addEffect(mod.id, newEffect(target)));
                setError(failed);
                if (failed === null) setSelectedTarget(target);
              }}
            >
              <option value="">+ Effect</option>
              {EFFECT_TARGETS.filter((t) => !taken.includes(t)).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="push"
            disabled={mod.effects.length === 1}
            title={mod.effects.length === 1 ? 'A mod needs at least one effect' : undefined}
            onClick={() => setError(run(removeEffect(mod.id, effect.target)))}
          >
            Remove {TARGET_LABELS[effect.target]}
          </button>
        </section>

        <section className="panel stack">
          {effect.target === 'tape' ? (
            <>
              <TapeSentence key={mod.id} tape={effect} onChange={change} onCommit={seal} />
              <TapeGraph tape={effect} clipSteps={Math.max(STEPS_PER_BAR, effect.length)} stepSeconds={stepDuration(project.song.bpm)} />
              <p className="muted small">Speed over a clip of {Math.max(1, Math.ceil(effect.length / STEPS_PER_BAR))} bar: each band is one time round, F forwards and R backwards.</p>
            </>
          ) : (
            <>
              <StepSentence
                key={`${mod.id}:${effect.target}`}
                effect={effect}
                project={project}
                taken={taken.filter((t) => t !== effect.target)}
                onChange={change}
                onTarget={(t) => {
                  const failed = run(replaceEffect(mod.id, effect.target, stepEffect(t)));
                  setError(failed);
                  if (failed === null) setSelectedTarget(t);
                }}
                onCommit={seal}
              />
              <StepGraph effect={effect} project={project} seed={exampleSeed} />
              <div className="row">
                <p className="muted small">
                  Over one bar of its clip.
                  {effect.shape.kind === 'random' ? ' One example of what it might do: every take rolls its own.' : ''}
                  {effect.shape.kind === 'cycle' ? ' Drawn as if it hit a step in every interval.' : ''}
                </p>
                {effect.shape.kind === 'random' && (
                  <button type="button" className="push" onClick={() => setExampleSeed((s) => s + 1)}>
                    Another example
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="panel row">
          <span className="label">Used in</span>
          <span className="muted small">{usedIn === 0 ? 'Not in the song. Drag it onto Mod A or Mod B in Song.' : `${usedIn} clip${usedIn === 1 ? '' : 's'} in the song`}</span>
        </section>
      </main>
    </div>
  );
}
