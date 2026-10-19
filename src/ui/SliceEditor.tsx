import { useEffect, useState, type ReactNode } from 'react';
import type { AudioData, Command, Id, Matrix, Renumber, Sample, SliceGrid } from '../model';
import {
  MIN_SLICE,
  STEPS_PER_BAR,
  cueMarkers,
  gridMarkers,
  guessBars,
  holds,
  makeOneShot,
  markerGrid,
  markersForBars,
  ownMatrix,
  pointMarkers,
  pointsOf,
  renumberConflict,
  sampleAudio,
  sampleBpm,
  setGrid,
  setMarkers,
  setPoints,
  setSampleBars,
  setSlicing,
  sliceName,
  slicePlaces,
  unlikelyBpm,
} from '../model';
import { detectTransients } from '../engine';
import { useApp, useProject, useRun, useSeal, useSelect } from './context';
import { RenumberDialog } from './RenumberDialog';
import { useAuditionPlayhead } from './AuditionPlayhead';
import { PlayControls } from './PlayControls';
import { Slider } from './Slider';
import { Waveform } from './Waveform';
import { sampleLabel } from './labels';
import { isTyping, modalOpen } from './isTyping';
import { useCommitAfterPause } from './usePause';

const GRIDS: readonly SliceGrid[] = [4, 8, 16];
const ms = (seconds: number) => Math.round(seconds * 1000);
const SENSITIVITY = 60;
const two = (i: number) => String(i + 1).padStart(2, '0');

/** How a sample is sliced: at the file's cue markers, an equal grid, or the transients found. */
export type SliceBy = 'cues' | SliceGrid | 'transients';

import type { TransientsFound } from './store';
export type { TransientsFound };

const sameMarkers = (a: readonly number[], b: readonly number[] | null) => b !== null && a.length === b.length && a.every((m, i) => Math.abs(m - b[i]!) < 1e-9);

/**
 * How a sliced sample is sliced now, read from its markers, so it follows
 * undo and markers moved by hand: the transients last found, while the
 * markers are still those; else the file's cues; else an equal grid; else
 * null, markers of one's own.
 */
export function slicedBy(sample: Sample, found: TransientsFound | null): SliceBy | null {
  if (sample.bars === null) return null;
  if (found !== null && found.sampleId === sample.id && sameMarkers(pointsOf(sample), found.points)) return 'transients';
  if (sample.points !== undefined ? sameMarkers(sample.points, [...(sample.cues ?? [])]) : sameMarkers(sample.markers, cueMarkers(sample))) return 'cues';
  return markerGrid(sample.markers, sample.bars);
}

/** Where hits start in the whole file, in seconds: Transients finds them in all of it, so they are there when the trim reaches them. (Magnus beslut) */
export function fileTransients(audio: AudioData, sensitivity: number): number[] {
  return detectTransients(audio, 0, (audio.channels[0]?.length ?? 0) / audio.sampleRate, sensitivity);
}

/** How it is sliced, in words: "equal 1/16", "transients", "cue markers", "own markers". */
export const slicedByText = (by: SliceBy | null): string =>
  by === null ? 'own markers' : by === 'transients' ? 'transients' : by === 'cues' ? 'cue markers' : `equal 1/${by}`;

/** A time as bar.beat.sixteenth, 1-based, with the rest in ms when it is off the grid. */
function position(time: number, stepTime: number): string {
  const step = Math.round(time / stepTime);
  const off = ms(time - step * stepTime);
  const at = `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`;
  return off === 0 ? at : `${at} ${off > 0 ? '+' : ''}${off} ms`;
}

interface TrimSlicingProps {
  readonly sample: Sample;
  /** How far through its matrix Play in the header is, 0–1, while it plays it. */
  readonly played: number | null;
  /** Opens the trim's Trim, here below the table, and brings it into view. */
  readonly toTrim: () => void;
  /** The trim's Trim while it is open: shown above the waveform (fas 23b). */
  readonly trim: ReactNode;
  /** Opens a matrix in Pads, in focus. */
  readonly toPads: (matrix: Matrix) => void;
  /** Stops Play in the header, before something here plays: one thing plays at a time. */
  readonly stopTransport: () => void;
}

/**
 * The selected trim's waveform and its slicing: a trim not sliced yet asks for
 * its bars and how to slice it; a sliced one has its markers to move. The
 * transients last found are kept here, so Transients stays chosen across
 * New trim, and undo and redo.
 */
