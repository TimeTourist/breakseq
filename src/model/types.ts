export type Id = string;

/** Injected randomness: returns 0 ≤ x < 1. */
export type Rng = () => number;

export const STEPS_PER_BAR = 16;

/** Raw audio. Treated as immutable once created. */
export interface AudioData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/**
 * Audio: an imported file, trimmed to a window of it, and how that trim is
 * sliced. Only sound; how it plays is its hits'.
 */
export interface Sample {
  readonly id: Id;
  readonly name: string;
  readonly audioId: Id;
  /** Start of the sample within its audio, in seconds. */
  readonly offset: number;
  /** Length in seconds. */
  readonly duration: number;
  /** Which channels play: everything plays in stereo, so Left, Right and Mono are the same in both. */
  readonly channel: SampleChannel;
  /** Its number among the trims of its file, from 1: "amen trim 2". Never changes. */
  readonly trim: number;
  /** Cue markers in the file, in seconds from its start: offered in Slice. Absent when it has none. */
  readonly cues?: readonly number[];
  /** Length in bars, giving its tempo; null when it is not sliced. */
  readonly bars: number | null;
  /**
   * Where slices start, as parts 0–1 of the sample: sorted, the first at 0. [0]
   * when not sliced. In parts rather than seconds, so they keep their steps when it is trimmed.
   */
  readonly markers: readonly number[];
  /** Marked to be sliced in Import but not sliced yet (bars is null). Nothing is guessed or made before that. */
  readonly unsliced?: true;
}

/** Stereo as the file is; Left or Right that channel in both; Mono the two averaged in both. */
export type SampleChannel = 'stereo' | 'left' | 'right' | 'mono';

export type Direction = 'forward' | 'reverse';

/** Part of a slice, start and end as parts 0–1 of it. */
export interface Region {
  readonly start: number;
  readonly end: number;
}

/**
 * Time stretch: the hit plays as short grains, each starting a little further
 * into the slice and laid over each other, so its length changes but its pitch
 * stays. Off is a factor of 1; Fit to tempo stretches by the sample's tempo over
 * the song's, so a slice lasts as long as its steps in the song.
 */
export type StretchMode = 'off' | 'fit' | 'factor';
/** Where the grain grid starts: at the sample's start, as when a sampler stretched the whole sample, or at the hit's start. */
export type GrainFrom = 'sample' | 'hit';

export interface HitStretch {
  readonly mode: StretchMode;
  /** Length factor for 'factor': 2 is twice as long. */
  readonly factor: number;
  /** Grain length in ms; null takes the next layer's, or DEFAULT_GRAIN. */
  readonly grain: number | null;
  /** null takes the next layer's, or 'sample'. */
  readonly from: GrainFrom | null;
}

/** Grain length when nothing sets one, in ms. */
export const DEFAULT_GRAIN = 30;
export const NO_STRETCH: HitStretch = { mode: 'off', factor: 1, grain: null, from: null };

/**
 * Dist colours a sound and keeps its level: Drive saturates and then clips,
 * Crush lowers the bit depth, Decimate the sample rate. Off takes the next layer's.
 */
export type DistMode = 'off' | 'drive' | 'crush' | 'decimate';
export interface HitDist {
  readonly mode: DistMode;
  /** 0–1. */
  readonly amount: number;
}
export const NO_DIST: HitDist = { mode: 'off', amount: 0.5 };

/** A low- or high-pass filter after dist. Off takes the next layer's. */
export type FilterType = 'off' | 'lowpass' | 'highpass';
export interface HitFilter {
  readonly type: FilterType;
  /** Hz. */
  readonly cutoff: number;
  /** 0–1. */
  readonly resonance: number;
}
export const NO_FILTER: HitFilter = { type: 'off', cutoff: 2000, resonance: 0.2 };
export const MIN_CUTOFF = 20;
export const MAX_CUTOFF = 20000;

/**
 * Reverb a hit sends to the song's one reverb, which rings out beside the
 * voice: the next hit cuts the hit, not its reverb. Amount 0 takes the next layer's.
 */
