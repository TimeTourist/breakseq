import { useEffect, useRef } from 'react';
import type { AudioData } from '../model';

interface WaveformProps {
  readonly audio: AudioData;
  /** Seconds into the audio. */
  readonly offset: number;
  readonly duration: number;
  readonly height: number;
  readonly color?: string;
}

/** Min/max per pixel column, drawn on a canvas sized to its box. */
export function Waveform({ audio, offset, duration, height, color = '#6f757c' }: WaveformProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const g = element?.getContext('2d');
    if (element == null || g == null) return;
    const width = Math.max(1, Math.round(element.clientWidth * devicePixelRatio));
    element.width = width;
    element.height = Math.round(height * devicePixelRatio);
    const data = audio.channels[0];
    if (data === undefined) return;
    const from = Math.round(offset * audio.sampleRate);
    const length = Math.round(duration * audio.sampleRate);
    const mid = element.height / 2;
    g.clearRect(0, 0, width, element.height);
    g.fillStyle = color;
    for (let x = 0; x < width; x++) {
      const start = from + Math.floor((x * length) / width);
      const end = Math.max(start + 1, from + Math.floor(((x + 1) * length) / width));
      let min = 0;
      let max = 0;
      for (let i = start; i < end; i++) {
        const v = data[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      g.fillRect(x, mid - max * mid, 1, Math.max(1, (max - min) * mid));
    }
  }, [audio, offset, duration, height, color]);

  return <canvas ref={canvas} className="waveform" style={{ height }} aria-hidden="true" />;
}
