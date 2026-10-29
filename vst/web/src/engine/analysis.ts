import type { AudioData } from '../model';

/** Mono samples of a window of the audio, averaged over channels. */
function mono(audio: AudioData, offset: number, duration: number): Float32Array {
  const from = Math.max(0, Math.round(offset * audio.sampleRate));
  const length = Math.max(0, Math.min(Math.round(duration * audio.sampleRate), (audio.channels[0]?.length ?? 0) - from));
  const out = new Float32Array(length);
  for (const channel of audio.channels) {
    for (let i = 0; i < length; i++) out[i]! += channel[from + i]! / audio.channels.length;
  }
  return out;
}

/** One-pole high-pass filter at `cutoff` Hz. */
function highPass(x: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / sampleRate);
  const y = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = a * (y[i - 1]! + x[i]! - x[i - 1]!);
  return y;
}

const db = (ratio: number) => 20 * Math.log10(Math.max(ratio, 1e-12));

/** Seconds a marker is put before the attack it found, so the attack is never cut. */
export const ONSET_LEAD = 0.001;

/**
 * Where hits start in a window of audio, in seconds from the window's start.
 * Sensitivity 0–100: higher finds softer hits. Each onset is moved back to where
 * the attack begins, less ONSET_LEAD.
 */
export function detectTransients(audio: AudioData, offset: number, duration: number, sensitivity: number): number[] {
  const { sampleRate } = audio;
  const x = highPass(mono(audio, offset, duration), sampleRate, 300);
  const frame = Math.max(1, Math.round(0.003 * sampleRate));
  const frames = Math.floor(x.length / frame);
  const env = new Float32Array(frames);
  let peak = 0;
  for (let k = 0; k < frames; k++) {
    let sum = 0;
    for (let i = k * frame; i < (k + 1) * frame; i++) sum += x[i]! * x[i]!;
    env[k] = Math.sqrt(sum / frame);
    peak = Math.max(peak, env[k]!);
  }
  if (peak === 0) return [];

  const s = Math.max(0, Math.min(100, sensitivity)) / 100;
  const riseDb = 10 - 7 * s; // How much louder than the last 24 ms: 10 dB (picky) to 3 dB (keen).
  const floorDb = -30 - 20 * s; // How loud against the loudest frame: −30 dB to −50 dB.
  const minGap = Math.round(0.03 / (frame / sampleRate));

  const onsets: number[] = [];
  let lastFrame = -Infinity;
  for (let k = 1; k < frames; k++) {
    let before = 1e-9;
    for (let j = Math.max(0, k - 8); j < k; j++) before = Math.max(before, env[j]!);
    if (db(env[k]! / before) < riseDb || db(env[k]! / peak) < floorDb || k - lastFrame < minGap) continue;
    // Take the strongest frame of this rise, then go back to where the attack starts.
    let top = k;
    while (top + 1 < frames && env[top + 1]! > env[top]!) top++;
    const searchFrom = Math.max(0, (k - 2) * frame);
    const searchTo = Math.min(x.length, (top + 1) * frame);
    let local = 0;
    for (let i = searchFrom; i < searchTo; i++) local = Math.max(local, Math.abs(x[i]!));
    let start = searchFrom;
    while (start < searchTo && Math.abs(x[start]!) < 0.25 * local) start++;
    onsets.push(Math.max(0, start / sampleRate - ONSET_LEAD));
    lastFrame = top;
    k = top;
  }
  return onsets;
}
