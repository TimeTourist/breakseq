import { LANES, clampToLane, inTurn, wholeValues } from './lanes';
import type { Chance, Clip, LaneStep, LaneTarget, Mod, ModEffect, ModRate, Project, StepEffect, StepSize } from './types';
import { CHANCES, LANE_TARGETS, STEP_SIZES } from './types';

/**
 * Old projects (before phase 24b) are worked out anew when they load: the
 * forms List, Cycle, Ramp and Random become step lanes (see Gamla projekt).
 */

/** A step effect as it was saved before lanes. */
type OldShape =
  | { readonly kind: 'list' | 'cycle'; readonly values: readonly number[] }
  | { readonly kind: 'ramp'; readonly from: number; readonly to: number }
  | { readonly kind: 'random'; readonly min: number; readonly max: number; readonly chance: number; readonly whole: boolean };
interface OldStepEffect extends Omit<StepEffect, 'step' | 'lane'> {
  readonly rate: ModRate;
  readonly shape: OldShape;
}

const SIZE_OF_RATE: Record<ModRate, StepSize> = { step: '1/16', beat: 'beat', bar: 'bar' };

const isOld = (effect: unknown): effect is OldStepEffect =>
  typeof effect === 'object' &&
  effect !== null &&
  (LANE_TARGETS as readonly string[]).includes((effect as { target?: string }).target ?? '') &&
  'shape' in effect &&
  !('lane' in effect);

/** What else the forms need to know: the most members a pad has, and how many intervals of a size the mod's longest clip has. */
export interface UpgradeContext {
  readonly members: number;
  /** Intervals of `size` steps in the mod's longest clip in Song, or null when it has no clip. */
  readonly intervals: (size: number) => number | null;
}

/** The nearest of 100, 75, 50 and 25 %. */
const nearestChance = (chance: number): Chance =>
  CHANCES.reduce((best, c) => (Math.abs(c - chance) < Math.abs(best - chance) ? c : best), CHANCES[0] as Chance);

/** An old value in the lane's units: Dist was 0–1 and is percent now; within range; whole where the target is. */
function laneValue(target: LaneTarget, value: number): number {
  const v = clampToLane(target, target === 'dist' ? value * 100 : value);
  return target === 'ratchet' || target === 'padMember' || target === 'direction' ? Math.round(v) : v;
}

/**
 * One old step effect as a lane, or null when it did nothing and goes: an
 * empty List or Cycle (but a Cycle with no values on Pad member is In turn).
 * List and Cycle keep their values; Ramp is a line over as many steps
 * of its rate as its longest clip has (16 when it has none); Random as many
 * dice steps with the same band and the nearest chance (on Direction, the
 * chance that it was reversed). Values outside the lane's range are kept
 * within it. (Claudes val.)
 */
export function upgradeStepEffect(old: OldStepEffect, ctx: UpgradeContext): StepEffect | null {
  const { rate, shape, ...settings } = old;
  const { target } = old;
  const size = STEP_SIZES[SIZE_OF_RATE[rate] ?? '1/16'];
  const runs = Math.max(1, Math.min(16, ctx.intervals(size) ?? 16));
  const fixed = (values: readonly number[]): LaneStep[] => values.slice(0, 16).map((v) => ({ v: laneValue(target, v) }));
  let lane: LaneStep[];
  let free = false;
  switch (shape.kind) {
    case 'list':
    case 'cycle':
      if (shape.values.length === 0 && !(shape.kind === 'cycle' && target === 'padMember')) return null;
      lane = shape.values.length > 0 ? fixed(shape.values) : inTurn(ctx.members);
      free = target === 'pitch' && shape.values.some((v) => !Number.isInteger(v));
      break;
    case 'ramp': {
      const values = Array.from({ length: runs }, (_, k) => (runs <= 1 ? shape.from : shape.from + ((shape.to - shape.from) * k) / (runs - 1)));
      lane = fixed(values);
      free = target === 'pitch' && values.some((v) => !Number.isInteger(v));
      break;
    }
    case 'random': {
      // On/off: it rolled 0 or 1 when its chance came up, so it was on half as often.
      const onOff = LANES[target].onOff === true;
      const chance = nearestChance(onOff && shape.min <= 0 && shape.max >= 1 ? shape.chance / 2 : shape.chance);
      const lo = onOff ? 0 : laneValue(target, Math.min(shape.min, shape.max));
      const hi = onOff ? 1 : laneValue(target, Math.max(shape.min, shape.max));
      // Whole numbers stay whole, also where the lane's dice roll freely (Random med hela tal).
      const whole = shape.whole && !onOff && !wholeValues({ target, pitch: { values: 'semitones' } });
      lane = Array.from({ length: runs }, () => (whole ? { lo, hi, chance, whole: true as const } : { lo, hi, chance }));
      free = target === 'pitch' && !shape.whole;
      break;
    }
  }
  return { ...settings, target, step: SIZE_OF_RATE[rate] ?? '1/16', lane, ...(target === 'pitch' ? { pitch: { values: free ? 'free' : 'semitones' } } : {}) };
}

/** A mod with its old step effects as lanes; anything else as it is. */
export function upgradeMod(mod: Mod, project: Pick<Project, 'pads' | 'song'>): Mod {
  if (!mod.effects.some(isOld)) return mod;
  const members = Math.max(1, ...Object.values(project.pads).map((p) => p.members.length));
  const clips = project.song.clips.filter((c: Clip) => c.ref === mod.id);
  const ctx: UpgradeContext = {
    members,
    intervals: (size) => (clips.length === 0 ? null : Math.max(...clips.map((c) => Math.max(1, Math.ceil((c.offset + c.length) / size))))),
  };
  return { ...mod, effects: mod.effects.flatMap((e: ModEffect | OldStepEffect) => (isOld(e) ? (upgradeStepEffect(e, ctx) ?? []) : [e])) as ModEffect[] };
}
