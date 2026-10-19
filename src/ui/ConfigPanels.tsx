import type { Config, HitDelay, HitDist, HitFilter, HitReverb, HitStretch, Id, Project, StretchMode } from '../model';
import { DEFAULT_GRAIN, MAX_CUTOFF, MAX_FEEDBACK, MAX_GRAIN, MIN_CUTOFF, MIN_GRAIN, clampStretch, sampleBpm } from '../model';
import { useSeal } from './context';
import { DELAY_TIMES, DIST_MODES, FILTER_TYPES, sizeText } from './labels';
import { Slider } from './Slider';

/** A stretch factor as it reads: 2×, 0.5×, 1.33×. */
export const formatFactor = (f: number) => `${Math.round(f * 100) / 100}×`;
/** A pan as it reads: L 50, C, R 100. */
const panText = (pan: number) => (Math.round(pan * 100) === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'} ${Math.abs(Math.round(pan * 100))}`);
/** A frequency as it reads: 200 Hz, 2.5 kHz. */
const formatHz = (hz: number) => (hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${Math.round(hz)} Hz`);
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v} ${unit}`;

/** A layer of config being edited: a hit's own, a pad's or a matrix's. */
export interface Layer {
  readonly config: Config;
  readonly set: (patch: Partial<Config>, field: string) => void;
  /** The layers laid over it, nearest first: for a hit its pad and matrix, for a pad its matrix. */
  readonly above: readonly { readonly name: 'pad' | 'matrix'; readonly config: Config }[];
  /** Whether Fit to tempo can be chosen: something under it has a tempo. */
  readonly canFit: boolean;
  /** How it is stretched as it plays: a hit with every layer, a pad or matrix by its own. */
  readonly played: { readonly factor: number; readonly grain: number };
}

/** Whether any hit under these pads plays a sample with a tempo, so it can fit to the song's. */
export function anyTempo(project: Project, padIds: readonly Id[]): boolean {
  return padIds.some((p) =>
    (project.pads[p]?.members ?? []).some((h) => {
      const sample = project.samples[project.hits[h]?.sampleId ?? ''];
      return sample !== undefined && sampleBpm(sample) !== null;
    }),
  );
}

/** How a pad's or matrix's own config stretches, with the grain from the nearest layer that has one. */
export function ownStretch(config: Config, above: Layer['above']) {
  return {
    factor: config.stretch.mode === 'factor' ? clampStretch(config.stretch.factor) : 1,
    grain: config.stretch.grain ?? above.find((a) => a.config.stretch.grain !== null)?.config.stretch.grain ?? DEFAULT_GRAIN,
  };
}

/**
 * Direction, pitch, volume, pan and fade, then stretch, colour and space: the
 * same for a hit, a pad and a matrix. Each control shows what comes from the
 * layers above.
 */
export function ConfigPanels({ layer }: { readonly layer: Layer }) {
  const seal = useSeal();
  return configPanels(layer);

  /** The nearest layer above with something for `has`, and its name: "pad", "matrix". */
  function nearestAbove(layer: Layer, has: (c: Config) => boolean) {
    return layer.above.find((a) => has(a.config));
  }

  /** Direction, pitch, volume, pan and fade, then stretch, colour and space: the same for a hit, a pad and a matrix. */
  function configPanels(layer: Layer) {
    const { config, set } = layer;
    /** Its own value, and what it plays at with the layers above added. */
    const withAbove = (own: number, field: 'pitch' | 'volume', unit: string) => {
      const added = layer.above.reduce((sum, a) => sum + a.config[field], 0);
      return added === 0 ? signed(own, unit) : `${signed(own, unit)} · plays ${signed(own + added, unit)}`;
    };
    const panAbove = layer.above.reduce((sum, a) => sum + a.config.pan, 0);
    return (
      <div className="config-grid">
        <div className="panel stack-tight">
          <span className="label">Direction</span>
          <div className="segmented full" role="group" aria-label="Direction">
            <button type="button" aria-pressed={config.direction === 'forward'} onClick={() => set({ direction: 'forward' }, 'direction')}>
              Forward
            </button>
            <button type="button" aria-pressed={config.direction === 'reverse'} onClick={() => set({ direction: 'reverse' }, 'direction')}>
              Reverse
            </button>
          </div>
        </div>
        <Slider label="Pitch" value={config.pitch} min={-24} max={24} step={1} format={(v) => withAbove(v, 'pitch', 'st')} onChange={(v) => set({ pitch: v }, 'pitch')} onCommit={seal} />
        <Slider label="Volume" value={config.volume} min={-24} max={6} step={0.5} format={(v) => withAbove(v, 'volume', 'dB')} onChange={(v) => set({ volume: v }, 'volume')} onCommit={seal} />
        <Slider
          label="Pan"
          value={Math.round(config.pan * 100)}
          min={-100}
          max={100}
          step={1}
          format={(v) => panText(v / 100) + (panAbove !== 0 ? ` · above ${panText(panAbove)}` : '')}
          onChange={(v) => set({ pan: v / 100 }, 'pan')}
          onCommit={seal}
        />
        <Slider label="Fade out" value={config.fadeOut} min={0} max={200} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ fadeOut: v }, 'fade')} onCommit={seal} />
        {stretchPanel(layer)}
        {colourPanel(layer)}
        {spacePanel(layer)}
      </div>
    );
  }

  /**
   * Stretch: Off, Fit to tempo or a factor, the grain length and where the
   * grains start. Without a grain length or grid of its own a layer takes the
   * nearest above's, and the factors of all layers multiply.
   */
  function stretchPanel(layer: Layer) {
    const stretch = layer.config.stretch;
    const set = (patch: Partial<HitStretch>, field: string) => layer.set({ stretch: { ...stretch, ...patch } }, `stretch:${field}`);
    const modes: [StretchMode, string][] = [
      ['off', 'Off'],
      ['fit', 'Fit to tempo'],
      ['factor', 'Factor'],
    ];
    const grainFrom = nearestAbove(layer, (c) => c.stretch.grain !== null)?.name ?? 'default';
    const hasAbove = layer.above.length > 0;
    /** Grain and where grains start matter only while it stretches, by its own or a layer above. */
    const stretches = stretch.mode !== 'off' || layer.played.factor !== 1;
    return (
      <div className="panel stack-tight wide" aria-label="Stretch" role="group">
        <div className="row spread">
          <span className="label">Stretch</span>
          <span className="muted small mono">{layer.played.factor === 1 ? 'plays as it is' : `plays ${formatFactor(layer.played.factor)}${hasAbove ? ' with the layers above' : ''}`}</span>
        </div>
        <div className="segmented full" role="group" aria-label="Stretch mode">
          {modes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={stretch.mode === mode}
              disabled={mode === 'fit' && !layer.canFit}
              title={mode === 'fit' && !layer.canFit ? 'A sample that is not sliced has no tempo to fit' : undefined}
              onClick={() => set({ mode }, 'mode')}
            >
              {label}
            </button>
          ))}
        </div>
        {stretches && (
          <>
            <div className="config-inline">
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
                value={stretch.grain ?? layer.played.grain}
                min={MIN_GRAIN}
                max={MAX_GRAIN}
                step={1}
                format={(v) => `${v} ms${stretch.grain === null ? ` (${grainFrom})` : ''}`}
                onChange={(v) => set({ grain: v }, 'grain')}
                onCommit={seal}
              />
            </div>
            <div className="row">
              <span className="label">Grains from</span>
              <div className="segmented" role="group" aria-label="Grains from">
                {hasAbove && (
                  <button type="button" aria-pressed={stretch.from === null} title="As the pad or matrix has it" onClick={() => set({ from: null }, 'from')}>
                    Inherit
                  </button>
                )}
                {(['sample', 'hit'] as const).map((from) => (
                  <button
                    key={from}
                    type="button"
                    aria-pressed={stretch.from === from || (!hasAbove && stretch.from === null && from === 'sample')}
                    title={from === 'sample' ? 'A grid from the start of the sample, like a sampler stretching the whole sample' : 'Grains start with the hit, for clean attacks'}
                    onClick={() => set({ from }, 'from')}
                  >
                    {from === 'sample' ? 'Sample' : 'Hit'}
                  </button>
                ))}
              </div>
              {stretch.grain !== null && (
                <button type="button" className="link-text small push" onClick={() => set({ grain: null }, 'grain')}>
                  Grain from {hasAbove ? 'above' : 'default'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  /**
   * Dist, then filter. Off takes the nearest layer above's, which is shown
   * beside it; dist keeps the level as it was.
   */
  function colourPanel(layer: Layer) {
    const { config } = layer;
    const setDist = (patch: Partial<HitDist>, field: string) => layer.set({ dist: { ...config.dist, ...patch } }, `dist:${field}`);
    const setFilter = (patch: Partial<HitFilter>, field: string) => layer.set({ filter: { ...config.filter, ...patch } }, `filter:${field}`);
    const fromAbove = (on: boolean, what: string) => (layer.above.length > 0 && !on ? <span className="muted small">{what}</span> : null);
    const dist = nearestAbove(layer, (c) => c.dist.mode !== 'off');
    const filter = nearestAbove(layer, (c) => c.filter.type !== 'off');
    const distText = dist === undefined ? 'above: none' : `${dist.name}: ${DIST_MODES.find(([m]) => m === dist.config.dist.mode)?.[1]} ${Math.round(dist.config.dist.amount * 100)}%`;
    const filterText = filter === undefined ? 'above: none' : `${filter.name}: ${FILTER_TYPES.find(([t]) => t === filter.config.filter.type)?.[1]} ${formatHz(filter.config.filter.cutoff)}`;
    return (
      <>
        <div className="panel stack-tight wide" role="group" aria-label="Dist">
          <div className="row spread">
            <span className="label">Dist</span>
            {fromAbove(config.dist.mode !== 'off', distText)}
          </div>
          <div className="segmented full" role="group" aria-label="Dist mode">
            <button type="button" aria-pressed={config.dist.mode === 'off'} onClick={() => setDist({ mode: 'off' }, 'mode')}>
              Off
            </button>
            {DIST_MODES.map(([mode, label]) => (
              <button key={mode} type="button" aria-pressed={config.dist.mode === mode} onClick={() => setDist({ mode }, 'mode')}>
                {label}
              </button>
            ))}
          </div>
          {config.dist.mode !== 'off' && (
            <Slider label="Amount" value={config.dist.amount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setDist({ amount: v }, 'amount')} onCommit={seal} />
          )}
        </div>
        <div className="panel stack-tight wide" role="group" aria-label="Filter">
          <div className="row spread">
            <span className="label">Filter</span>
            {fromAbove(config.filter.type !== 'off', filterText)}
          </div>
          <div className="segmented full" role="group" aria-label="Filter type">
            <button type="button" aria-pressed={config.filter.type === 'off'} onClick={() => setFilter({ type: 'off' }, 'type')}>
              Off
            </button>
            {FILTER_TYPES.map(([type, label]) => (
              <button key={type} type="button" aria-pressed={config.filter.type === type} onClick={() => setFilter({ type }, 'type')}>
                {label}
              </button>
            ))}
          </div>
          {config.filter.type !== 'off' && (
            <div className="config-inline">
              <Slider
                label="Cutoff"
                value={Math.log10(config.filter.cutoff)}
                min={Math.log10(MIN_CUTOFF)}
                max={Math.log10(MAX_CUTOFF)}
                step={0.01}
                format={(v) => formatHz(10 ** v)}
                onChange={(v) => setFilter({ cutoff: Math.round(10 ** v) }, 'cutoff')}
                onCommit={seal}
              />
              <Slider label="Resonance" value={config.filter.resonance} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ resonance: v }, 'resonance')} onCommit={seal} />
            </div>
          )}
        </div>
      </>
    );
  }

  /**
   * Reverb and delay: how much is sent to them, and their settings. They ring
   * out beside the hits, so the next hit does not cut them. An amount of 0
   * takes the nearest layer above's, which is shown beside it.
   */
  function spacePanel(layer: Layer) {
    const { config } = layer;
    const setReverb = (patch: Partial<HitReverb>, field: string) => layer.set({ reverb: { ...config.reverb, ...patch } }, `reverb:${field}`);
    const setDelay = (patch: Partial<HitDelay>, field: string) => layer.set({ delay: { ...config.delay, ...patch } }, `delay:${field}`);
    const fromAbove = (on: boolean, what: string) => (layer.above.length > 0 && !on ? <span className="muted small">{what}</span> : null);
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    const reverb = nearestAbove(layer, (c) => c.reverb.amount > 0);
    const delay = nearestAbove(layer, (c) => c.delay.amount > 0);
    const reverbText = reverb === undefined ? 'above: none' : `${reverb.name}: ${percent(reverb.config.reverb.amount)}`;
    const delayText = delay === undefined ? 'above: none' : `${delay.name}: ${percent(delay.config.delay.amount)} at ${DELAY_TIMES.find(([s]) => s === delay.config.delay.steps)?.[1]}`;
    return (
      <>
        <div className="panel stack-tight" role="group" aria-label="Reverb">
          <div className="row spread">
            <span className="label">Reverb</span>
            {fromAbove(config.reverb.amount > 0, reverbText)}
          </div>
          <Slider label="Reverb amount" value={config.reverb.amount} min={0} max={1} step={0.01} format={(v) => (v <= 0 ? 'Off' : percent(v))} onChange={(v) => setReverb({ amount: v }, 'amount')} onCommit={seal} />
          {config.reverb.amount > 0 && <Slider label="Size" value={config.reverb.size} min={0} max={1} step={0.01} format={sizeText} onChange={(v) => setReverb({ size: v }, 'size')} onCommit={seal} />}
        </div>
        <div className="panel stack-tight wide" role="group" aria-label="Delay">
          <div className="row spread">
            <span className="label">Delay</span>
            {fromAbove(config.delay.amount > 0, delayText)}
          </div>
          <Slider label="Delay amount" value={config.delay.amount} min={0} max={1} step={0.01} format={(v) => (v <= 0 ? 'Off' : percent(v))} onChange={(v) => setDelay({ amount: v }, 'amount')} onCommit={seal} />
          {config.delay.amount > 0 && (
            <>
              <div className="segmented full" role="group" aria-label="Delay time">
                {DELAY_TIMES.map(([steps, label]) => (
                  <button key={steps} type="button" aria-pressed={config.delay.steps === steps} onClick={() => setDelay({ steps }, 'steps')}>
                    {label}
                  </button>
                ))}
              </div>
              <Slider label="Feedback" value={config.delay.feedback} min={0} max={MAX_FEEDBACK} step={0.01} format={percent} onChange={(v) => setDelay({ feedback: v }, 'feedback')} onCommit={seal} />
            </>
          )}
        </div>
      </>
    );
  }
}
