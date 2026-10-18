import { useEffect, useRef, useState } from 'react';
import type { Command, Id, Project, Renumber, Sample, SliceGrid } from '../model';
import {
  MIN_SLICE,
  STEPS_PER_BAR,
  breakBpm,
  cueMarkers,
  gridMarkers,
  holds,
  isUnsliced,
  makeOneShot,
  markerGrid,
  markersForBars,
  ownMatrix,
  renumberConflict,
  sampleAudio,
  sampleBpm,
  setGrid,
  setMarkers,
  setSampleBars,
  setSlicing,
  sliceName,
  slicePlaces,
  trimName,
  unlikelyBpm,
} from '../model';
import { detectTransients } from '../engine';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { MatrixOrigin } from './MatrixOrigin';
import { RenumberDialog } from './RenumberDialog';
import { useAuditionPlayhead } from './AuditionPlayhead';
import { PlayControls } from './PlayControls';
import { Slider } from './Slider';
import { InSong, InSongMark, useHeard } from './InSong';
import { Waveform } from './Waveform';

const GRIDS: readonly SliceGrid[] = [4, 8, 16];
const ms = (seconds: number) => Math.round(seconds * 1000);
const SENSITIVITY = 60;

/** How a sample is sliced: at the file's cue markers, an equal grid, or the transients found. */
type SliceBy = 'cues' | SliceGrid | 'transients';

const sameMarkers = (a: readonly number[], b: readonly number[] | null) => b !== null && a.length === b.length && a.every((m, i) => Math.abs(m - b[i]!) < 1e-9);

