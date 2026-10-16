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
