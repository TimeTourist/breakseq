import type { Id, Pad, Rng } from '../model';

/**
 * Picks members for pads as a take is generated, in time order: call it each
 * time a pad plays with no member locked on the step or picked by a mod. Round
 * robin counts per pad over the whole song, whatever loop the pad is in.
 * Randomness only from `rng`, and only drawn for pads that play at random.
 */
export function padPicker(rng: Rng): (pad: Pad) => Id | undefined {
  const turns = new Map<Id, number>();
  const last = new Map<Id, number>();
  return (pad) => {
    const count = pad.members.length;
    if (count < 2) return pad.members[0];
    const pick = (i: number) => {
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
        return pick(Math.min(count - 1, Math.floor(rng() * count)));
      case 'noRepeat': {
        // Any member but the last one played: draw among the others and step past it.
        const previous = last.get(pad.id);
        if (previous === undefined) return pick(Math.min(count - 1, Math.floor(rng() * count)));
        const i = Math.min(count - 2, Math.floor(rng() * (count - 1)));
        return pick(i >= previous ? i + 1 : i);
      }
    }
  };
}
