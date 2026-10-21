import type { Clip, DelayPlay, Direction, DistPlay, FilterPlay, Id, Loop, Project, Region, ReverbPlay, Rng, StretchPlay } from '../model';
import { STEPS_PER_BAR, clampStretch, clipsByStep, effectiveHit, hitColour, hitSound, hitSpace, hitStretch, stepDuration } from '../model';
import type { StepState } from './mods';
import { applyMods, effectFor, modRuns, modValues, stepState, tempoRuns } from './mods';
import { padPicker } from './pad-choice';
import { swapper } from './swap';
import type { Tape } from './tape';
import { tapeWindows, windowTape } from './tape';

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
  /** Final pan, −1 (left) to 1 (right): the hit's, its parent's and mods' added. */
  readonly pan: number;
  readonly direction: Direction;
  readonly region: Region;
  /** How it is stretched; null plays it as it is. */
  readonly stretch: StretchPlay | null;
  /** Dist, then filter; null for none. */
  readonly dist: DistPlay | null;
  readonly filter: FilterPlay | null;
  /** Sent to the song's reverb and delay, which ring out beside the voice; null sends none. */
  readonly reverb: ReverbPlay | null;
  readonly delay: DelayPlay | null;
}

/** The loop heard at a song step, and the index of the step in it. */
export interface Layer {
  readonly loop: Loop;
  readonly index: number;
}

/**
 * For each song step, the layer heard: a Fill clip's loop where there is one,
 * otherwise a Main clip's, otherwise silence. A clip plays its loop from its
 * offset and wraps round; the main keeps time under a fill.
 */
export function songLayers(project: Project): (Layer | null)[] {
  const main = clipsByStep(project, 'main');
  const fill = clipsByStep(project, 'fill');
  return main.map((m, t) => {
    const clip = fill[t] ?? m;
    const loop = clip === null ? undefined : project.loops[clip.ref];
    if (clip === null || loop === undefined || loop.steps.length === 0) return null;
    return { loop, index: (t - clip.start + clip.offset) % loop.steps.length };
  });
}

/** What a take plays: triggers, and tapes where a mod's Tape plays instead. */
export interface Take {
  readonly triggers: readonly Trigger[];
  readonly tapes: readonly Tape[];
}

/**
 * Works out everything in the song. Pure: no DOM, no audio, randomness only
 * from `rng`. Under a Tape the song is not heard; the tape plays a recording of
 * what would have been heard in its segment.
 */
export function generateTake(project: Project, rng: Rng): Take {
  const runs = modRuns(project);
  const heard = heardTriggers(project, runs, rng);
  const windows = tapeWindows(runs);
  if (windows.length === 0) return { triggers: heard, tapes: [] };
  const stepTime = stepDuration(project.song.bpm);
  const covered = (time: number) => windows.some((w) => time >= w.start * stepTime - 1e-9 && time < w.end * stepTime - 1e-9);
  return {
    triggers: heard.filter((t) => !covered(t.time)),
    tapes: windows.map((w) => windowTape(project, w, heard, rng)),
  };
}

/** The triggers in the song, where tapes are not heard. */
export function generateTriggers(project: Project, rng: Rng): Trigger[] {
  return [...generateTake(project, rng).triggers];
}

