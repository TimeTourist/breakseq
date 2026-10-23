import type { Command, CommandContext } from './command';
import { defaultContext, notFound, ok } from './command';
import { newStepEffect } from './lanes';
import { newScratch } from './scratch';
import type { Id, LaneStep, Mod, ModEffect, Project, StepEffect, TapeEffect, TempoEffect } from './types';
import { DEFAULT_HALFTIME } from './types';

/**
 * The mod presets (see Crazy madness, Mod-förval): ready mods made as real
 * mods with `isPreset` in every project, which never change. A change to one
 * makes a mod of one's own and moves the preset's clips to it.
 */

/** How hard a preset hits, for Crazy's recipes to choose from. (Claudes val.) */
export type PresetStrength = 'extreme' | 'subtle';

/** A ready mod: a name and its effects. */
export interface ModPreset {
  readonly name: string;
  /** What it does, in a few words, for its tooltip. */
  readonly does: string;
  readonly strength: PresetStrength;
  /** Its effects, worked out when the preset is made in a project. */
  readonly effects: (project: Project) => readonly ModEffect[];
}

const step = (fields: StepEffect): StepEffect => fields;
const fixed = (...values: number[]): LaneStep[] => values.map((v) => ({ v }));
/** A line of `n` steps from `from` to `to`, rounded to `places` decimals: as the presets ramped over a bar before lanes. */
const line = (n: number, from: number, to: number, places = 0): LaneStep[] =>
  Array.from({ length: n }, (_, k) => ({ v: Math.round((from + ((to - from) * k) / (n - 1)) * 10 ** places) / 10 ** places }));
const tempo = (fields: TempoEffect): TempoEffect => fields;

const tape = (fields: Partial<TapeEffect>): TapeEffect => ({
  target: 'tape',
  length: 2,
  direction: 'pingpong',
  speed: { from: 1, to: 0.25 },
  rampOver: null,
  curve: 'linear',
  wow: 0,
  flutter: 0,
  ...fields,
});

/** Repeat the first 2/16, back and forth, slowing to a quarter: tape being braked. */
export const DEFAULT_TAPE: TapeEffect = tape({});

/** Stutter's Roll, on its card and in the preset Stutter Roll: 1/16 → 1/32 → 1/64 over a beat. */
export const STUTTER_ROLL: readonly LaneStep[] = fixed(1, 2, 3, 3);

