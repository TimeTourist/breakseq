import type { Id, Matrix, Pad, Project, Sample } from './types';

/**
 * Who owns what, looked up from the owner's side. The maps are built once per
 * `project.pads` and `project.matrices` (immutable, so a new record is a new
 * key), which makes a lookup per trigger O(1).
 */
const padsByHit = new WeakMap<Project['pads'], ReadonlyMap<Id, Pad>>();
const matricesByPad = new WeakMap<Project['matrices'], ReadonlyMap<Id, Matrix>>();

function owners<O, K extends object>(cache: WeakMap<K, ReadonlyMap<Id, O>>, record: K, owned: (owner: O) => readonly Id[]): ReadonlyMap<Id, O> {
  let map = cache.get(record);
  if (map === undefined) {
    const built = new Map<Id, O>();
    for (const owner of Object.values(record) as O[]) for (const id of owned(owner)) if (!built.has(id)) built.set(id, owner);
    map = built;
    cache.set(record, map);
  }
  return map;
}

/** The pad a hit sits in. */
export function padOfHit(project: Project, hitId: Id): Pad | undefined {
  return owners(padsByHit, project.pads, (pad: Pad) => pad.members).get(hitId);
}

/** The matrix a pad is a row of. */
export function matrixOfPad(project: Project, padId: Id): Matrix | undefined {
  return owners(matricesByPad, project.matrices, (matrix: Matrix) => matrix.pads).get(padId);
}

/** A matrix of more than one pad is a break, else a one-shot: a classification, never chosen. */
export function matrixKind(matrix: Matrix): 'break' | 'one-shot' {
  return matrix.pads.length > 1 ? 'break' : 'one-shot';
}

/** A sample's tempo, from its length and bars in 4/4; null when it is not sliced. */
export function sampleBpm(sample: Pick<Sample, 'duration' | 'bars'>): number | null {
  return sample.bars === null ? null : (sample.bars * 4 * 60) / sample.duration;
}
