import { useMemo } from 'react';
import type { Heard } from '../model';
import { heardInSong } from '../model';
import { useProject } from './context';

/** What is heard in the song, all the way down; worked out again when the project changes. */
export function useHeard(): Heard {
  const project = useProject();
  return useMemo(() => heardInSong(project), [project]);
}

/** "♪" by a name in a list when it is heard in the song; the link to Song is in the row under the tabs. */
export function InSongMark({ heard }: { readonly heard: boolean }) {
  return heard ? (
    <span className="in-song-mark" title="Heard in the song" aria-label="heard in the song">
      ♪
    </span>
  ) : null;
}
