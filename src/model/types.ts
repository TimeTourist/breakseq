export type Id = string;

/** Injected randomness: returns 0 ≤ x < 1. */
export type Rng = () => number;

export const STEPS_PER_BAR = 16;

/** The longest loop: 16 bars. */
export const MAX_LOOP_STEPS = 16 * STEPS_PER_BAR;

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
  /** Its number among the trims of its file, from 1: "amen sample 2". Never changes. */
  readonly trim: number;
  /** Cue markers in the file, in seconds from its start: offered in Slice. Absent when it has none. */
  readonly cues?: readonly number[];
  /** Length in bars, giving its tempo, in 1/16 steps (0.25 is a quarter bar); null when it is not sliced. */
  readonly bars: number | null;
  /**
   * Where slices start, as parts 0–1 of the sample: sorted, the first at 0. [0]
   * when not sliced. Those of `points` within the trim, as parts of it.
   */
  readonly markers: readonly number[];
  /**
   * Where slices start in the whole file, in seconds, sorted: its markers are
   * those within the trim, so they stay in the file when it is trimmed, and
   * those outside come back when it reaches them again (Magnus beslut).
   * Absent when not sliced, or when sliced before this: then its markers.
   */
  readonly points?: readonly number[];
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
  /**
   * Fit to tempo by pitch: the sample's tempo pitched to the song's, like a
   * sampler playing faster, added to the semitones and counted once however
   * many layers have it. Missing in older project files, so read it as `=== true`.
   */
  readonly pitchFit: boolean;
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
  pitchFit: false,
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
  /** Its randomness: every random choice is worked out from it and where it plays (see Slump och seeds). 0 ≤ seed < 2³². */
  readonly seed: number;
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
  /** Its randomness: every random choice is worked out from it and where it plays (see Slump och seeds). 0 ≤ seed < 2³². */
  readonly seed: number;
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
export const MOD_TARGETS = [
  'swap',
  'padMember',
  'ratchet',
  'pitch',
  'volume',
  'pan',
  'direction',
  'stretch',
  'dist',
  'filter',
  'reverb',
  'delay',
  'tempo',
  // The audio mods last, so the targets before them keep their numbers in dice rolls.
  'scramble',
  'stutter',
  'freeze',
  'reverse',
  'rewind',
  'halftime',
  // Scratch after them, for the same reason.
  'scratch',
  // Trance gate after Scratch, for the same reason.
  'tranceGate',
] as const;
export type ModTarget = (typeof MOD_TARGETS)[number];

/** How often Swap's Stack and Tempo pick: every 1/16, beat or bar. */
export type ModRate = 'step' | 'beat' | 'bar';

/**
 * Tempo (slip) keeps its forms (Magnus beslut: Swap, Tempo and Tape keep their
 * controls): values in turn, one further each interval with a step, a ramp
 * over the clip, or now and then a value at random.
 */
export type TempoShape =
  /** Values in turn, one per interval, then from the start again. */
  | { readonly kind: 'list'; readonly values: readonly number[] }
  /** One value further for each interval it plays a step in. */
  | { readonly kind: 'cycle'; readonly values: readonly number[] }
  /** From the first interval of the clip to its last. */
  | { readonly kind: 'ramp'; readonly from: number; readonly to: number }
  /** Chance in percent (0–100) that an interval gets a value at all. */
  | { readonly kind: 'random'; readonly min: number; readonly max: number; readonly chance: number; readonly whole: boolean };

/** Plays the layer in another tempo while the main clock goes on (see Slip-tempo). */
export interface TempoEffect {
  readonly target: 'tempo';
  readonly rate: ModRate;
  readonly shape: TempoShape;
}

/** The size of a step in a lane, in 1/16 steps. */
export type StepSize = '1/16' | 'beat' | 'bar';
export const STEP_SIZES: Readonly<Record<StepSize, number>> = { '1/16': 1, beat: 4, bar: STEPS_PER_BAR };
export const MAX_LANE_STEPS = 16;

/** The chances a dice step can have, in percent: a click on it goes down this list and round. */
export const CHANCES = [100, 75, 50, 25] as const;
export type Chance = (typeof CHANCES)[number];