export function TrimSlicing({ sample, ...rest }: TrimSlicingProps) {
  const project = useProject();
  const { store } = useApp();
  const found = useSelect((s) => s.transients);
  const setFound = (next: TransientsFound | null) => store.dispatch({ type: 'transients', found: next });
  const foundNow = (sampleId: Id, sensitivity: number) => {
    const now = store.getState().history.present.samples[sampleId];
    setFound(now === undefined ? null : { sampleId, points: pointsOf(now), sensitivity });
  };
  return sample.bars === null ? (
    <Unsliced key={sample.id} sample={sample} {...rest} onSliced={(by) => (by === 'transients' ? foundNow(sample.id, SENSITIVITY) : setFound(null))} />
  ) : (
    <Sliced
      key={sample.id}
      sample={sample}
      {...rest}
      found={found !== null && project.samples[found.sampleId] !== undefined ? found : null}
      onFound={(sampleId, sensitivity) => (sampleId === null ? setFound(null) : foundNow(sampleId, sensitivity))}
    />
  );
}

interface SlicedProps extends Omit<TrimSlicingProps, 'sample'> {
  readonly sample: Sample;
  readonly found: TransientsFound | null;
  /** Transients were found for a sample (null: something else was chosen). */
  readonly onFound: (sampleId: Id | null, sensitivity: number) => void;
}

