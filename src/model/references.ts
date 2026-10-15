import type { Usage } from './command';
import type { BorrowEffect, Id, Mod, Project, SongRow, StepEffect } from './types';
import { isScopedEffect } from './types';

/** A mod's effects that act on some steps, and so have a scope. */
export const stepEffects = (mod: Mod): (StepEffect | BorrowEffect)[] => mod.effects.filter(isScopedEffect);

export type ReferableKind = 'tag' | 'sample' | 'hit' | 'pad' | 'loop' | 'mod';

const songUsage = (project: Project, id: Id, rows: readonly SongRow[]): Usage[] =>
  project.song.clips.some((c) => c.ref === id && rows.includes(c.row)) ? [{ kind: 'song', id: null, name: 'Song' }] : [];

/** Everything that refers to the given object. An object with usages cannot be removed. */
export function findUsages(project: Project, kind: ReferableKind, id: Id): Usage[] {
  switch (kind) {
    case 'tag':
      return [
        ...Object.values(project.samples)
          .filter((s) => s.mainTag === id || s.extraTags.includes(id))
          .map((s): Usage => ({ kind: 'sample', id: s.id, name: s.name })),
        ...Object.values(project.mods)
          .filter((m) => stepEffects(m).some((e) => e.scope.kind === 'tag' && e.scope.tagId === id))
          .map((m): Usage => ({ kind: 'mod', id: m.id, name: m.name })),
      ];
    case 'sample':
      return Object.values(project.hits)
        .filter((h) => h.sampleId === id)
        .map((h) => ({ kind: 'hit', id: h.id, name: h.name }));
    case 'hit':
      return Object.values(project.pads)
        .filter((p) => p.members.includes(id))
        .map((p) => ({ kind: 'pad', id: p.id, name: p.name }));
    case 'pad':
      return [
        ...Object.values(project.loops)
          .filter((l) => l.steps.some((s) => s.padId === id))
          .map((l): Usage => ({ kind: 'loop', id: l.id, name: l.name })),
        ...Object.values(project.mods)
          .filter((m) => stepEffects(m).some((e) => e.scope.kind === 'pad' && e.scope.padId === id))
          .map((m): Usage => ({ kind: 'mod', id: m.id, name: m.name })),
      ];
    case 'loop':
      return [
        ...songUsage(project, id, ['main', 'fill']),
        ...Object.values(project.mods)
          .filter((m) => m.effects.some((e) => e.target === 'sourceLoop' && e.sources.includes(id)))
          .map((m): Usage => ({ kind: 'mod', id: m.id, name: m.name })),
      ];
    case 'mod':
      return songUsage(project, id, ['modA', 'modB']);
  }
}
