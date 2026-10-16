export type Id = string;

/** Injected randomness: returns 0 ≤ x < 1. */
export type Rng = () => number;

export const STEPS_PER_BAR = 16;

/** Raw audio. Treated as immutable once created. */
export interface AudioData {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** Audio: an imported file, trimmed to a window of it. Only sound; what it is used for is its breaks'. */
export interface Sample {
  readonly id: Id;
  readonly name: string;
  readonly audioId: Id;
  /** Start of the sample within its audio, in seconds. */
  readonly offset: number;
  /** Length in seconds. */
  readonly duration: number;
}

/**
 * A sample cut into slots 01…N, one pad per slot, each pad with its slot's hit
 * on top. Slots count by number: pad 05 always plays the fifth slice, whatever
 * the markers or the sample under the break. A one-shot is a break with one
 * slot and no markers to move.
 */
export interface Break {
  readonly id: Id;
  readonly name: string;
  readonly sampleId: Id;
  /** Its length in bars, which gives its tempo; null for a one-shot. */
  readonly bars: number | null;
  /**
   * Where slices start, as parts 0–1 of the break: sorted, the first at 0. In
   * parts rather than seconds, so they keep their steps when the sample changes.
   */
  readonly markers: readonly number[];
  /** One pad per slot, in order. It grows with the markers but never shrinks: a slot past the last slice is silent. */
  readonly pads: readonly Id[];
  /** The break's own hit: a macro for the hits of its slices. null for a one-shot. */
  readonly parent: Id | null;
  /** The loop made for the break the first time it became one, or null. */
  readonly loop: Id | null;
}

export type Direction = 'forward' | 'reverse';

/** Part of a slice, start and end as parts 0–1 of it. */
export interface Region {
  readonly start: number;
  readonly end: number;
}

export interface Hit {
  readonly id: Id;
  readonly name: string;
  /** The break it plays a slice of. */
  readonly breakId: Id;
  /** The slot it plays, from 0; null for the whole break. A slot past the break's last slice is silent. */
  readonly slot: number | null;
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
  /** How the pad picks a member when neither a step lock nor a mod has. */
  readonly choice: PadChoice;
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
export const MOD_TARGETS = ['swap', 'padMember', 'ratchet', 'pitch', 'volume', 'direction', 'tempo'] as const;
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
}

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

export interface Song {
  readonly bpm: number;
  /** Whole bars, except in a preview of one loop, which is exactly as long as the loop. */
  readonly bars: number;
  readonly clips: readonly Clip[];
}

export interface Project {
  readonly audio: Readonly<Record<Id, AudioData>>;
  readonly samples: Readonly<Record<Id, Sample>>;
  readonly breaks: Readonly<Record<Id, Break>>;
  readonly hits: Readonly<Record<Id, Hit>>;
  readonly pads: Readonly<Record<Id, Pad>>;
  readonly loops: Readonly<Record<Id, Loop>>;
  readonly mods: Readonly<Record<Id, Mod>>;
  readonly song: Song;
}
