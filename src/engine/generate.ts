import type { Direction, Id, Loop, Project, Region, Rng } from '../model';
import { STEPS_PER_BAR, stepDuration } from '../model';
import type { StepState } from './mods';
import { applyMods, modRuns, modValues } from './mods';

export interface Trigger {
  /** Seconds from the start of the song. */
  readonly time: number;
  /** Song bar, 0-based. */
  readonly bar: number;
  /** Step within the bar, 0–15. */
  readonly step: number;
  readonly hitId: Id;
  /** Final pitch in semitones: the hit's own plus mods. */
  readonly pitch: number;
  /** Final volume in dB. */
  readonly volume: number;
  readonly direction: Direction;
  readonly region: Region;
}

/** The loop heard in a bar and which of its bars plays. */
export interface ActiveLayer {
  readonly loop: Loop;
  readonly loopBar: number;
}

/** The main and the fill in a bar, each with the loop bar it is on. */
export interface BarLayers {
  readonly main: ActiveLayer | null;
  readonly fill: ActiveLayer | null;
}

/**
 * The loops in each bar. A main loops until the next main starts; a fill covers
 * as many bars as it is long. A main keeps counting its bars while a fill plays over it.
 */
export function barLayers(project: Project): BarLayers[] {
  const { song, loops } = project;
  let main: { loop: Loop; startBar: number } | null = null;
  let fill: { loop: Loop; startBar: number } | null = null;
  const layers: BarLayers[] = [];

  for (let bar = 0; bar < song.bars; bar++) {
    const mainId = song.rows.main[bar];
    const fillId = song.rows.fill[bar];
    const mainLoop = mainId == null ? undefined : loops[mainId];
    const fillLoop = fillId == null ? undefined : loops[fillId];
    if (mainLoop !== undefined) main = { loop: mainLoop, startBar: bar };
    if (fillLoop !== undefined) fill = { loop: fillLoop, startBar: bar };
    layers.push({
      main: main === null ? null : { loop: main.loop, loopBar: (bar - main.startBar) % main.loop.bars },
      fill: fill !== null && bar - fill.startBar < fill.loop.bars ? { loop: fill.loop, loopBar: bar - fill.startBar } : null,
    });
  }
  return layers;
}

/**
 * Exactly one layer per step: the fill inside its window, otherwise the main.
 * Returns the layer and the index of the step in its loop.
 */
export function stepLayer(layers: BarLayers, step: number): { readonly loop: Loop; readonly index: number } | null {
  const { fill, main } = layers;
  if (fill !== null) {
    const index = fill.loopBar * STEPS_PER_BAR + step;
    if (index >= fill.loop.window.start && index < fill.loop.window.end) return { loop: fill.loop, index };
  }
  return main === null ? null : { loop: main.loop, index: main.loopBar * STEPS_PER_BAR + step };
}

/** Works out every trigger in the song. Pure: no DOM, no audio, randomness only from `rng`. */
export function generateTriggers(project: Project, rng: Rng): Trigger[] {
  const stepTime = stepDuration(project.song.bpm);
  const layers = barLayers(project);
  const runs = modRuns(project.song, project.mods);
  const values = modValues(rng);
  const triggers: Trigger[] = [];

  layers.forEach((layer, bar) => {
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const playing = stepLayer(layer, step);
      const cell = playing?.loop.steps[playing.index];
      if (cell === undefined || cell.padId === null) continue;
      const pad = project.pads[cell.padId];
      if (pad === undefined) continue;
      const memberId = cell.memberId !== null && pad.members.includes(cell.memberId) ? cell.memberId : pad.members[0];
      const hit = memberId === undefined ? undefined : project.hits[memberId];
      if (hit === undefined) continue;

      const base: StepState = { padId: pad.id, hit, ratchet: 1, pitch: 0 };
      const state = cell.ignoreMods
        ? base
        : applyMods(base, { A: runs.A[bar] ?? null, B: runs.B[bar] ?? null }, bar, step, project, values);

      const start = (bar * STEPS_PER_BAR + step) * stepTime;
      for (let i = 0; i < state.ratchet; i++) {
        triggers.push({
          time: start + (i * stepTime) / state.ratchet,
          bar,
          step,
          hitId: state.hit.id,
          pitch: state.hit.pitch + state.pitch,
          volume: state.hit.volume,
          direction: state.hit.direction,
          region: state.hit.region,
        });
      }
    }
  });
  return triggers;
}

/** The project with a song that only plays one loop, once, from its first bar. */
export function loopSong(project: Project, loopId: Id): Project {
  const loop = project.loops[loopId];
  const bars = loop?.bars ?? 1;
  const empty = () => Array.from({ length: bars }, (): Id | null => null);
  const main = empty();
  main[0] = loop === undefined ? null : loopId;
  return { ...project, song: { bpm: project.song.bpm, bars, rows: { main, fill: empty(), modA: empty(), modB: empty() } } };
}
