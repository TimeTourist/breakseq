import type { Project } from '../model';
import { sampleAudio } from '../model';
import { heardOf, loopBlock, matrixBlock, modBlock } from '../engine';
import { currentLoopId } from './LoopsView';
import { currentModId, previewLoopId } from './ModsView';
import { selectedTrim } from './SamplesView';
import type { Preview } from './services';
import type { AppState } from './store';
import { matrixInView } from './store';

/**
 * What Play plays in a view: what the view shows. `key` names it, so a new
 * render of the same thing swaps in seamlessly while something else starts
 * over. A song is rendered as a song; the rest as a preview. `sound` is what
 * of the project can be heard in it: a change that leaves it the same (see
 * sameHeard) is not rendered again.
 *
 * Matrices, Loops and Mods play in blocks of passes (see Varv i loop):
 * `blocks(n)` is the song of block n, and `project` is block 0. The song
 * itself sounds the same each time round and has no blocks.
 */
export type Subject = { readonly key: string; readonly once: boolean; readonly sound: unknown } & (
  | { readonly kind: 'song'; readonly project: Project; readonly blocks?: (block: number) => Project }
  | { readonly kind: 'preview'; readonly preview: () => Preview }
);

/** The key of the song itself: only it has a cursor and a loop. */
export const SONG_KEY = 'song';

export function subjectOf(project: Project, state: Pick<AppState, 'view' | 'selection' | 'sliceTarget' | 'focus'>): Subject | null {
  const { view, selection } = state;
  const song = (key: string, p: Project, once = false): Subject => ({ key, once, sound: heardOf(p), kind: 'song', project: p });
  const passes = (key: string, blocks: (block: number) => Project): Subject => {
    const first = blocks(0);
    return { key, once: false, sound: heardOf(first), kind: 'song', project: first, blocks };
  };
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
        // The trim of the file's audio, in its channels: its name is not heard.
        sound: { audio: project.audio[sample.audioId], channel: sample.channel, from, to },
        kind: 'preview',
        preview: () => ({ kind: 'audio', audio, from, to }),
      };
    }
    case 'pads': {
      // Always the matrix shown, in a loop, whatever is selected (Magnus beslut): a click plays a pad or a hit.
      const matrixId = matrixInView(state.focus);
      if (matrixId === null || project.matrices[matrixId] === undefined) return null;
      return passes(`matrix:${matrixId}`, (block) => matrixBlock(project, matrixId, block));
    }
    case 'loops': {
      const loopId = currentLoopId(project, selection);
      return loopId === null ? song(SONG_KEY, project) : passes(`loop:${loopId}`, (block) => loopBlock(project, loopId, block));
    }
    case 'mods': {
      // The mod on its loop; with no mod there is nothing to play (spec, Uppspelning), so Play stops.
      const modId = currentModId(project, selection);
      if (modId === null) return null;
      const loopId = previewLoopId(project, selection);
      return loopId === null ? song(SONG_KEY, project) : passes(`mod:${modId}:${loopId}`, (block) => modBlock(project, modId, loopId, block));
    }
    case 'song':
    case 'project':
      return song(SONG_KEY, project);
  }
}
