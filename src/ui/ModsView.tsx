import { useState } from 'react';
import { blockPasses } from '../engine';
import type { EffectTarget, Id, Mod, ModEffect, Project, SwapEffect, TempoEffect } from '../model';
import {
  DEFAULT_HALFTIME,
  addEffect,
  cloneMod,
  createMod,
  hitStretch,
  isStepEffect,
  newStepEffect,
  removeEffect,
  renameMod,
  replaceEffect,
  rerollMod,
  stepDuration,
} from '../model';
import { Delete } from './DeleteButton';
import { InSongMark, useHeard } from './InSong';
import { LaneCard } from './LaneCard';
import { HalftimeCard, SwapCard, TapeCard, TempoCard } from './ModCards';
import { ADD_ORDER, TARGET_LABELS } from './modLabels';
import type { PassPlace } from './ModPreview';
import { ModPreview } from './ModPreview';
import { DEFAULT_TAPE, MOD_PRESETS } from './modPresets';
import { RenameInPlace } from './RenameInPlace';
import { RerollButton } from './RerollButton';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import type { Selection } from './store';

/** The mod open in Mods: the selected one, else the first. */
export function currentModId(project: Project, selection: Selection): Id | null {
  if (selection.mod !== null && project.mods[selection.mod] !== undefined) return selection.mod;
  return Object.keys(project.mods)[0] ?? null;
}

/** The loop a mod is tried on (Plays on): the chosen one, else the first main. */
export function previewLoopId(project: Project, selection: Selection): Id | null {
  if (selection.previewLoop !== null && project.loops[selection.previewLoop] !== undefined) return selection.previewLoop;
  const loops = Object.values(project.loops);
  return (loops.find((l) => l.kind === 'main') ?? loops[0])?.id ?? null;
}

/** Swap from the stack, at random, step by step. */
const NEW_SWAP: SwapEffect = { target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } };
/** Slip at a third of the tempo over each bar. */
const NEW_TEMPO: TempoEffect = { target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } };

const newEffect = (target: EffectTarget): ModEffect =>
  target === 'tape' ? DEFAULT_TAPE : target === 'swap' ? NEW_SWAP : target === 'tempo' ? NEW_TEMPO : target === 'halftime' ? DEFAULT_HALFTIME : newStepEffect(target);

/** A mod's effects in short: "Pitch · Ratchet". */
export const effectsLabel = (mod: Mod) => (mod.effects.length === 0 ? 'no effects' : mod.effects.map((e) => TARGET_LABELS[e.target]).join(' · '));
const effectCount = (mod: Mod) => `${mod.effects.length} ${mod.effects.length === 1 ? 'effect' : 'effects'}`;

/** Where Play is, while it plays in Mods: seconds into the block playing, and the block. */
export interface ModsPlayback {
  readonly seconds: number;
  readonly block: number;
}

/**
 * Mods (see Stegrader och fliken Mods): the list with Start from on the left;
 * the mod on the right, its effects as cards one under another, + Add effect,
 * and the preview on the loop under Plays on.
 */
