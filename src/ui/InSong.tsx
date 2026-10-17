import { useMemo } from 'react';
import type { Heard } from '../model';
import { heardInSong } from '../model';
import { useOpen, useProject } from './context';

/** What is heard in the song, all the way down; worked out again when the project changes. */
export function useHeard(): Heard {
  const project = useProject();
  return useMemo(() => heardInSong(project), [project]);
}

/** "♪ Song" by a name when it is heard in the song: a click opens Song. Nothing when it is not. */
export function InSong({ heard }: { readonly heard: boolean }) {
  const open = useOpen();
  if (!heard) return null;
  return (
    <button type="button" className="link-text small in-song" title="Heard in the song: open Song" onClick={() => open({}, 'song')}>
      ♪ Song
    </button>
  );
}

/** The same mark in a list, where it cannot be a button of its own. */
export function InSongMark({ heard }: { readonly heard: boolean }) {
  return heard ? (
    <span className="in-song-mark" title="Heard in the song" aria-label="heard in the song">
      ♪
    </span>
  ) : null;
}
