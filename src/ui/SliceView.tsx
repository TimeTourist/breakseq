import { useEffect, useRef, useState } from 'react';
import type { SliceGrid } from '../model';
import { MIN_SLICE, STEPS_PER_BAR, bpmOf, markerGrid, replaceSample, replaceSampleWithFile, sampleAudio, setBreakBars, setGrid, setMarkers, slicePlaces, unlikelyBpm } from '../model';
import { decodeAudioFile, detectTransients } from '../engine';
import { useApp, useProject, useRun, useSeal, useSelect } from './context';
import { PlayMode, useAuditionPlayhead } from './AuditionPlayhead';
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

export function SliceView() {
  const project = useProject();
  const { store, services } = useApp();
  const run = useRun();
  const seal = useSeal();
  const target = useSelect((s) => s.sliceTarget);
  // Slice opens on the slice it was sent to, if any; from then on it is picked here.
  const [selected, setSelected] = useState(() => store.getState().sliceSelected);
  const [error, setError] = useState<string | null>(null);
  const [playingBreak, setPlayingBreak] = useState(false);
  const [sensitivity, setSensitivity] = useState(60);
  const [transients, setTransients] = useState(false);
  const [loopBreak, setLoopBreak] = useState(true);
  const playhead = useAuditionPlayhead(playingBreak);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Leaving the view stops whatever is being auditioned.
  useEffect(() => () => services.player.stopAudition(), [services]);

  const breaks = Object.values(project.breaks).filter((b) => b.bars !== null);
  const brk = breaks.find((b) => b.id === target) ?? breaks[0];
  const sample = brk === undefined ? undefined : project.samples[brk.sampleId];

  if (brk === undefined || brk.bars === null || sample === undefined) {
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

  const bars = brk.bars;
  const bpm = bpmOf(project, brk) ?? 0;
  const audio = sampleAudio(project, sample);
  const duration = sample.duration;
  // Markers are parts of the break; here they are worked with in seconds.
  const markers = brk.markers.map((m) => m * duration);
  const stepTime = duration / (bars * STEPS_PER_BAR);
  const current = Math.min(selected, markers.length - 1);
  const ends = markers.map((_, i) => markers[i + 1] ?? duration);
  /** The slices on the break's 1/16 grid, as laying the parent in a loop places them. */
  const places = slicePlaces(brk.markers, bars * STEPS_PER_BAR);
  const toParts = (seconds: readonly number[]) => seconds.map((m) => m / duration);
  const move = (next: readonly number[]) => setError(run(setMarkers(brk.id, toParts(next)), `markers:${brk.id}`));
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
    if (run(setMarkers(brk.id, toParts(next))) === null) setSelected(next.indexOf(time));
  };
  const grid = markerGrid(brk.markers, bars);

  /** Markers on the hits found at this sensitivity. Moving a marker by hand makes them your own. */
  const detect = (value: number, mergeKey?: string) => {
    if (audio === undefined) return;
    setSensitivity(value);
    setTransients(true);
    setSelected(0);
    setError(run(setMarkers(brk.id, toParts(detectTransients(audio, sample.offset, duration, value))), mergeKey));
  };

  /** Plays a new file under the break: its markers keep their steps. */
  const replaceWithFile = async (file: File) => {
    try {
      setError(run(replaceSampleWithFile(brk.id, { name: file.name, audio: decodeAudioFile(await file.arrayBuffer()) })));
    } catch (e) {
      setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1>
            Slice <span className="mono muted title-file">{brk.name}</span>
          </h1>
          <p className="muted row">
            <label className="field inline">
              <input
                type="number"
                min={1}
                max={64}
                aria-label="Bars in the break"
                value={bars}
                onChange={(e) => {
                  const bars = Math.round(Number(e.target.value));
                  if (bars >= 1) setError(run(setBreakBars(brk.id, bars), `bars:${brk.id}`));
                }}
                onBlur={seal}
              />
              bars
            </label>
            · {bpm.toFixed(2)} BPM
            {unlikelyBpm(bpm) && <span className="warn-text">· check the bars: that tempo looks wrong</span>} · {markers.length} slices
            {grid === null ? ' · own markers' : ` · equal 1/${grid}`}
          </p>
        </div>
        <div className="row push">
          {audio !== undefined && (
            <>
              <PlayMode
                loop={loopBreak}
                onChange={(next) => {
                  setLoopBreak(next);
                  if (playingBreak) services.player.audition(audio, sample.offset, duration, () => setPlayingBreak(false), next);
                }}
              />
              <button
                type="button"
                aria-pressed={playingBreak}
                onClick={() => {
                  if (playingBreak) {
                    services.player.stopAudition();
                    return;
                  }
                  setPlayingBreak(true);
                  services.player.audition(audio, sample.offset, duration, () => setPlayingBreak(false), loopBreak);
                }}
              >
                {playingBreak ? 'Stop break' : 'Play break'}
              </button>
            </>
          )}
          {breaks.length > 1 && (
            <label className="field">
              Break
              <select value={brk.id} onChange={(e) => store.dispatch({ type: 'sliceTarget', breakId: e.target.value })}>
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
                aria-pressed={!transients && grid === g}
                onClick={() => {
                  setSelected(0);
                  setTransients(false);
                  setError(run(setGrid(brk.id, g)));
                }}
              >
                1/{g}
              </button>
            ))}
            <button type="button" aria-pressed={transients} disabled={audio === undefined} onClick={() => detect(sensitivity)}>
              Transients
            </button>
          </div>
          {transients && (
            <label className="field sensitivity">
              Sensitivity
              <input
                type="range"
                min={0}
                max={100}
                value={sensitivity}
                onChange={(e) => detect(Number(e.target.value), `transients:${brk.id}`)}
                onPointerUp={seal}
                onKeyUp={seal}
              />
              <span className="mono">{sensitivity}</span>
            </label>
          )}
        </div>
      </div>

      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: Math.max(1000, markers.length * 24, places.length * 22) }}>
            <div
              ref={box}
              className="slice-area"
              onDoubleClick={(e) => {
                addAt(at(e.clientX));
              }}
            >
              <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
              <div className="slice-grid" style={{ backgroundSize: `${100 / places.length}% 100%` }} aria-hidden="true" />
              {playhead !== null && (
                <div className="playhead" style={{ left: `${((playhead - sample.offset) / duration) * 100}%` }} />
              )}
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
            <div className="slice-steps" style={{ gridTemplateColumns: `repeat(${places.length}, minmax(0, 1fr))` }} aria-label="Where the slices land on the 1/16 grid">
              {places.map((p, i) => {
                const label = `Step ${position(i * stepTime, stepTime)}: ${p.slice === null ? 'empty' : `slice ${p.slice + 1}`}${p.dropped.length > 0 ? `; ${p.dropped.length + 1} slices here, ${p.dropped.map((d) => `slice ${d + 1}`).join(' and ')} dropped` : ''}`;
                return (
                  <div
                    key={i}
                    className={`slice-step${p.slice !== null ? ' filled' : ''}${p.slice === current ? ' selected' : ''}${p.dropped.length > 0 ? ' clash' : ''}${i % 4 === 0 ? ' downbeat' : ''}`}
                    title={p.dropped.length > 0 ? `${p.dropped.length + 1} slices land here: only ${String(p.slice! + 1).padStart(2, '0')} plays` : undefined}
                    aria-label={label}
                  >
                    {p.slice === null ? '' : String(p.slice + 1).padStart(2, '0')}
                    {p.reach > 0 && <span className={`reach${p.slice === null ? ' tail' : ''}`} style={{ width: `${p.reach * 100}%` }} />}
                  </div>
                );
              })}
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
                if (run(setMarkers(brk.id, toParts(markers.filter((_, i) => i !== current)))) === null) setSelected(current - 1);
              }}
            >
              Remove marker
            </button>
          </div>
          <p className="muted small">
            Drag a marker, or select it and use ←/→ (Shift: 10 ms). Double-click the waveform to add one.
          </p>
        </section>

        <section className="panel stack grow-1" aria-label="Sample">
          <h2 className="label">Sample</h2>
          <p className="muted">
            The sound under the markers. Replace it and every slot plays the new sound at the same steps. Changes here and to
            the markers are heard straight away wherever the break plays.
          </p>
          <div className="row">
            <label className="field">
              Plays
              <select aria-label="Sample under the break" value={sample.id} onChange={(e) => setError(run(replaceSample(brk.id, e.target.value)))}>
                {Object.values(project.samples).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="self-end" onClick={() => fileInput.current?.click()}>
              Replace sample…
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".wav,.aif,.aiff,.aifc,audio/wav,audio/aiff"
              aria-label="New sample file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void replaceWithFile(file);
                e.target.value = '';
              }}
            />
          </div>
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