/** The presets under Start from in Mods, as before lanes, drawn as lanes over a bar. */
export const START_FROM_PRESETS: readonly ModPreset[] = [
  { name: 'Tape rock', strength: 'extreme', does: 'The first 2/16 back and forth, slowing to a quarter', effects: () => [DEFAULT_TAPE] },
  {
    name: 'Tape stop',
    strength: 'extreme',
    does: 'A bar of tape slowing gently to a stop',
    effects: () => [tape({ length: 16, direction: 'forward', speed: { from: 1, to: 0 }, curve: 'softStart', wow: 0.1 })],
  },
  { name: 'Stutter', strength: 'subtle', does: 'Every step under the clip rolls in fours', effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(4) })] },
  {
    name: 'Pitch stair',
    strength: 'subtle',
    does: 'Pitch climbs 0, 3, 5, 7 a beat at a time',
    effects: () => [step({ target: 'pitch', step: 'beat', lane: fixed(0, 3, 5, 7), pitch: { values: 'semitones' } })],
  },
  {
    name: 'Reverse roll',
    strength: 'extreme',
    does: 'Every other step backwards, in twos',
    effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(2) }), step({ target: 'direction', step: '1/16', lane: fixed(0, 1) })],
  },
  {
    name: 'Slip 1/3',
    strength: 'extreme',
    does: 'The layer at a third of the tempo, back in time after',
    effects: () => [tempo({ target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } })],
  },
  {
    name: 'Snare roll',
    strength: 'extreme',
    does: 'Rolls from single hits to eights, climbing an octave',
    effects: () => [
      step({ target: 'ratchet', step: 'beat', lane: line(4, 1, 8) }),
      step({ target: 'pitch', step: '1/16', lane: line(16, 0, 12), pitch: { values: 'semitones' } }),
    ],
  },
  {
    name: 'Pitch dive',
    strength: 'extreme',
    does: 'Pitch falls an octave over a bar',
    effects: () => [step({ target: 'pitch', step: '1/16', lane: line(16, 0, -12), pitch: { values: 'semitones' } })],
  },
  {
    name: 'Random reverse',
    strength: 'subtle',
    does: 'A quarter of the steps backwards, at random',
    effects: () => [step({ target: 'direction', step: '1/16', lane: [{ lo: 0, hi: 1, chance: 25 }] })],
  },
  { name: 'Gate', strength: 'subtle', does: 'Every other step all but silent', effects: () => [step({ target: 'volume', step: '1/16', lane: fixed(0, -24) })] },
  {
    name: 'Hat bounce',
    strength: 'subtle',
    does: 'Every step somewhere between left and right, at random',
    effects: () => [step({ target: 'pan', step: '1/16', lane: [{ lo: -100, hi: 100, chance: 100 }] })],
  },
  {
    name: 'Ping-pong roll',
    strength: 'subtle',
    does: 'Steps in twos, left and right in turn',
    effects: () => [step({ target: 'ratchet', step: '1/16', lane: fixed(2) }), step({ target: 'pan', step: '1/16', lane: fixed(-80, 80) })],
  },
  {
    name: 'Filter rise',
    strength: 'subtle',
    does: 'A low-pass opening from 200 Hz to 12 kHz over a bar',
    effects: () => [step({ target: 'filter', step: '1/16', lane: line(16, 200, 12000, -1), filter: { type: 'lowpass', resonance: 0.3 } })],
  },
  {
    name: 'Thin out',
    strength: 'subtle',
    does: 'A high-pass rising to 2 kHz, taking the bottom away',
    effects: () => [step({ target: 'filter', step: '1/16', lane: line(16, 60, 2000, -1), filter: { type: 'highpass', resonance: 0.3 } })],
  },
  {
    name: 'Crush build',
    strength: 'extreme',
    does: 'Fewer and fewer bits, a beat at a time, at the same level',
    effects: () => [step({ target: 'dist', step: 'beat', lane: fixed(0, 35, 65, 100), dist: { mode: 'crush' } })],
  },
  {
    name: 'SP grit',
    strength: 'subtle',
    does: 'Lower sample rate, gritty and metallic like an old sampler',
    effects: () => [step({ target: 'dist', step: 'bar', lane: fixed(50), dist: { mode: 'decimate' } })],
  },
  {
    name: 'Radio',
    strength: 'subtle',
    does: 'Thin and driven, like a small speaker',
    effects: () => [
      step({ target: 'dist', step: 'bar', lane: fixed(60), dist: { mode: 'drive' } }),
      step({ target: 'filter', step: 'bar', lane: fixed(1200), filter: { type: 'highpass', resonance: 0.6 } }),
    ],
  },
  {
    name: 'Stretch smear',
    strength: 'extreme',
    does: 'Each hit stretched to twice its length in short metallic grains',
    effects: () => [step({ target: 'stretch', step: 'bar', lane: fixed(2), stretch: { grain: 12, combine: 'multiply' } })],
  },
  {
    name: 'Reverb throw',
    strength: 'subtle',
    does: 'Every hit under it into a large hall, ringing out after it',
    effects: () => [step({ target: 'reverb', step: 'bar', lane: fixed(100), reverb: { size: 0.85 } })],
  },
  {
    name: 'Delay throw',
    strength: 'subtle',
    does: 'Every hit under it echoing at 3/16, dying away slowly',
    effects: () => [step({ target: 'delay', step: 'bar', lane: fixed(80), delay: { steps: 3, feedback: 0.7 } })],
  },
  {
    name: 'Random verb',
    strength: 'subtle',
    does: 'Now and then a hit into the reverb, about one in four',
    effects: () => [step({ target: 'reverb', step: '1/16', lane: [{ lo: 60, hi: 100, chance: 25 }], reverb: { size: 0.6 } })],
  },
];

/** A new effect for an audio mod's target with its lane drawn as `lane`. */
const audio = (target: 'freeze' | 'reverse' | 'rewind', lane: LaneStep[]): StepEffect => ({ ...newStepEffect(target), lane });

/**
 * One preset per audio mod (Claudes val: the list). Stutter Roll, Scratch
 * Baby and Trance gate Straight are the presets on their cards; Halftime and
 * Scramble are a new effect, which is heard at once.
 */
