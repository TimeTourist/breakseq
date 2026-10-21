import type { Clip, DelayPlay, Direction, DistPlay, FilterPlay, Id, Loop, Project, Region, ReverbPlay, StretchPlay } from '../model';
import { STEPS_PER_BAR, clampStretch, clipsByStep, effectiveHit, hitColour, hitSound, hitSpace, hitStretch, stepDuration } from '../model';
import type { StepState } from './mods';
import { applyMods, modRuns, modValues, stepState, tempoEffect, tempoRuns, tempoValues } from './mods';
import type { PickState } from './pad-choice';
import { padPicker } from './pad-choice';
import type { Dice } from './random';
import { CHOICE, passSeed, placeRng } from './random';
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

/** The loop heard at a song step, the index of the step in it, and the clip it plays in. */
export interface Layer {
  readonly loop: Loop;
  readonly index: number;
  readonly clip: Clip;
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
    return { loop, index: (t - clip.start + clip.offset) % loop.steps.length, clip };
  });
}

/** What a take plays: triggers, and tapes where a mod's Tape plays instead. */
export interface Take {
  readonly triggers: readonly Trigger[];
  readonly tapes: readonly Tape[];
  /** Where the pads' choices stood at the end: the next pass of Play starts from it. Missing in takes not generated. */
  readonly end?: PickState;
}

export interface GenerateOptions {
  /** Where the pads' choices stand at the start: where the last pass ended. None by default. */
  readonly from?: PickState;
  /** Randomness for each choice from its seeds and place; placeRng unless a test injects its own. */
  readonly dice?: Dice;
}

/**
 * Works out everything in the song. Pure: no DOM, no audio, and every random
 * choice comes from the seeds of what makes it and where in the song it is
 * made (see Slump och seeds), so the same project gives the same take. Under
 * a Tape the song is not heard; the tape plays a recording of what would have
 * been heard in its segment.
 */
export function generateTake(project: Project, options: GenerateOptions = {}): Take {
  const dice = options.dice ?? placeRng;
  const runs = modRuns(project);
  const { triggers: heard, end } = heardTriggers(project, runs, dice, options.from);
  const windows = tapeWindows(runs);
  if (windows.length === 0) return { triggers: heard, tapes: [], end };
  const stepTime = stepDuration(project.song.bpm);
  const covered = (time: number) => windows.some((w) => time >= w.start * stepTime - 1e-9 && time < w.end * stepTime - 1e-9);
  return {
    triggers: heard.filter((t) => !covered(t.time)),
    tapes: windows.map((w) => windowTape(project, w, heard, dice)),
    end,
  };
}

/** The triggers in the song, where tapes are not heard. */
export function generateTriggers(project: Project, options: GenerateOptions = {}): Trigger[] {
  return [...generateTake(project, options).triggers];
}

/** Every trigger the song plays, as if no mod had Tape, and where the pads' choices stand after them. */
function heardTriggers(project: Project, runs: ReturnType<typeof modRuns>, dice: Dice, from: PickState | undefined): { triggers: Trigger[]; end: PickState } {
  const stepTime = stepDuration(project.song.bpm);
  const totalSteps = project.song.bars * STEPS_PER_BAR;
  const layers = songLayers(project);
  const tempo = tempoRuns(runs);
  const values = modValues(dice);
  const tempos = tempoValues(dice);
  const swap = swapper(project, runs, layers.map((l) => l?.loop.steps[l.index]), dice);
  const picker = padPicker(from);
  // A pad's choice is laid over by its matrix: its seed goes in too.
  const matrixSeed = new Map<Id, number>();
  for (const matrix of Object.values(project.matrices)) for (const padId of matrix.pads) matrixSeed.set(padId, matrix.seed);
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
    // A random pick comes from the matrix's, pad's and clip's seeds and the step in the clip: a copied clip picks the same.
    const { clip } = layer;
    const pick = (pad: NonNullable<typeof modded.pad>) =>
      picker.pick(pad, dice(CHOICE.pad, matrixSeed.get(pad.id) ?? 0, pad.seed, clip.seed, content - clip.start + clip.offset));
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
      const factor = tempos(run, tempoEffect(run.mod)!, at);
      const length = stepTime / (factor !== null && factor > 0 ? factor : 1);
      play(content, at, time, Math.min(length, endTime - time));
      content++;
      time += length;
    }
    clock = end;
  }
  return { triggers, end: picker.state() };
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
 * loop of 6/16 gives 6/16 bars a pass. Each pass is a clip of its own, whose
 * seed comes from its number from `firstPass`: pass 1, 2, 3 … sound
 * different, and the same passes the same (see Slump och seeds).
 */
export function loopSong(project: Project, loopId: Id, passes = 1, firstPass = 0): Project {
  const loop = project.loops[loopId];
  const count = Math.max(1, Math.floor(passes));
  const steps = loop?.steps.length ?? 0;
  const bars = loop === undefined ? 1 : (steps * count) / STEPS_PER_BAR;
  const clips: Clip[] =
    loop === undefined || steps === 0
      ? []
      : Array.from({ length: count }, (_, i) => ({ id: `preview-loop-${i}`, row: 'main', ref: loopId, start: i * steps, length: steps, offset: 0, seed: passSeed(firstPass + i) }));
  return { ...project, song: { bpm: project.song.bpm, bars, clips } };
}

/**
 * One loop with a mod in row A over all of it, to try a mod out: once, or
 * `passes` times from pass `firstPass`, each pass with a clip of the mod of
 * its own, seeded by its number like the loop's.
 */
export function modPreviewSong(project: Project, modId: Id, loopId: Id, passes = 1, firstPass = 0): Project {
  const alone = loopSong(project, loopId, passes, firstPass);
  if (project.mods[modId] === undefined) return alone;
  const mods: Clip[] = alone.song.clips.map((c, i) => ({ ...c, id: `preview-mod-${i}`, row: 'modA', ref: modId }));
  return { ...alone, song: { ...alone.song, clips: [...alone.song.clips, ...mods] } };
}
