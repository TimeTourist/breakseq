import type { Id, Pad, Rng } from '../model';

/**
 * Where the pads' choices stand: each pad's Round robin turn, and the member
 * No repeat played last. A pass (varv) of Play starts where the last ended.
 */
export interface PickState {
  readonly turns: Readonly<Record<Id, number>>;
  readonly last: Readonly<Record<Id, number>>;
}

export const NO_PICKS: PickState = { turns: {}, last: {} };

export interface PadPicker {
  /**
   * The member a pad plays, when neither the step nor a mod picked one. Call it
   * in time order. `rng` is only drawn from for pads that play at random.
   */
  readonly pick: (pad: Pad, rng: Rng) => Id | undefined;
  /** Where the choices stand now. */
  readonly state: () => PickState;
}

/**
 * Picks members for pads as a take is generated. Round robin counts per pad
 * over the whole song, whatever loop the pad is in, from `from`.
 */
export function padPicker(from: PickState = NO_PICKS): PadPicker {
  const turns = new Map<Id, number>(Object.entries(from.turns));
  const last = new Map<Id, number>(Object.entries(from.last));
  const pick = (pad: Pad, rng: Rng): Id | undefined => {
    const count = pad.members.length;
    if (count < 2) return pad.members[0];
    const played = (i: number) => {
      last.set(pad.id, i);
      return pad.members[i];
    };
    switch (pad.choice) {
      case 'top':
        return pad.members[0];
      case 'roundRobin': {
        const turn = turns.get(pad.id) ?? 0;
        turns.set(pad.id, turn + 1);
        return pad.members[turn % count];
      }
      case 'random':
        return played(Math.min(count - 1, Math.floor(rng() * count)));
      case 'noRepeat': {
        // Any member but the last one played: draw among the others and step past it.
        const previous = last.get(pad.id);
        if (previous === undefined || previous >= count) return played(Math.min(count - 1, Math.floor(rng() * count)));
        const i = Math.min(count - 2, Math.floor(rng() * (count - 1)));
        return played(i >= previous ? i + 1 : i);
      }
    }
  };
  return { pick, state: () => ({ turns: Object.fromEntries(turns), last: Object.fromEntries(last) }) };
}
