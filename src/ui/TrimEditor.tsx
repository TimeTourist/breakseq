import { useEffect, useRef, useState } from 'react';
import type { Renumber, Sample, SampleChannel } from '../model';
import { MIN_SLICE, ownMatrix, pointsOf, retrimConflict, sampleAudio, setSampleChannel, trimSample } from '../model';
import { useApp, useProject, useRun, useSeal } from './context';
import { RenumberDialog } from './RenumberDialog';
import { useAuditionPlayhead } from './AuditionPlayhead';
import { PlayControls } from './PlayControls';
import { RegionHandle } from './RegionHandle';
import { Waveform } from './Waveform';

const ms = (seconds: number) => Math.round(seconds * 1000);

const CHANNELS: [SampleChannel, string, string][] = [
  ['stereo', 'Stereo', 'Both channels, as the file is'],
  ['left', 'Left', 'The left channel, in both'],
  ['right', 'Right', 'The right channel, in both'],
  ['mono', 'Mono', 'Left and right averaged, in both'],
];

/** Start and end of an imported sample, as a window in its file, and which of its channels play. */
export function TrimEditor({
  sample,
  played = null,
  transport,
}: {
  readonly sample: Sample;
  /** Where Play (the one at the top) is in the trimmed sample, in seconds, while it plays it. */
  readonly played?: number | null;
  /**
   * Play in the header, which plays the open Trim, looped: given, ▶ here is
   * that same Play, so one stops the other. Left out, ▶ auditions on its own.
   */
  readonly transport?: { readonly playing: boolean; readonly ready: boolean; readonly onToggle: () => void };
}) {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  /** Snap to nearest slice: the handles go from slice point to slice point; off, they move freely. (Magnus beslut) */
  const [snap, setSnap] = useState(false);
  /** A new start and end that would renumber used slices: shown, and asked about on release. */
  const [pending, setPending] = useState<{ readonly from: number; readonly to: number } | null>(null);
  const [asking, setAsking] = useState<{ readonly conflict: Renumber; readonly go: (newTrim: boolean) => void } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // Plays looped at first, breaks and one-shots alike.
  const [loop, setLoop] = useState(true);
  const auditioned = useAuditionPlayhead(playing);
  // The file with the sample's channel choice, so what is shown and heard is what plays.
  const audio = sampleAudio(project, sample);

  // Closing the editor stops what it plays.
  useEffect(() => () => services.player.stopAudition(), [services]);

  if (audio === undefined) return null;

  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const playhead = auditioned ?? (played === null ? null : sample.offset + played);
  const start = pending?.from ?? sample.offset;
  const end = pending?.to ?? sample.offset + sample.duration;
  const conflictAt = (from: number, to: number) => retrimConflict(project, sample.id, from, to);
  /** Trims to `from`–`to`: slice points stay in the file. With `newTrim`, in a new trim, which is then selected. */
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
    // A loop that is playing follows the new start and end straight away.
    if (playing) {
      const clampedStart = Math.max(0, from);
      services.player.setAuditionRegion(clampedStart, Math.min(length, to) - clampedStart);
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
  const play = (looped: boolean) => {
    setPlaying(true);
    services.player.audition(audio, start, sample.duration, () => setPlaying(false), looped);
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
      <div className="trim-wave" ref={box}>
        <Waveform audio={audio} offset={0} duration={length} height={120} />
        <div className="region-shade" style={{ left: 0, width: `${(start / length) * 100}%` }} />
        <div className="region-shade" style={{ left: `${(end / length) * 100}%`, right: 0 }} />
        {playhead !== null && <div className="playhead" style={{ left: `${(playhead / length) * 100}%` }} />}
        {handle('start')}
        {handle('end')}
      </div>
      <div className="row">
        <label className="field">
          Start ms
          <input
            type="number"
            min={0}
            max={ms(end) - 1}
            value={ms(start)}
                  onChange={(e) => trim(Number(e.target.value) / 1000, end)}
            onBlur={done}
          />
        </label>
        <label className="field">
          End ms
          <input
            type="number"
            min={ms(start) + 1}
            max={ms(length)}
            value={ms(end)}
                  onChange={(e) => trim(start, Number(e.target.value) / 1000)}
            onBlur={done}
          />
        </label>
        <span className="mono muted small">
          {ms(sample.duration)} ms of {ms(length)} ms
        </span>
        <div className="segmented" role="group" aria-label="Channel">
          {CHANNELS.map(([channel, label, title]) => (
            <button
              key={channel}
              type="button"
              title={title}
              aria-pressed={sample.channel === channel}
              onClick={() => {
                // What plays now is the old channels: stop it, and play again to hear the new ones.
                if (playing) services.player.stopAudition();
                setError(run(setSampleChannel(sample.id, channel)));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {sample.bars !== null && (
          <div className="segmented">
            <button type="button" aria-pressed={snap} title="Dragged, the start and end go from slice to slice; off, they move freely" onClick={() => setSnap(!snap)}>
              Snap to nearest slice
            </button>
          </div>
        )}
        <div className="row push">
          {transport === undefined ? (
            <PlayControls
              what="trim"
              playing={playing}
              onToggle={() => (playing ? services.player.stopAudition() : play(loop))}
              loop={loop}
              onLoop={(next) => {
                setLoop(next);
                if (playing) play(next);
              }}
            />
          ) : (
            <PlayControls
              what="trim"
              playing={transport.playing}
              disabled={!transport.playing && !transport.ready}
              onToggle={transport.onToggle}
              title={!transport.playing && !transport.ready ? 'Rendering…' : 'Plays the trim looped, as Play at the top does'}
            />
          )}
          <button type="button" disabled={(start === 0 && Math.abs(end - length) < 1e-9)} onClick={() => trimNow(0, length)}>
            Reset
          </button>
        </div>
      </div>
      <p className="muted small">
        {snapPoints === null ? 'Drag the handles, or focus one and use ←/→ (Shift: 10 ms).' : 'Drag the handles, or focus one and use ←/→: they go from slice to slice.'}
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
