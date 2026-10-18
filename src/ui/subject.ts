import type { Project, Rng } from '../model';
import { ownMatrix, sampleAudio } from '../model';
import { hitRun, loopSong, matrixSong, modPreviewSong, padTurns } from '../engine';
import { hitsOpen } from './HitsView';
import { currentLoopId } from './LoopsView';
import { currentModId, previewLoopId } from './ModsView';
import type { Preview } from './services';
import type { AppState } from './store';

/**
 * What Play plays in a view: what the view shows. `key` names it, so a new
 * render of the same thing swaps in seamlessly while something else starts
 * over. A song is rendered as a song; the rest as a preview.
 */
export type Subject = { readonly key: string; readonly once: boolean } & (
  | { readonly kind: 'song'; readonly project: Project }
  | { readonly kind: 'preview'; readonly preview: (rng: Rng) => Preview }
);

/** The key of the song itself: only it has a cursor and a loop. */
export const SONG_KEY = 'song';

export function subjectOf(project: Project, state: Pick<AppState, 'view' | 'selection' | 'sliceTarget' | 'trimming' | 'hitsLoop'>): Subject | null {
  const { view, selection } = state;
  const song = (key: string, p: Project, once = false): Subject => ({ key, once, kind: 'song', project: p });
  switch (view) {
    case 'samples': {
      // The sample whose Trim is open, trimmed, as it is.
      const trimmed = project.samples[state.trimming ?? ''];
      const trimmedAudio = trimmed === undefined ? undefined : sampleAudio(project, trimmed);
      if (trimmed !== undefined && trimmedAudio !== undefined) {
        const from = Math.round(trimmed.offset * trimmedAudio.sampleRate);
        const to = Math.round((trimmed.offset + trimmed.duration) * trimmedAudio.sampleRate);
        // Loops, as in Trim.
        return {
          key: `sample:${trimmed.id}`,
          once: false,
          kind: 'preview',
          preview: () => ({ kind: 'audio', audio: { sampleRate: trimmedAudio.sampleRate, channels: trimmedAudio.channels.map((c) => c.slice(from, to)) } }),
        };
      }
      // Else the sample open in Slice, or the first sliced one, as its own matrix lays it out; with none, the song.
      const sliced = Object.values(project.samples).filter((s) => s.bars !== null);
      const sample = sliced.find((s) => s.id === state.sliceTarget) ?? sliced[0];
      const matrix = sample === undefined ? undefined : ownMatrix(project, sample.id);
      return matrix === undefined ? song(SONG_KEY, project) : song(`matrix:${matrix.id}`, matrixSong(project, matrix.id));
    }
    case 'pads': {
      const once = !state.hitsLoop;
      const { pad, hit, picked, matrix } = hitsOpen(project, selection);
      if (matrix !== undefined) return song(`matrix:${matrix.id}:${once}`, matrixSong(project, matrix.id), once);
      if (picked && hit !== undefined) return { key: `hit:${hit.id}:${once}`, once, kind: 'preview', preview: () => ({ kind: 'hits', project, run: hitRun(project, [hit.id]) }) };
      if (pad === undefined || pad.members.length === 0) return null;
      return { key: `pad:${pad.id}:${once}`, once, kind: 'preview', preview: (rng) => ({ kind: 'hits', project, run: hitRun(project, padTurns(pad, !once, rng)) }) };
    }
    case 'loops': {
      const loopId = currentLoopId(project, selection);
      return loopId === null ? song(SONG_KEY, project) : song(`loop:${loopId}`, loopSong(project, loopId));
    }
    case 'mods': {
      const loopId = previewLoopId(project, selection);
      const modId = currentModId(project, selection);
      if (loopId === null) return song(SONG_KEY, project);
      return modId === null ? song(`loop:${loopId}`, loopSong(project, loopId)) : song(`mod:${modId}:${loopId}`, modPreviewSong(project, modId, loopId));
    }
    case 'song':
    case 'project':
      return song(SONG_KEY, project);
  }
}