export const AUDIO_PRESETS: readonly ModPreset[] = [
  { name: 'Stutter Roll', strength: 'subtle', does: 'Each beat rolls 1/16 → 1/32 → 1/64', effects: () => [{ ...newStepEffect('stutter'), step: '1/16', lane: STUTTER_ROLL }] },
  { name: 'Scratch Baby', strength: 'extreme', does: 'A baby scratch, back and forth, the fader always open', effects: () => [newScratch()] },
  // TODO(spec): the spec names Freeze, Reverse and Rewind as presets but not their lanes. A new effect of these is all off,
  // so it would be heard nowhere; they are drawn on the last beat of each bar (Claudes val, to be confirmed).
  { name: 'Freeze', strength: 'extreme', does: 'The last beat of each bar frozen to a tone', effects: () => [audio('freeze', fixed(0, 0, 0, 1))] },
  { name: 'Reverse', strength: 'subtle', does: 'The last beat of each bar backwards, 1/16 by 1/16', effects: () => [audio('reverse', fixed(0, 0, 0, 1))] },
  { name: 'Rewind', strength: 'extreme', does: 'Pulls back a beat on the last beat of each bar', effects: () => [audio('rewind', fixed(0, 0, 0, 1))] },
  { name: 'Halftime', strength: 'extreme', does: 'What is heard at half speed, the pitch down like a record', effects: () => [DEFAULT_HALFTIME] },
  { name: 'Scramble', strength: 'extreme', does: 'Half the 1/16 cells swapped for cells from anywhere in the song', effects: () => [newStepEffect('scramble')] },
  { name: 'Trance gate Straight', strength: 'subtle', does: '16 pulses a bar, each open half a step', effects: () => [newStepEffect('tranceGate')] },
];

/** Every preset, in the order they are made and listed. */
export const MOD_PRESETS: readonly ModPreset[] = [...START_FROM_PRESETS, ...AUDIO_PRESETS];

/** `preset` made in `project` as a mod with `isPreset`. */
const presetMod = (project: Project, preset: ModPreset, ctx: CommandContext): Mod => ({
  id: ctx.newId(),
  name: preset.name,
  effects: preset.effects(project),
  seed: ctx.newSeed(),
  isPreset: true,
});

/**
 * The presets `project` lacks (by name), made as mods with `isPreset`; those
 * it has stay as they are, so a project sounds the same even when the app's
 * presets change. Nothing plays the new ones. The same project back when it
 * lacks none. (Claudes val: by name, so a preset added to the app later comes too.)
 */
export function addMissingPresets(project: Project, ctx: CommandContext = defaultContext): Project {
  const has = new Set(Object.values(project.mods).flatMap((m) => (m.isPreset === true ? [m.name] : [])));
  const missing = MOD_PRESETS.filter((p) => !has.has(p.name));
  if (missing.length === 0) return project;
  const made = missing.map((p) => presetMod(project, p, ctx));
  return { ...project, mods: { ...project.mods, ...Object.fromEntries(made.map((m) => [m.id, m])) } };
}

export const isPreset = (project: Project, id: Id): boolean => project.mods[id]?.isPreset === true;

/** `name` if no mod has it, else `name 2`, `name 3` … the first free. */
export function freeModName(project: Project, name: string): string {
  const names = new Set(Object.values(project.mods).map((m) => m.name));
  if (!names.has(name)) return name;
  let n = 2;
  while (names.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/** A mod of one's own made from `mod`, with a new id and a free name from its own; without `isPreset`. */
function ownCopy(project: Project, mod: Mod, ctx: CommandContext): Mod {
  return { id: ctx.newId(), name: freeModName(project, mod.name), effects: mod.effects, seed: mod.seed };
}

/**
 * Before a change to mod `id`: a preset is left as it is, and a mod of one's
 * own made from it (same effects and seed) takes the preset's clips. Returns
 * the project and the mod the change goes to; a mod of one's own as it is.
 */
export function ownModFor(project: Project, id: Id, ctx: CommandContext): { readonly project: Project; readonly id: Id } {
  const mod = project.mods[id];
  if (mod === undefined || mod.isPreset !== true) return { project, id };
  const copy = ownCopy(project, mod, ctx);
  const clips = project.song.clips.map((c) => ((c.row === 'modA' || c.row === 'modB') && c.ref === id ? { ...c, ref: copy.id } : c));
  return { project: { ...project, mods: { ...project.mods, [copy.id]: copy }, song: { ...project.song, clips } }, id: copy.id };
}

/** Start from: a mod of one's own from preset `id`, named as it with a number, with a new seed. */
export const startFromPreset =
  (id: Id): Command =>
  (project, ctx) => {
    const mod = project.mods[id];
    if (mod === undefined) return notFound(id);
    const copy = { ...ownCopy(project, mod, ctx), seed: ctx.newSeed() };
    return ok({ ...project, mods: { ...project.mods, [copy.id]: copy } });
  };
