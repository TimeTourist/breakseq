import type { Usage } from './command';
import type { Id, Project, SongRow } from './types';

export type ReferableKind = 'sample' | 'hit' | 'pad' | 'loop' | 'mod';

const songUsage = (project: Project, id: Id, rows: readonly SongRow[]): Usage[] =>
  project.song.clips.some((c) => c.ref === id && rows.includes(c.row)) ? [{ kind: 'song', id: null, name: 'Song' }] : [];

/** Everything that refers to the given object. An object with usages cannot be removed. */
export function findUsages(project: Project, kind: ReferableKind, id: Id): Usage[] {
  switch (kind) {
    case 'sample':
      return Object.values(project.breaks)
        .filter((b) => b.sampleId === id)
        .map((b) => ({ kind: 'break', id: b.id, name: b.name }));
    case 'hit':
      return [
        ...Object.values(project.breaks)
          .filter((b) => b.parent === id)
          .map((b): Usage => ({ kind: 'break', id: b.id, name: b.name })),
        ...Object.values(project.pads)
          .filter((p) => p.members.includes(id))
          .map((p): Usage => ({ kind: 'pad', id: p.id, name: p.name })),
      ];
    case 'pad':
      return [
        ...Object.values(project.breaks)
          .filter((b) => b.pads.includes(id))
          .map((b): Usage => ({ kind: 'break', id: b.id, name: b.name })),
        ...Object.values(project.loops)
          .filter((l) => l.steps.some((s) => s.padId === id))
          .map((l): Usage => ({ kind: 'loop', id: l.id, name: l.name })),
      ];
    case 'loop':
      return [
        ...songUsage(project, id, ['main', 'fill']),
      ];
    case 'mod':
      return songUsage(project, id, ['modA', 'modB']);
  }
}

/** What is heard in the song, all the way down: its loops and mods, the pads on their steps, those pads' hits, and their breaks. */
export interface Heard {
  readonly loops: ReadonlySet<Id>;
  readonly mods: ReadonlySet<Id>;
  readonly pads: ReadonlySet<Id>;
  readonly hits: ReadonlySet<Id>;
  readonly breaks: ReadonlySet<Id>;
}

/**
 * The loops and mods with a clip in the song, the pads on those loops' steps,
 * every hit in those pads (any of them can be picked) or locked on a step,
 * and the breaks those hits play; a break's parent is heard with it.
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
  for (const id of pads) for (const m of project.pads[id]?.members ?? []) hits.add(m);
  const breaks = new Set<Id>();
  for (const id of hits) {
    const hit = project.hits[id];
    if (hit !== undefined) breaks.add(hit.breakId);
  }
  for (const id of breaks) {
    const parent = project.breaks[id]?.parent;
    if (parent != null) hits.add(parent);
  }
  return { loops, mods, pads, hits, breaks };
}