export interface HitReverb {
  /** 0–1: how much of the hit is sent. */
  readonly amount: number;
  /** 0–1: a short room to a large hall. */
  readonly size: number;
}
export const NO_REVERB: HitReverb = { amount: 0, size: 0.5 };

/** Delay times, in steps of 1/16 at the song's tempo: 1/16, 1/8, 3/16, 1/4. */
export const DELAY_STEPS = [1, 2, 3, 4] as const;
export type DelaySteps = (typeof DELAY_STEPS)[number];
/** Echoes a hit sends to a delay beside the voice, like reverb. Amount 0 takes the next layer's. */
export interface HitDelay {
  /** 0–1: how much of the hit is sent. */
  readonly amount: number;
  readonly steps: DelaySteps;
  /** 0–1: how much of each echo comes back as the next. */
  readonly feedback: number;
}
export const NO_DELAY: HitDelay = { amount: 0, steps: 3, feedback: 0.4 };

/** What a hit has for itself, and its pad and matrix have for all under them. */
export interface Config {
  readonly direction: Direction;
  /** Semitones. */
  readonly pitch: number;
  /** dB. */
  readonly volume: number;
  /** −1 (left) to 1 (right); the layers' and mods' add to it. */
  readonly pan: number;
  /** Milliseconds. */
  readonly fadeOut: number;
  readonly stretch: HitStretch;
  readonly dist: HitDist;
  readonly filter: HitFilter;
  readonly reverb: HitReverb;
  readonly delay: HitDelay;
}

export const NO_CONFIG: Config = {
  direction: 'forward',
  pitch: 0,
  volume: 0,
  pan: 0,
  fadeOut: 0,
  stretch: NO_STRETCH,
  dist: NO_DIST,
  filter: NO_FILTER,
  reverb: NO_REVERB,
  delay: NO_DELAY,
};

/** Plays a sample, or a slice of it, with its own config. A variant is a new hit on the same sample. */
export interface Hit extends Config {
  readonly id: Id;
  readonly name: string;
  readonly sampleId: Id;
  /** The slice it plays, from 0; null for the whole sample. Past the last marker it is silent. */
  readonly slice: number | null;
  readonly region: Region;
  /** The hit this one was duplicated from, or null. */
  readonly variantOf: Id | null;
}

/** Ordered hits in a row (x). Member 1 (index 0) is the default. Its config is laid over all its hits. */
export interface Pad {
  readonly id: Id;
  readonly name: string;
  /** Each hit belongs to this pad only. */
  readonly members: readonly Id[];
  /** How the pad picks a member when neither a step lock nor a mod has. */
  readonly choice: PadChoice;
  readonly config: Config;
}

/**
 * Pads in order (y), 01, 02 …, and config laid over all of them. With more than
 * one pad it is a break, with one a one-shot: a classification, never chosen.
 */
export interface Matrix {
  readonly id: Id;
  readonly name: string;
  /** Its pads in order (y); each pad belongs to this matrix only. */
  readonly pads: readonly Id[];
  readonly config: Config;
  /** The sample it was made from: its rows follow that sample's slicing. null for one built by hand or copied. */
  readonly sampleId: Id | null;
  /** The loop the slicing made, or null. */
  readonly loop: Id | null;
}

/** Top plays member 1; Round robin the next member each time the pad plays in the song; Random any; No repeat any but the last. */
export const PAD_CHOICES = ['top', 'roundRobin', 'random', 'noRepeat'] as const;
export type PadChoice = (typeof PAD_CHOICES)[number];

export interface Step {
  readonly padId: Id | null;
  /** Hit id of the chosen member; null plays member 1. */
  readonly memberId: Id | null;
  readonly ignoreMods: boolean;
  /** Always 0 in v1. */
  readonly nudge: number;
}

/** A tag for grouping and naming loops (M1, F1). Any loop can go in either Song row. */
export type LoopKind = 'main' | 'fill';

export interface Loop {
  readonly id: Id;
  readonly name: string;
  readonly kind: LoopKind;
  /** Its length is the number of steps: any number of 1/16, not only whole bars. */
  readonly steps: readonly Step[];
}

