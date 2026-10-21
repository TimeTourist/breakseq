import type { CellSize, Clip, Id, Project, StepEffect } from '../model';
import { DEFAULT_MOD_SCRAMBLE, STEPS_PER_BAR, STEP_SIZES, isDice, isStepEffect } from '../model';
import type { ScrambleCell } from './audio-mods';
import { audioWindows, scrambleCells, scrambleRange } from './audio-mods';
import { generateTake, modPreviewSong, songLayers } from './generate';
import { effectFor, laneDice, laneValueAt, modRuns, tempoValues } from './mods';
import { blockPasses } from './preview';
import { passSeed, placeRng } from './random';
import { rampedSpeed } from './tape';

/**
 * What a mod does on each step of the loop under Plays on in one pass of Play
 * (see Sidan): the preview's grid. Pure, like generate: the same seeds as Play
 * renders, so the grid shows what is heard in that pass.
 */

/** One step of a lane's row: what the step does in this pass. */
export interface LaneCell {
  /** The value it has this pass, or null where it does nothing (a dice step whose chance did not come up). */
  readonly value: number | null;
  /** A dice step's band, or null for a fixed step. */
  readonly band: { readonly lo: number; readonly hi: number } | null;
  /** Which step of the lane it is, from 0. */
  readonly laneStep: number;
  /** Where the lane starts again. */
  readonly restart: boolean;
}

export type PassRow =
  | { readonly kind: 'lane'; readonly target: StepEffect['target']; readonly effect: StepEffect; readonly cells: readonly LaneCell[] }
  /** The hit each step plays this pass where Swap changed it, else null. */
  | { readonly kind: 'swap'; readonly target: 'swap'; readonly cells: readonly (Id | null)[] }
  /** Tempo's speed on each step, or null where it has none. */
  | { readonly kind: 'tempo'; readonly target: 'tempo'; readonly cells: readonly (number | null)[] }
  /** Tape's speed on each step (its ramp, without wow and flutter). */
  | { readonly kind: 'tape'; readonly target: 'tape'; readonly cells: readonly number[] }
  /** Halftime's speed, the same on every step: it has no lane. */
  | { readonly kind: 'halftime'; readonly target: 'halftime'; readonly cells: readonly number[] };

/** The first hit each step plays in a take of one pass, by its step from the start. */
function hitsByStep(project: Project, steps: number): (Id | null)[] {
  const hits: (Id | null)[] = Array.from({ length: steps }, () => null);
  for (const t of generateTake(project).triggers) {
    const at = t.bar * 16 + t.step;
    if (at < steps && hits[at] === null) hits[at] = t.hitId;
  }
  return hits;
}

/** The rows of a mod's effects over the loop in pass `pass` (from 0), in the mod's order. */
export function modPassRows(project: Project, modId: Id, loopId: Id, pass: number): PassRow[] {
  const mod = project.mods[modId];
  const loop = project.loops[loopId];
  if (mod === undefined || loop === undefined) return [];
  const steps = loop.steps.length;
  // The clip of the mod in this pass, as modPreviewSong lays it out.
  const clip: Clip = { id: 'preview-mod-0', row: 'modA', ref: modId, start: 0, length: steps, offset: 0, seed: passSeed(pass) };
  const run = { mod, row: 'A' as const, clip };
  const onePass = modPreviewSong(project, modId, loopId, 1, pass);
  return mod.effects.map((effect): PassRow => {
    if (isStepEffect(effect)) {
      const size = STEP_SIZES[effect.step];
      const roll = laneDice(placeRng, mod, clip, effect.target);
      const cells = Array.from({ length: steps }, (_, i): LaneCell => {
        const laneStep = Math.floor(i / size) % effect.lane.length;
        const step = effect.lane[laneStep]!;
        return {
          value: laneValueAt(effect, i, roll),
          band: isDice(step) ? { lo: step.lo, hi: step.hi } : null,
          laneStep,
          restart: i % (size * effect.lane.length) === 0,
        };
      });
      return { kind: 'lane', target: effect.target, effect, cells };
    }
    if (effect.target === 'swap') {
      const without = { ...project, mods: { ...project.mods, [modId]: { ...mod, effects: mod.effects.filter((e) => e.target !== 'swap') } } };
      const withSwap = hitsByStep(onePass, steps);
      const unswapped = hitsByStep(modPreviewSong(without, modId, loopId, 1, pass), steps);
      return { kind: 'swap', target: 'swap', cells: withSwap.map((h, i) => (h !== unswapped[i] ? h : null)) };
    }
    if (effect.target === 'tempo') {
      const values = tempoValues(placeRng);
      return { kind: 'tempo', target: 'tempo', cells: Array.from({ length: steps }, (_, i) => values(run, effect, i)) };
    }
    if (effect.target === 'halftime') return { kind: 'halftime', target: 'halftime', cells: Array.from({ length: steps }, () => effect.speed) };
    return { kind: 'tape', target: 'tape', cells: Array.from({ length: steps }, (_, i) => rampedSpeed(effect, steps, i)) };
  });
}


