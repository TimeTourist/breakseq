import { useRef, useState } from 'react';
import type { Sample } from '../model';
import { trimSample } from '../model';
import { useApp, useProject, useRun, useSeal } from './context';
import { Waveform } from './Waveform';

const ms = (seconds: number) => Math.round(seconds * 1000);

/** Start and end of an imported sample, as a window in its file. */
export function TrimEditor({ sample }: { readonly sample: Sample }) {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const seal = useSeal();
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = project.audio[sample.audioId];
  if (audio === undefined) return null;

  const length = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
  const start = sample.offset;
  const end = sample.offset + sample.duration;
  const locked = sample.break?.sliced === true;
  const trim = (from: number, to: number) => setError(run(trimSample(sample.id, from, to), `trim:${sample.id}`));
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
      disabled={locked}
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
            disabled={locked}
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
            disabled={locked}
            onChange={(e) => trim(start, Number(e.target.value) / 1000)}
            onBlur={seal}
          />
        </label>
        <span className="mono muted small">
          {ms(sample.duration)} ms of {ms(length)} ms
        </span>
        <div className="row push">
          <button type="button" onClick={() => services.player.audition(audio, start, sample.duration)}>
            Play trimmed
          </button>
          <button type="button" disabled={locked || (start === 0 && Math.abs(end - length) < 1e-9)} onClick={() => trim(0, length)}>
            Reset
          </button>
        </div>
      </div>
      {locked && <p className="muted small">This break is sliced. Re-slice it in Slice to trim it.</p>}
      <p className="muted small">Drag the handles, or focus one and use ←/→ (Shift: 10 ms).</p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
