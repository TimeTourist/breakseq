import type { Project, Rng } from '../model';
import { ownMatrix, sampleAudio } from '../model';
import { hitRun, loopSong, matrixSong, modPreviewSong, padTurns } from '../engine';
import { currentLoopId } from './LoopsView';
import { currentModId, previewLoopId } from './ModsView';
import { padsOpen } from './pads';
import { selectedTrim } from './SamplesView';
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

export function subjectOf(project: Project, state: Pick<AppState, 'view' | 'selection' | 'sliceTarget' | 'trimming' | 'focus'>): Subject | null {
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
      // Else the trim shown below the table, as its own matrix lays it out; with none, the song.
      const sample = selectedTrim(project, state.sliceTarget);
      const matrix = sample === undefined ? undefined : ownMatrix(project, sample.id);
      return matrix === undefined ? song(SONG_KEY, project) : song(`matrix:${matrix.id}`, matrixSong(project, matrix.id));
    }
    case 'pads': {
      // What is selected: a hit once, a pad as it picks (anew each time round), the matrix in a loop.
      const open = padsOpen(project, state.focus.matrix, selection);
      if (open === null) return null;
      if (open.kind === 'matrix') return song(`matrix:${open.matrix.id}`, matrixSong(project, open.matrix.id));
      if (open.kind === 'hit') {
        const hitId = open.hit.id;
        return { key: `hit:${hitId}`, once: true, kind: 'preview', preview: () => ({ kind: 'hits', project, run: hitRun(project, [hitId]) }) };
      }
      const pad = open.pad;
      if (pad.members.length === 0) return null;
      return { key: `pad:${pad.id}`, once: false, kind: 'preview', preview: (rng) => ({ kind: 'hits', project, run: hitRun(project, padTurns(pad, true, rng)) }) };
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
