import type { Usage } from './command';
import { matrixOfPad } from './owners';
import type { Id, Loop, Project, SongRow } from './types';

export type ReferableKind = 'sample' | 'matrix' | 'hit' | 'pad' | 'loop' | 'mod';

const songUsage = (project: Project, id: Id, rows: readonly SongRow[]): Usage[] =>
  project.song.clips.some((c) => c.ref === id && rows.includes(c.row)) ? [{ kind: 'song', id: null, name: 'Song' }] : [];

const loopUsage = (l: Loop): Usage => ({ kind: 'loop', id: l.id, name: l.name });

/** Loops other than `except` with a step that plays one of `pads`. */
const loopsPlaying = (project: Project, pads: ReadonlySet<Id>, except: Id | null): Usage[] =>
  Object.values(project.loops)
    .filter((l) => l.id !== except && l.steps.some((s) => s.padId !== null && pads.has(s.padId)))
    .map(loopUsage);

/**
 * Where a matrix is used, which goes silent without it: loops other than its
 * own that play its pads, and its own loop in the song. Copies of its hits
 * elsewhere are not usages: they are independent (decision 8).
 */
function matrixUsages(project: Project, matrixId: Id): Usage[] {
  const matrix = project.matrices[matrixId];
  if (matrix === undefined) return [];
  return [...loopsPlaying(project, new Set(matrix.pads), matrix.loop), ...(matrix.loop === null ? [] : songUsage(project, matrix.loop, ['main', 'fill']))];
}

/**
 * Where a sample (a trim) is used, which goes silent without it: where its own
 * matrix is used, pads elsewhere with a hit that plays it, and the loops that
 * play those pads or have a step locked to such a hit.
 */
function sampleUsages(project: Project, sampleId: Id): Usage[] {
  const own = Object.values(project.matrices).find((m) => m.sampleId === sampleId);
  const ownPads = new Set(own?.pads ?? []);
  const playing = (hitId: Id) => project.hits[hitId]?.sampleId === sampleId;
  const outside = Object.values(project.pads).filter((p) => !ownPads.has(p.id) && p.members.some(playing));
  const outsideIds = new Set(outside.map((p) => p.id));
  const fromOwn = own === undefined ? [] : matrixUsages(project, own.id);
  const named = new Set(fromOwn.flatMap((u) => (u.kind === 'loop' ? [u.id] : [])));
  const elsewhere = Object.values(project.loops)
    .filter((l) => !named.has(l.id) && l.steps.some((s) => (s.padId !== null && outsideIds.has(s.padId)) || (s.memberId !== null && playing(s.memberId))))
    .map(loopUsage);
  // Loops first, then pads; the song usage of the own matrix stays among the loops it names.
  const loops = fromOwn.filter((u) => u.kind === 'loop');
  const rest = fromOwn.filter((u) => u.kind !== 'loop');
  return [...loops, ...elsewhere, ...rest, ...outside.map((p): Usage => ({ kind: 'pad', id: p.id, name: p.name }))];
}

/**
 * Everything that refers to the given object from outside it, and goes silent
 * when it is removed anyway. An object with usages cannot simply be removed.
 * What owns it (a hit's pad, a pad's matrix) is no usage: it goes from there.
 */
export function findUsages(project: Project, kind: ReferableKind, id: Id): Usage[] {
  switch (kind) {
    case 'sample':
      return sampleUsages(project, id);
    case 'matrix':
      return matrixUsages(project, id);
    case 'hit':
      return Object.values(project.loops)
        .filter((l) => l.steps.some((s) => s.memberId === id))
        .map(loopUsage);
    case 'pad':
      return loopsPlaying(project, new Set([id]), null);
    case 'loop':
      return songUsage(project, id, ['main', 'fill']);
    case 'mod':
      return songUsage(project, id, ['modA', 'modB']);
  }
}

/** What is heard in the song, all the way down: its loops and mods, the pads on their steps, those pads' hits, and their matrices. */
export interface Heard {
  readonly loops: ReadonlySet<Id>;
  readonly mods: ReadonlySet<Id>;
  readonly pads: ReadonlySet<Id>;
  readonly hits: ReadonlySet<Id>;
  readonly matrices: ReadonlySet<Id>;
}

/**
 * The loops and mods with a clip in the song, the pads on those loops' steps,
 * every hit in those pads (any of them can be picked) or locked on a step,
 * and the matrices those pads are rows of.
 */
export function heardInSong(project: Project): Heard {
  const clips = project.song.clips;
  const loops = new Set(clips.filter((c) => c.row === 'main' || c.row === 'fill').map((c) => c.ref));
  const mods = new Set(clips.filter((c) => c.row === 'modA' || c.row === 'modB').map((c) => c.ref));
  const pads = new Set<Id>();
  const hits = new Set<Id>();
  for (const id of loops) {
    for (const step of project.loops[id]?.steps ?? []) {
      if (step.padId !== null) pads.add(step.padId);
      if (step.memberId !== null) hits.add(step.memberId);
    }
  }
  const matrices = new Set<Id>();
  for (const id of pads) {
    for (const m of project.pads[id]?.members ?? []) hits.add(m);
    const matrix = matrixOfPad(project, id);
    if (matrix !== undefined) matrices.add(matrix.id);
  }
  return { loops, mods, pads, hits, matrices };
}
