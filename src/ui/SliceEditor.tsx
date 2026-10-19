import { useEffect, useState } from 'react';
import type { AudioData, Command, Id, Renumber, Sample, SliceGrid } from '../model';
import {
  MIN_SLICE,
  STEPS_PER_BAR,
  cueMarkers,
  gridMarkers,
  guessBars,
  holds,
  makeSampleFromSlices,
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
  slicePlaces,
  unlikelyBpm,
  unsliceTakes,
  unsliceUsages,
} from '../model';
import { detectTransients } from '../engine';
import { useApp, useProject, useRun, useSeal, useSelect } from './context';
import { ConfirmDelete } from './DeleteButton';
import { RenumberDialog } from './RenumberDialog';
import { useAuditionPlayhead } from './AuditionPlayhead';
import { Slider } from './Slider';
import { TrimEditor } from './TrimEditor';
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

/** A time as bar.beat.sixteenth, 1-based, with the rest in ms when it is off the grid. */
function position(time: number, stepTime: number): string {
  const step = Math.round(time / stepTime);
  const off = ms(time - step * stepTime);
  const at = `${Math.floor(step / 16) + 1}.${Math.floor((step % 16) / 4) + 1}.${(step % 4) + 1}`;
  return off === 0 ? at : `${at} ${off > 0 ? '+' : ''}${off} ms`;
}

interface SampleEditorProps {
  readonly sample: Sample;
  /** Where Play in the header is in the sample, in seconds from its start, while it plays it. */
  readonly played: number | null;
  /** Stops Play in the header, before something here plays: one thing plays at a time. */
  readonly stopTransport: () => void;
}

/**
 * The selected sample's editor, one for trim and slicing (Magnus beslut): the
 * whole file with the trim, the sample's own waveform with its slices and the
 * 1/16 steps they land on, and Slices last: None, or how it is sliced. The
 * transients last found are kept in the store, so Transients stays chosen
 * across a new sample, and undo and redo.
 */