/** What a mod changes. Applied in this order, whatever row the mod is in. */
export const MOD_TARGETS = ['swap', 'padMember', 'ratchet', 'pitch', 'volume', 'pan', 'direction', 'stretch', 'dist', 'filter', 'reverb', 'delay', 'tempo'] as const;
export type ModTarget = (typeof MOD_TARGETS)[number];

export type ModRate = 'step' | 'beat' | 'bar';

export type ModShape =
  /** Values in turn, one per interval, then from the start again. */
  | { readonly kind: 'list'; readonly values: readonly number[] }
  /** One value further for each interval the mod hits a step in; with no values, a pad's members in turn. */
  | { readonly kind: 'cycle'; readonly values: readonly number[] }
  /** From the first interval of the run to its last. */
  | { readonly kind: 'ramp'; readonly from: number; readonly to: number }
  /**
   * Chance in percent (0–100) that an interval gets a value at all. `whole`
   * rolls whole numbers only, e.g. pitch in semitones; targets that take whole
   * numbers always do.
   */
  | { readonly kind: 'random'; readonly min: number; readonly max: number; readonly chance: number; readonly whole: boolean };

/** Targets that set a value on a step through a shape: all but Swap. */
export type StepTarget = Exclude<ModTarget, 'swap'>;
export const STEP_TARGETS = MOD_TARGETS.filter((t): t is StepTarget => t !== 'swap');

/** An effect that changes steps as they play, by a value from its shape. */
export interface StepEffect {
  readonly target: StepTarget;
  readonly rate: ModRate;
  readonly shape: ModShape;
  /** For Stretch only: its grain length and how it meets the hit's own stretch. Missing means DEFAULT_MOD_STRETCH. */
  readonly stretch?: ModStretch;
  /** For Dist only: its mode; the value is the amount. Missing means DEFAULT_MOD_DIST. */
  readonly dist?: ModDist;
  /** For Filter only: its type and resonance; the value is the cutoff. Missing means DEFAULT_MOD_FILTER. */
  readonly filter?: ModFilter;
  /** For Reverb only: its size; the value is the amount in percent. Missing means DEFAULT_MOD_REVERB. */
  readonly reverb?: ModReverb;
  /** For Delay only: its time and feedback; the value is the amount in percent. Missing means DEFAULT_MOD_DELAY. */
  readonly delay?: ModDelay;
}

export interface ModReverb {
  readonly size: number;
}
export const DEFAULT_MOD_REVERB: ModReverb = { size: 0.5 };
export interface ModDelay {
  readonly steps: DelaySteps;
  readonly feedback: number;
}
export const DEFAULT_MOD_DELAY: ModDelay = { steps: 3, feedback: 0.4 };

export interface ModDist {
  readonly mode: Exclude<DistMode, 'off'>;
}
export const DEFAULT_MOD_DIST: ModDist = { mode: 'drive' };
export interface ModFilter {
  readonly type: Exclude<FilterType, 'off'>;
  readonly resonance: number;
}
export const DEFAULT_MOD_FILTER: ModFilter = { type: 'lowpass', resonance: 0.2 };

/** Multiply: times the hit's own stretch. Replace: instead of it. */
export type StretchCombine = 'multiply' | 'replace';
export interface ModStretch {
  /** Grain length in ms. */
  readonly grain: number;
  readonly combine: StretchCombine;
}
export const DEFAULT_MOD_STRETCH: ModStretch = { grain: DEFAULT_GRAIN, combine: 'multiply' };

/**
 * Stack chooses among everything under the playhead: the layers top down (Fill,
 * then Main), and in each the hits of its pad in order. At random; round robin,
 * one candidate further each interval with a hit; or layer by layer, a layer's
 * default hit each interval, from the top or from the bottom.
 */
export type StackPick = 'random' | 'roundRobin' | 'topDown' | 'bottomUp';

/**
 * Shuffle deals out the hits played within the clip to the steps that have one:
 * like a deck (each once, in a random order), freely (any, again and again), in
 * reverse, or rotated by `by` hits.
 */
export type ShufflePick =
  | { readonly kind: 'deck' }
  | { readonly kind: 'random' }
  | { readonly kind: 'reverse' }
  | { readonly kind: 'rotate'; readonly by: number };