/**
 * A step in a lane: a fixed value, or a dice step that rolls a value in its
 * band each time it plays, if its chance comes up; otherwise it does nothing.
 * On an on/off lane the band is 0–1 and the chance is how likely it is on.
 */
/**
 * A fixed step, or a dice step: a band and a chance. `whole` makes a dice step
 * roll whole numbers on a target whose rolls are free otherwise: an old Random
 * with whole numbers (see Gamla projekt).
 */
export type LaneStep = { readonly v: number } | { readonly lo: number; readonly hi: number; readonly chance: Chance; readonly whole?: true };
export const isDice = (step: LaneStep): step is Extract<LaneStep, { lo: number }> => 'lo' in step;

/** Targets with a lane: every target that sets a value on a step, all but Swap and Tempo, and the audio mods but Halftime. */
export const LANE_TARGETS = ['padMember', 'ratchet', 'pitch', 'volume', 'pan', 'direction', 'stretch', 'dist', 'filter', 'reverb', 'delay', 'scramble', 'stutter', 'freeze', 'reverse', 'rewind', 'tranceGate'] as const;
export type LaneTarget = (typeof LANE_TARGETS)[number];

/** Targets that set something on a step as it plays: the lanes and Tempo. */
export type StepTarget = LaneTarget | 'tempo';

/** Pitch values in whole semitones (the default) or free. */
export interface ModPitch {
  readonly values: 'semitones' | 'free';
}

/**
 * An effect that changes steps as they play: its lane of 1–16 steps of the
 * same size starts where the clip starts and loops on its own length, and
 * each step's value holds over the step for every trigger in it.
 */
export interface StepEffect {
  readonly target: LaneTarget;
  readonly step: StepSize;
  readonly lane: readonly LaneStep[];
  /** For Pitch only: whole semitones or free. Missing means semitones. */
  readonly pitch?: ModPitch;
  /** For Stretch only: its grain length and how it meets the hit's own stretch. Missing means DEFAULT_MOD_STRETCH. */
  readonly stretch?: ModStretch;
  /** For Dist only: its mode; the value is the amount in percent. Missing means DEFAULT_MOD_DIST. */
  readonly dist?: ModDist;
  /** For Filter only: its type and resonance; the value is the cutoff. Missing means DEFAULT_MOD_FILTER. */
  readonly filter?: ModFilter;
  /** For Reverb only: its size; the value is the amount in percent. Missing means DEFAULT_MOD_REVERB. */
  readonly reverb?: ModReverb;
  /** For Delay only: its time and feedback; the value is the amount in percent. Missing means DEFAULT_MOD_DELAY. */
  readonly delay?: ModDelay;
  /** For Scramble only; the value is the chance in percent that a cell is swapped. Missing means DEFAULT_MOD_SCRAMBLE. */
  readonly scramble?: ModScramble;
  /** For Stutter only; the value is the repeat: 0 off, 1 1/16, 2 1/32, 3 1/64. Missing means DEFAULT_MOD_STUTTER. */
  readonly stutter?: ModStutter;
  /** For Freeze only; the value is on or off. Missing means DEFAULT_MOD_FREEZE. */
  readonly freeze?: ModFreeze;
  /** For Reverse only; the value is on or off. Missing means DEFAULT_MOD_REVERSE. */
  readonly reverse?: ModReverse;
  /** For Rewind only; the value is on (fires) or off. Missing means DEFAULT_MOD_REWIND. */
  readonly rewind?: ModRewind;
  /** For Trance gate only; the value is open (on) or closed. Missing means DEFAULT_MOD_TRANCE_GATE. */
  readonly tranceGate?: ModTranceGate;
}

/**
 * Audio mods sample what is heard under their clip (see Mods som samplar det
 * som hörs): Main or Fill with the step mods, reverb and delay, and tape;
 * never themselves or one another.
 */
export const AUDIO_TARGETS = ['scramble', 'stutter', 'freeze', 'reverse', 'rewind', 'halftime', 'tranceGate'] as const;
export type AudioTarget = (typeof AUDIO_TARGETS)[number];

