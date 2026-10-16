import { useEffect, useRef, useState } from 'react';
import type { Sample } from '../model';
import { trimSample } from '../model';
import { useApp, useProject, useRun, useSeal } from './context';
import { PlayMode, useAuditionPlayhead } from './AuditionPlayhead';
import { Waveform } from './Waveform';

const ms = (seconds: number) => Math.round(seconds * 1000);

/** Start and end of an imported sample, as a window in its file. */
export function TrimEditor({ sample, loopFirst }: { readonly sample: Sample; readonly loopFirst: boolean }) {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const seal = useSeal();
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // Breaks are trimmed to loop; one-shots to play once.
  const [loop, setLoop] = useState(loopFirst);
  const playhead = useAuditionPlayhead(playing);
  const audio = project.audio[sample.audioId];

  // Closing the editor stops what it plays.
  useEffect(() => () => services.player.stopAudition(), [services]);

  if (audio === undefined) return null;

  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const start = sample.offset;
  const end = sample.offset + sample.duration;
  const trim = (from: number, to: number) => {
    const failed = run(trimSample(sample.id, from, to), `trim:${sample.id}`);
    setError(failed);
    // A loop that is playing follows the new start and end straight away.
    if (failed === null && playing) {
      const clampedStart = Math.max(0, from);
      services.player.setAuditionRegion(clampedStart, Math.min(length, to) - clampedStart);
    }
  };
  const play = (looped: boolean) => {
    setPlaying(true);
    services.player.audition(audio, start, sample.duration, () => setPlaying(false), looped);
  };
  const at = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    return rect === undefined ? 0 : Math.max(0, Math.min(length, ((clientX - rect.left) / rect.width) * length));
  };

  /** Dragging a handle moves that end; one drag is one undo step. */
  const handle = (which: 'start' | 'end') => (
    <button
      type="button"
      className={`trim-handle ${which}`}
      style={{ left: `${((which === 'start' ? start : end) / length) * 100}%` }}
      aria-label={`${which === 'start' ? 'Start' : 'End'} at ${ms(which === 'start' ? start : end)} ms`}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const t = at(e.clientX);
        if (which === 'start') trim(Math.min(t, end - 0.001), end);
        else trim(start, Math.max(t, start + 0.001));
      }}
      onPointerUp={seal}
      onKeyDown={(e) => {
        const delta = (e.shiftKey ? 10 : 1) / 1000;
        const move = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
        if (move === 0) return;
        e.preventDefault();
        if (which === 'start') trim(start + move, end);
        else trim(start, end + move);
      }}
      onKeyUp={seal}
    />
  );

  return (
    <div className="trim stack-tight">
      <div className="trim-wave" ref={box}>
        <Waveform audio={audio} offset={0} duration={length} height={120} color="#9aa0a6" />
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
            onBlur={seal}
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
            onBlur={seal}
          />
        </label>
        <span className="mono muted small">
          {ms(sample.duration)} ms of {ms(length)} ms
        </span>
        <div className="row push">
          <PlayMode
            loop={loop}
            onChange={(next) => {
              setLoop(next);
              if (playing) play(next);
            }}
          />
          <button type="button" aria-pressed={playing} onClick={() => (playing ? services.player.stopAudition() : play(loop))}>
            {playing ? 'Stop' : 'Play trimmed'}
          </button>
          <button type="button" disabled={(start === 0 && Math.abs(end - length) < 1e-9)} onClick={() => trim(0, length)}>
            Reset
          </button>
        </div>
      </div>
      <p className="muted small">Drag the handles, or focus one and use ←/→ (Shift: 10 ms).</p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
