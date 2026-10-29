import type { DistPlay, FilterPlay } from '../model';

/**
 * Dist and filter settings worked out as numbers: pure, so render only
 * applies them. Dist works sample by sample on audio; the filter is a biquad
 * whose resonance peak is kept within FILTER_PEAK_DB.
 */

/** Drive's gain before tanh: 1 (clean) at 0, 50 (nearly square) at 1. */
export const driveGain = (amount: number): number => 50 ** amount;
/** Crush's bit depth: 16 at 0, 2 at 1. */
export const crushBits = (amount: number): number => 16 - 14 * amount;
/** Decimate's rate divisor: 1 at 0, 32 at 1. */
export const decimateFactor = (amount: number): number => 32 ** amount;

/** Audio through dist, a new array. Decimate holds each sample for `factor` samples, fractions carried over. */
export function distort(data: Float32Array, dist: DistPlay): Float32Array<ArrayBuffer> {
  const out = new Float32Array(data.length);
  switch (dist.mode) {
    case 'drive': {
      const g = driveGain(dist.amount);
      for (let i = 0; i < data.length; i++) out[i] = Math.tanh(g * data[i]!);
      return out;
    }
    case 'crush': {
      const step = 2 / 2 ** crushBits(dist.amount);
      for (let i = 0; i < data.length; i++) out[i] = Math.round(data[i]! / step) * step;
      return out;
    }
    case 'decimate': {
      const factor = decimateFactor(dist.amount);
      let held = 0;
      let phase = 1;
      for (let i = 0; i < data.length; i++) {
        if (phase >= 1) {
          held = data[i]!;
          phase -= 1;
        }
        out[i] = held;
        phase += 1 / factor;
      }
      return out;
    }
  }
}

/** The root mean square of frames `from` to `to` over all channels. */
export function rms(channels: readonly Float32Array[], from = 0, to = channels[0]?.length ?? 0): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let i = Math.max(0, from); i < Math.min(to, channel.length); i++) sum += channel[i]! ** 2;
    count += Math.max(0, Math.min(to, channel.length) - Math.max(0, from));
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/** The gain that brings dist's output back to the level of what went in: same RMS. 1 for silence. */
export function levelMatch(before: number, after: number): number {
  return before > 0 && after > 0 ? before / after : 1;
}

/** The highest a filter's resonance peak may rise, in dB. */
export const FILTER_PEAK_DB = 6;

/**
 * A filter as a biquad: its Q in dB, as Web Audio reads Q for low- and
 * high-pass (−3 dB is flat; resonance 1 is a 21 dB peak), and a gain that
 * keeps the peak within FILTER_PEAK_DB.
 */
export function filterSettings(filter: FilterPlay, sampleRate: number): { type: 'lowpass' | 'highpass'; frequency: number; q: number; gain: number } {
  const q = -3 + 24 * filter.resonance;
  return {
    type: filter.type,
    frequency: Math.min(filter.cutoff, sampleRate / 2 - 1),
    q,
    gain: q > FILTER_PEAK_DB ? 10 ** (-(q - FILTER_PEAK_DB) / 20) : 1,
  };
}

/**
 * Balance with equal power for a pan of −1 (left) to 1 (right): the middle is
 * 1 and 1, as without pan; at one side the other channel is 0 and this one √2.
 */
export function panGains(pan: number): { left: number; right: number } {
  const theta = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return { left: Math.SQRT2 * Math.cos(theta), right: Math.SQRT2 * Math.sin(theta) };
}
