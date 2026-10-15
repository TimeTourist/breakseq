import { useEffect, useState } from 'react';
import type { SliceGrid } from '../model';
import { STEPS_PER_BAR, sliceBreak } from '../model';
import { useApp, useProject, useRun, useSelect } from './context';
import { sources } from './ImportView';
import { Waveform } from './Waveform';

const GRIDS: readonly SliceGrid[] = [4, 8, 16];

/** Position of slice i as bar.beat.sixteenth, 1-based. */
function position(i: number, grid: SliceGrid): string {
  const step = i * (STEPS_PER_BAR / grid);
  return `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`;
}

export function SliceView() {
  const project = useProject();
  const { store, services } = useApp();
  const run = useRun();
  const target = useSelect((s) => s.sliceTarget);
  const [grid, setGrid] = useState<SliceGrid>(16);
  const [error, setError] = useState<string | null>(null);
  const [playingBreak, setPlayingBreak] = useState(false);

  // Leaving the view stops whatever is being auditioned.
  useEffect(() => () => services.player.stopAudition(), [services]);

  const breaks = sources(project).filter((s) => s.break !== null);
  const sample = breaks.find((s) => s.id === target) ?? breaks.find((s) => s.break?.sliced === false) ?? breaks[0];

  if (sample === undefined || sample.break === null) {
    return (
      <main className="view">
        <div className="view-head">
          <h1>Slice</h1>
          <p className="muted">No break to slice yet. Import a file and mark it as Break.</p>
        </div>
        <button type="button" className="self-start" onClick={() => store.dispatch({ type: 'view', view: 'import' })}>
          ← Import
        </button>
      </main>
    );
  }

  const audio = project.audio[sample.audioId];
  const count = sample.break.bars * grid;
  const sliceDuration = sample.duration / count;
  const sliced = sample.break.sliced;

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>
            Slice <span className="mono muted title-file">{sample.name}</span>
          </h1>
          <p className="muted">
            {sample.break.bars} bars · {sample.break.bpm.toFixed(1)} BPM ·{' '}
            {sliced ? 'sliced' : `${count} slices. Click a slice to hear it.`}
          </p>
        </div>
        <div className="row push">
          {audio !== undefined && (
            <button
              type="button"
              aria-pressed={playingBreak}
              onClick={() => {
                if (playingBreak) {
                  services.player.stopAudition();
                  return;
                }
                setPlayingBreak(true);
                services.player.audition(audio, sample.offset, sample.duration, () => setPlayingBreak(false));
              }}
            >
              {playingBreak ? 'Stop break' : 'Play break'}
            </button>
          )}
          {breaks.length > 1 && (
            <label className="field">
              Break
              <select
                value={sample.id}
                onChange={(e) => store.dispatch({ type: 'sliceTarget', sampleId: e.target.value })}
              >
                {breaks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="segmented" role="group" aria-label="Grid">
            {GRIDS.map((g) => (
              <button key={g} type="button" aria-pressed={grid === g} disabled={sliced} onClick={() => setGrid(g)}>
                1/{g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: Math.max(1000, count * 28) }}>
            <Waveform audio={audio} offset={sample.offset} duration={sample.duration} height={200} />
            {!sliced && (
              <div className="slice-grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                {Array.from({ length: count }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="slice"
                    aria-label={`Play slice ${i + 1} at ${position(i, grid)}`}
                    onClick={() => services.player.audition(audio, sample.offset + i * sliceDuration, sliceDuration)}
                  >
                    <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <section className="panel stack">
        <h2 className="label">{sliced ? 'Done' : 'Apply creates'}</h2>
        {sliced ? (
          <>
            <p className="muted">This break is sliced. Its loop is ready in Song.</p>
            <button type="button" className="self-start" onClick={() => store.dispatch({ type: 'view', view: 'song' })}>
              Song →
            </button>
          </>
        ) : (
          <>
            <div className="chain mono">
              <span>{count} samples</span>→<span>{count} hits</span>→<span>{count} pads</span>→
              <span className="accent">a main loop</span>
            </div>
            <p className="muted">The loop plays the pads in order, quantized to 1/16. After that it is a normal loop.</p>
            {error !== null && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="primary self-start"
              onClick={() => setError(run(sliceBreak(sample.id, sample.break?.bars ?? 1, grid)))}
            >
              Apply slices
            </button>
          </>
        )}
      </section>
    </main>
  );
}
