import type { Project, ScratchEffect } from '../model';
import { STEP_SIZES, scratchCurve, scratchMotion, scratchOf, scratchSpeeds, stepDuration } from '../model';
import type { AudioWindow, Splice } from './audio-mods';
import { clipSplice, contentStart, windowsWhere } from './audio-mods';
import type { ModRun } from './mods';

/**
 * Scratch (see Scratch): the generator's part. Pure, like generate: a hand
 * on a record, as splices of what is heard. Like Tape it records what is heard
 * from where its clip starts, with step mods, reverb and delay but without Tape
 * and Scratch, and plays instead of it under the clip; the audio mods hear it
 * as they hear Tape. Render plays the splices (finishHeard).
 */

const EPSILON = 1e-9;

const hasScratch = (run: ModRun | null): run is ModRun => run !== null && scratchOf(run.mod) !== undefined;

/**
 * One window's splices: each step of the movement within it plays the
 * recording along the step's curve (the needle's position over the step,
 * smoothed between the points), at the speed and direction the curve has,
 * so the pitch follows like a record. A held step and a closed fader are
 * silent. At the movement's end the needle is lifted and jumps back to the
 * first point: the next splice starts there, and render cross-fades
 * neighbouring splices, so neither the jump nor a fader edge clicks.
 */
function windowSplices(window: AudioWindow, effect: ScratchEffect, stepTime: number): Splice[] {
  const { clip } = window.run;
  const recordStart = clip.start * stepTime;
  const recordLength = effect.record * stepTime;
  const size = STEP_SIZES[effect.step];
  const n = effect.points.length;
  const speeds = scratchSpeeds(effect);
  const origin = contentStart(clip);
  const out: Splice[] = [];
  for (let k = Math.floor((window.start - origin) / size + EPSILON); origin + k * size < window.end - EPSILON; k++) {
    const i = ((k % n) + n) % n;
    const stepStart = origin + k * size;
    const c = scratchCurve(effect, i);
    const held = scratchMotion(speeds[i]!) === 'held';
    const whole: Splice = {
      time: stepStart * stepTime,
      length: size * stepTime,
      source: [recordStart + recordLength * c[0], recordLength * c[1], recordLength * c[2], recordLength * c[3]],
      gain: 1,
      grains: null,
    };
    const cell = effect.fader[i] ?? [true];
    const parts = cell.length === 1 ? [{ from: 0, to: 1, open: cell[0] }] : [{ from: 0, to: 0.5, open: cell[0] }, { from: 0.5, to: 1, open: cell[1]! }];
    for (const part of parts) {
      const from = Math.max(window.start, stepStart + part.from * size);
      const to = Math.min(window.end, stepStart + part.to * size);
      if (to - from <= EPSILON) continue;
      const piece = from === stepStart && to === stepStart + size ? whole : clipSplice(whole, from * stepTime, to * stepTime);
      out.push({ ...piece, gain: held || !part.open ? 0 : 1 });
    }
  }
  return out;
}

/** Every splice Scratch plays in the song, in time order: under each clip whose mod has it, B's where both rows have it. */
export function scratchSplices(project: Project, runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }): Splice[] {
  const stepTime = stepDuration(project.song.bpm);
  return windowsWhere(runs, hasScratch)
    .flatMap((window) => windowSplices(window, scratchOf(window.run.mod)!, stepTime))
    .sort((a, b) => a.time - b.time);
}
