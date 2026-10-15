import type { Hit, Id, Pad, Project, Sample } from '../model';
import { baseName } from '../model';

const TAG_COLORS: Record<string, string> = {
  K: '#F0883E',
  S: '#9CCBF7',
  H: '#F2DE7A',
  R: '#A68CF0',
  G: '#9AA0A6',
};
const CUSTOM_COLORS = ['#4FC4B0', '#E5689A', '#7FD17F'];
export const UNTAGGED_COLOR = '#8C8A84';

export const TAG_NAMES: Record<string, string> = { K: 'Kick', S: 'Snare', H: 'Hat', R: 'Ride', G: 'Ghost' };

export function tagColor(project: Project, tagId: Id | null): string {
  if (tagId === null) return UNTAGGED_COLOR;
  const tag = project.tags[tagId];
  if (tag === undefined) return UNTAGGED_COLOR;
  const custom = Object.values(project.tags).filter((t) => TAG_COLORS[t.name] === undefined);
  return TAG_COLORS[tag.name] ?? CUSTOM_COLORS[custom.indexOf(tag) % CUSTOM_COLORS.length] ?? UNTAGGED_COLOR;
}

export const sampleOfHit = (project: Project, hitId: Id | null | undefined): Sample | undefined => {
  const hit = hitId == null ? undefined : project.hits[hitId];
  return hit === undefined ? undefined : project.samples[hit.sampleId];
};

/** The colour of the main tag a hit's sample has. */
export const hitColor = (project: Project, hitId: Id | null | undefined): string =>
  tagColor(project, sampleOfHit(project, hitId)?.mainTag ?? null);

/** A pad is coloured by its member 1. */
export const padColor = (project: Project, pad: Pad): string => hitColor(project, pad.members[0]);

/** A short label for a pad chip: a slice's number ("amen 07" → "07"), otherwise the start of its name. */
export function padLabel(pad: Pad): string {
  const name = baseName(pad.name);
  const number = pad.auto ? /\s(\d+)$/.exec(name)?.[1] : undefined;
  return number ?? (name.length > 8 ? `${name.slice(0, 7)}…` : name);
}

/** The imported file a sample comes from: itself, or the break it was sliced from. */
export const sourceOf = (project: Project, sample: Sample): Sample =>
  (sample.sliceOf === null ? undefined : project.samples[sample.sliceOf]) ?? sample;

export interface Group<T> {
  readonly name: string;
  readonly items: readonly T[];
}

/** Hits as Variants first, then one group per imported file. */
export function hitGroups(project: Project): Group<Hit>[] {
  const hits = Object.values(project.hits);
  const variants = hits.filter((h) => h.variantOf !== null);
  const bySource = new Map<Id, Hit[]>();
  for (const hit of hits) {
    if (hit.variantOf !== null) continue;
    const sample = project.samples[hit.sampleId];
    if (sample === undefined) continue;
    const source = sourceOf(project, sample);
    bySource.set(source.id, [...(bySource.get(source.id) ?? []), hit]);
  }
  return [
    ...(variants.length > 0 ? [{ name: 'Variants', items: variants }] : []),
    ...[...bySource].map(([id, items]) => ({ name: project.samples[id]?.name ?? 'Other', items })),
  ];
}

/** Built pads first, then the chain's pads grouped by imported file. */
export function padGroups(project: Project, filter: (pad: Pad) => boolean = () => true): Group<Pad>[] {
  const pads = Object.values(project.pads).filter(filter);
  const built = pads.filter((p) => !p.auto);
  const bySource = new Map<string, Pad[]>();
  for (const pad of pads.filter((p) => p.auto)) {
    const sample = sampleOfHit(project, pad.members[0]);
    const name = sample === undefined ? 'Other' : sourceOf(project, sample).name;
    bySource.set(name, [...(bySource.get(name) ?? []), pad]);
  }
  return [
    ...(built.length > 0 ? [{ name: 'Built', items: built }] : []),
    ...[...bySource].map(([name, items]) => ({ name, items })),
  ];
}

/** Pads a hit is in, with its member number in each. */
export const hitUsages = (project: Project, hitId: Id) =>
  Object.values(project.pads)
    .filter((p) => p.members.includes(hitId))
    .map((pad) => ({ pad, member: pad.members.indexOf(hitId) + 1 }));

/** Loops a pad is in, with how many steps use it. */
export const padUsages = (project: Project, padId: Id) =>
  Object.values(project.loops)
    .map((loop) => ({ loop, steps: loop.steps.filter((s) => s.padId === padId).length }))
    .filter((u) => u.steps > 0);

/** How many song bars start a loop. */
export const loopUsage = (project: Project, loopId: Id): number =>
  [...project.song.rows.main, ...project.song.rows.fill].filter((id) => id === loopId).length;
