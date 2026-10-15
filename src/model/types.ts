export type Id = string;

/** Injected randomness: returns 0 ≤ x < 1. */
export type Rng = () => number;

export const STEPS_PER_BAR = 16;
export const MAX_TAGS = 8;

/** Raw audio. Treated as immutable once created. */
export interface AudioData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export interface Tag {
  readonly id: Id;
  readonly name: string;
}

export interface BreakInfo {
  readonly bars: number;
  readonly bpm: number;
  /** Sliced breaks are locked until unsliced. */
  readonly sliced: boolean;
  /** Where slices start, in seconds from the break's start: sorted, the first at 0. */
  readonly markers: readonly number[];
  /** The loop the slicing made, while the break is sliced. */
  readonly loop: Id | null;
}

/** Audio: a slice of a break or an imported file, as a window into an AudioData. */
export interface Sample {
  readonly id: Id;
  readonly name: string;
  readonly audioId: Id;
  /** Start of the sample within its audio, in seconds. */
  readonly offset: number;
  /** Length in seconds. */
  readonly duration: number;
  readonly mainTag: Id | null;
  /** The main tag is a guess, not yet confirmed. */
  readonly tagGuessed: boolean;
  readonly extraTags: readonly Id[];
  /** Set when the sample is a break; null for a one-shot. */
  readonly break: BreakInfo | null;
  /** The break this sample was sliced from, or null for an imported file. */
  readonly sliceOf: Id | null;
}

export type Direction = 'forward' | 'reverse';

/** Region in seconds, relative to the start of the sample. */
export interface Region {
  readonly start: number;
  readonly end: number;
}

export interface Hit {
  readonly id: Id;
  readonly name: string;
  readonly sampleId: Id;
  readonly region: Region;
  readonly direction: Direction;
  /** Semitones. */
  readonly pitch: number;
  /** dB. */
  readonly volume: number;
  /** Milliseconds. */
  readonly fadeOut: number;
  /** The hit this one was duplicated from, or null. */
  readonly variantOf: Id | null;
}

/** Ordered hits. Member 1 (index 0) is the default. */
export interface Pad {
  readonly id: Id;
  readonly name: string;
  readonly members: readonly Id[];
  /** Made by the automatic chain rather than built by hand. Only used to group pads in the GUI. */
  readonly auto: boolean;
}

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
export const MOD_TARGETS = ['sourceLoop', 'padMember', 'ratchet', 'pitch', 'volume', 'direction', 'tempo'] as const;
export type ModTarget = (typeof MOD_TARGETS)[number];

export type ModScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'tag'; readonly tagId: Id }
  | { readonly kind: 'pad'; readonly padId: Id };

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

/** Targets that set a value on a step through a shape: all but Borrow. */
export type StepTarget = Exclude<ModTarget, 'sourceLoop'>;
export const STEP_TARGETS = MOD_TARGETS.filter((t): t is StepTarget => t !== 'sourceLoop');

/** An effect that changes steps as they play, by a value from its shape. */
export interface StepEffect {
  readonly target: StepTarget;
  readonly scope: ModScope;
  readonly rate: ModRate;
  readonly shape: ModShape;
}

/**
 * How Borrow chooses, interval by interval: at random with a chance; every
 * nth interval; or round its own loop and the others in turn.
 */
export type BorrowPick =
  | { readonly kind: 'random'; readonly chance: number }
  | { readonly kind: 'every'; readonly n: number }
  | { readonly kind: 'inTurn' };

/**
 * Plays a step's hit from another loop: the same step in one of `sources`,
 * with its pad, member and locks. Where that loop has nothing on the step,
 * `skipEmpty` keeps the step's own hit; otherwise it goes silent.
 */
export interface BorrowEffect {
  readonly target: 'sourceLoop';
  readonly scope: ModScope;
  readonly rate: ModRate;
  readonly sources: readonly Id[];
  readonly pick: BorrowPick;
  readonly skipEmpty: boolean;
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

export type ModEffect = StepEffect | BorrowEffect | TapeEffect;
export type EffectTarget = ModEffect['target'];

/** A mod does things through its effects: at most one per target. A new mod has none, and does nothing until it gets one. */
export interface Mod {
  readonly id: Id;
  readonly name: string;
  readonly effects: readonly ModEffect[];
}

export const isStepEffect = (effect: ModEffect): effect is StepEffect => effect.target !== 'tape' && effect.target !== 'sourceLoop';
/** Effects that act on some steps: everything but Tape. */
export const isScopedEffect = (effect: ModEffect): effect is StepEffect | BorrowEffect => effect.target !== 'tape';
export const borrowOf = (mod: Mod | undefined): BorrowEffect | undefined =>
  mod?.effects.find((e): e is BorrowEffect => e.target === 'sourceLoop');
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

export interface Song {
  readonly bpm: number;
  /** Whole bars, except in a preview of one loop, which is exactly as long as the loop. */
  readonly bars: number;
  readonly clips: readonly Clip[];
}

export interface Project {
  readonly audio: Readonly<Record<Id, AudioData>>;
  readonly tags: Readonly<Record<Id, Tag>>;
  readonly samples: Readonly<Record<Id, Sample>>;
  readonly hits: Readonly<Record<Id, Hit>>;
  readonly pads: Readonly<Record<Id, Pad>>;
  readonly loops: Readonly<Record<Id, Loop>>;
  readonly mods: Readonly<Record<Id, Mod>>;
  readonly song: Song;
}
