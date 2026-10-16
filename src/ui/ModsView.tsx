import { useState } from 'react';
import type { EffectTarget, Id, Mod, ModEffect, ModRate, ModShape, ModStretch, Project, StepEffect, StepTarget, SwapEffect } from '../model';
import { DEFAULT_MOD_STRETCH, MAX_GRAIN, MIN_GRAIN, MOD_TARGETS, STEPS_PER_BAR, addEffect, createMod, remove, removeEffect, renameMod, replaceEffect, stepDuration } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { StepGraph, SwapGraph, TapeGraph } from './ModGraph';
import { MOD_PRESETS, DEFAULT_TAPE } from './modPresets';
import { StepSentence, SwapSentence, TapeSentence } from './ModSentence';
import { TARGET_LABELS, randomMod } from './modText';
import type { Selection } from './store';
import { Slider } from './Slider';

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
const DEFAULTS: Record<StepTarget, { rate: ModRate; shape: ModShape }> = {
  padMember: { rate: 'step', shape: { kind: 'cycle', values: [] } },
  ratchet: { rate: 'step', shape: { kind: 'random', min: 2, max: 4, chance: 30, whole: true } },
  pitch: { rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } },
  volume: { rate: 'step', shape: { kind: 'list', values: [0, -6] } },
  direction: { rate: 'step', shape: { kind: 'random', min: 0, max: 1, chance: 25, whole: true } },
  stretch: { rate: 'beat', shape: { kind: 'ramp', from: 1, to: 4 } },
  tempo: { rate: 'bar', shape: { kind: 'list', values: [1 / 3] } },
};

/** A new step effect for a target, acting on every step. */
const stepEffect = (target: StepTarget): StepEffect => ({ target, ...DEFAULTS[target] });

/** Swap from the stack, at random, step by step. */
const NEW_SWAP: SwapEffect = { target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } };

const newEffect = (target: EffectTarget): ModEffect => (target === 'tape' ? DEFAULT_TAPE : target === 'swap' ? NEW_SWAP : stepEffect(target));

/** Every target, in the order effects apply: the step targets, then Tape. */
const EFFECT_TARGETS: readonly EffectTarget[] = [...MOD_TARGETS, 'tape'];

/** A mod's effects in short: "Pitch + Ratchet". */
export const effectsLabel = (mod: Mod) => (mod.effects.length === 0 ? 'no effect yet' : mod.effects.map((e) => TARGET_LABELS[e.target]).join(' + '));

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
        <button type="button" className="dashed" onClick={() => newMod(null, [])}>
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
  const effect = mod.effects.find((e) => e.target === selectedTarget) ?? mod.effects[0];
  /** Swaps the effect being edited for a new one on another target, in its place. */
  const swap = (target: EffectTarget) => {
    if (effect === undefined) return;
    const failed = run(replaceEffect(mod.id, effect.target, newEffect(target)));
    setError(failed);
    if (failed === null) setSelectedTarget(target);
  };
  /** Puts a changed version of the effect being edited in its place. */
  const change = (next: ModEffect, key?: string) =>
    effect !== undefined &&
    setError(run(replaceEffect(mod.id, effect.target, next), key === undefined ? undefined : `mod:${mod.id}:${effect.target}:${key}`));
  /** A Stretch effect's grain length, and whether it multiplies the hit's own stretch or replaces it. */
  const stretchSettings = (stretch: StepEffect) => {
    const settings = stretch.stretch ?? DEFAULT_MOD_STRETCH;
    const set = (patch: Partial<ModStretch>, key: string) => change({ ...stretch, stretch: { ...settings, ...patch } }, key);
    return (
      <div className="slider-grid" aria-label="Stretch settings" role="group">
        <div className="panel stack-tight">
          <span className="label">With the hit's own stretch</span>
          <div className="segmented full" role="group" aria-label="With the hit's own stretch">
            <button type="button" aria-pressed={settings.combine === 'multiply'} title="Times the hit's stretch: 2× makes a break on Fit to tempo twice as long as its steps" onClick={() => set({ combine: 'multiply' }, 'combine')}>
              Multiply
            </button>
            <button type="button" aria-pressed={settings.combine === 'replace'} title="Instead of the hit's stretch" onClick={() => set({ combine: 'replace' }, 'combine')}>
              Replace
            </button>
          </div>
        </div>
        <Slider label="Grain" value={settings.grain} min={MIN_GRAIN} max={MAX_GRAIN} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ grain: v }, 'grain')} onCommit={seal} />
      </div>
    );
  };

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
              disabled={effect === undefined || effect.target === 'tape' || effect.target === 'swap'}
              title="Pick this effect's target, rate and shape at random. Undo takes it back."
              onClick={() => effect !== undefined && effect.target !== 'tape' && effect.target !== 'swap' && change(randomMod(Math.random, taken.filter((t) => t !== effect.target)))}
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
          {mod.effects.length > 0 && (
            <div className="segmented" role="group" aria-label="Effects">
              {mod.effects.map((e) => (
                <span key={e.target} className="effect-tab">
                  <button type="button" aria-pressed={e.target === effect?.target} onClick={() => setSelectedTarget(e.target)}>
                    {TARGET_LABELS[e.target]}
                  </button>
                  <button
                    type="button"
                    className="effect-remove"
                    aria-label={`Remove ${TARGET_LABELS[e.target]}`}
                    title={`Remove ${TARGET_LABELS[e.target]}`}
                    onClick={() => setError(run(removeEffect(mod.id, e.target)))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
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
        </section>

        <section className="panel stack">
          {effect === undefined ? (
            <p className="sentence muted">This mod does nothing yet. Pick what it does with + Effect above.</p>
          ) : effect.target === 'tape' ? (
            <>
              <TapeSentence key={mod.id} tape={effect} taken={taken.filter((t) => t !== 'tape')} onChange={change} onTarget={swap} onCommit={seal} />
              <TapeGraph tape={effect} clipSteps={Math.max(STEPS_PER_BAR, effect.length)} stepSeconds={stepDuration(project.song.bpm)} />
              <p className="muted small">Speed over a clip of {Math.max(1, Math.ceil(effect.length / STEPS_PER_BAR))} bar: each band is one time round, F forwards and R backwards.</p>
            </>
          ) : effect.target === 'swap' ? (
            <>
              <SwapSentence key={mod.id} effect={effect} taken={taken.filter((t) => t !== 'swap')} onChange={change} onTarget={swap} onCommit={seal} />
              <SwapGraph effect={effect} project={project} modId={mod.id} loopId={previewId} seed={exampleSeed} />
              <div className="row">
                <p className="muted small">
                  Each step of the first bar of {previewId === null ? 'a loop' : project.loops[previewId]?.name}, lit where Swap changes its hit. One example: every take
                  rolls its own.
                </p>
                <button type="button" className="push" onClick={() => setExampleSeed((s) => s + 1)}>
                  Another example
                </button>
              </div>
            </>
          ) : (
            <>
              <StepSentence
                key={`${mod.id}:${effect.target}`}
                effect={effect}
                taken={taken.filter((t) => t !== effect.target)}
                onChange={change}
                onTarget={swap}
                onCommit={seal}
              />
              <StepGraph effect={effect} seed={exampleSeed} />
              {effect.target === 'stretch' && stretchSettings(effect)}
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