/** Swaps the hit on steps that have one, keeping the rhythm. */
export interface SwapEffect {
  readonly target: 'swap';
  /** How often Stack picks; Shuffle works hit by hit. */
  readonly rate: ModRate;
  readonly mode: { readonly kind: 'stack'; readonly pick: StackPick } | { readonly kind: 'shuffle'; readonly pick: ShufflePick };
}

export type TapeDirection = 'forward' | 'reverse' | 'pingpong';
/**
 * How the speed moves from `from` to `to`: evenly; starting or ending gently;
 * or aggressively, most of the way at once at the start, or all at the end.
 */
export type TapeCurve = 'linear' | 'softStart' | 'softEnd' | 'hardStart' | 'hardEnd';

/** The longest tape segment: 4 bars. */
export const MAX_TAPE_STEPS = 4 * STEPS_PER_BAR;
export const MAX_TAPE_SPEED = 4;

/**
 * Records the first `length` steps heard from the clip's start and plays them
 * like tape for as long as the clip lasts, at a speed going from `from` to `to`.
 */
export interface TapeEffect {
  readonly target: 'tape';
  /** Steps of 1/16, 1 to MAX_TAPE_STEPS. */
  readonly length: number;
  readonly direction: TapeDirection;
  /** Playback speed, 0 to MAX_TAPE_SPEED: 1 is as recorded, 0 is stopped. */
  readonly speed: { readonly from: number; readonly to: number };
  /** Steps the ramp takes from the clip's start, then it holds `to`; null ramps over the whole clip. */
  readonly rampOver: number | null;
  readonly curve: TapeCurve;
  /** Slow wobble in speed, 0–1: up to ±25 %. */
  readonly wow: number;
  /** Fast, uneven flutter in speed, 0–1: up to ±6 %. */
  readonly flutter: number;
}

export type ModEffect = StepEffect | SwapEffect | TapeEffect;
export type EffectTarget = ModEffect['target'];

/** A mod does things through its effects: at most one per target. A new mod has none, and does nothing until it gets one. */
export interface Mod {
  readonly id: Id;
  readonly name: string;
  readonly effects: readonly ModEffect[];
}

export const isStepEffect = (effect: ModEffect): effect is StepEffect => effect.target !== 'tape' && effect.target !== 'swap';
export const swapOf = (mod: Mod | undefined): SwapEffect | undefined => mod?.effects.find((e): e is SwapEffect => e.target === 'swap');
export const tapeOf = (mod: Mod | undefined): TapeEffect | undefined =>
  mod?.effects.find((e): e is TapeEffect => e.target === 'tape');

export type SongRow = 'main' | 'fill' | 'modA' | 'modB';

/**
 * A loop or mod laid out in a Song row. Times are in steps of 1/16 from the
 * start of the song. Clips in the same row never overlap.
 */
export interface Clip {
  readonly id: Id;
  readonly row: SongRow;
  /** The loop (Main, Fill) or mod (Mod A, Mod B) it plays. */
  readonly ref: Id;
  readonly start: number;
  /** At least one step. */
  readonly length: number;
  /** Where in its content the clip starts: trimming its start moves it. A loop wraps round. */
  readonly offset: number;
}

/** A part of the song that plays over and over, in steps from the start; `on` false keeps it but plays the whole song. */
export interface SongLoop {
  readonly start: number;
  /** After the last step, so the loop is `end - start` steps long. */
  readonly end: number;
  readonly on: boolean;
}

export interface Song {
  readonly bpm: number;
  /** Whole bars, except in a preview of one loop, which is exactly as long as the loop. */
  readonly bars: number;
  readonly clips: readonly Clip[];
  /** Missing in songs from before there were loops. */
  readonly loop?: SongLoop | null;
}

export interface Project {
  readonly audio: Readonly<Record<Id, AudioData>>;
  readonly samples: Readonly<Record<Id, Sample>>;
  readonly matrices: Readonly<Record<Id, Matrix>>;
  readonly hits: Readonly<Record<Id, Hit>>;
  readonly pads: Readonly<Record<Id, Pad>>;
  readonly loops: Readonly<Record<Id, Loop>>;
  readonly mods: Readonly<Record<Id, Mod>>;
  readonly song: Song;
}
