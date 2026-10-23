import type { Project, StepEffect } from '../model';
import { DEFAULT_MOD_TRANCE_GATE, STEP_SIZES, stepDuration } from '../model';
import type { AudioWindow } from './audio-mods';
import { contentStart, windowsWhere } from './audio-mods';
import type { ModRun } from './mods';
import { clipPosition, effectFor, laneDice, laneValueAt } from './mods';
import type { Dice } from './random';

/**
 * Trance gate (Magnus beslut 2026-10-23): the generator's part. Pure, like
 * generate. It does not read what is heard as the other audio mods do; it
 * changes the level last, of whatever plays there (what is heard, tape,
 * Scratch or an audio mod), in time with its lane. (Claudes val.)
 */

/** Where one clip's Trance gate plays, in seconds of the song, and the level it leaves. */
export interface Gate {
  readonly time: number;
  readonly end: number;
  /** The level of a closed step, linear: 0 for Depth −∞. */
  readonly depth: number;
  /** Seconds every edge takes (Smooth). */
  readonly smooth: number;
  /** The open parts of its steps, in seconds of the song, in order and apart. */
  readonly opens: readonly { readonly time: number; readonly end: number }[];
}

const EPSILON = 1e-9;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * How open the gate is at song time `t` (0 closed, 1 open): each open part
 * goes up over Smooth from where it starts and down over Smooth from where it
 * ends. The song round the clip counts as open: the gate goes down over Smooth
 * where the clip starts, and is all the way up by where it ends, so after the
 * clip what is heard is heard as it is. (Claudes val.)
 */
function openness(gate: Gate, t: number): number {
  const s = gate.smooth;
  let most = Math.max(clamp01(1 - (t - gate.time) / s), clamp01((t - (gate.end - s)) / s));
  for (const open of gate.opens) {
    if (open.time > t) break;
    most = Math.max(most, clamp01(Math.min((t - open.time) / s, 1 - (t - open.end) / s)));
    if (most >= 1) return 1;
  }
  return most;
}

/** The level a gate leaves at song time `t`: 1 outside its clip, between Depth and 1 under it. */
export function gateGain(gate: Gate, t: number): number {
  if (t < gate.time || t >= gate.end) return 1;
  const open = openness(gate, t);
  return open >= 1 ? 1 : gate.depth + (1 - gate.depth) * open;
}

const hasGate = (run: ModRun | null): run is ModRun => run !== null && effectFor(run.mod, 'tranceGate') !== undefined;

/** One window's gate: each step of the lane open for Open of its length where its value is on; a 🎲 step is on by its chance. */
function windowGate(window: AudioWindow, effect: StepEffect, stepTime: number, dice: Dice): Gate {
  const settings = effect.tranceGate ?? DEFAULT_MOD_TRANCE_GATE;
  const size = STEP_SIZES[effect.step];
  const origin = contentStart(window.run.clip);
  const roll = laneDice(dice, window.run.mod, window.run.clip, 'tranceGate');
  const opens: { time: number; end: number }[] = [];
  for (let j = Math.floor((window.start - origin) / size); origin + j * size < window.end; j++) {
    const begins = origin + j * size;
    const start = Math.max(window.start, begins);
    if (start >= window.end) break;
    const value = laneValueAt(effect, clipPosition(window.run.clip, start), roll);
    if (value === null || value < 0.5) continue;
    const from = start;
    const to = Math.min(window.end, begins + (size * settings.open) / 100);
    if (to <= from + EPSILON) continue;
    const last = opens.at(-1);
    // Open parts that meet are one: Open 100 % on open steps is as without the gate.
    if (last !== undefined && Math.abs(last.end - from * stepTime) < EPSILON) last.end = to * stepTime;
    else opens.push({ time: from * stepTime, end: to * stepTime });
  }
  return {
    time: window.start * stepTime,
    end: window.end * stepTime,
    depth: settings.depth === '-inf' ? 0 : 10 ** (settings.depth / 20),
    smooth: settings.smooth / 1000,
    opens,
  };
}

/** Every clip's Trance gate in the song, in time order: for each song step B's clip if its mod has one, else A's. */
export function tranceGates(project: Project, runs: { readonly A: readonly (ModRun | null)[]; readonly B: readonly (ModRun | null)[] }, dice: Dice): Gate[] {
  const stepTime = stepDuration(project.song.bpm);
  return windowsWhere(runs, hasGate).map((w) => windowGate(w, effectFor(w.run.mod, 'tranceGate')!, stepTime, dice));
}
