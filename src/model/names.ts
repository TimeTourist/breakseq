import { baseName } from './sound';
import type { Id, Project } from './types';

/**
 * Renames a break, which is its parent: the parent, and the names of its slot
 * pads, their hits and its own loop that start with its old name ("amen 1 07"
 * becomes "think 07"). Its file, trim and slice keep their names.
 */
export function renameBreakIn(project: Project, breakId: Id, name: string): Project {
  const brk = project.breaks[breakId];
  if (brk === undefined) return project;
  const from = baseName(brk.name);
  const renamed = (n: string) => (n === from || n.startsWith(`${from} `) ? `${name}${n.slice(from.length)}` : n);
  const pads = { ...project.pads };
  for (const id of brk.pads) {
    const pad = pads[id];
    if (pad !== undefined && renamed(pad.name) !== pad.name) pads[id] = { ...pad, name: renamed(pad.name) };
  }
  const hits = Object.fromEntries(
    Object.entries(project.hits).map(([id, hit]) => [id, hit.breakId === breakId && renamed(hit.name) !== hit.name ? { ...hit, name: id === brk.parent ? name : renamed(hit.name) } : hit]),
  );
  if (brk.parent !== null && hits[brk.parent] !== undefined) hits[brk.parent] = { ...hits[brk.parent]!, name };
  const loop = brk.loop === null ? undefined : project.loops[brk.loop];
  const loops = loop === undefined || loop.name !== from ? project.loops : { ...project.loops, [loop.id]: { ...loop, name } };
  return { ...project, pads, hits, loops, breaks: { ...project.breaks, [breakId]: { ...brk, name } } };
}

