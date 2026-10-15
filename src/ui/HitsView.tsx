import { useState } from 'react';
import type { Hit } from '../model';
import { addVariant, baseName, parentHit, remove, updateHit } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { hitColor, hitGroups, hitUsages } from './labels';
import { Slider } from './Slider';
import { PlayIcon } from './TagView';
import { Waveform } from './Waveform';

const ms = (seconds: number) => Math.round(seconds * 1000);
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v} ${unit}`;

export function HitsView() {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selected = useSelect((s) => s.selection.hit);
  const [error, setError] = useState<string | null>(null);
  const groups = hitGroups(project);
  const hit = (selected === null ? undefined : project.hits[selected]) ?? groups[0]?.items[0];

  if (hit === undefined) {
    return (
      <main className="view">
        <div className="view-head">
          <h1>Hits</h1>
          <p className="muted">No hits yet. Every imported sample gets one.</p>
        </div>
      </main>
    );
  }

  const sample = project.samples[hit.sampleId];
  const audio = sample === undefined ? undefined : project.audio[sample.audioId];
  const usages = hitUsages(project, hit.id);
  const source = hit.variantOf === null ? undefined : project.hits[hit.variantOf];
  const edit = (patch: Partial<Omit<Hit, 'id' | 'sampleId'>>, field: string) =>
    setError(run(updateHit(hit.id, patch), `hit:${hit.id}:${field}`));
  const duration = sample?.duration ?? 0;
  const parent = parentHit(project, hit);
  const children = Object.values(project.hits).filter((h) => parentHit(project, h)?.id === hit.id).length;
  /** A slice's own value, and what it plays at with its parent's added. */
  const withParent = (own: number, inherited: number | undefined, unit: string) =>
    inherited === undefined || inherited === 0 ? signed(own, unit) : `${signed(own, unit)} · plays ${signed(own + inherited, unit)}`;

  return (
    <div className="split">
      <aside className="sidebar" aria-label="Hits">
        {groups.map((group) => (
          <section key={group.name} className="stack-tight">
            <h2 className="label">{group.name}</h2>
            {group.items.map((h) => (
              <button
                key={h.id}
                type="button"
                className="list-item"
                aria-current={h.id === hit.id ? 'true' : undefined}
                onClick={() => open({ hit: h.id }, 'hits')}
              >
                <span className="dot" style={{ background: hitColor(project, h.id) }} />
                <span className="mono grow ellipsis">{baseName(h.name)}</span>
                {project.samples[h.sampleId]?.break?.sliced === true && h.variantOf === null && <span className="badge">parent</span>}
                {h.direction === 'reverse' && <span className="muted small">rev</span>}
                {h.pitch !== 0 && <span className="muted small">{signed(h.pitch, 'st')}</span>}
              </button>
            ))}
          </section>
        ))}
      </aside>

      <main className="view">
        <div className="view-head row">
          <div className="stack-tight grow">
            <label className="sr-only" htmlFor="hit-name">
              Hit name
            </label>
            <input
              id="hit-name"
              className="title-input mono"
              value={hit.name}
              onChange={(e) => edit({ name: e.target.value }, 'name')}
              onBlur={seal}
            />
            <p className="muted">
              {source === undefined ? `From ${sample?.name ?? 'a missing sample'}` : `Variant of ${source.name}`}
              {children > 0 && ` · parent: its pitch and volume apply to all ${children} slices`}
              {parent !== undefined && ` · slice of ${baseName(parent.name)}, which adds its pitch and volume`}
            </p>
          </div>
          <div className="row push">
            <button type="button" className="icon-button" aria-label="Preview hit" onClick={() => services.player.playHit(project, hit.id)}>
              <PlayIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                const before = store.getState().history.present.hits;
                if (run(addVariant(hit.id, `${hit.name} var`)) === null) {
                  const copy = Object.keys(store.getState().history.present.hits).find((id) => !(id in before));
                  if (copy !== undefined) open({ hit: copy }, 'hits');
                }
              }}
            >
              Duplicate as variant
            </button>
            <button
              type="button"
              disabled={usages.length > 0}
              title={usages.length > 0 ? 'In use: remove it from its pads first' : undefined}
              onClick={() => {
                const failed = run(remove('hit', hit.id));
                if (failed === null) open({ hit: null }, 'hits');
                else setError(failed);
              }}
            >
              Delete
            </button>
          </div>
        </div>

        {audio !== undefined && sample !== undefined && (
          <div className="panel wave-panel">
            <div className="row spread mono small muted">
              <span>
                Region {ms(hit.region.start)}–{ms(hit.region.end)} ms of {ms(duration)} ms
              </span>
              {hit.direction === 'reverse' && <span style={{ color: hitColor(project, hit.id) }}>plays reversed</span>}
            </div>
            <div className="wave-region">
              <Waveform audio={audio} offset={sample.offset} duration={sample.duration} height={180} color={hitColor(project, hit.id)} />
              <div className="region-shade" style={{ left: 0, width: `${(hit.region.start / duration) * 100}%` }} />
              <div
                className="region-shade"
                style={{ left: `${(hit.region.end / duration) * 100}%`, right: 0 }}
              />
            </div>
          </div>
        )}

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="slider-grid">
          <Slider
            label="Region start"
            value={ms(hit.region.start)}
            min={0}
            max={ms(duration)}
            step={1}
            format={(v) => `${v} ms`}
            onChange={(v) => edit({ region: { start: Math.min(v / 1000, hit.region.end - 0.001), end: hit.region.end } }, 'start')}
            onCommit={seal}
          />
          <Slider
            label="Region end"
            value={ms(hit.region.end)}
            min={0}
            max={ms(duration)}
            step={1}
            format={(v) => `${v} ms`}
            onChange={(v) =>
              edit({ region: { start: hit.region.start, end: Math.max(v / 1000, hit.region.start + 0.001) } }, 'end')
            }
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
          <Slider label="Fade out" value={hit.fadeOut} min={0} max={200} step={1} format={(v) => `${v} ms`} onChange={(v) => edit({ fadeOut: v }, 'fade')} onCommit={seal} />
        </div>

        <section className="panel row">
          <span className="label">Used in</span>
          {usages.length === 0 ? (
            <span className="muted small">No pads</span>
          ) : (
            usages.map(({ pad, member }) => (
              <button key={pad.id} type="button" className="link-chip mono" onClick={() => open({ pad: pad.id }, 'pads')}>
                {pad.name} · member {member}
              </button>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