/**
 * Trance gate (Magnus beslut 2026-10-23): changes only the level of what plays,
 * in time with its lane. Depth is how quiet a closed step is ('-inf' silent),
 * Open how much of an open step is heard, Smooth the attack and release of
 * every edge in ms (1–50).
 */
export const TRANCE_DEPTHS = [-6, -12, -24, '-inf'] as const;
export const TRANCE_OPENS = [25, 50, 75, 100] as const;
export const MIN_TRANCE_SMOOTH = 1;
export const MAX_TRANCE_SMOOTH = 50;
export interface ModTranceGate {
  /** dB, or '-inf' for silence. */
  readonly depth: (typeof TRANCE_DEPTHS)[number];
  /** Percent of an open step that is heard. */
  readonly open: (typeof TRANCE_OPENS)[number];
  /** ms, 1–50. */
  readonly smooth: number;
}
export const DEFAULT_MOD_TRANCE_GATE: ModTranceGate = { depth: '-inf', open: 50, smooth: 5 };

/** Cells of the song's grid, in 1/16 steps: 1/32, 1/16, 1/8 or a beat. */
export const CELL_SIZES = [0.5, 1, 2, 4] as const;
export type CellSize = (typeof CELL_SIZES)[number];

/** Where Scramble takes cells from: the whole song, a number of bars round the clip, or inside the clip. */
export type ScrambleFrom = 'song' | 'around' | 'clip';
export interface ModScramble {
  readonly cell: CellSize;
  readonly from: ScrambleFrom;
  /** Bars either side of the clip, for 'around'. */
  readonly around: 1 | 2 | 4;
  /** The chance in percent that a swapped cell plays backwards. */
  readonly reverse: 0 | 25 | 50 | 100;
}
export const DEFAULT_MOD_SCRAMBLE: ModScramble = { cell: 1, from: 'song', around: 2, reverse: 0 };

/** How much a stutter repeats, in 1/16 steps: the start of a window of this size on the song's grid. */
export const STUTTER_GRABS = [1, 2, 4] as const;
export interface ModStutter {
  readonly grabs: (typeof STUTTER_GRABS)[number];
  /** Semitones each repeat goes up or down from the one before. */
  readonly pitch: -2 | -1 | 0 | 1 | 2;
  /** The part of each repeat that is heard, in percent. */
  readonly gate: 100 | 75 | 50;
}
export const DEFAULT_MOD_STUTTER: ModStutter = { grabs: 1, pitch: 0, gate: 100 };

export interface ModFreeze {
  /** The grain held, in ms. */
  readonly grain: 10 | 30 | 80;
  /** How far round the frozen point each grain may start, in percent of a grain. */
  readonly spread: 0 | 25 | 50;
  /** dB. */
  readonly level: -6 | -3 | 0;
}
export const DEFAULT_MOD_FREEZE: ModFreeze = { grain: 30, spread: 0, level: 0 };

export interface ModReverse {
  readonly cell: CellSize;
}
export const DEFAULT_MOD_REVERSE: ModReverse = { cell: 1 };

/**
 * How a rewind moves over its step: Fast at an even speed; Slowing fast at
 * first, then coming to a stop; Spin-back braking from playing, turning and
 * spinning backwards faster and faster.
 */
export type RewindCurve = 'fast' | 'slowing' | 'spinBack';
export interface ModRewind {
  /** How far back it pulls, in 1/16 steps: a beat, two beats or a bar. */
  readonly pullBack: 4 | 8 | 16;
  readonly curve: RewindCurve;
}
export const DEFAULT_MOD_REWIND: ModRewind = { pullBack: 4, curve: 'fast' };

/** Plays what is heard under the whole clip at another speed: pitch follows like a record, or is kept (stretch). No lane. */
export interface HalftimeEffect {
  readonly target: 'halftime';
  readonly speed: 0.5 | 0.75 | 2;
  readonly keepPitch: boolean;
}
export const HALFTIME_SPEEDS = [0.5, 0.75, 2] as const;
export const DEFAULT_HALFTIME: HalftimeEffect = { target: 'halftime', speed: 0.5, keepPitch: false };

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

