/**
 * Time stretch as old samplers did it: a sound is played as short grains, each
 * starting a little further into it and laid over the one before, half a grain
 * apart. The grains move through the sound slower or faster than they play, so
 * its length changes while its pitch stays. Pure: render schedules the grains.
 */

/** One grain: where it plays from the voice's start, where it reads from, and how long it plays, all in seconds. */
export interface Grain {
  /** Output time from the voice's start. Negative for a grain already under way when the voice starts. */
  readonly at: number;
  /** Where it starts reading, in seconds of the buffer. */
  readonly from: number;
  readonly length: number;
  /** Hann rises and falls; flatStart is the first grain of a stretch from the hit, which keeps its attack. */
  readonly shape: 'hann' | 'flatStart';
}

export interface GrainInput {
  /** The region played, in seconds of the buffer. */
  readonly start: number;
  readonly end: number;
  /** Playback rate from pitch: 2 is an octave up. */
  readonly rate: number;
  /** Length factor: 2 plays twice as long. */
  readonly factor: number;
  /** Grain length in seconds of output. */
  readonly grain: number;
  /**
   * Where the grain grid starts, in seconds of the buffer. At the region's start
   * the grains start with the hit; at the break's start, a slice gets the grains
   * a stretch of the whole break would have had there.
   */
  readonly origin: number;
  /** The furthest a grain may read, in seconds of the buffer: a grain that would read past it reads the last of the sound instead. */
  readonly limit: number;
}

/** The grains that play a stretched region, and how long it lasts. */
export function grainPlan({ start, end, rate, factor, grain, origin, limit }: GrainInput): { grains: Grain[]; length: number } {
  const length = (Math.max(0, end - start) / rate) * factor;
  if (length <= 0 || grain <= 0) return { grains: [], length: 0 };
  // Grains start half a grain apart in output; in the buffer the grid moves rate/factor as fast.
  const hop = grain / 2;
  const sourceHop = (hop * rate) / factor;
  const fromHit = Math.abs(origin - start) < 1e-12;
  // Grain j reads from origin + j·sourceHop and plays at the output time where the
  // stretch has got that far. Every grain that sounds within the region is kept.
  const first = Math.floor((start - origin) / sourceHop - 2 + 1e-9) + 1;
  const grains: Grain[] = [];
  for (let j = first; ; j++) {
    const from = origin + j * sourceHop;
    const at = ((from - start) * factor) / rate;
    if (at >= length - 1e-12) break;
    // From the hit, nothing before its start is read: the first grain plays at full level from the start.
    if (fromHit && at < -1e-12) continue;
    // Near the end a grain reads further than the grid has got: it reads the last grain's worth of sound instead.
    const read = Math.max(fromHit ? start : 0, Math.min(from, limit - grain * rate));
    grains.push({ at, from: read, length: grain, shape: fromHit && Math.abs(at) < 1e-12 ? 'flatStart' : 'hann' });
  }
  return { grains, length };
}

/** A grain's level over the part of it from `skip` (0–1) to its end, as points for a value curve. */
export function grainCurve(shape: Grain['shape'], skip = 0, points = 64): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = skip + ((1 - skip) * i) / (points - 1);
    // sin² windows half a grain apart add up to 1, so a stretch at 1× gives back the sound.
    curve[i] = shape === 'flatStart' && x < 0.5 ? 1 : Math.sin(Math.PI * x) ** 2;
  }
  return curve;
}
