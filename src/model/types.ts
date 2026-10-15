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
  /** A break is sliced once. */
  readonly sliced: boolean;
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
}

/** Ordered hits. Member 1 (index 0) is the default. */
export interface Pad {
  readonly id: Id;
  readonly name: string;
  readonly members: readonly Id[];
}

export interface Step {
  readonly padId: Id | null;
  /** Hit id of the chosen member; null plays member 1. */
  readonly memberId: Id | null;
  readonly ignoreMods: boolean;
  /** Always 0 in v1. */
  readonly nudge: number;
}

export type LoopKind = 'main' | 'fill';

export interface Loop {
  readonly id: Id;
  readonly name: string;
  readonly kind: LoopKind;
  readonly bars: number;
  /** bars × STEPS_PER_BAR steps. */
  readonly steps: readonly Step[];
}

/**
 * Targets implemented so far. Phase 4 adds padMember, volume, direction,
 * tempo and sourceLoop; each needs an entry here and a handler in the engine.
 */
export type ModTarget = 'pitch' | 'ratchet';

export type ModScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'tag'; readonly tagId: Id }
  | { readonly kind: 'pad'; readonly padId: Id }
  /** Steps within the bar, 0-based and inclusive. */
  | { readonly kind: 'range'; readonly from: number; readonly to: number };

export type ModRate = 'step' | 'beat' | 'bar';

/** Phase 4 adds cycle and ramp. */
export type ModShape =
  | { readonly kind: 'list'; readonly values: readonly number[] }
  /** Chance in percent (0–100) that an interval gets a value at all. */
  | { readonly kind: 'random'; readonly min: number; readonly max: number; readonly chance: number };

export interface Mod {
  readonly id: Id;
  readonly name: string;
  readonly target: ModTarget;
  readonly scope: ModScope;
  readonly rate: ModRate;
  readonly shape: ModShape;
}

export type SongRow = 'main' | 'fill' | 'modA' | 'modB';

/** Each row has one cell per bar. A cell holds the id of a loop or mod that starts there. */
export interface Song {
  readonly bpm: number;
  readonly bars: number;
  readonly rows: { readonly [R in SongRow]: readonly (Id | null)[] };
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
