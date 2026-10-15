import { useEffect, useRef, useState } from 'react';
import type { SliceGrid } from '../model';
import { MIN_SLICE, STEPS_PER_BAR, gridMarkers, setMarkers, sliceAtMarkers, unsliceBreak } from '../model';
import { useApp, useProject, useRun, useSeal, useSelect } from './context';
import { sources } from './ImportView';
import { Waveform } from './Waveform';

const GRIDS: readonly SliceGrid[] = [4, 8, 16];
const ms = (seconds: number) => Math.round(seconds * 1000);

/** A time as bar.beat.sixteenth, 1-based, with the rest in ms when it is off the grid. */
function position(time: number, stepTime: number): string {
  const step = Math.round(time / stepTime);
  const off = ms(time - step * stepTime);
  const at = `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`;
  return off === 0 ? at : `${at} ${off > 0 ? '+' : ''}${off} ms`;
}

const sameMarkers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((m, i) => Math.abs(m - b[i]!) < 1e-6);

export function SliceView() {
  const project = useProject();
  const { store, services } = useApp();
  const run = useRun();
  const seal = useSeal();
  const target = useSelect((s) => s.sliceTarget);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playingBreak, setPlayingBreak] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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

  const info = sample.break;
  const { markers, sliced } = info;
  const audio = project.audio[sample.audioId];
  const duration = sample.duration;
  const stepTime = duration / (info.bars * STEPS_PER_BAR);
  const current = Math.min(selected, markers.length - 1);
  const ends = markers.map((_, i) => markers[i + 1] ?? duration);
  const move = (next: readonly number[]) => setError(run(setMarkers(sample.id, next), `markers:${sample.id}`));
  const moveMarker = (index: number, time: number) => {
    const low = (markers[index - 1] ?? 0) + MIN_SLICE;
    const high = (markers[index + 1] ?? duration) - MIN_SLICE;
    move(markers.map((m, i) => (i === index ? Math.max(low, Math.min(high, time)) : m)));
  };
  const at = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    return rect === undefined ? 0 : Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };
  const addAt = (time: number) => {
    const next = [...markers, time].sort((a, b) => a - b);
    if (run(setMarkers(sample.id, next)) === null) setSelected(next.indexOf(time));
  };
  const grid = GRIDS.find((g) => sameMarkers(markers, gridMarkers(duration, info.bars, g))) ?? null;

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>
            Slice <span className="mono muted title-file">{sample.name}</span>
          </h1>
          <p className="muted">
            {info.bars} bars · {info.bpm.toFixed(2)} BPM · {markers.length} slices
            {sliced ? ' · sliced' : grid === null ? ' · own markers' : ` · equal 1/${grid}`}
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
                services.player.audition(audio, sample.offset, duration, () => setPlayingBreak(false));
              }}
            >
              {playingBreak ? 'Stop break' : 'Play break'}
            </button>
          )}
          {breaks.length > 1 && (
            <label className="field">
              Break
              <select value={sample.id} onChange={(e) => store.dispatch({ type: 'sliceTarget', sampleId: e.target.value })}>
                {breaks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="segmented" role="group" aria-label="Equal grid">
            {GRIDS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={grid === g}
                disabled={sliced}
                onClick={() => {
                  setSelected(0);
                  setError(run(setMarkers(sample.id, gridMarkers(duration, info.bars, g))));
                }}
              >
                1/{g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: Math.max(1000, markers.length * 24) }}>
            <div
              ref={box}
              className="slice-area"
              onDoubleClick={(e) => {
                if (!sliced) addAt(at(e.clientX));
              }}
            >
              <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
              {markers.map((m, i) => (
                <button
                  key={`slice-${i}`}
                  type="button"
                  className={`slice-segment${i === current ? ' selected' : ''}`}
                  style={{ left: `${(m / duration) * 100}%`, width: `${((ends[i]! - m) / duration) * 100}%` }}
                  aria-label={`Play slice ${i + 1}`}
                  onClick={() => {
                    setSelected(i);
                    services.player.audition(audio, sample.offset + m, ends[i]! - m);
                  }}
                >
                  <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                </button>
              ))}
              {markers.map((m, i) => (
                <button
                  key={`marker-${i}`}
                  type="button"
                  className={`marker${i === current ? ' selected' : ''}${i === 0 ? ' fixed' : ''}`}
                  style={{ left: `${(m / duration) * 100}%` }}
                  aria-label={`Marker ${i + 1} at ${position(m, stepTime)}`}
                  aria-pressed={i === current}
                  disabled={sliced}
                  onFocus={() => setSelected(i)}
                  onPointerDown={(e) => {
                    setSelected(i);
                    if (i > 0) e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (i > 0 && e.currentTarget.hasPointerCapture(e.pointerId)) moveMarker(i, at(e.clientX));
                  }}
                  onPointerUp={seal}
                  onKeyDown={(e) => {
                    const delta = (e.shiftKey ? 10 : 1) / 1000;
                    const step = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
                    if (step !== 0 && i > 0) {
                      e.preventDefault();
                      moveMarker(i, m + step);
                    }
                  }}
                  onKeyUp={seal}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="columns">
        <section className="panel stack-tight grow-1" aria-label="Selected slice">
          <h2 className="label">Slice {String(current + 1).padStart(2, '0')}</h2>
          <div className="info-row">
            <span className="muted">Starts</span>
            <span className="mono">{position(markers[current] ?? 0, stepTime)}</span>
          </div>
          <div className="info-row">
            <span className="muted">Length</span>
            <span className="mono">{ms((ends[current] ?? 0) - (markers[current] ?? 0))} ms</span>
          </div>
          {!sliced && (
            <>
              <div className="row">
                <button type="button" aria-label="Nudge marker left" disabled={current === 0} onClick={() => moveMarker(current, (markers[current] ?? 0) - 0.001)}>
                  ←
                </button>
                <button type="button" aria-label="Nudge marker right" disabled={current === 0} onClick={() => moveMarker(current, (markers[current] ?? 0) + 0.001)}>
                  →
                </button>
                <button
                  type="button"
                  onClick={() => addAt(((markers[current] ?? 0) + (ends[current] ?? duration)) / 2)}
                >
                  Add marker
                </button>
                <button
                  type="button"
                  disabled={current === 0}
                  onClick={() => {
                    if (run(setMarkers(sample.id, markers.filter((_, i) => i !== current))) === null) setSelected(current - 1);
                  }}
                >
                  Remove marker
                </button>
              </div>
              <p className="muted small">
                Drag a marker, or select it and use ←/→ (Shift: 10 ms). Double-click the waveform to add one.
              </p>
            </>
          )}
        </section>

        <section className="panel stack grow-1">
          <h2 className="label">{sliced ? 'Sliced' : 'Apply creates'}</h2>
          {sliced ? (
            <>
              <p className="muted">
                The slices, their hits and pads, and the loop are made. Re-slicing takes them back, as long as nothing else
                uses them and the loop is not in the song.
              </p>
              <div className="row">
                <button type="button" onClick={() => setError(run(unsliceBreak(sample.id)))}>
                  Re-slice
                </button>
                <button type="button" onClick={() => store.dispatch({ type: 'view', view: 'song' })}>
                  Song →
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="chain mono">
                <span>{markers.length} samples</span>→<span>{markers.length} hits</span>→<span>{markers.length} pads</span>→
                <span className="accent">a main loop</span>
              </div>
              <p className="muted">Each slice goes on its nearest 1/16 in the loop. After that it is a normal loop.</p>
              <button type="button" className="primary self-start" onClick={() => setError(run(sliceAtMarkers(sample.id)))}>
                Apply slices
              </button>
            </>
          )}
          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