/** Every trigger the song plays, as if no mod had Tape. */
function heardTriggers(project: Project, runs: ReturnType<typeof modRuns>, rng: Rng): Trigger[] {
  const stepTime = stepDuration(project.song.bpm);
  const totalSteps = project.song.bars * STEPS_PER_BAR;
  const layers = songLayers(project);
  const tempo = tempoRuns(runs);
  const values = modValues(rng);
  const swap = swapper(project, runs, layers.map((l) => l?.loop.steps[l.index]), rng);
  const pick = padPicker(rng);
  const triggers: Trigger[] = [];

  /**
   * Plays content step `content` (in song steps) at `time` for `length` seconds.
   * Mods are those at the main clock's step `clock`, where the sound is heard.
   */
  const play = (content: number, clock: number, time: number, length: number) => {
    const layer = layers[content];
    const own = layer?.loop.steps[layer.index];
    if (layer == null || own === undefined) return;
    const cell = swap(content, clock, own);
    const place = { index: layer.index, clock };
    const modded = applyMods(stepState(project, cell), { A: runs.A[clock] ?? null, B: runs.B[clock] ?? null }, place, project, values);
    // A step lock goes before a mod, and a mod before the pad: only an unpicked member is the pad's choice.
    const picked = modded.cell.memberId === null && modded.pad !== undefined && modded.hit !== undefined ? pick(modded.pad) : undefined;
    const state = picked === undefined ? modded : { ...modded, hit: project.hits[picked] };
    if (state.hit === undefined) return;
    // A slot past its break's last slice is silent.
    const sound = hitSound(project, state.hit);
    if (sound === null) return;
    const hit = effectiveHit(project, state.hit);
    const stretch = playedStretch(hitStretch(project, state.hit), state.stretch);
    // A Dist or Filter mod plays in place of the hit's own.
    const colour = hitColour(project, state.hit);
    const dist = state.dist ?? colour.dist;
    const filter = state.filter ?? colour.filter;
    // So do Reverb and Delay mods.
    const space = hitSpace(project, state.hit);
    const reverb = state.reverb === undefined ? space.reverb : state.reverb;
    const delay = state.delay === undefined ? space.delay : state.delay;
    for (let i = 0; i < state.ratchet; i++) {
      triggers.push({
        time: time + (i * length) / state.ratchet,
        bar: Math.floor(content / STEPS_PER_BAR),
        step: content % STEPS_PER_BAR,
        hitId: hit.id,
        pitch: hit.pitch + state.pitch,
        volume: hit.volume + state.volume,
        pan: Math.max(-1, Math.min(1, hit.pan + state.pan)),
        direction: state.reverse === null ? hit.direction : state.reverse ? 'reverse' : 'forward',
        region: sound.region,
        stretch,
        dist,
        filter,
        reverb,
        delay,
      });
    }
  };

  let clock = 0;
  while (clock < totalSteps) {
    const run = tempo[clock] ?? null;
    if (run === null) {
      play(clock, clock, clock * stepTime, stepTime);
      clock++;
      continue;
    }
    // Slip: a local playhead starts where the main clock is and runs at the clip's tempo
    // until the clip ends; then everything carries on where the main clock is.
    const end = Math.min(totalSteps, run.clip.start + run.clip.length);
    const endTime = end * stepTime;
    let content = clock;
    let time = clock * stepTime;
    while (time < endTime - 1e-9 && content < totalSteps) {
      const at = Math.min(end - 1, Math.floor(time / stepTime + 1e-9));
      const factor = values(run, effectFor(run.mod, 'tempo')!, at, false);
      const length = stepTime / (factor !== null && factor > 0 ? factor : 1);
      play(content, at, time, Math.min(length, endTime - time));
      content++;
      time += length;
    }
    clock = end;
  }
  return triggers;
}

/**
 * A hit's own stretch with a Stretch mod over it: Multiply times the hit's,
 * Replace instead of it; the mod's grain length applies either way. A factor of
 * 1 is no stretch at all: grains at 1 play the sound back unchanged.
 */
export function playedStretch(own: StretchPlay, mod: StepState['stretch']): StretchPlay | null {
  const played =
    mod === null
      ? own
      : {
          factor: clampStretch(mod.settings.combine === 'multiply' ? own.factor * mod.factor : mod.factor),
          grain: mod.settings.grain,
          from: own.from,
        };
  return Math.abs(played.factor - 1) < 1e-9 ? null : played;
}

/**
 * The project with a song that only plays one loop, `passes` times (once by
 * default), from its start. The song is exactly as long as the passes, so a
 * loop of 6/16 gives 6/16 bars a pass.
 */
export function loopSong(project: Project, loopId: Id, passes = 1): Project {
  const loop = project.loops[loopId];
  const length = loop === undefined ? 0 : loop.steps.length * Math.max(1, Math.floor(passes));
  const bars = loop === undefined ? 1 : length / STEPS_PER_BAR;
  const clips: Clip[] = loop === undefined ? [] : [{ id: 'preview-loop', row: 'main', ref: loopId, start: 0, length, offset: 0, seed: 0 }];
  return { ...project, song: { bpm: project.song.bpm, bars, clips } };
}

/** One loop, once, with a mod in row A over all of it: to try a mod out. */
export function modPreviewSong(project: Project, modId: Id, loopId: Id): Project {
  const alone = loopSong(project, loopId);
  if (project.mods[modId] === undefined) return alone;
  const length = alone.song.bars * STEPS_PER_BAR;
  const mod: Clip = { id: 'preview-mod', row: 'modA', ref: modId, start: 0, length, offset: 0, seed: 0 };
  return { ...alone, song: { ...alone.song, clips: [...alone.song.clips, mod] } };
}