/** What a sample is called in Slice: its own matrix's name, or its trim's when that is gone. */
const sampleLabel = (project: Project, sample: Sample): string => ownMatrix(project, sample.id)?.name ?? trimName(sample);

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
  const [playingSample, setPlayingSample] = useState(false);
  const [sensitivity, setSensitivity] = useState(SENSITIVITY);
  const [transients, setTransients] = useState(false);
  const [loopSample, setLoopSample] = useState(true);
  const playhead = useAuditionPlayhead(playingSample);
  const box = useRef<HTMLDivElement>(null);
  const open = useOpen();
  const heard = useHeard();
  const [made, setMade] = useState<{ name: string; matrix: Id; pad: Id | null } | null>(null);
  /** A change that renumbers slices played more than once, waiting for New trim or Renumber. */
  const [asking, setAsking] = useState<{ readonly conflict: Renumber; readonly go: (newTrim: boolean) => void } | null>(null);

  // Leaving the view stops whatever is being auditioned.
  useEffect(() => () => services.player.stopAudition(), [services]);

  // Samples, sliced or marked Slice in Import and waiting to be.
  const samples = Object.values(project.samples).filter((s) => s.bars !== null || isUnsliced(s));
  const sample = samples.find((s) => s.id === target) ?? samples[0];
  /** The samples a hit heard in the song plays. */
  const heardSamples = new Set([...heard.hits].flatMap((h) => project.hits[h]?.sampleId ?? []));

  if (sample === undefined) {
    return (
      <main className="view">
        <div className="view-head">
          <h1>Slice</h1>
          <p className="muted">Nothing to slice yet. Import a file and mark it Slice.</p>
        </div>
        <div className="row nav-row">
          <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'import' })}>
            ← Import
          </button>
        </div>
      </main>
    );
  }

  const sidebar = (
    <aside className="sidebar narrow" aria-label="Samples">
      <h2 className="label">Samples</h2>
      {samples.map((s) => (
        <button
          key={s.id}
          type="button"
          className="list-item matrix-head"
          aria-current={s.id === sample.id ? 'true' : undefined}
          onClick={() => {
            setSelected(0);
            setTransients(false);
            store.dispatch({ type: 'sliceTarget', sampleId: s.id });
          }}
        >
          <span className="label grow ellipsis">{sampleLabel(project, s)}</span>
          <InSongMark heard={heardSamples.has(s.id)} />
          {isUnsliced(s) && <span className="badge">not sliced</span>}
        </button>
      ))}
    </aside>
  );

  const toTrim = () => {
    store.dispatch({ type: 'trimming', sampleId: sample.id });
    store.dispatch({ type: 'view', view: 'import' });
  };

  if (sample.bars === null) {
    return (
      <div className="split">
        {sidebar}
        <Unsliced
          key={sample.id}
          sample={sample}
          toTrim={toTrim}
          onSliced={(by) => {
            setSelected(0);
            setTransients(by === 'transients');
            setSensitivity(SENSITIVITY);
          }}
        />
      </div>
    );
  }

  const bars = sample.bars;
  const bpm = sampleBpm(sample) ?? 0;
  const own = ownMatrix(project, sample.id);
  const audio = sampleAudio(project, sample);
  const duration = sample.duration;
  // Markers are parts of the sample; here they are worked with in seconds.
  const markers = sample.markers.map((m) => m * duration);
  const stepTime = duration / (bars * STEPS_PER_BAR);
  const current = Math.min(selected, markers.length - 1);
  const ends = markers.map((_, i) => markers[i + 1] ?? duration);
  /** The slices on the sample's 1/16 grid, as laying its matrix in a loop places them. */
  const places = slicePlaces(sample.markers, bars * STEPS_PER_BAR);
  const toParts = (seconds: readonly number[]) => seconds.map((m) => m / duration);
  /**
   * Runs a change to the slicing that gives the sample `next` markers. If it
   * renumbers slices played more than once, it asks first (decision 14): New
   * trim moves this sample's matrix to a new trim with the change, which Slice
   * then shows; Renumber changes the sample. `then` runs once it is done.
   */
  const change = (next: readonly number[], command: (newTrim: boolean) => Command, mergeKey?: string, then?: () => void) => {
    const go = (newTrim: boolean) => {
      const before = store.getState().history.present.samples;
      const failed = run(command(newTrim), newTrim ? undefined : mergeKey);
      setError(failed);
      if (failed !== null) return;
      const added = newTrim ? Object.keys(store.getState().history.present.samples).find((id) => !(id in before)) : undefined;
      if (added !== undefined) store.dispatch({ type: 'sliceTarget', sampleId: added });
      then?.();
    };
    const conflict = renumberConflict(project, sample.id, next);
    if (conflict === null) go(false);
    else setAsking({ conflict, go });
  };
  /** New markers, in parts of the sample. */
  const markersTo = (next: readonly number[], mergeKey?: string, then?: () => void) =>
    change(next, (newTrim) => setMarkers(sample.id, next, newTrim), mergeKey, then);
  const move = (next: readonly number[]) => markersTo(toParts(next), `markers:${sample.id}`);
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
    markersTo(toParts(next), undefined, () => setSelected(next.indexOf(time)));
  };
  const grid = markerGrid(sample.markers, bars);
  const cues = cueMarkers(sample);

  /** Markers on the hits found at this sensitivity. Moving a marker by hand makes them your own. */
  const detect = (value: number, mergeKey?: string) => {
    if (audio === undefined) return;
    setSensitivity(value);
    setTransients(true);
    setSelected(0);
    markersTo(toParts(detectTransients(audio, sample.offset, duration, value)), mergeKey);
  };

  return (
    <div className="split">
    {sidebar}
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1 className="mono">{sliceName(sample)}</h1>
          <div className="row nav-row">
            {own !== undefined && <MatrixOrigin matrix={own} parts={['matrix', 'file']} />}
            <InSong heard={heardSamples.has(sample.id)} />
            <button
              type="button"
              className="link-text small"
              title="Trim the start and end of the sample, and pick its channel, in Import"
              onClick={toTrim}
            >
              ← Trim
            </button>
            {own !== undefined && (
              <button type="button" className="link-text small" title={`Matrix ${own.name}, in Hits`} onClick={() => open({ matrix: own.id, pad: null, hit: null }, 'hits')}>
                Hits →
              </button>
            )}
          </div>
          <p className="muted row">
            <label className="field">
              Bars
              <input
                type="number"
                min={1}
                max={64}
                aria-label="Bars in the sample"
                value={bars}
                onChange={(e) => {
                  const bars = Math.round(Number(e.target.value));
                  if (bars >= 1) change(markersForBars(sample, bars), (newTrim) => setSampleBars(sample.id, bars, newTrim), `bars:${sample.id}`);
                }}
                onBlur={seal}
              />
            </label>
            {bpm.toFixed(2)} BPM
            {unlikelyBpm(bpm) && <span className="warn-text">· check the bars: that tempo looks wrong</span>} · {markers.length} slices
            {grid === null ? ' · own markers' : ` · equal 1/${grid}`}
          </p>
        </div>
        <div className="row push">
          {audio !== undefined && (
            <PlayControls
              what="sample"
              playing={playingSample}
              loop={loopSample}
              onLoop={(next) => {
                setLoopSample(next);
                if (playingSample) services.player.audition(audio, sample.offset, duration, () => setPlayingSample(false), next);
              }}
              onToggle={() => {
                if (playingSample) {
                  services.player.stopAudition();
                  return;
                }
                setPlayingSample(true);
                services.player.audition(audio, sample.offset, duration, () => setPlayingSample(false), loopSample);
              }}
            />
          )}
          <div className="segmented" role="group" aria-label="Slice by">
            {cues !== null && (
              <button
                type="button"
                aria-pressed={!transients && sameMarkers(sample.markers, cues)}
                title="At the cue markers in the WAV file"
                onClick={() => {
                  setSelected(0);
                  setTransients(false);
                  markersTo(cues);
                }}
              >
                Cue markers
              </button>
            )}
            {GRIDS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={!transients && grid === g}
                onClick={() => {
                  setSelected(0);
                  setTransients(false);
                  change(gridMarkers(bars, g), (newTrim) => setGrid(sample.id, g, newTrim));
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
            <Slider label="Sensitivity" value={sensitivity} min={0} max={100} step={1} format={String} onChange={(v) => detect(v, `transients:${sample.id}`)} onCommit={seal} />
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
                  aria-label={`Play slice ${String(i + 1).padStart(2, '0')}`}
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
                  aria-label={`Marker ${String(i + 1).padStart(2, '0')} at ${position(m, stepTime)}`}
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
                const two = (n: number) => String(n + 1).padStart(2, '0');
                const label = `Step ${position(i * stepTime, stepTime)}: ${p.slice === null ? 'empty' : `slice ${two(p.slice)}`}${p.dropped.length > 0 ? `; ${p.dropped.length + 1} slices here, ${p.dropped.map((d) => `slice ${two(d)}`).join(' and ')} dropped` : ''}`;
                return (
                  <div
                    key={i}
                    style={{ gridColumn: i + 1, gridRow: 1 }}
                    className={`slice-step${p.slice !== null ? ' filled' : ''}${p.slice === current ? ' selected' : ''}${p.dropped.length > 0 ? ' clash' : ''}${i % 4 === 0 ? ' downbeat' : ''}`}
                    title={p.dropped.length > 0 ? `${p.dropped.length + 1} slices land here: only ${String(p.slice! + 1).padStart(2, '0')} plays` : undefined}
                    aria-label={label}
                  >
                    {p.slice === null ? '' : String(p.slice + 1).padStart(2, '0')}
                  </div>
                );
              })}
              {holds(places.map((p) => p.slice !== null)).map((h) => (
                <span key={`hold-${h.start}`} className="hold" style={{ gridColumn: `${h.start + 1} / span ${h.length}`, gridRow: 1 }} aria-hidden="true" />
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
          <div className="row">
            <button type="button" aria-label="Nudge marker left" disabled={current === 0} onClick={() => moveMarker(current, (markers[current] ?? 0) - 0.001)}>
              −1 ms
            </button>
            <button type="button" aria-label="Nudge marker right" disabled={current === 0} onClick={() => moveMarker(current, (markers[current] ?? 0) + 0.001)}>
              +1 ms
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
              onClick={() => markersTo(toParts(markers.filter((_, i) => i !== current)), undefined, () => setSelected(current - 1))}
            >
              Delete marker
            </button>
            <button
              type="button"
              title="A one-shot of this slice: a new trim of the file over just the slice, with a matrix of one pad. This sample stays as it is."
              onClick={() => {
                const before = store.getState().history.present.matrices;
                const failed = run(makeOneShot(sample.id, current));
                setError(failed);
                const shot = Object.values(store.getState().history.present.matrices).find((m) => !(m.id in before));
                setMade(shot === undefined ? null : { name: shot.name, matrix: shot.id, pad: shot.pads[0] ?? null });
              }}
            >
              Make one-shot
            </button>
          </div>
          {made !== null && (
            <p className="small">
              Made the one-shot <span className="mono">{made.name}</span>{' '}
              <button type="button" className="link-text small" onClick={() => open({ matrix: made.matrix, pad: made.pad, hit: null }, 'hits')}>
                Hits →
              </button>
            </p>
          )}
          <p className="muted small">
            Drag a marker, or select it and use ←/→ (Shift: 10 ms). Double-click the waveform to add one.
          </p>
          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

      </div>
      {asking !== null && (
        <RenumberDialog
          project={project}
          conflict={asking.conflict}
          onAnswer={(newTrim) => {
            setAsking(null);
            if (newTrim !== null) asking.go(newTrim);
          }}
        />
      )}
    </main>
    </div>
  );
}

interface UnslicedProps {
  readonly sample: Sample;
  readonly toTrim: () => void;
  /** After it is sliced, and how. */
  readonly onSliced: (by: SliceBy) => void;
}

/**
 * A sample marked Slice in Import and not sliced yet: nothing is made until
 * its bars and how to slice it are both chosen, then its matrix gets a pad per
 * slice and a loop, in one undo step. The file's cue markers, if it has any,
 * are chosen to start with.
 */
function Unsliced({ sample, toTrim, onSliced }: UnslicedProps) {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const heard = useHeard();
  const own = ownMatrix(project, sample.id);
  const heardSamples = new Set([...heard.hits].flatMap((h) => project.hits[h]?.sampleId ?? []));
  const cues = cueMarkers(sample);
  const [bars, setBars] = useState<number | null>(null);
  const [by, setBy] = useState<SliceBy | null>(cues === null ? null : 'cues');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const playhead = useAuditionPlayhead(playing);
  const audio = sampleAudio(project, sample);
  const duration = sample.duration;

  const slice = (bars: number | null, by: SliceBy | null) => {
    if (bars === null || by === null) return;
    const markers =
      by === 'cues'
        ? cues
        : by === 'transients'
          ? audio === undefined
            ? null
            : detectTransients(audio, sample.offset, duration, SENSITIVITY).map((m) => m / duration)
          : gridMarkers(bars, by);
    if (markers === null) return;
    const failed = run(setSlicing(sample.id, bars, markers));
    setError(failed);
    if (failed === null) onSliced(by);
  };

  return (
    <main className="view">
      <div className="view-head row">
        <div className="stack-tight">
          <h1 className="mono">{sampleLabel(project, sample)}</h1>
          <div className="row nav-row">
            {own !== undefined && <MatrixOrigin matrix={own} parts={['file']} />}
            <InSong heard={heardSamples.has(sample.id)} />
            <button type="button" className="link-text small" title="Trim the start and end of the sample, and pick its channel, in Import" onClick={toTrim}>
              ← Trim
            </button>
          </div>
          <p className="muted">Not sliced yet: set its bars and how to slice it. Nothing is made before that.</p>
          <p className="muted row">
            <label className="field">
              Bars
              <input
                type="number"
                min={1}
                max={64}
                aria-label="Bars in the sample"
                placeholder="–"
                value={bars ?? ''}
                onChange={(e) => {
                  const next = Math.round(Number(e.target.value));
                  const value = e.target.value === '' || next < 1 ? null : next;
                  setBars(value);
                  slice(value, by);
                }}
              />
            </label>
            {bars !== null && `${breakBpm(duration, bars).toFixed(2)} BPM`}
          </p>
        </div>
        <div className="row push">
          {audio !== undefined && (
            <PlayControls
              what="sample"
              playing={playing}
              loop={loop}
              onLoop={(next) => {
                setLoop(next);
                if (playing) services.player.audition(audio, sample.offset, duration, () => setPlaying(false), next);
              }}
              onToggle={() => {
                if (playing) {
                  services.player.stopAudition();
                  return;
                }
                setPlaying(true);
                services.player.audition(audio, sample.offset, duration, () => setPlaying(false), loop);
              }}
            />
          )}
          <div className="segmented" role="group" aria-label="Slice by">
            {cues !== null && (
              <button type="button" aria-pressed={by === 'cues'} title="At the cue markers in the WAV file" onClick={() => (setBy('cues'), slice(bars, 'cues'))}>
                Cue markers
              </button>
            )}
            {GRIDS.map((g) => (
              <button key={g} type="button" aria-pressed={by === g} onClick={() => (setBy(g), slice(bars, g))}>
                1/{g}
              </button>
            ))}
            <button type="button" aria-pressed={by === 'transients'} disabled={audio === undefined} onClick={() => (setBy('transients'), slice(bars, 'transients'))}>
              Transients
            </button>
          </div>
        </div>
      </div>
      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: 1000 }}>
            <div className="slice-area">
              <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
              {by === 'cues' &&
                cues?.map((m, i) => <div key={i} className="cue-line" style={{ left: `${m * 100}%` }} aria-hidden="true" />)}
              {playhead !== null && <div className="playhead" style={{ left: `${((playhead - sample.offset) / duration) * 100}%` }} />}
            </div>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