/**
 * Pads heard in the song only under a Stretch mod: wherever a step plays them
 * (not ignoring mods), row A or B has a Stretch there. A Stretch mod plays its
 * own grain length, so their hits' own Grain is not heard in the song (see
 * Reglage som inte hörs).
 */
export function padsOnlyUnderStretch(project: Project): Set<Id> {
  const layers = songLayers(project);
  const runs = modRuns(project);
  const under = new Set<Id>();
  const free = new Set<Id>();
  layers.forEach((layer, t) => {
    const step = layer?.loop.steps[layer.index];
    if (step?.padId == null) return;
    const stretched = !step.ignoreMods && [runs.A[t], runs.B[t]].some((run) => run != null && effectFor(run.mod, 'stretch') !== undefined);
    (stretched ? under : free).add(step.padId);
  });
  for (const pad of free) under.delete(pad);
  return under;
}

/** The picture Where each cell comes from (Scramble): the song Play renders a pass in, cut in cells, and what each cell of the pass's clip plays. */
export interface ScramblePicture {
  readonly cell: CellSize;
  /** The song Play renders the pass in (its block of passes), in cells. */
  readonly songCells: number;
  /** The pass's clip of the mod, in cells. */
  readonly clip: { readonly start: number; readonly end: number };
  /** Take from, in cells. */
  readonly range: { readonly start: number; readonly end: number };
  /** Bars of the song, for the ruler. */
  readonly bars: number;
  readonly cells: readonly ScrambleCell[];
}

/**
 * Where each cell of the mod's Scramble comes from in pass `pass` of Play in
 * Mods: the same block of passes and seeds as Play renders (see Varv i loop),
 * so Whole song is the block. Null when the mod has no Scramble.
 */
export function scramblePicture(project: Project, modId: Id, loopId: Id, pass: number): ScramblePicture | null {
  const mod = project.mods[modId];
  const effect = mod === undefined ? undefined : effectFor(mod, 'scramble');
  const steps = project.loops[loopId]?.steps.length ?? 0;
  if (effect === undefined || steps === 0) return null;
  const perBlock = blockPasses(steps);
  const song = modPreviewSong(project, modId, loopId, perBlock, Math.floor(pass / perBlock) * perBlock);
  const songSteps = song.song.bars * STEPS_PER_BAR;
  const window = audioWindows(modRuns(song), 'scramble').find((w) => w.run.clip.id === `preview-mod-${pass % perBlock}`);
  if (window === undefined) return null;
  const settings = effect.scramble ?? DEFAULT_MOD_SCRAMBLE;
  const size = settings.cell;
  const { clip } = window.run;
  return {
    cell: size,
    songCells: Math.ceil(songSteps / size - 1e-9),
    clip: { start: Math.floor(clip.start / size + 1e-9), end: Math.ceil((clip.start + clip.length) / size - 1e-9) },
    range: scrambleRange(clip, settings, songSteps),
    bars: song.song.bars,
    cells: scrambleCells(window, effect, songSteps, placeRng),
  };
}
