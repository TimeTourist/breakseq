import { useEffect, useState } from 'react';
import type { EffectTarget, Id, Mod, ModEffect, ModRate, ModScope, ModShape, ModTarget, Project, StepEffect, TapeEffect } from '../model';
import { MAX_TAPE_SPEED, MOD_TARGETS, addEffect, createMod, isParentPad, remove, removeEffect, renameMod, replaceEffect } from '../model';
import { lengthText } from './labels';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { TARGET_LABELS, VALUE_HINTS, formatValues, parseValues, randomMod } from './modText';
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
  ratchet: { rate: 'step', shape: { kind: 'random', min: 2, max: 4, chance: 30 } },
  pitch: { rate: 'beat', shape: { kind: 'ramp', from: 0, to: 12 } },
  volume: { rate: 'step', shape: { kind: 'list', values: [0, -6] } },
  direction: { rate: 'step', shape: { kind: 'random', min: 0, max: 1, chance: 25 } },
  tempo: { rate: 'bar', shape: { kind: 'list', values: [1 / 3] } },
};

/** A new step effect for a target, acting on all steps. */
const stepEffect = (target: ModTarget): StepEffect => ({ target, scope: { kind: 'all' }, ...DEFAULTS[target], sources: [] });

/** Repeat the first 2/16, back and forth, slowing to a quarter speed: tape being braked. */
export const DEFAULT_TAPE: TapeEffect = { target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0.25 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 };

const newEffect = (target: EffectTarget): ModEffect => (target === 'tape' ? DEFAULT_TAPE : stepEffect(target));

/** Every target, in the order effects apply: the step targets, then Tape. */
const EFFECT_TARGETS: readonly EffectTarget[] = [...MOD_TARGETS, 'tape'];

/** A mod's effects in short: "Pitch + Ratchet". */
export const effectsLabel = (mod: Mod) => mod.effects.map((e) => TARGET_LABELS[e.target]).join(' + ');

/** Targets that pick one thing out of several: no ramp, and Random picks among them. */
const PICKS = new Set<ModTarget>(['sourceLoop', 'direction']);

const SHAPES = ['list', 'cycle', 'ramp', 'random'] as const;
const RATES: readonly ModRate[] = ['step', 'beat', 'bar'];

function scopeText(scope: ModScope, project: Project): string {
  switch (scope.kind) {
    case 'all':
      return 'every step';
    case 'tag':
      return `${project.tags[scope.tagId]?.name ?? '?'} steps`;
    case 'pad':
      return `pad ${project.pads[scope.padId]?.name ?? '?'}`;
  }
}

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

  const newMod = () => {
    const before = store.getState().history.present.mods;
    const name = `Mod ${Object.keys(before).length + 1}`;
    if (run(createMod(name, [stepEffect('ratchet')])) === null) {
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
        <button type="button" className="dashed" onClick={newMod}>
          + New mod
        </button>
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
  const change = (next: ModEffect, key?: string) => setError(run(replaceEffect(mod.id, effect.target, next), key));

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
          <span className="muted small">
            {effect.target === 'tape'
              ? `repeat ${lengthText(effect.length)} · ${effect.speed.from}× → ${effect.speed.to}×`
              : `${scopeText(effect.scope, project)} · per ${effect.rate}`}
          </span>
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

        {effect.target === 'tape' ? (
          <TapeEditor key={mod.id} tape={effect} onChange={change} onCommit={seal} />
        ) : (
          <div className="mod-grid">
            <section className="panel stack-tight">
              <h2 className="label">Target</h2>
              <div className="choice-grid" role="group" aria-label="Target">
                {MOD_TARGETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={effect.target === t}
                    disabled={t !== effect.target && taken.includes(t)}
                    onClick={() => {
                      if (t === effect.target) return;
                      const failed = run(replaceEffect(mod.id, effect.target, stepEffect(t)));
                      setError(failed);
                      if (failed === null) setSelectedTarget(t);
                    }}
                  >
                    {TARGET_LABELS[t]}
                  </button>
                ))}
              </div>
            </section>

            <ScopeEditor effect={effect} project={project} onChange={(scope) => change({ ...effect, scope })} />

            <section className="panel stack-tight">
              <h2 className="label">Rate · one value per</h2>
              <div className="segmented" role="group" aria-label="Rate">
                {RATES.map((r) => (
                  <button key={r} type="button" aria-pressed={effect.rate === r} onClick={() => change({ ...effect, rate: r })}>
                    {r}
                  </button>
                ))}
              </div>
              {effect.target === 'tempo' && <p className="muted small">Tempo ignores scope: it moves the whole layer.</p>}
            </section>

            <ShapeEditor key={`${mod.id}:${effect.target}`} effect={effect} modId={mod.id} project={project} onChange={change} onCommit={seal} />
          </div>
        )}

        <section className="panel row">
          <span className="label">Used in</span>
          <span className="muted small">{usedIn === 0 ? 'Not in the song. Drag it onto Mod A or Mod B in Song.' : `${usedIn} clip${usedIn === 1 ? '' : 's'} in the song`}</span>
        </section>
      </main>
    </div>
  );
}

