import { useEffect, useState } from 'react';
import type { Id, Mod, ModRate, ModScope, ModShape, ModTarget, Project } from '../model';
import { MOD_TARGETS, createMod, remove, updateMod } from '../model';
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

/** Targets that pick one thing out of several: no ramp, and Random picks among them. */
const PICKS = new Set<ModTarget>(['sourceLoop', 'direction']);

const SHAPES = ['list', 'cycle', 'ramp', 'random'] as const;
const RATES: readonly ModRate[] = ['step', 'beat', 'bar'];

function scopeText(scope: ModScope, project: Project): string {
  switch (scope.kind) {
    case 'all':
      return 'all steps';
    case 'tag':
      return `${project.tags[scope.tagId]?.name ?? '?'} steps`;
    case 'pad':
      return `pad ${project.pads[scope.padId]?.name ?? '?'}`;
    case 'range':
      return `steps ${scope.from + 1}–${scope.to + 1}`;
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

  const newMod = () => {
    const before = store.getState().history.present.mods;
    const name = `Mod ${Object.keys(before).length + 1}`;
    if (run(createMod({ name, target: 'ratchet', scope: { kind: 'all' }, ...DEFAULTS.ratchet })) === null) {
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
            <span className="muted small">{TARGET_LABELS[m.target]}</span>
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

  const update = (patch: Partial<Omit<Mod, 'id'>>, key?: string) => setError(run(updateMod(mod.id, patch), key));
  const usedIn = [...project.song.rows.modA, ...project.song.rows.modB].filter((id) => id === mod.id).length;

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
            onChange={(e) => update({ name: e.target.value }, `mod:${mod.id}:name`)}
            onBlur={seal}
          />
          <span className="muted">
            {TARGET_LABELS[mod.target]} · {scopeText(mod.scope, project)} · per {mod.rate}
          </span>
          <div className="row push">
            <button type="button" title="Pick target, scope, rate and shape at random. Undo takes it back." onClick={() => update(randomMod(project))}>
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

        <div className="mod-grid">
          <section className="panel stack-tight">
            <h2 className="label">Target</h2>
            <div className="choice-grid" role="group" aria-label="Target">
              {MOD_TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={mod.target === t}
                  onClick={() => {
                    if (t !== mod.target) update({ target: t, ...DEFAULTS[t], sources: [] });
                  }}
                >
                  {TARGET_LABELS[t]}
                </button>
              ))}
            </div>
          </section>

          <ScopeEditor mod={mod} project={project} onChange={(scope) => update({ scope })} />

          <section className="panel stack-tight">
            <h2 className="label">Rate · one value per</h2>
            <div className="segmented" role="group" aria-label="Rate">
              {RATES.map((r) => (
                <button key={r} type="button" aria-pressed={mod.rate === r} onClick={() => update({ rate: r })}>
                  {r}
                </button>
              ))}
            </div>
            {mod.target === 'tempo' && <p className="muted small">Tempo ignores scope: it moves the whole layer.</p>}
          </section>

          <ShapeEditor mod={mod} project={project} onChange={update} onCommit={seal} />
        </div>

        <section className="panel row">
          <span className="label">Used in</span>
          <span className="muted small">{usedIn === 0 ? 'Not in the song. Drag it onto Mod A or Mod B in Song.' : `${usedIn} song bar${usedIn === 1 ? '' : 's'}`}</span>
        </section>
      </main>
    </div>
  );
}

function ScopeEditor({ mod, project, onChange }: { mod: Mod; project: Project; onChange: (scope: ModScope) => void }) {
  const { scope } = mod;
  const tags = Object.values(project.tags);
  const pads = Object.values(project.pads);
  return (
    <section className="panel stack-tight">
      <h2 className="label">Acts on</h2>
      <div className="segmented" role="group" aria-label="Scope">
        <button type="button" aria-pressed={scope.kind === 'all'} onClick={() => onChange({ kind: 'all' })}>
          All steps
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
        <button type="button" aria-pressed={scope.kind === 'range'} onClick={() => onChange({ kind: 'range', from: 12, to: 15 })}>
          Steps
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
      {scope.kind === 'range' && (
        <div className="row">
          <label className="field">
            From step
            <input type="number" min={1} max={scope.to + 1} value={scope.from + 1} onChange={(e) => onChange({ ...scope, from: Math.max(0, Math.min(scope.to, Number(e.target.value) - 1)) })} />
          </label>
          <label className="field">
            to
            <input type="number" min={scope.from + 1} max={16} value={scope.to + 1} onChange={(e) => onChange({ ...scope, to: Math.max(scope.from, Math.min(15, Number(e.target.value) - 1)) })} />
          </label>
        </div>
      )}
    </section>
  );
}

interface ShapeEditorProps {
  readonly mod: Mod;
  readonly project: Project;
  readonly onChange: (patch: Partial<Omit<Mod, 'id'>>, key?: string) => void;
  readonly onCommit: () => void;
}

function ShapeEditor({ mod, project, onChange, onCommit }: ShapeEditorProps) {
  const { shape, target } = mod;
  const picks = PICKS.has(target);
  const shownValues = shape.kind === 'list' || shape.kind === 'cycle' ? formatValues(mod, shape.values, project) : '';
  const [text, setText] = useState(shownValues);
  const [problem, setProblem] = useState<string | null>(null);
  // Follow the mod when it changes from elsewhere (another mod, undo).
  useEffect(() => {
    setText(shownValues);
    setProblem(null);
  }, [mod.id, shownValues]);

  const commitText = (value: string) => {
    setText(value);
    const parsed = parseValues(target, value, project);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    if (shape.kind === 'list' || shape.kind === 'cycle') {
      onChange({ shape: { kind: shape.kind, values: parsed.values }, ...(target === 'sourceLoop' ? { sources: parsed.sources } : {}) }, `mod:${mod.id}:values`);
    }
  };

  const setKind = (kind: ModShape['kind']) => {
    const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : [];
    const range = target === 'sourceLoop' ? { min: 0, max: Math.max(0, mod.sources.length - 1) } : target === 'direction' ? { min: 0, max: 1 } : { min: 1, max: 4 };
    const next: ModShape =
      kind === 'list' || kind === 'cycle'
        ? { kind, values }
        : kind === 'ramp'
          ? { kind, from: 0, to: 12 }
          : { kind, ...range, chance: 50 };
    onChange({ shape: next });
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
          if (Number.isFinite(v)) onChange({ shape: apply(v) }, `mod:${mod.id}:${label}`);
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
                defaultValue={formatValues(mod, mod.sources.map((_, i) => i), project)}
                onBlur={(e) => {
                  const parsed = parseValues('sourceLoop', e.target.value, project);
                  if (parsed.ok) onChange({ sources: parsed.sources, shape: { ...shape, min: 0, max: Math.max(0, parsed.sources.length - 1) } });
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
