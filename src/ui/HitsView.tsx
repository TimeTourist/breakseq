import { useState } from 'react';
import type { Hit, HitDist, HitFilter, HitStretch, Id, Pad, Project, StretchMode } from '../model';
import {
  addPadMember,
  addVariant,
  MAX_CUTOFF,
  MAX_GRAIN,
  MIN_CUTOFF,
  MIN_GRAIN,
  baseName,
  hitStretch,
  createPad,
  isParentHit,
  isParentPad,
  movePadMember,
  parentHit,
  remove,
  removePadMember,
  sampleAudio,
  renamePad,
  setPadChoice,
  PAD_CHOICES,
  setHitSource,
  sliceWindow,
  slotHeard,
  updateHit,
} from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import type { Selection } from './store';
import { PlayMode } from './AuditionPlayhead';
import { PlayIcon } from './icons';
import { CHOICE_LABEL, DIST_MODES, FILTER_TYPES, HIT_COLOR, hitUsages, padGroups, padLabel, padUsages, replacedBy } from './labels';
import { Slider } from './Slider';
import { Waveform } from './Waveform';

/** A stretch factor as it reads: 2×, 0.5×, 1.33×. */
const formatFactor = (f: number) => `${Math.round(f * 100) / 100}×`;
/** A pan as it reads: L 50, C, R 100. */
const panText = (pan: number) => (Math.round(pan * 100) === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'} ${Math.abs(Math.round(pan * 100))}`);
/** A frequency as it reads: 200 Hz, 2.5 kHz. */
const formatHz = (hz: number) => (hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${Math.round(hz)} Hz`);

/** A hit being dragged: from the list on the left, or within a pad. */
export const HIT_MIME = 'application/x-breakseq-hit';

const ms = (seconds: number) => Math.round(seconds * 1000);
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v} ${unit}`;

/** The pad open in Hits: the selected one, else one the selected hit is in, else the first. */
function currentPad(project: Project, padId: Id | null, hitId: Id | null): Pad | undefined {
  const selected = padId === null ? undefined : project.pads[padId];
  if (selected !== undefined && !isParentPad(project, selected)) return selected;
  const pads = Object.values(project.pads).filter((p) => !isParentPad(project, p));
  return (hitId === null ? undefined : pads.find((p) => p.members.includes(hitId))) ?? padGroups(project)[0]?.items[0];
}

/**
 * What is open in Hits. A parent is edited on its own, with no pad. Otherwise
 * the open pad, and the hit picked in it; with none picked, Play plays the
 * pad's choice and its first hit is the one edited.
 */
export function hitsOpen(project: Project, selection: Pick<Selection, 'pad' | 'hit'>): { pad: Pad | undefined; hit: Hit | undefined; picked: boolean; parent: boolean } {
  const selectedHit = selection.hit === null ? undefined : project.hits[selection.hit];
  if (selectedHit !== undefined && isParentHit(project, selectedHit)) return { pad: undefined, hit: selectedHit, picked: true, parent: true };
  const pad = currentPad(project, selection.pad, selection.hit);
  const picked = selectedHit !== undefined && pad?.members.includes(selectedHit.id) === true;
  return { pad, hit: picked ? selectedHit : project.hits[pad?.members[0] ?? ''], picked, parent: false };
}

/**
 * Breaks, their pads and the hits in each, in one place. On the left each break
 * with its parent as heading and its pads in order, then one-shots and pads
 * built by hand. On the right the open pad's hits, and the hit being edited.
 */
export function HitsView() {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { pad, hit, picked, parent: parentOpen } = hitsOpen(project, selection);
  const hitsLoop = useSelect((s) => s.hitsLoop);
  const folded = useSelect((s) => s.folded);
  const playing = parentOpen
    ? `${project.breaks[hit?.breakId ?? '']?.name ?? 'the break'} as laid out, with its pads`
    : picked
      ? (hit?.name ?? '')
      : pad === undefined
        ? 'nothing'
        : `pad ${pad.name}, as it picks (${CHOICE_LABEL[pad.choice]})`;
  const groups = padGroups(project);
  /** Slot pads past their break's last slice: they play nothing until it has more. */
  const silent = new Set(Object.values(project.breaks).flatMap((b) => b.pads.filter((_, slot) => !slotHeard(b, slot))));
  const [replacing, setReplacing] = useState(false);

  const newPad = () => {
    const before = store.getState().history.present.pads;
    const name = `Pad ${Object.values(project.pads).filter((p) => !p.auto).length + 1}`;
    if (run(createPad(name)) === null) {
      const id = Object.keys(store.getState().history.present.pads).find((k) => !(k in before));
      if (id !== undefined) open({ pad: id, hit: null }, 'hits');
    }
  };

  /** The breaks whose pads fold: those with a parent. */
  const foldable = groups.flatMap((g) => (g.breakId !== undefined && project.breaks[g.breakId]?.parent != null ? [g.breakId] : []));
  const allOpen = foldable.every((id) => !folded.includes(id));
  const sidebar = (
    <aside className="sidebar" aria-label="Breaks and pads">
      {foldable.length > 0 && (
        <div className="row spread">
          <h2 className="label">Breaks</h2>
          <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'fold', breakIds: foldable, folded: allOpen })}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      {groups.map((group) => {
        const parentId = group.breakId === undefined ? null : (project.breaks[group.breakId]?.parent ?? null);
        const parent = parentId === null ? undefined : project.hits[parentId];
        return (
          <section key={group.breakId ?? group.name} className="stack-tight">
            {parent !== undefined ? (
              <div className="row nowrap fold-head">
              <button
                type="button"
                className="icon-button small fold"
                aria-expanded={!folded.includes(group.breakId ?? '')}
                aria-label={`${folded.includes(group.breakId ?? '') ? 'Show' : 'Hide'} the pads of ${group.name}`}
                onClick={() => store.dispatch({ type: 'fold', breakIds: [group.breakId ?? ''], folded: !folded.includes(group.breakId ?? '') })}
              >
                {folded.includes(group.breakId ?? '') ? '▸' : '▾'}
              </button>
              <button
                type="button"
                className="list-item break-head grow"
                aria-current={hit?.id === parent.id ? 'true' : undefined}
                title="The break's own hit: its pitch, volume and direction apply to every slice"
                onClick={() => open({ hit: parent.id, pad: null }, 'hits')}
              >
                <span className="label grow ellipsis">{group.name}</span>
                <span className="badge">parent</span>
              </button>
              </div>
            ) : (
              <h2 className="label">{group.name}</h2>
            )}
            {!folded.includes(group.breakId ?? '') && group.items.map((p) => (
              <div key={p.id} className={`pad-row${p.id === pad?.id ? ' current' : ''}${silent.has(p.id) ? ' silent' : ''}`} title={silent.has(p.id) ? 'Silent: the break has fewer slices than this slot' : undefined}>
                <button type="button" className="pad-row-name mono" aria-label={`Pad ${p.name}`} onClick={() => open({ pad: p.id, hit: null }, 'hits')}>
                  {padLabel(p)}
                </button>
                {p.members.map((m, i) => {
                  const h = project.hits[m];
                  const by = h === undefined ? null : replacedBy(project, p.id, h);
                  return h === undefined ? null : (
                    <button
                      key={m}
                      type="button"
                      className={`hit-chip mono${i === 0 ? ' first' : ''}${by !== null ? ' replaced' : ''}${p.id === pad?.id && picked && m === hit?.id ? ' current' : ''}`}
                      title={`${h.name}${by !== null ? ` · plays ${by} instead` : ''}${i === 0 && p.choice === 'top' ? ' · plays by default' : ''} · drag onto a pad to add it there`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(HIT_MIME, m);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => open({ pad: p.id, hit: m }, 'hits')}
                    >
                      {baseName(h.name).replace(/^.*\s(\d+)$/, '$1')}
                      {by !== null && `→${by}`}
                      {h.direction === 'reverse' ? ' ◂' : ''}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
      <button type="button" className="dashed" onClick={newPad}>
        + New pad
      </button>
    </aside>
  );

  if (hit === undefined && pad === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Hits</h1>
            <p className="muted">No hits yet. Every imported sample gets one, in a pad of its own.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        <div className="row hits-play">
          <PlayMode loop={hitsLoop} onChange={(loop) => store.dispatch({ type: 'hitsLoop', loop })} />
          <span className="muted small ellipsis">Play (Space) plays {playing}</span>
        </div>
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pad !== undefined && padPanel(pad, hit?.id ?? null)}
        {hit !== undefined && hitEditor(hit)}
        {hit === undefined && pad !== undefined && <p className="muted">This pad has no hits yet. Add one above.</p>}
      </main>
    </div>
  );

  /**
   * The open pad: its name, its hits in order (the first plays by default), and
   * adding more. A plain function, not a component, so its inputs keep focus.
   */
  function padPanel(pad: Pad, hitId: Id | null) {
    const onError = setError;
    const usages = padUsages(project, pad.id);
    const query = search.trim().toLowerCase();
    const available = Object.values(project.hits).filter(
      (h) => !pad.members.includes(h.id) && !isParentHit(project, h) && (query === '' || h.name.toLowerCase().includes(query)),
    );
    const move = (id: Id, to: number) => onError(run(movePadMember(pad.id, id, to)));
    const add = (id: Id) => onError(run(addPadMember(pad.id, id)));
    return (
      <section className="panel stack" aria-label="Pad">
        <div className="row">
          <label className="sr-only" htmlFor="pad-name">
            Pad name
          </label>
          <input
            id="pad-name"
            className="title-input mono"
            value={pad.name}
            onChange={(e) => onError(run(renamePad(pad.id, e.target.value), `pad:${pad.id}:name`))}
            onBlur={seal}
          />
          <span className="muted small">A step lock goes first, then a mod, then the pad's own choice.</span>
          <div className="row push">
            <button
              type="button"
              className="icon-button"
              aria-label="Preview pad"
              disabled={pad.members.length === 0}
              onClick={() => pad.members[0] !== undefined && services.player.playHit(project, pad.members[0])}
            >
              <PlayIcon />
            </button>
            <button
              type="button"
              disabled={usages.length > 0}
              title={usages.length > 0 ? 'In use: take it out of its loops first' : undefined}
              onClick={() => {
                const failed = run(remove('pad', pad.id));
                if (failed === null) open({ pad: null, hit: null }, 'hits');
                else onError(failed);
              }}
            >
              Delete pad
            </button>
          </div>
        </div>

        <div className="row">
          <span className="label">Pad plays</span>
          <div className="segmented" role="group" aria-label="Pad plays">
            {PAD_CHOICES.map((c) => (
              <button key={c} type="button" aria-pressed={pad.choice === c} onClick={() => onError(run(setPadChoice(pad.id, c)))}>
                {CHOICE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <ol
          className="members"
          aria-label="Hits in this pad"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(HIT_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            const dragged = e.dataTransfer.getData(HIT_MIME);
            if (dragged === '') return;
            e.preventDefault();
            if (pad.members.includes(dragged)) return;
            add(dragged);
          }}
        >
          {pad.members.map((id, i) => {
            const h = project.hits[id];
            if (h === undefined) return null;
            return (
              <li
                key={id}
                className={`member${i === 0 ? ' first' : ''}${id === hitId ? ' current' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(HIT_MIME, id)}
                onDrop={(e) => {
                  const dragged = e.dataTransfer.getData(HIT_MIME);
                  if (dragged === '' || !pad.members.includes(dragged)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  move(dragged, i);
                }}
              >
                <span className="member-num mono">{i + 1}</span>
                <button type="button" className="link-text mono grow ellipsis" aria-current={id === hitId ? 'true' : undefined} onClick={() => open({ pad: pad.id, hit: id }, 'hits')}>
                  {baseName(h.name)}
                </button>
                <span className="muted small">{i === 0 && pad.choice === 'top' ? 'default' : ''}</span>
                <button type="button" className="icon-button small" aria-label={`Play ${h.name}`} onClick={() => services.player.playHit(project, id)}>
                  <PlayIcon />
                </button>
                <button type="button" className="icon-button small" aria-label={`Move ${h.name} up`} disabled={i === 0} onClick={() => move(id, i - 1)}>
                  ↑
                </button>
                <button type="button" className="icon-button small" aria-label={`Move ${h.name} down`} disabled={i === pad.members.length - 1} onClick={() => move(id, i + 1)}>
                  ↓
                </button>
                <button type="button" className="icon-button small" aria-label={`Remove ${h.name} from pad`} onClick={() => onError(run(removePadMember(pad.id, id)))}>
                  ×
                </button>
              </li>
            );
          })}
        </ol>

        <details className="add-hits">
          <summary>+ Hit · or drag one from the left onto the list</summary>
          <input type="search" placeholder="Search hits" aria-label="Search hits" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="add-list">
            {available.slice(0, 200).map((h) => (
              <div key={h.id} className="add-row">
                <span className="mono grow ellipsis">{baseName(h.name)}</span>
                <button type="button" aria-label={`Add ${h.name} to pad`} onClick={() => add(h.id)}>
                  Add
                </button>
              </div>
            ))}
            {available.length === 0 && <p className="muted small">No hits to add.</p>}
          </div>
        </details>

        <div className="row">
          <span className="label">Used in</span>
          {usages.length === 0 ? (
            <span className="muted small">No loops</span>
          ) : (
            usages.map(({ loop, steps }) => (
              <button key={loop.id} type="button" className="link-chip mono" onClick={() => open({ loop: loop.id, step: null }, 'loops')}>
                {loop.name} · {steps} {steps === 1 ? 'step' : 'steps'}
              </button>
            ))
          )}
        </div>
      </section>
    );
  }

  /**
   * Which slice a hit plays: another slot of its break, or of another break or
   * one-shot. Its pitch, volume, fade and direction stay.
   */
  function replacePanel(hit: Hit) {
    const breaks = Object.values(project.breaks);
    const brk = project.breaks[hit.breakId];
    const slots = brk === undefined ? 0 : brk.bars === null ? 1 : Math.max(brk.markers.length, brk.pads.length);
    return (
      <section className="panel row" aria-label="Replace">
        <span className="muted">Plays</span>
        <select
          aria-label="Break the hit plays"
          value={hit.breakId}
          onChange={(e) => {
            const next = project.breaks[e.target.value];
            if (next !== undefined) setError(run(setHitSource(hit.id, next.id, next.bars === null ? 0 : Math.min(hit.slot ?? 0, next.markers.length - 1))));
          }}
        >
          {breaks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bars === null ? `${b.name} (one-shot)` : b.name}
            </option>
          ))}
        </select>
        {brk !== undefined && brk.bars !== null && (
          <select
            aria-label="Slot the hit plays"
            value={hit.slot === null ? 'whole' : String(hit.slot)}
            onChange={(e) => setError(run(setHitSource(hit.id, brk.id, e.target.value === 'whole' ? null : Number(e.target.value))))}
          >
            {Array.from({ length: slots }, (_, i) => (
              <option key={i} value={i}>
                Slot {String(i + 1).padStart(2, '0')}
                {i >= brk.markers.length ? ' (silent)' : ''}
              </option>
            ))}
            <option value="whole">The whole break</option>
          </select>
        )}
        <span className="muted small">Pitch, volume, fade and direction stay.</span>
      </section>
    );
  }

  /**
   * Stretch: Off, Fit to tempo or a factor, the grain length and where the
   * grains start. A slice without a grain length or grid of its own takes its
   * parent's, and its factor is multiplied by the parent's.
   */
  function stretchPanel(hit: Hit, parent: Hit | undefined, oneShot: boolean) {
    const stretch = hit.stretch;
    const set = (patch: Partial<HitStretch>, field: string) => setError(run(updateHit(hit.id, { stretch: { ...stretch, ...patch } }), `hit:${hit.id}:stretch:${field}`));
    const played = hitStretch(project, hit);
    const modes: [StretchMode, string][] = [
      ['off', 'Off'],
      ['fit', 'Fit to tempo'],
      ['factor', 'Factor'],
    ];
    const inherited = parent === undefined ? 'default' : 'parent';
    return (
      <div className="panel stack-tight" aria-label="Stretch" role="group">
        <div className="row spread">
          <span className="label">Stretch</span>
          <span className="muted small mono">
            {played.factor === 1 ? 'plays as it is' : `plays ${formatFactor(played.factor)}${parent !== undefined ? ' with the parent' : ''}`}
          </span>
        </div>
        <div className="segmented full" role="group" aria-label="Stretch mode">
          {modes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={stretch.mode === mode}
              disabled={mode === 'fit' && oneShot}
              title={mode === 'fit' && oneShot ? 'A one-shot has no tempo to fit' : undefined}
              onClick={() => set({ mode }, 'mode')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="slider-grid">
          {stretch.mode === 'factor' && (
            <Slider
              label="Factor"
              value={Math.log2(stretch.factor)}
              min={-4}
              max={4}
              step={1 / 12}
              format={(v) => formatFactor(2 ** v)}
              onChange={(v) => set({ factor: 2 ** v }, 'factor')}
              onCommit={seal}
            />
          )}
          <Slider
            label="Grain"
            value={stretch.grain ?? played.grain}
            min={MIN_GRAIN}
            max={MAX_GRAIN}
            step={1}
            format={(v) => `${v} ms${stretch.grain === null ? ` (${inherited})` : ''}`}
            onChange={(v) => set({ grain: v }, 'grain')}
            onCommit={seal}
          />
        </div>
        <div className="row">
          <span className="label">Grains from</span>
          <div className="segmented" role="group" aria-label="Grains from">
            {parent !== undefined && (
              <button type="button" aria-pressed={stretch.from === null} onClick={() => set({ from: null }, 'from')}>
                Parent
              </button>
            )}
            {(['break', 'hit'] as const).map((from) => (
              <button
                key={from}
                type="button"
                aria-pressed={stretch.from === from || (parent === undefined && stretch.from === null && from === 'break')}
                title={from === 'break' ? 'A grid from the start of the break, like a sampler stretching the whole break' : 'Grains start with the hit, for clean attacks'}
                onClick={() => set({ from }, 'from')}
              >
                {from === 'break' ? 'Break' : 'Hit'}
              </button>
            ))}
          </div>
          {stretch.grain !== null && (
            <button type="button" className="link-text small push" onClick={() => set({ grain: null }, 'grain')}>
              Grain from {inherited}
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * Dist, then filter. Off on a slice takes its parent's, which is shown
   * beside it; dist keeps the level as it was.
   */
  function colourPanel(hit: Hit, parent: Hit | undefined) {
    const setDist = (patch: Partial<HitDist>, field: string) => setError(run(updateHit(hit.id, { dist: { ...hit.dist, ...patch } }), `hit:${hit.id}:dist:${field}`));
    const setFilter = (patch: Partial<HitFilter>, field: string) => setError(run(updateHit(hit.id, { filter: { ...hit.filter, ...patch } }), `hit:${hit.id}:filter:${field}`));
    const fromParent = (on: boolean, what: string) => (parent !== undefined && !on ? <span className="muted small">{what}</span> : null);
    const parentDist = parent?.dist.mode === 'off' || parent === undefined ? 'parent: none' : `parent: ${DIST_MODES.find(([m]) => m === parent.dist.mode)?.[1]} ${Math.round(parent.dist.amount * 100)}%`;
    const parentFilter =
      parent?.filter.type === 'off' || parent === undefined ? 'parent: none' : `parent: ${FILTER_TYPES.find(([t]) => t === parent.filter.type)?.[1]} ${formatHz(parent.filter.cutoff)}`;
    return (
      <div className="slider-grid">
        <div className="panel stack-tight" role="group" aria-label="Dist">
          <div className="row spread">
            <span className="label">Dist</span>
            {fromParent(hit.dist.mode !== 'off', parentDist)}
          </div>
          <div className="segmented full" role="group" aria-label="Dist mode">
            <button type="button" aria-pressed={hit.dist.mode === 'off'} onClick={() => setDist({ mode: 'off' }, 'mode')}>
              Off
            </button>
            {DIST_MODES.map(([mode, label]) => (
              <button key={mode} type="button" aria-pressed={hit.dist.mode === mode} onClick={() => setDist({ mode }, 'mode')}>
                {label}
              </button>
            ))}
          </div>
          {hit.dist.mode !== 'off' && (
            <Slider label="Amount" value={hit.dist.amount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setDist({ amount: v }, 'amount')} onCommit={seal} />
          )}
        </div>
        <div className="panel stack-tight" role="group" aria-label="Filter">
          <div className="row spread">
            <span className="label">Filter</span>
            {fromParent(hit.filter.type !== 'off', parentFilter)}
          </div>
          <div className="segmented full" role="group" aria-label="Filter type">
            <button type="button" aria-pressed={hit.filter.type === 'off'} onClick={() => setFilter({ type: 'off' }, 'type')}>
              Off
            </button>
            {FILTER_TYPES.map(([type, label]) => (
              <button key={type} type="button" aria-pressed={hit.filter.type === type} onClick={() => setFilter({ type }, 'type')}>
                {label}
              </button>
            ))}
          </div>
          {hit.filter.type !== 'off' && (
            <>
              <Slider
                label="Cutoff"
                value={Math.log10(hit.filter.cutoff)}
                min={Math.log10(MIN_CUTOFF)}
                max={Math.log10(MAX_CUTOFF)}
                step={0.01}
                format={(v) => formatHz(10 ** v)}
                onChange={(v) => setFilter({ cutoff: Math.round(10 ** v) }, 'cutoff')}
                onCommit={seal}
              />
              <Slider label="Resonance" value={hit.filter.resonance} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ resonance: v }, 'resonance')} onCommit={seal} />
            </>
          )}
        </div>
      </div>
    );
  }

  /** How the selected hit plays: region, direction, pitch, volume and fade. */
  function hitEditor(hit: Hit) {
    const onError = setError;
    const brk = project.breaks[hit.breakId];
    const sample = brk === undefined ? undefined : project.samples[brk.sampleId];
    const audio = sample === undefined ? undefined : sampleAudio(project, sample);
    const usages = hitUsages(project, hit.id);
    const source = hit.variantOf === null ? undefined : project.hits[hit.variantOf];
    const edit = (patch: Partial<Omit<Hit, 'id' | 'breakId' | 'slot'>>, field: string) => onError(run(updateHit(hit.id, patch), `hit:${hit.id}:${field}`));
    // The slice the hit plays, in seconds of its sample; the region is a part of it.
    const window = brk === undefined ? null : sliceWindow(project, brk, hit.slot);
    const duration = window === null ? 0 : window.end - window.start;
    const region = { start: hit.region.start * duration, end: hit.region.end * duration };
    const toPart = (seconds: number) => (duration > 0 ? seconds / duration : 0);
    const what =
      brk === undefined
        ? 'a missing break'
        : hit.slot === null
          ? `all of ${brk.name}`
          : brk.bars === null
            ? brk.name
            : `slot ${String(hit.slot + 1).padStart(2, '0')} of ${brk.name}`;
    const parent = parentHit(project, hit);
    // A parent stands for the break's slices: as many as it has markers.
    const children = isParentHit(project, hit) ? (brk?.markers.length ?? 0) : 0;
    /** A slice's own value, and what it plays at with its parent's added. */
    const withParent = (own: number, inherited: number | undefined, unit: string) =>
      inherited === undefined || inherited === 0 ? signed(own, unit) : `${signed(own, unit)} · plays ${signed(own + inherited, unit)}`;
    return (
      <section className="stack" aria-label="Hit">
        <div className="view-head row">
          <div className="stack-tight grow">
            <label className="sr-only" htmlFor="hit-name">
              Hit name
            </label>
            <input id="hit-name" className="title-input mono" value={hit.name} onChange={(e) => edit({ name: e.target.value }, 'name')} onBlur={seal} />
            <p className="muted">
              {source === undefined ? `Plays ${what}` : `Variant of ${source.name}, plays ${what}`}
              {window === null && brk !== undefined && ` · silent: ${brk.name} has ${brk.markers.length} slices`}
              {children > 0 && ` · parent: its pitch, volume and direction apply to all ${children} slices`}
              {parent !== undefined && ` · slice of ${baseName(parent.name)}, which adds its pitch and volume`}
            </p>
          </div>
          <div className="row push">
            <button type="button" className="icon-button" aria-label="Preview hit" onClick={() => services.player.playHit(project, hit.id)}>
              <PlayIcon />
            </button>
            {!isParentHit(project, hit) && (
              <button type="button" aria-expanded={replacing} onClick={() => setReplacing(!replacing)}>
                Replace…
              </button>
            )}
            {children === 0 && (
              <button
                type="button"
                title="A copy of this hit in the same pad, to change: reversed, pitched, shorter"
                onClick={() => {
                  const before = store.getState().history.present.hits;
                  if (run(addVariant(hit.id, `${hit.name} var`)) === null) {
                    const copy = Object.keys(store.getState().history.present.hits).find((id) => !(id in before));
                    if (copy !== undefined) open({ hit: copy }, 'hits');
                  }
                }}
              >
                Variant
              </button>
            )}
            <button
              type="button"
              disabled={usages.length > 0}
              title={usages.length > 0 ? 'In use: remove it from its pads first' : undefined}
              onClick={() => {
                const failed = run(remove('hit', hit.id));
                if (failed === null) open({ hit: null }, 'hits');
                else onError(failed);
              }}
            >
              Delete hit
            </button>
          </div>
        </div>

        {replacing && !isParentHit(project, hit) && replacePanel(hit)}

        {audio !== undefined && sample !== undefined && window !== null && duration > 0 && (
          <div className="panel wave-panel">
            <div className="row spread mono small muted">
              <span>
                Region {ms(region.start)}–{ms(region.end)} ms of {ms(duration)} ms
              </span>
              {hit.direction === 'reverse' && <span>plays reversed</span>}
            </div>
            <div className="wave-region">
              <Waveform audio={audio} offset={sample.offset + window.start} duration={duration} height={180} color={HIT_COLOR} />
              <div className="region-shade" style={{ left: 0, width: `${hit.region.start * 100}%` }} />
              <div className="region-shade" style={{ left: `${hit.region.end * 100}%`, right: 0 }} />
              {/* The parent shows where its slices are; a double-click edits one in Slice, where markers are moved. */}
              {isParentHit(project, hit) &&
                brk !== undefined &&
                brk.markers.map((m, i) => {
                  const toSlice = () => {
                    store.dispatch({ type: 'sliceTarget', breakId: brk.id, slice: i });
                    store.dispatch({ type: 'view', view: 'slice' });
                  };
                  return (
                    <button
                      key={i}
                      type="button"
                      className="slice-line"
                      style={{ left: `${m * 100}%` }}
                      aria-label={`Slice ${String(i + 1).padStart(2, '0')}: double-click to edit in Slice`}
                      title="Double-click to edit in Slice"
                      onDoubleClick={toSlice}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') toSlice();
                      }}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        <div className="slider-grid">
          <Slider
            label="Region start"
            value={ms(region.start)}
            min={0}
            max={ms(duration)}
            step={1}
            format={(v) => `${v} ms`}
            onChange={(v) => edit({ region: { start: Math.min(toPart(v / 1000), hit.region.end - toPart(0.001)), end: hit.region.end } }, 'start')}
            onCommit={seal}
          />
          <Slider
            label="Region end"
            value={ms(region.end)}
            min={0}
            max={ms(duration)}
            step={1}
            format={(v) => `${v} ms`}
            onChange={(v) => edit({ region: { start: hit.region.start, end: Math.max(toPart(v / 1000), hit.region.start + toPart(0.001)) } }, 'end')}
            onCommit={seal}
          />
          <div className="panel stack-tight">
            <span className="label">Direction</span>
            <div className="segmented full" role="group" aria-label="Direction">
              <button type="button" aria-pressed={hit.direction === 'forward'} onClick={() => edit({ direction: 'forward' }, 'direction')}>
                Forward
              </button>
              <button type="button" aria-pressed={hit.direction === 'reverse'} onClick={() => edit({ direction: 'reverse' }, 'direction')}>
                Reverse
              </button>
            </div>
          </div>
          <Slider label="Pitch" value={hit.pitch} min={-24} max={24} step={1} format={(v) => withParent(v, parent?.pitch, 'st')} onChange={(v) => edit({ pitch: v }, 'pitch')} onCommit={seal} />
          <Slider label="Volume" value={hit.volume} min={-24} max={6} step={0.5} format={(v) => withParent(v, parent?.volume, 'dB')} onChange={(v) => edit({ volume: v }, 'volume')} onCommit={seal} />
          <Slider
            label="Pan"
            value={Math.round(hit.pan * 100)}
            min={-100}
            max={100}
            step={1}
            format={(v) => panText(v / 100) + (parent !== undefined && parent.pan !== 0 ? ` · parent ${panText(parent.pan)}` : '')}
            onChange={(v) => edit({ pan: v / 100 }, 'pan')}
            onCommit={seal}
          />
          <Slider label="Fade out" value={hit.fadeOut} min={0} max={200} step={1} format={(v) => `${v} ms`} onChange={(v) => edit({ fadeOut: v }, 'fade')} onCommit={seal} />
        </div>
        {stretchPanel(hit, parent, brk?.bars === null)}
        {colourPanel(hit, parent)}
      </section>
    );
  }
}
