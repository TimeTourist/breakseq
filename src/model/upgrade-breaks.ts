import { ensureSlots, slotHit, slotName } from './breaks';
import type { Break, Hit, Id, Pad, Project, Region, Sample } from './types';
import { STEPS_PER_BAR } from './types';

/** A sample as saved before breaks were their own objects: a break was a sample with markers, a slice a sample of its own. */
interface LegacySample {
  readonly id: Id;
  readonly name: string;
  readonly audioId: Id;
  readonly offset: number;
  readonly duration: number;
  readonly break: { readonly bars: number; readonly sliced: boolean; readonly markers?: readonly number[]; readonly loop?: Id | null } | null;
  readonly sliceOf?: Id | null;
}

/** A hit as saved then: it played a sample, with its region in seconds of it. */
type LegacyHit = Omit<Hit, 'breakId' | 'slot'> & { readonly sampleId: Id };

const parts = (region: Region, duration: number): Region =>
  duration > 0 ? { start: region.start / duration, end: region.end / duration } : { start: 0, end: 1 };

/**
 * Brings a project from before breaks into the model with them. Every imported
 * file becomes a sample and a break: a one-shot with one slot, or a break whose
 * slices become its slots, each keeping its pad and hits. Hits move from seconds
 * of their sample to parts of their slice. New ids are made from the break's,
 * so the same project always upgrades the same way.
 */
export function breaksFromSamples(project: Project): Project {
  const old = Object.values(project.samples as unknown as Readonly<Record<Id, LegacySample>>);
  const oldHits = Object.values(project.hits as unknown as Readonly<Record<Id, LegacyHit>>);
  const defaultHit = (sampleId: Id) => oldHits.find((h) => h.sampleId === sampleId && h.variantOf === null);
  const autoPad = (hitId: Id | undefined): Pad | undefined =>
    hitId === undefined ? undefined : Object.values(project.pads).find((p) => p.auto && p.members[0] === hitId);
  const hitsOn = (sampleId: Id) => oldHits.filter((h) => h.sampleId === sampleId);
  const toHit = (h: LegacyHit, breakId: Id, slot: number | null, duration: number): Hit => {
    const { id, name, direction, pitch, volume, fadeOut, variantOf } = h;
    return { id, name, breakId, slot, region: parts(h.region, duration), direction, pitch, volume, fadeOut, variantOf };
  };

  const samples: Record<Id, Sample> = {};
  const breaks: Record<Id, Break> = {};
  const hits: Record<Id, Hit> = {};
  const pads: Record<Id, Pad> = { ...project.pads };
  const toFill: { breakId: Id; count: number }[] = [];

  for (const s of old.filter((x) => x.sliceOf == null)) {
    samples[s.id] = { id: s.id, name: s.name, audioId: s.audioId, offset: s.offset, duration: s.duration };
    const breakId = `${s.id}-break`;
    const info = s.break;
    if (info === null) {
      for (const h of hitsOn(s.id)) hits[h.id] = toHit(h, breakId, 0, s.duration);
      const pad = autoPad(defaultHit(s.id)?.id);
      breaks[breakId] = { id: breakId, name: s.name, sampleId: s.id, bars: null, markers: [0], pads: pad === undefined ? [] : [pad.id], parent: null, loop: null };
      toFill.push({ breakId, count: 1 });
      continue;
    }

    // Hits on the break's own sample play the whole break; the first is its parent.
    for (const h of hitsOn(s.id)) hits[h.id] = toHit(h, breakId, null, s.duration);
    const slices = info.sliced ? old.filter((x) => x.sliceOf === s.id).sort((a, b) => a.offset - b.offset) : [];
    const count = info.bars * STEPS_PER_BAR;
    const markers =
      slices.length > 0
        ? slices.map((x) => (x.offset - s.offset) / s.duration)
        : (info.markers?.map((m) => m / s.duration) ?? Array.from({ length: count }, (_, i) => i / count));
    const brk: Break = { id: breakId, name: s.name, sampleId: s.id, bars: info.bars, markers, pads: [], parent: defaultHit(s.id)?.id ?? null, loop: info.loop ?? null };
    // Each slice keeps its pad and hits in its slot; a slot whose pad has gone gets a new one.
    const slotPads = slices.map((slice, slot) => {
      for (const h of hitsOn(slice.id)) hits[h.id] = toHit(h, breakId, slot, slice.duration);
      const pad = autoPad(defaultHit(slice.id)?.id);
      if (pad !== undefined) return pad.id;
      const hit = slotHit(`${breakId}-slot-${slot}-hit`, slotName(brk, slot), breakId, slot);
      hits[hit.id] = hit;
      const made: Pad = { id: `${breakId}-slot-${slot}`, name: hit.name, members: [hit.id], auto: true, choice: 'top' };
      pads[made.id] = made;
      return made.id;
    });
    breaks[breakId] = { ...brk, pads: slotPads };
    toFill.push({ breakId, count: markers.length });
  }

  let upgraded: Project = { ...project, samples, breaks, hits, pads };
  for (const { breakId, count } of toFill) {
    let n = 0;
    upgraded = ensureSlots(upgraded, breakId, count, () => `${breakId}-new-${n++}`);
  }
  return upgraded;
}