/** A sliced trim: its waveform with numbered slices, the markers between them, and the 1/16 steps they land on. */
function Sliced({ sample, played, toTrim, trim, toPads, stopTransport, found, onFound }: SlicedProps) {
  const project = useProject();
  const { store, services } = useApp();
  const run = useRun();
  const seal = useSeal();
  // The slice picked here: the first to begin with.
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playingSample, setPlayingSample] = useState(false);
  const [sensitivity, setSensitivity] = useState(found?.sensitivity ?? SENSITIVITY);
  /** Bars typed but not committed yet: they apply on blur or Enter, so typing "16" asks once, not at "1". */
  const [barsDraft, setBarsDraft] = useState<string | null>(null);
  /** A sensitivity dragged to that would renumber used slices: it is asked about on release. */
  const [pendingSensitivity, setPendingSensitivity] = useState<number | null>(null);
  const [loopSample, setLoopSample] = useState(true);
  const auditioned = useAuditionPlayhead(playingSample);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [made, setMade] = useState<Matrix | null>(null);
  /** A change that renumbers slices played more than once, waiting for New trim or Renumber. */
  const [asking, setAsking] = useState<{ readonly conflict: Renumber; readonly go: (newTrim: boolean) => void } | null>(null);

  const bars = sample.bars ?? 1;
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
  const by = slicedBy(sample, found);
  const transients = by === 'transients';
  // The audition's playhead, else Play in the header's through the matrix.
  const playhead = auditioned !== null ? (auditioned - sample.offset) / duration : played;

  /**
   * Runs a change to the slicing that gives the sample `next` markers. If it
   * renumbers slices played more than once, it asks first (decision 14): New
   * trim moves this sample's matrix to a new trim with the change, which is
   * then selected; Renumber changes the sample. `then` runs once it is done,
   * with the trim that changed.
   */
  const change = (next: readonly number[], command: (newTrim: boolean) => Command, mergeKey?: string, then?: (sampleId: Id) => void) => {
    const go = (newTrim: boolean) => {
      const before = store.getState().history.present.samples;
      const failed = run(command(newTrim), newTrim ? undefined : mergeKey);
      setError(failed);
      if (failed !== null) return;
      const added = newTrim ? Object.keys(store.getState().history.present.samples).find((id) => !(id in before)) : undefined;
      if (added !== undefined) store.dispatch({ type: 'sliceTarget', sampleId: added });
      then?.(added ?? sample.id);
    };
    const conflict = renumberConflict(project, sample.id, next);
    if (conflict === null) go(false);
    else setAsking({ conflict, go });
  };
  /** New markers, in parts of the sample. */
  const markersTo = (next: readonly number[], mergeKey?: string, then?: (sampleId: Id) => void) =>
    change(next, (newTrim) => setMarkers(sample.id, next, newTrim), mergeKey, then);
  const move = (next: readonly number[]) => markersTo(toParts(next), `markers:${sample.id}`);
  const moveMarker = (index: number, time: number) => {
    const low = (markers[index - 1] ?? 0) + MIN_SLICE;
    const high = (markers[index + 1] ?? duration) - MIN_SLICE;
    move(markers.map((m, i) => (i === index ? Math.max(low, Math.min(high, time)) : m)));
  };
  const at = (clientX: number) => {
    const rect = box?.getBoundingClientRect();
    return rect === undefined ? 0 : Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };
  const addAt = (time: number) => {
    const next = [...markers, time].sort((a, b) => a - b);
    markersTo(toParts(next), undefined, () => setSelected(next.indexOf(time)));
  };
  const cues = cueMarkers(sample);

  /** The hits found in the whole file at a sensitivity, and the markers they give this trim. */
  const transientPoints = (value: number) => {
    if (audio === undefined) return null;
    const points = fileTransients(audio, value);
    return { points, markers: pointMarkers(points, sample.offset, duration) };
  };
  /** Slice points at the hits found at this sensitivity, asking first if they renumber used slices. Moving a marker by hand makes them your own. */
  const detect = (value: number) => {
    const next = transientPoints(value);
    if (next === null) return;
    change(next.markers, (newTrim) => setPoints(sample.id, next.points, newTrim), undefined, (changed) => {
      setSensitivity(value);
      onFound(changed, value);
      setSelected(0);
    });
  };
  /**
   * The Sensitivity slider while dragged: markers follow at once while that
   * renumbers no used slice; otherwise the value waits, and is asked about on
   * release (`releaseSensitivity`), not in the middle of the drag.
   */
  const dragSensitivity = (value: number) => {
    const next = transientPoints(value);
    if (next === null) return;
    if (renumberConflict(project, sample.id, next.markers) !== null) {
      setPendingSensitivity(value);
      return;
    }
    setPendingSensitivity(null);
    setSensitivity(value);
    setSelected(0);
    const failed = run(setPoints(sample.id, next.points), `transients:${sample.id}`);
    setError(failed);
    if (failed === null) onFound(sample.id, value);
  };
  const releaseSensitivity = () => {
    seal();
    if (pendingSensitivity === null) return;
    setPendingSensitivity(null);
    detect(pendingSensitivity);
  };
  /** Commits typed bars, asking first if they renumber used slices. */
  /** `pausing`: typing rested; a value on the way that is not one yet waits for more. */
  const commitBars = (pausing = false) => {
    if (barsDraft === null) return;
    const next = Math.round(Number(barsDraft));
    const valid = barsDraft.trim() !== '' && Number.isFinite(next) && next >= 1 && next <= 64;
    if (pausing && !valid) return;
    setBarsDraft(null);
    if (!valid || next === bars) return;
    change(markersForBars(sample, next), (newTrim) => setSampleBars(sample.id, next, newTrim));
  };
  useCommitAfterPause(barsDraft, () => commitBars(true));
  const chose = () => {
    setSelected(0);
    onFound(null, sensitivity);
  };
  /** Deletes a slice's marker, the selected one's by default; the first, at the start, stays. */
  const deleteMarker = (index = current) => {
    if (index === 0) return;
    markersTo(toParts(markers.filter((_, i) => i !== index)), undefined, () => setSelected(index - 1));
  };
  // Delete and Backspace do as Delete marker does (fas 23b), but not while typing in a field or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target) || modalOpen() || asking !== null) return;
      e.preventDefault();
      deleteMarker();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="stack">
      <div className="view-head row">
        <div className="stack-tight">
          <h2 className="mono">{sliceName(sample)}</h2>
          <div className="row nav-row">
            <button type="button" className="link-text small" title="Trim the start and end of the sample, and pick its channel, below" onClick={toTrim}>
              ← Trim
            </button>
          </div>
          <p className="muted row">
            <label className="field">
              Bars
              <input
                type="number"
                min={1}
                max={64}
                aria-label="Bars in the sample"
                value={barsDraft ?? bars}
                onChange={(e) => setBarsDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter commits here and nothing else: not a button the dialog it may open has.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitBars();
                  }
                  if (e.key === 'Escape') setBarsDraft(null);
                }}
                onBlur={() => commitBars()}
              />
            </label>
            {bpm.toFixed(2)} BPM
            {unlikelyBpm(bpm) && <span className="warn-text">· check the bars: that tempo looks wrong</span>}
            <span>{`· ${markers.length} slices · ${slicedByText(by)}`}</span>
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
                stopTransport();
                setPlayingSample(true);
                services.player.audition(audio, sample.offset, duration, () => setPlayingSample(false), loopSample);
              }}
            />
          )}
          <div className="segmented" role="group" aria-label="Slice by">
            {cues !== null && (
              <button type="button" aria-pressed={by === 'cues'} title="At the cue markers in the WAV file" onClick={() => change(pointMarkers(sample.cues ?? [], sample.offset, duration), (newTrim) => setPoints(sample.id, sample.cues ?? [], newTrim), undefined, chose)}>
                Cue markers
              </button>
            )}
            {GRIDS.map((g) => (
              <button key={g} type="button" aria-pressed={by === g} onClick={() => change(gridMarkers(bars, g), (newTrim) => setGrid(sample.id, g, newTrim), undefined, chose)}>
                1/{g}
              </button>
            ))}
            <button type="button" aria-pressed={transients} disabled={audio === undefined} onClick={() => detect(sensitivity)}>
              Transients
            </button>
          </div>
          {transients && (
            <Slider label="Sensitivity" value={pendingSensitivity ?? sensitivity} min={0} max={100} step={1} format={String} onChange={dragSensitivity} onCommit={releaseSensitivity} />
          )}
        </div>
      </div>

      {trim}
      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: Math.max(1000, markers.length * 24, places.length * 22) }}>
            <div ref={setBox} className="slice-area" onDoubleClick={(e) => addAt(at(e.clientX))}>
              <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
              <div className="slice-grid" style={{ backgroundSize: `${100 / places.length}% 100%` }} aria-hidden="true" />
              {playhead !== null && <div className="playhead" style={{ left: `${playhead * 100}%` }} />}
              {markers.map((m, i) => (
                <button
                  key={`slice-${i}`}
                  type="button"
                  className={`slice-segment${i === current ? ' selected' : ''}`}
                  style={{ left: `${(m / duration) * 100}%`, width: `${((ends[i]! - m) / duration) * 100}%` }}
                  aria-label={`Play slice ${two(i)}`}
                  onClick={() => {
                    setSelected(i);
                    // One thing plays at a time: Play in the header stops.
                    stopTransport();
                    services.player.audition(audio, sample.offset + m, ends[i]! - m);
                  }}
                >
                  <span className="mono">{two(i)}</span>
                </button>
              ))}
              {markers.map((m, i) => (
                <button
                  key={`marker-${i}`}
                  type="button"
                  className={`marker${i === current ? ' selected' : ''}${i === 0 ? ' fixed' : ''}`}
                  style={{ left: `${(m / duration) * 100}%` }}
                  aria-label={`Marker ${two(i)} at ${position(m, stepTime)}`}
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
                  onDoubleClick={(e) => {
                    // A double click on a marker deletes it; in between, it adds one. (Magnus beslut)
                    e.stopPropagation();
                    deleteMarker(i);
                  }}
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
                const label = `Step ${position(i * stepTime, stepTime)}: ${p.slice === null ? 'empty' : `slice ${two(p.slice)}`}${p.dropped.length > 0 ? `; ${p.dropped.length + 1} slices here, ${p.dropped.map((d) => `slice ${two(d)}`).join(' and ')} dropped` : ''}`;
                return (
                  <div
                    key={i}
                    style={{ gridColumn: i + 1, gridRow: 1 }}
                    className={`slice-step${p.slice !== null ? ' filled' : ''}${p.slice === current ? ' selected' : ''}${p.dropped.length > 0 ? ' clash' : ''}${i % 4 === 0 ? ' downbeat' : ''}`}
                    title={p.dropped.length > 0 ? `${p.dropped.length + 1} slices land here: only ${two(p.slice!)} plays` : undefined}
                    aria-label={label}
                  >
                    {p.slice === null ? '' : two(p.slice)}
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
          <h3 className="label">Slice {two(current)}</h3>
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
            <button type="button" onClick={() => addAt(((markers[current] ?? 0) + (ends[current] ?? duration)) / 2)}>
              Add marker
            </button>
            <button type="button" disabled={current === 0} title="Delete or Backspace" onClick={() => deleteMarker()}>
              Delete marker
            </button>
            <button
              type="button"
              title="A new trim of the file over just this slice, with a matrix of one pad. This trim stays as it is."
              onClick={() => {
                const before = store.getState().history.present.matrices;
                const failed = run(makeOneShot(sample.id, current));
                setError(failed);
                setMade(Object.values(store.getState().history.present.matrices).find((m) => !(m.id in before)) ?? null);
              }}
            >
              New matrix from slice
            </button>
          </div>
          {made !== null && (
            <p className="small">
              Made the matrix <span className="mono">{made.name}</span>{' '}
              <button type="button" className="link-text small" onClick={() => toPads(made)}>
                Pads →
              </button>
            </p>
          )}
          <p className="muted small">Drag a marker, or select it and use ←/→ (Shift: 10 ms). Double-click the waveform to add one.</p>
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
          canNewTrim={own !== undefined}
          onAnswer={(newTrim) => {
            setAsking(null);
            if (newTrim !== null) asking.go(newTrim);
          }}
        />
      )}
    </div>
  );
}

