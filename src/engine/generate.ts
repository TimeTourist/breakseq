import type { Direction, Id, Loop, Project, Region, Rng } from '../model';
import { STEPS_PER_BAR, stepDuration } from '../model';
import { applyMods, modRuns, modValues, stepState, tempoRuns } from './mods';

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
  const totalSteps = project.song.bars * STEPS_PER_BAR;
  const layers = barLayers(project);
  const runs = modRuns(project.song, project.mods);
  const tempo = tempoRuns(runs);
  const values = modValues(rng);
  const triggers: Trigger[] = [];

  /**
   * Plays content step `content` (in song steps) at `time` for `length` seconds.
   * Mods are those of the main clock's step `clock`, where the sound is heard.
   */
  const play = (content: number, clock: number, time: number, length: number) => {
    const bar = Math.floor(content / STEPS_PER_BAR);
    const step = content % STEPS_PER_BAR;
    const layer = layers[bar];
    const playing = layer === undefined ? null : stepLayer(layer, step);
    const cell = playing?.loop.steps[playing.index];
    if (playing === null || cell === undefined) return;
    const clockBar = Math.floor(clock / STEPS_PER_BAR);
    const place = { index: playing.index, bar: clockBar, step: clock % STEPS_PER_BAR };
    const state = applyMods(stepState(project, cell), { A: runs.A[clockBar] ?? null, B: runs.B[clockBar] ?? null }, place, project, values);
    const { hit } = state;
    if (hit === undefined) return;
    for (let i = 0; i < state.ratchet; i++) {
      triggers.push({
        time: time + (i * length) / state.ratchet,
        bar,
        step,
        hitId: hit.id,
        pitch: hit.pitch + state.pitch,
        volume: hit.volume + state.volume,
        direction: state.reverse === null ? hit.direction : state.reverse ? 'reverse' : 'forward',
        region: hit.region,
      });
    }
  };

  let clock = 0;
  while (clock < totalSteps) {
    const run = tempo[Math.floor(clock / STEPS_PER_BAR)] ?? null;
    if (run === null) {
      play(clock, clock, clock * stepTime, stepTime);
      clock++;
      continue;
    }
    // Slip: a local playhead starts where the main clock is and runs at the run's tempo
    // until the run ends; then everything carries on where the main clock is.
    const end = (run.startBar + run.bars) * STEPS_PER_BAR;
    const endTime = end * stepTime;
    let content = clock;
    let time = clock * stepTime;
    while (time < endTime - 1e-9 && content < totalSteps) {
      const at = Math.min(end - 1, Math.floor(time / stepTime + 1e-9));
      const factor = values(run, Math.floor(at / STEPS_PER_BAR), at % STEPS_PER_BAR, false);
      const length = stepTime / (factor !== null && factor > 0 ? factor : 1);
      play(content, at, time, Math.min(length, endTime - time));
      content++;
      time += length;
    }
    clock = end;
  }
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

/** One loop, once, with a mod in row A over all of it: to try a mod out. */
export function modPreviewSong(project: Project, modId: Id, loopId: Id): Project {
  const alone = loopSong(project, loopId);
  const modA = alone.song.rows.modA.map(() => (project.mods[modId] === undefined ? null : modId));
  return { ...alone, song: { ...alone.song, rows: { ...alone.song.rows, modA } } };
}
