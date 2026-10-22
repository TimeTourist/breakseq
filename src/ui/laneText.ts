import type { LaneStep, StepEffect, StepSize } from '../model';
import { LANES, STEP_SIZES, isAudioEffect, isDice, norm } from '../model';
import { audioSentence } from './audioText';
import { TARGET_LABELS } from './modLabels';

/** How the lanes read (see Kortet): a value in short and in full, a step's title, and the card's sentence. */

type Target = Pick<StepEffect, 'target'>;

const signed = (x: number, text: string) => (x > 0 ? `+${text}` : x < 0 ? `−${text}` : text);
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** A value in short, as under a step: −6, +5, 1.2k, 0.5, 4. */
export function shortValue({ target }: Target, x: number): string {
  switch (target) {
    case 'filter':
      return x >= 1000 ? `${round(x / 1000, 1)}k` : String(Math.round(x));
    case 'stretch':
      return String(round(x, 2));
    case 'padMember':
      return Math.round(x) <= 0 ? 'off' : String(Math.round(x));
    case 'direction':
      return x >= 0.5 ? '◂' : '·';
    case 'stutter':
      return ['off', '1/16', '1/32', '1/64'][Math.max(0, Math.min(3, Math.round(x)))]!;
    case 'freeze':
      return x >= 0.5 ? '❄' : '·';
    case 'reverse':
      return x >= 0.5 ? '◂' : '▸';
    case 'rewind':
      return x >= 0.5 ? '⟲' : '·';
    case 'pitch':
      return signed(x, String(Math.abs(round(x, 1))));
    case 'volume':
    case 'pan':
      return signed(x, String(Math.abs(Math.round(x))));
    default:
      return String(Math.round(x));
  }
}

/** A value in full, with its unit: −6 dB, +5 st, 1.2 kHz, 300 Hz, 2×, 40%, member 3, reversed. */
export function fullValue(effect: Target, x: number): string {
  const { target } = effect;
  if (target === 'filter') return x >= 1000 ? `${round(x / 1000, 1)} kHz` : `${Math.round(x)} Hz`;
  if (target === 'direction') return x >= 0.5 ? 'reversed' : 'as it is';
  if (target === 'padMember') return Math.round(x) <= 0 ? 'off' : `member ${Math.round(x)}`;
  if (target === 'scramble') return `${Math.round(x)}% swap`;
  if (target === 'stutter') return Math.round(x) <= 0 ? 'off' : `repeats ${shortValue(effect, x)}`;
  if (target === 'freeze') return x >= 0.5 ? 'frozen' : 'passes through';
  if (target === 'reverse') return x >= 0.5 ? 'reversed' : 'forward';
  if (target === 'rewind') return x >= 0.5 ? 'fires' : 'does not fire';
  const unit = LANES[target].unit;
  return `${shortValue(effect, x)}${unit === '%' || unit === '×' ? '' : ' '}${unit}`;
}

const SIZE_WORDS: Record<StepSize, string> = { '1/16': '1/16', beat: '1 beat', bar: '1 bar' };

/** How long the lane is, where it says more than its steps: (3/16), (1 beat), (1 bar), (2 bars). */
export function lengthNote(effect: Pick<StepEffect, 'step' | 'lane'>): string {
  if (effect.step === 'bar') return '';
  const sixteenths = effect.lane.length * STEP_SIZES[effect.step];
  if (sixteenths % 16 === 0) return ` (${sixteenths / 16} ${sixteenths === 16 ? 'bar' : 'bars'})`;
  if (effect.step === '1/16') return sixteenths % 4 === 0 ? ` (${sixteenths / 4} ${sixteenths === 4 ? 'beat' : 'beats'})` : ` (${sixteenths}/16)`;
  return '';
}

/** "4 steps of 1 beat (1 bar), loops" */
export function laneLength(effect: Pick<StepEffect, 'step' | 'lane'>): string {
  const n = effect.lane.length;
  return `${n} ${n === 1 ? 'step' : 'steps'} of ${SIZE_WORDS[effect.step]}${lengthNote(effect)}, loops`;
}

const diceCount = (lane: readonly LaneStep[]) => {
  const n = lane.filter(isDice).length;
  return n === 0 ? '' : `, ${n} ${n === 1 ? 'dice step' : 'dice steps'}`;
};

/**
 * What the effect does, in one line: "Volume · 4 steps of 1 beat (1 bar),
 * loops · 0 to −12 dB"; "Pitch · 3 steps of 1/16 (3/16), loops · +5 to −7 st,
 * 1 dice step". The range starts at the end nearer the zero value.
 */
export function laneSentence(effect: StepEffect): string {
  const { target, lane } = effect;
  if (isAudioEffect(effect)) return audioSentence(effect);
  const head = `${TARGET_LABELS[target]} · ${laneLength(effect)} · `;
  if (target === 'direction') {
    const on = lane.filter((s) => !isDice(s) && s.v >= 0.5).length;
    return `${head}${on === 0 && !lane.some(isDice) ? 'never reversed' : `reversed on ${on} of ${lane.length}`}${diceCount(lane)}`;
  }
  const values = lane.flatMap((s) => (isDice(s) ? [s.lo, s.hi] : [s.v]));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const zero = norm(target, LANES[target].zero);
  const [a, b] = Math.abs(norm(target, lo) - zero) < Math.abs(norm(target, hi) - zero) ? [lo, hi] : [hi, lo];
  const range =
    lo === hi
      ? `at ${fullValue(effect, lo)}`
      : target === 'filter'
        ? `${fullValue(effect, a)} to ${fullValue(effect, b)}`
        : target === 'padMember'
          ? Math.round(a) <= 0
            ? `off to ${fullValue(effect, b)}`
            : `members ${Math.round(a)} to ${Math.round(b)}`
          : `${shortValue(effect, a)} to ${fullValue(effect, b)}`;
  return `${head}${range}${diceCount(lane)}`;
}

/** A step as its title reads: "Step 2: −6 dB", "Step 3: 🎲 −7 st to +5 st, 75% chance". */
export function stepTitle(effect: Target, step: LaneStep, i: number): string {
  if (!isDice(step)) return `Step ${i + 1}: ${fullValue(effect, step.v)}`;
  if (LANES[effect.target].onOff === true) return `Step ${i + 1}: 🎲 ${fullValue(effect, 1)}, ${step.chance}% chance`;
  return `Step ${i + 1}: 🎲 ${fullValue(effect, step.lo)} to ${fullValue(effect, step.hi)}, ${step.chance}% chance`;
}

/** What a step shows while it is dragged: "−6 dB", "🎲 −7 st to +5 st". */
export function dragText(effect: Target, step: LaneStep): string {
  return isDice(step) ? `🎲 ${fullValue(effect, step.lo)} to ${fullValue(effect, step.hi)}` : fullValue(effect, step.v);
}
