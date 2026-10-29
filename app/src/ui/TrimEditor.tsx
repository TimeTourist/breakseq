import { useRef, useState } from 'react';
import type { Renumber, Sample, SampleChannel } from '../model';
import { MIN_SLICE, ownMatrix, pointsOf, retrimConflict, sampleAudio, setSampleChannel, trimSample } from '../model';
import { useApp, useProject, useRun, useSeal } from './context';
import { RenumberDialog } from './RenumberDialog';
import { RegionHandle } from './RegionHandle';
import { Waveform } from './Waveform';

const ms = (seconds: number) => Math.round(seconds * 1000);

const CHANNELS: [SampleChannel, string, string][] = [
  ['stereo', 'Stereo', 'Both channels, as the file is'],
  ['left', 'L', 'The left channel, in both'],
  ['right', 'R', 'The right channel, in both'],
  ['mono', 'Mono', 'Left and right averaged, in both'],
];

/**
 * The top of a sample's editor: the whole file with the sample's window
 * between two handles, then the Trim row (start, end, Snap and the channel),
 * and its help below it. (Magnus beslut)
 */
export function TrimEditor({
  sample,
  playhead = null,
}: {
  readonly sample: Sample;
  /** Where in the file what plays of the sample is, in seconds, while it plays. */
  readonly playhead?: number | null;
}) {
  const project = useProject();
  const { store } = useApp();
  const run = useRun();
  const seal = useSeal();
  /** Snap to nearest slice: the handles go from slice point to slice point; off, they move freely. (Magnus beslut) */
  const [snap, setSnap] = useState(false);
  /** A new start and end that would renumber used slices: shown, and asked about on release. */
  const [pending, setPending] = useState<{ readonly from: number; readonly to: number } | null>(null);
  const [asking, setAsking] = useState<{ readonly conflict: Renumber; readonly go: (newTrim: boolean) => void } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The file with the sample's channel choice, so what is shown and heard is what plays.
  const audio = sampleAudio(project, sample);

  if (audio === undefined) return null;

  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const start = pending?.from ?? sample.offset;
  const end = pending?.to ?? sample.offset + sample.duration;
  const conflictAt = (from: number, to: number) => retrimConflict(project, sample.id, from, to);
  /** Trims to `from`–`to`: slice points stay in the file. With `newTrim`, in a new sample, which is then selected. */
  const apply = (from: number, to: number, newTrim = false) => {
    const before = store.getState().history.present.samples;
    const failed = run(trimSample(sample.id, from, to, newTrim), newTrim ? undefined : `trim:${sample.id}`);
    setError(failed);
    if (failed !== null) return;
    const added = newTrim ? Object.keys(store.getState().history.present.samples).find((id) => !(id in before)) : undefined;
    if (added !== undefined) {
      store.dispatch({ type: 'sliceTarget', sampleId: added });
      const found = store.getState().transients;
      if (found?.sampleId === sample.id) store.dispatch({ type: 'transients', found: { ...found, sampleId: added } });
    }
  };
  /** Where the handles snap to: the slice points in the file, and its start and end. */
  const snapPoints = snap && sample.bars !== null ? [0, ...pointsOf(sample), length].sort((a, b) => a - b) : null;
  /** The slice point nearest `t` that keeps the trim at least MIN_SLICE long, or `t` with Snap off. */
  const snapped = (which: 'start' | 'end', t: number) => {
    const allowed = snapPoints?.filter((p) => (which === 'start' ? p <= end - MIN_SLICE : p >= start + MIN_SLICE)) ?? [];
    return allowed.length === 0 ? t : allowed.reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best));
  };
  /** With Snap on, the next slice point from `t` in `direction`; null when there is none. */
  const nextPoint = (which: 'start' | 'end', t: number, direction: -1 | 1) => {
    const allowed = snapPoints!.filter((p) => (which === 'start' ? p <= end - MIN_SLICE : p >= start + MIN_SLICE) && direction * (p - t) > 1e-6);
    return allowed.length === 0 ? null : direction > 0 ? allowed[0]! : allowed[allowed.length - 1]!;
  };
  /** While dragging or typing: at once, unless it renumbers used slices; then it waits for release (`done`). */
  const trim = (from: number, to: number) => {
    if (conflictAt(from, to) !== null) {
      setPending({ from, to });
      return;
    }
    setPending(null);
    apply(from, to);
  };
  /** Trims at once, asking first if it renumbers used slices. */
  const trimNow = (from: number, to: number) => {
    const conflict = conflictAt(from, to);
    if (conflict === null) apply(from, to);
    else setAsking({ conflict, go: (newTrim) => apply(from, to, newTrim) });
  };
  /** A drag, key press or typing has ended: closes its undo step, and asks about a trim that waited. */
  const done = () => {
    seal();
    if (pending === null) return;
    setPending(null);
    trimNow(pending.from, pending.to);
  };
  const at = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    return rect === undefined ? 0 : Math.max(0, Math.min(length, ((clientX - rect.left) / rect.width) * length));
  };

  /** One end of the trim: dragged, or moved with ←/→ (Shift: 10 ms). */
  const handle = (which: 'start' | 'end') => (
    <RegionHandle
      which={which}
      left={`${((which === 'start' ? start : end) / length) * 100}%`}
      label={`${which === 'start' ? 'Start' : 'End'} at ${ms(which === 'start' ? start : end)} ms`}
      onDrag={(x) => {
        const t = snapped(which, at(x));
        if (which === 'start') trim(Math.min(t, end - 0.001), end);
        else trim(start, Math.max(t, start + 0.001));
      }}
      onNudge={(direction, big) => {
        const from = which === 'start' ? start : end;
        const to = snapPoints === null ? from + (direction * (big ? 10 : 1)) / 1000 : nextPoint(which, from, direction);
        if (to === null) return;
        if (which === 'start') trim(to, end);
        else trim(start, to);
      }}
      onDone={done}
    />
  );

  return (
    <div className="trim stack-tight">
      <div className="trim-wave overview" ref={box}>
        <Waveform audio={audio} offset={0} duration={length} height={52} />
        <div className="region-shade" style={{ left: 0, width: `${(start / length) * 100}%` }} />
        <div className="region-shade" style={{ left: `${(end / length) * 100}%`, right: 0 }} />
        {playhead !== null && <div className="playhead" style={{ left: `${(playhead / length) * 100}%` }} />}
        {handle('start')}
        {handle('end')}
      </div>
      <div className="row trim-row">
        <span className="row-label">Trim</span>
        <label className="field">
          Start
          <input type="number" aria-label="Start ms" min={0} max={ms(end) - 1} value={ms(start)} onChange={(e) => trim(Number(e.target.value) / 1000, end)} onBlur={done} />
          ms
        </label>
        <label className="field">
          End
          <input type="number" aria-label="End ms" min={ms(start) + 1} max={ms(length)} value={ms(end)} onChange={(e) => trim(start, Number(e.target.value) / 1000)} onBlur={done} />
          ms
        </label>
        <span className="mono muted small">of {ms(length)} ms</span>
        {sample.bars !== null && (
          <button type="button" className="loop-toggle" aria-pressed={snap} title="Dragged, the start and end go from slice to slice; off, they move freely" onClick={() => setSnap(!snap)}>
            Snap to nearest slice
          </button>
        )}
        <div className="segmented" role="group" aria-label="Channel">
          {CHANNELS.map(([channel, label, title]) => (
            <button
              key={channel}
              type="button"
              title={title}
              aria-label={channel === 'left' ? 'Left' : channel === 'right' ? 'Right' : label}
              aria-pressed={sample.channel === channel}
              onClick={() => setError(run(setSampleChannel(sample.id, channel)))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small help">
        {snapPoints === null
          ? 'Drag the yellow handles to set where the sample starts and ends in the file. Focus one and use ←/→ (Shift: 10 ms).'
          : 'Drag the yellow handles to set where the sample starts and ends in the file; with Snap on they go from slice to slice, and so do ←/→.'}
      </p>
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
    </div>
  );
}