function ScopeEditor({ effect, project, onChange }: { effect: StepEffect; project: Project; onChange: (scope: ModScope) => void }) {
  const { scope } = effect;
  const tags = Object.values(project.tags);
  // A break's own pad never plays as a pad, so a mod cannot act on it.
  const pads = Object.values(project.pads).filter((p) => !isParentPad(project, p));
  return (
    <section className="panel stack-tight">
      <h2 className="label">Acts on</h2>
      <div className="segmented" role="group" aria-label="Scope">
        <button type="button" aria-pressed={scope.kind === 'all'} onClick={() => onChange({ kind: 'all' })}>
          Steps
        </button>
        <button
          type="button"
          aria-pressed={scope.kind === 'tag'}
          disabled={tags.length === 0}
          onClick={() => onChange({ kind: 'tag', tagId: (tags.find((t) => t.name === 'S') ?? tags[0])!.id })}
        >
          Tag
        </button>
        <button type="button" aria-pressed={scope.kind === 'pad'} disabled={pads.length === 0} onClick={() => onChange({ kind: 'pad', padId: pads[0]!.id })}>
          Pad
        </button>
      </div>
      {scope.kind === 'tag' && (
        <label className="field">
          Tag
          <select aria-label="Scope tag" value={scope.tagId} onChange={(e) => onChange({ kind: 'tag', tagId: e.target.value })}>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {scope.kind === 'pad' && (
        <label className="field">
          Pad
          <select aria-label="Scope pad" value={scope.padId} onChange={(e) => onChange({ kind: 'pad', padId: e.target.value })}>
            {pads.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

interface ShapeEditorProps {
  readonly effect: StepEffect;
  readonly modId: Id;
  readonly project: Project;
  readonly onChange: (effect: StepEffect, key?: string) => void;
  readonly onCommit: () => void;
}

function ShapeEditor({ effect, modId, project, onChange, onCommit }: ShapeEditorProps) {
  const { shape, target } = effect;
  const key = (part: string) => `mod:${modId}:${target}:${part}`;
  const picks = PICKS.has(target);
  const shownValues = shape.kind === 'list' || shape.kind === 'cycle' ? formatValues(effect, shape.values, project) : '';
  const [text, setText] = useState(shownValues);
  const [problem, setProblem] = useState<string | null>(null);
  // Follow the mod when it changes from elsewhere (another mod, undo).
  useEffect(() => {
    setText(shownValues);
    setProblem(null);
  }, [shownValues]);

  const commitText = (value: string) => {
    setText(value);
    const parsed = parseValues(target, value, project);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    if (shape.kind === 'list' || shape.kind === 'cycle') {
      onChange({ ...effect, shape: { kind: shape.kind, values: parsed.values }, ...(target === 'sourceLoop' ? { sources: parsed.sources } : {}) }, key('values'));
    }
  };

  const setKind = (kind: ModShape['kind']) => {
    const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : [];
    const range = target === 'sourceLoop' ? { min: 0, max: Math.max(0, effect.sources.length - 1) } : target === 'direction' ? { min: 0, max: 1 } : { min: 1, max: 4 };
    const next: ModShape =
      kind === 'list' || kind === 'cycle'
        ? { kind, values }
        : kind === 'ramp'
          ? { kind, from: 0, to: 12 }
          : { kind, ...range, chance: 50 };
    onChange({ ...effect, shape: next });
  };

  const number = (label: string, value: number, apply: (v: number) => ModShape, min?: number, max?: number) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={Math.round(value * 1000) / 1000}
        min={min}
        max={max}
        step="any"
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange({ ...effect, shape: apply(v) }, key(label));
        }}
        onBlur={onCommit}
      />
    </label>
  );

  return (
    <section className="panel stack-tight shape-editor">
      <h2 className="label">Shape</h2>
      <div className="segmented" role="group" aria-label="Shape">
        {SHAPES.map((k) => (
          <button key={k} type="button" aria-pressed={shape.kind === k} disabled={k === 'ramp' && picks} onClick={() => setKind(k)}>
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {(shape.kind === 'list' || shape.kind === 'cycle') && (
        <>
          <label className="field wide">
            Values
            <input
              className="mono grow"
              aria-label="Values"
              placeholder={VALUE_HINTS[target]}
              value={text}
              onChange={(e) => commitText(e.target.value)}
              onBlur={onCommit}
            />
          </label>
          <p className="muted small">
            {shape.kind === 'list'
              ? 'One value per interval, in turn, then again from the start.'
              : target === 'padMember' && shape.values.length === 0
                ? 'Empty: goes round the pad’s members, one further each time the mod hits a step.'
                : 'One value further each time the mod hits a step in a new interval.'}{' '}
            {VALUE_HINTS[target]}.
          </p>
        </>
      )}
      {shape.kind === 'ramp' && (
        <div className="row">
          {number('From', shape.from, (v) => ({ ...shape, from: v }))}
          {number('To', shape.to, (v) => ({ ...shape, to: v }))}
          <p className="muted small">From the first interval of the run to its last.</p>
        </div>
      )}
      {shape.kind === 'random' && (
        <div className="row">
          {!picks && number('Min', shape.min, (v) => ({ ...shape, min: v }))}
          {!picks && number('Max', shape.max, (v) => ({ ...shape, max: v }))}
          {number('Chance %', shape.chance, (v) => ({ ...shape, chance: Math.max(0, Math.min(100, v)) }), 0, 100)}
          {target === 'sourceLoop' && (
            <label className="field wide">
              From loops
              <input
                className="mono grow"
                aria-label="Borrow from"
                placeholder="loop names, e.g. F1 F2"
                defaultValue={formatValues(effect, effect.sources.map((_, i) => i), project)}
                onBlur={(e) => {
                  const parsed = parseValues('sourceLoop', e.target.value, project);
                  if (parsed.ok) onChange({ ...effect, sources: parsed.sources, shape: { ...shape, min: 0, max: Math.max(0, parsed.sources.length - 1) } });
                  else setProblem(parsed.error);
                }}
              />
            </label>
          )}
          <p className="muted small">Each interval gets a value with this chance{picks ? ', picked at random' : ''}.</p>
        </div>
      )}
      {problem !== null && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

const DIRECTIONS: readonly { value: TapeEffect['direction']; label: string }[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'pingpong', label: 'Ping-pong' },
];

const REPEAT_PARTS = [
  { label: 'Bars', size: 16, max: 4 },
  { label: 'Beats', size: 4, max: 3 },
  { label: '1/16', size: 1, max: 3 },
] as const;

interface TapeEditorProps {
  readonly tape: TapeEffect;
  readonly onChange: (tape: TapeEffect, key?: string) => void;
  readonly onCommit: () => void;
}

/** Repeat length, direction and speed of a Tape. */
function TapeEditor({ tape, onChange, onCommit }: TapeEditorProps) {
  const split = [Math.floor(tape.length / 16), Math.floor((tape.length % 16) / 4), tape.length % 4];
  const setPart = (index: number, value: number) => {
    const parts = split.map((p, i) => (i === index ? value : p));
    const length = parts.reduce((sum, p, i) => sum + p * REPEAT_PARTS[i]!.size, 0);
    if (length >= 1) onChange({ ...tape, length }, 'tape:length');
  };
  const speed = (label: string, value: number, apply: (v: number) => TapeEffect) => (
    <label className="field">
      {label}
      <input
        type="number"
        min={0}
        max={MAX_TAPE_SPEED}
        step={0.05}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && v <= MAX_TAPE_SPEED) onChange(apply(v), `tape:${label}`);
        }}
        onBlur={onCommit}
      />
    </label>
  );
  return (
    <div className="mod-grid">
      <section className="panel stack-tight">
        <h2 className="label">Repeat · records the first</h2>
        <div className="row" role="group" aria-label="Repeat">
          {REPEAT_PARTS.map((part, i) => (
            <label key={part.label} className="field">
              {part.label}
              <input type="number" min={0} max={part.max} value={split[i]} onChange={(e) => setPart(i, Math.max(0, Math.round(Number(e.target.value))))} onBlur={onCommit} />
            </label>
          ))}
        </div>
        <p className="muted small">
          {lengthText(tape.length)} from where the clip starts, played round and round as long as the clip lasts. The clip is at least this long.
        </p>
      </section>
      <section className="panel stack-tight">
        <h2 className="label">Direction</h2>
        <div className="segmented" role="group" aria-label="Tape direction">
          {DIRECTIONS.map((d) => (
            <button key={d.value} type="button" aria-pressed={tape.direction === d.value} onClick={() => onChange({ ...tape, direction: d.value })}>
              {d.label}
            </button>
          ))}
        </div>
      </section>
      <section className="panel stack-tight">
        <h2 className="label">Speed · over the clip</h2>
        <div className="row">
          {speed('From', tape.speed.from, (v) => ({ ...tape, speed: { ...tape.speed, from: v } }))}
          {speed('To', tape.speed.to, (v) => ({ ...tape, speed: { ...tape.speed, to: v } }))}
        </div>
        <p className="muted small">Like tape: slower is lower and longer. At 0× it is silent until the clip ends. The song&apos;s tempo never changes.</p>
      </section>
    </div>
  );
}