interface UnslicedProps extends Omit<TrimSlicingProps, 'sample'> {
  readonly sample: Sample;
  /** After it is sliced, and how. */
  readonly onSliced: (by: SliceBy) => void;
}

/**
 * A trim not sliced yet: nothing is made until its bars and how to slice it
 * are both chosen, then its matrix gets a pad per slice and a loop, in one
 * undo step. The file's cue markers, if it has any, are chosen to start with.
 */
function Unsliced({ sample, toTrim, trim, stopTransport, onSliced }: UnslicedProps) {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const cues = cueMarkers(sample);
  const [bars, setBars] = useState<number | null>(null);
  const [by, setBy] = useState<SliceBy | null>(cues === null ? null : 'cues');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const playhead = useAuditionPlayhead(playing);
  const audio = sampleAudio(project, sample);
  const duration = sample.duration;

  const slice = (bars: number | null, by: SliceBy | null, mergeKey?: string) => {
    if (bars === null || by === null) return;
    // Cues and transients are slice points in the whole file; a grid is laid over the trim.
    const points = by === 'cues' ? (sample.cues ?? []) : by === 'transients' ? (audio === undefined ? null : fileTransients(audio, SENSITIVITY)) : undefined;
    if (points === null) return;
    const failed = run(setSlicing(sample.id, bars, points === undefined ? gridMarkers(bars, by as SliceGrid) : undefined, points), mergeKey);
    setError(failed);
    if (failed === null) onSliced(by);
  };

  // Marked Slice by a click: sliced once by default, at its cues or transients and guessed bars, in the mark's undo step. (Magnus beslut)
  const autoSlice = useSelect((s) => s.autoSlice);
  useEffect(() => {
    if (autoSlice !== sample.id || store.getState().autoSlice !== sample.id) return;
    store.dispatch({ type: 'autoSlice', sampleId: null });
    const guessed = guessBars(duration);
    setBars(guessed);
    const by: SliceBy = cues !== null ? 'cues' : audio !== undefined ? 'transients' : 16;
    setBy(by);
    slice(guessed, by, `slice:${sample.id}`);
    seal();
    // Once per click that set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSlice]);

  return (
    <div className="stack">
      <div className="view-head row">
        <div className="stack-tight">
          <h2 className="mono">{sampleLabel(project, sample)}</h2>
          <div className="row nav-row">
            <button type="button" className="link-text small" title="Trim the start and end of the sample, and pick its channel, below" onClick={toTrim}>
              ← Trim
            </button>
          </div>
          <p className={bars === null && by !== null ? 'warn-text' : 'muted'}>
            {bars === null && by !== null
              ? 'Set its bars to slice it.'
              : bars !== null && by === null
                ? 'Pick how to slice it: 1/4, 1/8, 1/16 or Transients.'
                : 'Not sliced yet: set its bars and how to slice it. Nothing is made before that.'}
          </p>
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
            {bars !== null && `${sampleBpm({ duration, bars })!.toFixed(2)} BPM`}
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
                stopTransport();
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
      {trim}
      {audio !== undefined && (
        <div className="table-scroll slice-box">
          <div className="slice-canvas" style={{ minWidth: 1000 }}>
            <div className="slice-area">
              <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
              {by === 'cues' && cues?.map((m, i) => <div key={i} className="cue-line" style={{ left: `${m * 100}%` }} aria-hidden="true" />)}
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
    </div>
  );
}
