import type { Id, Loop, Mod, Project } from '../model';
import { ownMods, presetMods } from '../model';
import { useApp, useSelect } from './context';
import { PinIcon } from './icons';
import { InSongMark, useHeard } from './InSong';
import { middleEllipsis, musicalLength } from './labels';
import type { Focus } from './store';
import { songPinned } from './store';

/** A group in Song's list and shelf: Main and Fill loops, and Mods; on the shelf also Presets. */
export interface SongGroup {
  readonly name: 'Main' | 'Fill' | 'Mods' | 'Presets';
  readonly loops: readonly Loop[];
  readonly mods: readonly Mod[];
}

/** The groups Main, Fill and Mods in Loops' and Mods' order, the mods of one's own only; with `focus`, only what is pinned in Song. */
export function songGroups(project: Project, focus?: Focus): readonly SongGroup[] {
  const keep = (id: Id) => focus === undefined || songPinned(focus, id);
  const loops = Object.values(project.loops).filter((l) => keep(l.id));
  return [
    { name: 'Main', loops: loops.filter((l) => l.kind === 'main'), mods: [] },
    { name: 'Fill', loops: loops.filter((l) => l.kind === 'fill'), mods: [] },
    { name: 'Mods', loops: [], mods: ownMods(project).filter((m) => keep(m.id)) },
  ];
}

/**
 * The shelf: the pinned groups that have something, and the mod presets as a
 * fixed group last, always there and without pins (see Mod-förval).
 */
export function shelfGroups(project: Project, focus: Focus): { readonly pinned: readonly SongGroup[]; readonly presets: SongGroup | null } {
  const presets = presetMods(project);
  return {
    pinned: songGroups(project, focus).filter((g) => g.loops.length + g.mods.length > 0),
    presets: presets.length === 0 ? null : { name: 'Presets', loops: [], mods: presets },
  };
}

const effectCount = (mod: Mod) => `${mod.effects.length} ${mod.effects.length === 1 ? 'effect' : 'effects'}`;

/**
 * Song's list (Magnus beslut 2026-10-22, Listan och hyllan i Song and
 * Song-v2): the loops and mods in Main, Fill and Mods, a row each with its
 * pin, which puts it on the shelf Loops and mods. A click on a row plays the
 * loop once, or the mod once on its loop under Plays on, and selects nothing.
 * The rows are not dragged: one drags from the shelf.
 */
export function SongList({ project, onPlayLoop, onPlayMod }: { readonly project: Project; readonly onPlayLoop: (id: Id) => void; readonly onPlayMod: (id: Id) => void }) {
  const { store } = useApp();
  const heard = useHeard();
  const focus = useSelect((s) => s.focus);

  const pin = (id: Id, name: string) => {
    const pinned = songPinned(focus, id);
    return (
      <button
        type="button"
        className={`icon-button small pin${pinned ? ' pinned' : ''}`}
        aria-pressed={pinned}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${name}`}
        title={pinned ? 'Pinned: it is in the shelf below. Click to unpin' : 'Pin: show it in the shelf below'}
        onClick={() => store.dispatch({ type: 'songPin', id, on: !pinned })}
      >
        <PinIcon />
      </button>
    );
  };

  return (
    <section className="panel file-list matrix-list loops-list song-list" aria-label="List">
      <div className="file-list-head">
        <span className="label">Loops and mods</span>
        <span className="muted small drop-hint">· pin to use in the shelf</span>
      </div>
      {songGroups(project).map((group, i) => (
        <div key={group.name} className={`file-group${i > 0 ? ' song-list-group' : ''}`} role="group" aria-label={group.name}>
          <div className="file-row">
            <span className="label grow">{group.name}</span>
          </div>
          {group.loops.map((l) => (
            <div key={l.id} className="sample-row matrix-pin-row">
              {pin(l.id, l.name)}
              <button type="button" className="sample-pick" aria-label={`Hear ${l.name}`} title="Click: hear it once" onClick={() => onPlayLoop(l.id)}>
                <span className={`mono grow ellipsis loop-name ${l.kind}`} title={l.name}>
                  {middleEllipsis(l.name)}
                </span>
                <span className="faint small">{musicalLength(l.steps.length)}</span>
                <InSongMark heard={heard.loops.has(l.id)} />
              </button>
            </div>
          ))}
          {group.mods.map((m) => (
            <div key={m.id} className="sample-row matrix-pin-row">
              {pin(m.id, m.name)}
              <button type="button" className="sample-pick" aria-label={`Hear ${m.name}`} title="Click: hear it once on its loop under Plays on in Mods" onClick={() => onPlayMod(m.id)}>
                <span className="mono grow ellipsis mod-name" title={m.name}>
                  {middleEllipsis(m.name)}
                </span>
                <span className="faint small">{effectCount(m)}</span>
                <InSongMark heard={heard.mods.has(m.id)} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