/** What Scratch can record from the clip's start, in 1/16 steps: 1 beat, 2 beats, 1 bar, 2 bars. */
export const SCRATCH_RECORDS = [4, 8, 16, 32] as const;
export type ScratchRecord = (typeof SCRATCH_RECORDS)[number];
/** A crossfader cell: the whole step, or its two halves; open (true) or closed (silent). */
export type FaderCell = readonly [boolean] | readonly [boolean, boolean];
export const MIN_SCRATCH_STEPS = 2;

/**
 * Like a hand on a record (see Scratch): records the first `record` steps
 * heard from the clip's start, and plays them by a drawn needle movement and a
 * crossfader. One point per step: where the needle is in the recording (0 its
 * start, 1 its end) where the step starts, smoothed between. Loops on its own
 * length; at the loop the needle is lifted and jumps back to the first point.
 */
export interface ScratchEffect {
  readonly target: 'scratch';
  readonly record: ScratchRecord;
  readonly step: StepSize;
  /** MIN_SCRATCH_STEPS to MAX_LANE_STEPS points, each 0–1 in steps of 1/(2·record). */
  readonly points: readonly number[];
  /** One cell per point. */
  readonly fader: readonly FaderCell[];
}

export type ModEffect = StepEffect | TempoEffect | SwapEffect | TapeEffect | HalftimeEffect | ScratchEffect;
export type EffectTarget = ModEffect['target'];

/** A mod does things through its effects: at most one per target. A new mod has none, and does nothing until it gets one. */
export interface Mod {
  readonly id: Id;
  readonly name: string;
  readonly effects: readonly ModEffect[];
  /** Its randomness: every random choice is worked out from it and where it plays (see Slump och seeds). 0 ≤ seed < 2³². */
  readonly seed: number;
  /** A preset (see Mod-förval): made in every project and never changed. Missing on a mod of one's own. */
  readonly isPreset?: true;
}

export const isStepEffect = (effect: ModEffect): effect is StepEffect => (LANE_TARGETS as readonly string[]).includes(effect.target);
export const tempoOf = (mod: Mod | undefined): TempoEffect | undefined => mod?.effects.find((e): e is TempoEffect => e.target === 'tempo');
export const swapOf = (mod: Mod | undefined): SwapEffect | undefined => mod?.effects.find((e): e is SwapEffect => e.target === 'swap');
export const tapeOf = (mod: Mod | undefined): TapeEffect | undefined =>
  mod?.effects.find((e): e is TapeEffect => e.target === 'tape');
export const isAudioEffect = (effect: ModEffect): boolean => (AUDIO_TARGETS as readonly string[]).includes(effect.target);
export const halftimeOf = (mod: Mod | undefined): HalftimeEffect | undefined => mod?.effects.find((e): e is HalftimeEffect => e.target === 'halftime');
export const scratchOf = (mod: Mod | undefined): ScratchEffect | undefined => mod?.effects.find((e): e is ScratchEffect => e.target === 'scratch');

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
  /** Its own randomness, so two clips of the same loop or mod vary between them; a copy keeps it. 0 ≤ seed < 2³². */
  readonly seed: number;
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

/**
 * What is built by itself when a break is sliced (see Crazy madness, Två
 * lägen): Total control only the automatic chain, Crazy madness all the way
 * to Song after the song's recipe.
 */
export type Mode = 'total' | 'crazy';

export interface Project {
  /** Missing in a project from before Crazy madness: it opens in Total control, since it was built by hand. (Claudes val) */
  readonly mode?: Mode;
  /** The song's recipe (see Crazy madness, Recept): set when the project is made, new at Go crazy. 0 ≤ seed < 2³². */
  readonly recipeSeed?: number;
  readonly audio: Readonly<Record<Id, AudioData>>;
  readonly samples: Readonly<Record<Id, Sample>>;
  readonly matrices: Readonly<Record<Id, Matrix>>;
  readonly hits: Readonly<Record<Id, Hit>>;
  readonly pads: Readonly<Record<Id, Pad>>;
  readonly loops: Readonly<Record<Id, Loop>>;
  readonly mods: Readonly<Record<Id, Mod>>;
  readonly song: Song;
}
