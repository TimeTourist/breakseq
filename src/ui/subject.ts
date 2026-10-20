import type { Project, Rng } from '../model';
import { sampleAudio } from '../model';
import { loopSongLooped, matrixSongLooped, modPreviewSong } from '../engine';
import { currentLoopId } from './LoopsView';
import { currentModId, previewLoopId } from './ModsView';
import { selectedTrim } from './SamplesView';
import type { Preview } from './services';
import type { AppState } from './store';
import { matrixInView } from './store';

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

export function subjectOf(project: Project, state: Pick<AppState, 'view' | 'selection' | 'sliceTarget' | 'focus'>): Subject | null {
  const { view, selection } = state;
  const song = (key: string, p: Project, once = false): Subject => ({ key, once, kind: 'song', project: p });
  switch (view) {
    case 'samples': {
      // The selected sample, trimmed, as it is (Magnus beslut); with none, the song.
      const sample = selectedTrim(project, state.sliceTarget);
      const audio = sample === undefined ? undefined : sampleAudio(project, sample);
      if (sample === undefined || audio === undefined) return song(SONG_KEY, project);
      const from = Math.round(sample.offset * audio.sampleRate);
      const to = Math.round((sample.offset + sample.duration) * audio.sampleRate);
      return {
        key: `sample:${sample.id}`,
        once: false,
        kind: 'preview',
        preview: () => ({ kind: 'audio', audio: { sampleRate: audio.sampleRate, channels: audio.channels.map((c) => c.slice(from, to)) } }),
      };
    }
    case 'pads': {
      // Always the matrix shown, in a loop, whatever is selected (Magnus beslut): a click plays a pad or a hit.
      const matrixId = matrixInView(state.focus);
      if (matrixId === null || project.matrices[matrixId] === undefined) return null;
      return song(`matrix:${matrixId}`, matrixSongLooped(project, matrixId));
    }
    case 'loops': {
      const loopId = currentLoopId(project, selection);
      return loopId === null ? song(SONG_KEY, project) : song(`loop:${loopId}`, loopSongLooped(project, loopId));
    }
    case 'mods': {
      // The mod on its loop; with no mod there is nothing to play (spec, Uppspelning), so Play stops.
      const modId = currentModId(project, selection);
      if (modId === null) return null;
      const loopId = previewLoopId(project, selection);
      return loopId === null ? song(SONG_KEY, project) : song(`mod:${modId}:${loopId}`, modPreviewSong(project, modId, loopId));
    }
    case 'song':
    case 'project':
      return song(SONG_KEY, project);
  }
}