export function ModsView({ playback = null }: { readonly playback?: ModsPlayback | null }) {
  const project = useProject();
  const { store } = useApp();
  const heard = useHeard();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  const modId = currentModId(project, selection);
  const mod = modId === null ? undefined : project.mods[modId];
  const previewId = previewLoopId(project, selection);

  /** Runs a command that makes a mod, and opens the new mod. */
  const runAndOpen = (command: Parameters<typeof run>[0]) => {
    const before = store.getState().history.present.mods;
    const failed = run(command);
    setError(failed);
    if (failed === null) {
      const id = Object.keys(store.getState().history.present.mods).find((k) => !(k in before));
      if (id !== undefined) open({ mod: id }, 'mods');
    }
  };
  const newMod = (name: string | null, effects: readonly ModEffect[]) => runAndOpen(createMod(name ?? `Mod ${Object.keys(project.mods).length + 1}`, effects));

  const sidebar = (
    <aside className="sidebar narrow mods-sidebar" aria-label="Mods">
      <section className="stack-tight">
        <h2 className="label">Mods</h2>
        <button type="button" className="dashed" title="An empty mod, selected: it does nothing until you add an effect" onClick={() => newMod(null, [])}>
          + New mod
        </button>
        {Object.values(project.mods).map((m) => (
          <button key={m.id} type="button" className="list-item" aria-current={m.id === modId ? 'true' : undefined} onClick={() => open({ mod: m.id }, 'mods')}>
            <span className="mono mod-name grow ellipsis" title={m.name}>
              {m.name}
            </span>
            <span className="muted small">{effectCount(m)}</span>
            <InSongMark heard={heard.mods.has(m.id)} />
          </button>
        ))}
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
      <p className="muted small">Click a mod to edit it and hear it on the loop under Plays on.</p>
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

  const taken = new Set(mod.effects.map((e) => e.target));
  const change = (target: EffectTarget) => (next: ModEffect, key?: string) =>
    setError(run(replaceEffect(mod.id, target, next), key === undefined ? undefined : `mod:${mod.id}:${target}:${key}`));
  const remove = (target: EffectTarget) => () => setError(run(removeEffect(mod.id, target)));

  const loop = previewId === null ? undefined : project.loops[previewId];
  const loopPads = (loop?.steps ?? []).flatMap((s) => (s.padId === null ? [] : [project.pads[s.padId]])).filter((p) => p !== undefined);
  const members = { count: Math.max(1, ...loopPads.map((p) => p.members.length)), loop: loop?.name ?? null };
  const ownStretch = loopPads.some((p) => p.members.some((h) => project.hits[h] !== undefined && hitStretch(project, project.hits[h]).factor !== 1));
  const stretchUnheard = loop === undefined || ownStretch ? null : `No hit in ${loop.name} has its own stretch: Multiply and Replace sound the same`;

  // Which pass Play is in: the block's passes, each the loop once (see Varv i loop).
  const passSeconds = (loop?.steps.length ?? 0) * stepDuration(project.song.bpm);
  const playing: PassPlace | null =
    playback === null || loop === undefined || passSeconds <= 0
      ? null
      : (() => {
          const perBlock = blockPasses(loop.steps.length);
          const within = Math.min(perBlock - 1, Math.max(0, Math.floor(playback.seconds / passSeconds + 1e-9)));
          const step = Math.max(0, Math.floor((playback.seconds - within * passSeconds) / stepDuration(project.song.bpm) + 1e-9));
          return { pass: playback.block * perBlock + within, step };
        })();

  return (
    <div className="split">
      {sidebar}
      <main className="view mods-view">
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <section className="panel mod-box" aria-label="Mod">
          <div className="box-head">
            <h1 className="mono mod-name mod-title ellipsis" title={mod.name}>
              {mod.name}
            </h1>
            <RenameInPlace key={mod.id} name={mod.name} what="mod" onRename={(name) => run(renameMod(mod.id, name))} onError={setError} />
            <button type="button" title="A copy of the mod, selected" onClick={() => runAndOpen(cloneMod(mod.id))}>
              Clone
            </button>
            <Delete kind="mod" id={mod.id} name={mod.name} onError={setError} icon onDeleted={() => open({ mod: null }, 'mods')} />
            <RerollButton command={rerollMod(mod.id)} label="Reroll this mod" title={`Reroll ${mod.name}: its dice steps roll new values everywhere it plays.`} onError={setError} />
            <span className="muted small mono push">{effectCount(mod)}</span>
          </div>
          <div className="mod-cards">
            {mod.effects.length === 0 && <p className="mod-empty">No effects yet: the mod does nothing. Add one below.</p>}
            {mod.effects.map((effect) => {
              const common = { onCommit: seal, onRemove: remove(effect.target) };
              if (isStepEffect(effect))
                return (
                  <LaneCard
                    key={`${mod.id}:${effect.target}`}
                    effect={effect}
                    onChange={change(effect.target)}
                    rng={Math.random}
                    members={members}
                    stretchUnheard={stretchUnheard}
                    {...common}
                  />
                );
              if (effect.target === 'swap') return <SwapCard key={`${mod.id}:swap`} effect={effect} onChange={change('swap')} {...common} />;
              if (effect.target === 'tempo') return <TempoCard key={`${mod.id}:tempo`} effect={effect} onChange={change('tempo')} {...common} />;
              if (effect.target === 'halftime') return <HalftimeCard key={`${mod.id}:halftime`} effect={effect} onChange={change('halftime')} {...common} />;
              return <TapeCard key={`${mod.id}:tape`} effect={effect} onChange={change('tape')} {...common} />;
            })}
            <div className="row">
              <select
                aria-label="Add effect"
                className="add-effect"
                value=""
                title="One effect per target"
                onChange={(e) => {
                  const target = e.target.value as EffectTarget | '';
                  if (target !== '') setError(run(addEffect(mod.id, newEffect(target))));
                }}
              >
                <option value="">+ Add effect</option>
                {ADD_ORDER.filter((t) => !taken.has(t)).map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              <span className="muted small">One effect per target.</span>
            </div>
            <p className="muted small">
              Drag up or down on a step to set it; drag across steps to paint them. Hover a step and click 🎲 to make it a dice step (click 🎲 again to fix it): it rolls a new value in its band every pass, with the chance under it. On a dice step a drag moves the nearer edge of its band. After ↻ the lane loops on, faint, as it does over a clip in Song.
            </p>
          </div>
        </section>
        <ModPreview project={project} modId={mod.id} loopId={previewId} playing={playing} onLoop={(id) => open({ previewLoop: id }, 'mods')} />
      </main>
    </div>
  );
}
