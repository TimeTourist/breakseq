import type { Project, Rng } from '../model';
import { sampleAudio } from '../model';
import { breakSong, hitRun, loopSong, modPreviewSong, padTurns } from '../engine';
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
    case 'import': {
      // The sample whose Trim is open, trimmed, as it is; with none open, the song.
      const brk = project.breaks[state.trimming ?? ''];
      const sample = brk === undefined ? undefined : project.samples[brk.sampleId];
      const audio = sample === undefined ? undefined : sampleAudio(project, sample);
      if (brk === undefined || sample === undefined || audio === undefined) return song(SONG_KEY, project);
      const from = Math.round(sample.offset * audio.sampleRate);
      const to = Math.round((sample.offset + sample.duration) * audio.sampleRate);
      // Breaks loop, as in Trim; one-shots play once.
      return {
        key: `sample:${sample.id}`,
        once: brk.bars === null,
        kind: 'preview',
        preview: () => ({ kind: 'audio', audio: { sampleRate: audio.sampleRate, channels: audio.channels.map((c) => c.slice(from, to)) } }),
      };
    }
    case 'slice': {
      const breaks = Object.values(project.breaks).filter((b) => b.bars !== null);
      const brk = breaks.find((b) => b.id === state.sliceTarget) ?? breaks[0];
      return brk === undefined ? null : song(`break:${brk.id}`, breakSong(project, brk.id));
    }
    case 'hits': {
      const once = !state.hitsLoop;
      const { pad, hit, picked, parent } = hitsOpen(project, selection);
      if (parent && hit !== undefined) return song(`break:${hit.breakId}:${once}`, breakSong(project, hit.breakId), once);
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
