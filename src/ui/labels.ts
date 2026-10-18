import type { Heard, Hit, Id, Matrix, Pad, PadChoice, Project, Sample } from '../model';
import { STEPS_PER_BAR, baseName, hitSound, matrixKind, ownMatrix, trimName } from '../model';

/** Hits have no colour of their own for now: every hit is drawn in this one. */
export const HIT_COLOR = '#C9C4B8';

/** A short label for a pad chip: a row's number ("amen 07" → "07"), otherwise the start of its name. */
export function padLabel(pad: Pad): string {
  const name = baseName(pad.name);
  const number = /\s(\d{2,})$/.exec(name)?.[1];
  return number ?? (name.length > 8 ? `${name.slice(0, 7)}…` : name);
}

export interface Group<T> {
  readonly name: string;
  readonly items: readonly T[];
  /** For a group of a matrix's pads: the matrix, which lays all of them out. */
  readonly matrixId?: Id;
}

/** A pad whose first hit plays a slice past its sample's last marker: it plays nothing until there are more. */
export function padSilent(project: Project, pad: Pad): boolean {
  const hit = pad.members[0] === undefined ? undefined : project.hits[pad.members[0]];
  return hit !== undefined && hitSound(project, hit) === null;
}

/** A matrix of the shelf in Loops: its pads in order, with its classification. */
export interface ShelfGroup extends Group<Pad> {
  readonly matrixId: Id;
  readonly kind: 'break' | 'one-shot';
}

/**
 * The shelf in Loops (decision 5): the given matrices (the focus, then those
 * taken from) with their pads. A silent pad shows only while a loop still plays it.
 */
export function shelfGroups(project: Project, matrixIds: readonly Id[]): ShelfGroup[] {
  const inLoops = new Set(Object.values(project.loops).flatMap((l) => l.steps.flatMap((s) => (s.padId === null ? [] : [s.padId]))));
  return matrixIds.flatMap((id) => {
    const matrix = project.matrices[id];
    if (matrix === undefined) return [];
    const items = matrix.pads.flatMap((p) => {
      const pad = project.pads[p];
      return pad !== undefined && (!padSilent(project, pad) || inLoops.has(p)) ? [pad] : [];
    });
    return [{ name: matrix.name, items, matrixId: id, kind: matrixKind(matrix) }];
  });
}

/** The matrix a pad is a row of, and its row (0 is 01). */
function rowOf(project: Project, padId: Id): { matrix: Matrix; row: number } | undefined {
  const matrix = Object.values(project.matrices).find((m) => m.pads.includes(padId));
  return matrix === undefined ? undefined : { matrix, row: matrix.pads.indexOf(padId) };
}

/**
 * Where a hit in a row of a sliced matrix plays from, when it is not that
 * row's slice: "07", "think 07", or a one-shot's name. null in a matrix built by hand.
 */
export function replacedBy(project: Project, padId: Id, hit: Hit): string | null {
  const home = rowOf(project, padId);
  if (home === undefined || home.matrix.sampleId === null) return null;
  if (hit.sampleId === home.matrix.sampleId && hit.slice === home.row) return null;
  const sample = project.samples[hit.sampleId];
  if (sample === undefined) return null;
  const name = ownMatrix(project, sample.id)?.name ?? baseName(sample.name);
  if (hit.slice === null || sample.bars === null) return name;
  const number = String(hit.slice + 1).padStart(2, '0');
  return hit.sampleId === home.matrix.sampleId ? number : `${name} ${number}`;
}

/** What a sample is called in Import and Slice: its own matrix's name, or its trim's when that matrix is gone. */
export const sampleLabel = (project: Project, sample: Sample): string => ownMatrix(project, sample.id)?.name ?? trimName(sample);

/** The samples that a hit heard in the song plays. */
export const heardSamples = (project: Project, heard: Heard): ReadonlySet<Id> => new Set([...heard.hits].flatMap((h) => project.hits[h]?.sampleId ?? []));

/** Loops a pad is in, with how many steps use it. */
export const padUsages = (project: Project, padId: Id) =>
  Object.values(project.loops)
    .map((loop) => ({ loop, steps: loop.steps.filter((s) => s.padId === padId).length }))
    .filter((u) => u.steps > 0);

/** How many song clips play a loop. */
export const loopUsage = (project: Project, loopId: Id): number =>
  project.song.clips.filter((c) => c.ref === loopId && (c.row === 'main' || c.row === 'fill')).length;

/** A length in steps, as bars and sixteenths: "1 bar", "6/16", "2 bars 4/16". */
export function lengthText(steps: number): string {
  const bars = Math.floor(steps / STEPS_PER_BAR);
  const rest = steps % STEPS_PER_BAR;
  const barText = bars === 0 ? '' : `${bars} bar${bars === 1 ? '' : 's'}`;
  return [barText, rest === 0 ? '' : `${rest}/16`].filter((s) => s !== '').join(' ');
}

/** A length in steps as a musician says it: "3/16", "1 beat", "2 beats", "1 bar", "2 bars". */
export function musicalLength(steps: number): string {
  if (steps % STEPS_PER_BAR === 0) return `${steps / STEPS_PER_BAR} bar${steps === STEPS_PER_BAR ? '' : 's'}`;
  if (steps < STEPS_PER_BAR && steps % 4 === 0) return `${steps / 4} beat${steps === 4 ? '' : 's'}`;
  return lengthText(steps);
}

/** What each way a pad picks its member is called. */
export const CHOICE_LABEL: Record<PadChoice, string> = { top: 'Top', roundRobin: 'Round robin', random: 'Random', noRepeat: 'No repeat' };

/** Dist modes and filter types as they read, without Off: for a mod, which always does something. */
export const DIST_MODES = [
  ['drive', 'Drive'],
  ['crush', 'Crush'],
  ['decimate', 'Decimate'],
] as const;
export const FILTER_TYPES = [
  ['lowpass', 'Low-pass'],
  ['highpass', 'High-pass'],
] as const;
/** Delay times as note values, in steps of 1/16. */
export const DELAY_TIMES = [
  [1, '1/16'],
  [2, '1/8'],
  [3, '3/16'],
  [4, '1/4'],
] as const;
/** A reverb's size as words: a room to a hall. */
export const sizeText = (size: number): string => `${Math.round(size * 100)}% (${size < 0.34 ? 'room' : size < 0.67 ? 'chamber' : 'hall'})`;

/** A long file name shortened in the middle, keeping its start and its end with the extension. */
export function middleEllipsis(name: string, max = 32): string {
  if (name.length <= max) return name;
  const tail = Math.floor((max - 1) / 3);
  return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
}