export function SampleEditor({ sample, played, stopTransport }: SampleEditorProps) {
  const project = useProject();
  const { store, services } = useApp();
  const run = useRun();
  const seal = useSeal();
  const stored = useSelect((s) => s.transients);
  const found = stored !== null && project.samples[stored.sampleId] !== undefined ? stored : null;
  const setFound = (next: TransientsFound | null) => store.dispatch({ type: 'transients', found: next });
  const foundNow = (sampleId: Id, sensitivity: number) => {
    const now = store.getState().history.present.samples[sampleId];
    setFound(now === undefined ? null : { sampleId, points: pointsOf(now), sensitivity });
  };

  // The slice picked here, and the other end of a range picked with Shift-click.
  const [selected, setSelected] = useState(0);
  const [to, setTo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(found?.sampleId === sample.id ? found.sensitivity : SENSITIVITY);
  /** Bars typed but not committed yet: they apply on blur, Enter or a pause, so typing "16" asks once, not at "1". */
  const [barsDraft, setBarsDraft] = useState<string | null>(null);
  /** A sensitivity dragged to that would renumber used slices: it is asked about on release. */
  const [pendingSensitivity, setPendingSensitivity] = useState<number | null>(null);
  /** What an audition here plays: a slice, or a one shot whole. */
  const [auditioning, setAuditioning] = useState(false);
  const auditioned = useAuditionPlayhead(auditioning);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  /** A change that renumbers slices played more than once, waiting for New sample or Renumber. */
  const [asking, setAsking] = useState<{ readonly conflict: Renumber; readonly go: (newTrim: boolean) => void } | null>(null);
  /** None on a sliced sample: asked first, as Delete does. */
  const [unslicing, setUnslicing] = useState(false);

  const sliced = sample.bars !== null;
  const bars = sample.bars ?? 1;
  const bpm = sampleBpm(sample);
  const audio = sampleAudio(project, sample);
  const duration = sample.duration;
  // Markers are parts of the sample; here they are worked with in seconds.
  const markers = sliced ? sample.markers.map((m) => m * duration) : [0];
  const stepTime = duration / (bars * STEPS_PER_BAR);
  const current = Math.min(selected, markers.length - 1);
  const other = Math.min(to, markers.length - 1);
  const low = Math.min(current, other);
  const high = Math.max(current, other);
  const ends = markers.map((_, i) => markers[i + 1] ?? duration);
  /** The slices on the sample's 1/16 grid, as laying its matrix in a loop places them. */
  const places = sliced ? slicePlaces(sample.markers, bars * STEPS_PER_BAR) : [];
  const toParts = (seconds: readonly number[]) => seconds.map((m) => m / duration);
  const by = slicedBy(sample, found);
  const cues = cueMarkers(sample);
  // An audition's playhead here, else Play in the header's.
  const playhead = auditioned !== null ? (auditioned - sample.offset) / duration : played === null ? null : played / duration;

  const pick = (index: number) => {
    setSelected(index);
    setTo(index);
  };
  /** Plays a stretch of the sample at once, stopping Play in the header: one thing plays at a time. */
  const audition = (from: number, length: number) => {
    if (audio === undefined) return;
    stopTransport();
    setAuditioning(true);
    services.player.audition(audio, sample.offset + from, length, () => setAuditioning(false), false);
  };

  /**
   * Runs a change to the slicing that gives the sample `next` markers. If it
   * renumbers slices played more than once, it asks first (decision 14): New
   * sample moves this sample's matrix to a new sample with the change, which
   * is then selected; Renumber changes the sample. `then` runs once it is
   * done, with the sample that changed.
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
    const lowest = (markers[index - 1] ?? 0) + MIN_SLICE;
    const highest = (markers[index + 1] ?? duration) - MIN_SLICE;
    move(markers.map((m, i) => (i === index ? Math.max(lowest, Math.min(highest, time)) : m)));
  };
  const at = (clientX: number) => {
    const rect = box?.getBoundingClientRect();
    return rect === undefined ? 0 : Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };
  const addAt = (time: number) => {
    const next = [...markers, time].sort((a, b) => a - b);
    markersTo(toParts(next), undefined, () => pick(next.indexOf(time)));
  };

  /** The hits found in the whole file at a sensitivity, and the markers they give this sample. */
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
      foundNow(changed, value);
      pick(0);
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
    pick(0);
    const failed = run(setPoints(sample.id, next.points), `transients:${sample.id}`);
    setError(failed);
    if (failed === null) foundNow(sample.id, value);
  };
  const releaseSensitivity = () => {
    seal();
    if (pendingSensitivity === null) return;
    setPendingSensitivity(null);
    detect(pendingSensitivity);
  };
  /** Commits typed bars, asking first if they renumber used slices. `pausing`: typing rested; a value on the way that is not one yet waits for more. */
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
    pick(0);
    setFound(null);
  };

  /**
   * A one shot sliced at once, in one undo step: at guessed bars, at its
   * transients or cues (slice points in the whole file) or on a grid. (Magnus beslut)
   */
  const sliceNow = (how: SliceBy) => {
    const guessed = guessBars(duration);
    const points = how === 'cues' ? (sample.cues ?? []) : how === 'transients' ? (audio === undefined ? null : fileTransients(audio, sensitivity)) : undefined;
    if (points === null) return;
    const failed = run(setSlicing(sample.id, guessed, points === undefined ? gridMarkers(guessed, how as SliceGrid) : undefined, points));
    setError(failed);
    if (failed !== null) return;
    pick(0);
    if (how === 'transients') foundNow(sample.id, sensitivity);
    else setFound(null);
  };
  /** How to slice it, from the Slices row: on a one shot it slices it; on a sliced sample it changes how. */
  const choose = (how: SliceBy) => {
    if (!sliced) return sliceNow(how);
    if (how === 'transients') return detect(sensitivity);
    if (how === 'cues') return change(pointMarkers(sample.cues ?? [], sample.offset, duration), (newTrim) => setPoints(sample.id, sample.cues ?? [], newTrim), undefined, chose);
    change(gridMarkers(bars, how), (newTrim) => setGrid(sample.id, how, newTrim), undefined, chose);
  };
  /** None: a sliced sample asks first; one only marked to be sliced loses the mark. */
  const none = () => {
    if (sliced) setUnslicing(true);
    else if (sample.unsliced === true) setError(run(setSlicing(sample.id, null)));
  };

  /** Deletes a slice's marker, the selected one's by default; the first, at the start, stays. */
  const deleteMarker = (index = current) => {
    if (index === 0 || !sliced) return;
    markersTo(toParts(markers.filter((_, i) => i !== index)), undefined, () => pick(index - 1));
  };
  // Delete and Backspace delete the selected slice's marker, but not while typing in a field or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target) || modalOpen() || asking !== null || unslicing) return;
      e.preventDefault();
      deleteMarker();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /** A new sample of the file over the selected slices; it is then selected. (Magnus beslut) */
  const newSample = () => {
    const before = store.getState().history.present.samples;
    const failed = run(makeSampleFromSlices(sample.id, low, high));
    setError(failed);
    if (failed !== null) return;
    const added = Object.keys(store.getState().history.present.samples).find((id) => !(id in before));
    if (added !== undefined) store.dispatch({ type: 'sliceTarget', sampleId: added });
  };

  // Room for the slice numbers and steps; past that it scrolls inside its box, never the page.
  const canvasWidth = sliced ? Math.max(markers.length * 20, places.length * 14) : 0;

  return (
    <div className="sample-editor stack">
      <TrimEditor sample={sample} playhead={playhead === null ? null : sample.offset + playhead * duration} />

      {audio !== undefined && (
        <div className="stack-tight">
          <div className="table-scroll slice-box">
            <div className="slice-canvas" style={{ minWidth: canvasWidth }}>
              {sliced ? (
                <div ref={setBox} className="slice-area" onDoubleClick={(e) => addAt(at(e.clientX))}>
                  <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
                  <div className="slice-grid" style={{ backgroundSize: `${100 / places.length}% 100%` }} aria-hidden="true" />
                  {playhead !== null && <div className="playhead" style={{ left: `${playhead * 100}%` }} />}
                  {markers.map((m, i) => (
                    <button
                      key={`slice-${i}`}
                      type="button"
                      className={`slice-segment${i >= low && i <= high ? ' selected' : ''}`}
                      style={{ left: `${(m / duration) * 100}%`, width: `${((ends[i]! - m) / duration) * 100}%` }}
                      aria-label={`Play slice ${two(i)}`}
                      aria-pressed={i >= low && i <= high}
                      onClick={(e) => {
                        // Shift-click picks every slice from the selected one to this one. (Magnus beslut)
                        if (e.shiftKey) {
                          setTo(i);
                          return;
                        }
                        pick(i);
                        audition(m, ends[i]! - m);
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
                      onFocus={() => pick(i)}
                      onPointerDown={(e) => {
                        pick(i);
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
              ) : (
                <button type="button" className="slice-area one-shot" aria-label={`Play ${sampleLabel(project, sample)}`} onClick={() => audition(0, duration)}>
                  <Waveform audio={audio} offset={sample.offset} duration={duration} height={200} />
                  {playhead !== null && <div className="playhead" style={{ left: `${playhead * 100}%` }} />}
                </button>
              )}
              {sliced && (
                <div className="slice-steps" style={{ gridTemplateColumns: `repeat(${places.length}, minmax(0, 1fr))` }} aria-label="Where the slices land on the 1/16 grid">
                  {places.map((p, i) => {
                    const label = `Step ${position(i * stepTime, stepTime)}: ${p.slice === null ? 'empty' : `slice ${two(p.slice)}`}${p.dropped.length > 0 ? `; ${p.dropped.length + 1} slices here, ${p.dropped.map((d) => `slice ${two(d)}`).join(' and ')} dropped` : ''}`;
                    return (
                      <div
                        key={i}
                        style={{ gridColumn: i + 1, gridRow: 1 }}
                        className={`slice-step${p.slice !== null ? ' filled' : ''}${p.slice !== null && p.slice >= low && p.slice <= high ? ' selected' : ''}${p.dropped.length > 0 ? ' clash' : ''}${i % 4 === 0 ? ' downbeat' : ''}`}
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
              )}
            </div>
          </div>
          <p className="muted small help">
            {sliced
              ? 'Click a slice to hear it, Shift-click to select more; Space or ▶ plays the whole sample. Double-click the waveform to add a marker, double-click a marker to delete it. Drag a marker, or select it and use ←/→ (Shift: 10 ms).'
              : 'Click the waveform to hear it; Space or ▶ plays it too. Pick a way to slice to turn it into a break.'}
          </p>
        </div>
      )}

      <div className="row slices-row">
        <span className="row-label">Slices</span>
        <div className="segmented" role="group" aria-label="Slices">
          <button type="button" aria-pressed={!sliced} title="One shot: the whole sample is one hit" onClick={none}>
            None
          </button>
          <button type="button" aria-pressed={by === 'transients'} disabled={audio === undefined} title="A slice at each hit in the sound" onClick={() => choose('transients')}>
            Transients
          </button>
          {cues !== null && (
            <button type="button" aria-pressed={by === 'cues'} title="At the cue markers in the WAV file" onClick={() => choose('cues')}>
              Cues
            </button>
          )}
          {GRIDS.map((g) => (
            <button key={g} type="button" aria-pressed={by === g} title={`Equal slices, ${g} per bar`} onClick={() => choose(g)}>
              1/{g}
            </button>
          ))}
        </div>
        {by === 'transients' && (
          <Slider label="Sensitivity" value={pendingSensitivity ?? sensitivity} min={0} max={100} step={1} format={String} onChange={dragSensitivity} onCommit={releaseSensitivity} />
        )}
        {sliced ? (
          <>
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
            {bpm !== null && <span className="mono muted small">= {bpm.toFixed(2)} BPM</span>}
            {bpm !== null && unlikelyBpm(bpm) && (
              <span className="warn-text small" title="That tempo looks wrong: set how many bars the sample is">
                check the bars
              </span>
            )}
            <button type="button" className="push" title="A new sample of the file over the selected slices: one slice is a one shot, more keep their slices" onClick={newSample}>
              {low === high ? `New sample from slice ${two(low)}` : `New sample from slices ${two(low)}–${two(high)}`}
            </button>
          </>
        ) : (
          <span className="mono muted small">{ms(duration)} ms</span>
        )}
      </div>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {asking !== null && (
        <RenumberDialog
          project={project}
          conflict={asking.conflict}
          canNewTrim={ownMatrix(project, sample.id) !== undefined}
          onAnswer={(newTrim) => {
            setAsking(null);
            if (newTrim !== null) asking.go(newTrim);
          }}
        />
      )}
      {unslicing && (
        <ConfirmDelete
          name={sampleLabel(project, sample)}
          question={`Don't slice ${sampleLabel(project, sample)}?`}
          action="Don't slice"
          goes={unsliceTakes(project, sample.id)}
          usages={unsliceUsages(project, sample.id)}
          onAnswer={(yes) => {
            setUnslicing(false);
            if (yes) {
              setError(run(setSlicing(sample.id, null)));
              setFound(null);
            }
          }}
        />
      )}
    </div>
  );
}
