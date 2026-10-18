import { baseName } from './sound';
import type { Hit, Id, Pad, Project } from './types';

/**
 * Renames a matrix, and the names of its own pads, their hits and its own loop
 * that still carry its old name ("amen 1 07" becomes "think 07", "amen 1"
 * becomes "think"). Other names, its file, trim and slice keep theirs.
 */
export function renameMatrixIn(project: Project, matrixId: Id, name: string): Project {
  const matrix = project.matrices[matrixId];
  if (matrix === undefined) return project;
  const from = baseName(matrix.name);
  const renamed = (n: string) => (n === from || n.startsWith(`${from} `) ? `${name}${n.slice(from.length)}` : n);
  const pads: Record<Id, Pad> = { ...project.pads };
  const hits: Record<Id, Hit> = { ...project.hits };
  for (const id of matrix.pads) {
    const pad = pads[id];
    if (pad === undefined) continue;
    if (renamed(pad.name) !== pad.name) pads[id] = { ...pad, name: renamed(pad.name) };
    for (const m of pad.members) {
      const hit = hits[m];
      if (hit !== undefined && renamed(hit.name) !== hit.name) hits[m] = { ...hit, name: renamed(hit.name) };
    }
  }
  const loop = matrix.loop === null ? undefined : project.loops[matrix.loop];
  const loops = loop === undefined || loop.name !== from ? project.loops : { ...project.loops, [loop.id]: { ...loop, name } };
  return { ...project, pads, hits, loops, matrices: { ...project.matrices, [matrixId]: { ...matrix, name } } };
}
