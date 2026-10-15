import { useState } from 'react';
import type { Id } from '../model';
import { addPadMember, baseName, createPad, movePadMember, remove, removePadMember, renamePad } from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { hitColor, padColor, padGroups, padLabel, padUsages } from './labels';
import { PlayIcon } from './TagView';

const MEMBER_MIME = 'application/x-breakseq-member';

export function PadsView() {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selected = useSelect((s) => s.selection.pad);
  const [hideUnused, setHideUnused] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const groups = padGroups(project, (p) => !hideUnused || padUsages(project, p.id).length > 0 || p.id === selected);
  const pad = (selected === null ? undefined : project.pads[selected]) ?? groups[0]?.items[0];

  const newPad = () => {
    const before = store.getState().history.present.pads;
    const name = `Pad ${Object.values(project.pads).filter((p) => !p.auto).length + 1}`;
    if (run(createPad(name)) === null) {
      const id = Object.keys(store.getState().history.present.pads).find((k) => !(k in before));
      if (id !== undefined) open({ pad: id }, 'pads');
    }
  };

  const sidebar = (
    <aside className="sidebar" aria-label="Pads">
      <div className="row spread">
        <h2 className="sidebar-title">Pads</h2>
        <label className="check">
          <input type="checkbox" checked={hideUnused} onChange={(e) => setHideUnused(e.target.checked)} />
          Hide unused
        </label>
      </div>
      {groups.map((group) => (
        <section key={group.name} className="stack-tight">
          <h3 className="label">{group.name}</h3>
          <div className="pad-grid">
            {group.items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="pad-tile mono"
                aria-current={p.id === pad?.id ? 'true' : undefined}
                aria-label={`Pad ${p.name}, ${p.members.length} hits`}
                title={p.name}
                style={{ color: padColor(project, p), boxShadow: `inset 0 -3px 0 ${padColor(project, p)}` }}
                onClick={() => open({ pad: p.id }, 'pads')}
              >
                <span className="pad-tile-label">{padLabel(p)}</span>
                <span className="cell-sub">
                  {p.members.length} {p.members.length === 1 ? 'hit' : 'hits'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <button type="button" className="dashed" onClick={newPad}>
        + New pad
      </button>
    </aside>
  );

  if (pad === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Pads</h1>
            <p className="muted">No pads yet. Import a sample, or make a new pad.</p>
          </div>
        </main>
      </div>
    );
  }

  const usages = padUsages(project, pad.id);
  const query = search.trim().toLowerCase();
  const available = Object.values(project.hits).filter(
    (h) => !pad.members.includes(h.id) && (query === '' || h.name.toLowerCase().includes(query)),
  );
  const move = (hitId: Id, to: number) => setError(run(movePadMember(pad.id, hitId, to)));

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        <div className="view-head row">
          <div className="stack-tight grow">
            <label className="sr-only" htmlFor="pad-name">
              Pad name
            </label>
            <input
              id="pad-name"
              className="title-input"
              value={pad.name}
              onChange={(e) => setError(run(renamePad(pad.id, e.target.value), `pad:${pad.id}:name`))}
              onBlur={seal}
            />
            <p className="muted">
              {pad.members.length} {pad.members.length === 1 ? 'hit' : 'hits'}. Member 1 plays by default; steps can choose
              another.
            </p>
          </div>
          <div className="row push">
            <button
              type="button"
              className="icon-button"
              aria-label="Preview pad"
              disabled={pad.members.length === 0}
              onClick={() => pad.members[0] !== undefined && services.player.playHit(project, pad.members[0])}
            >
              <PlayIcon />
            </button>
            <button
              type="button"
              disabled={usages.length > 0}
              title={usages.length > 0 ? 'In use: take it out of its loops first' : undefined}
              onClick={() => {
                const failed = run(remove('pad', pad.id));
                if (failed === null) open({ pad: null }, 'pads');
                else setError(failed);
              }}
            >
              Delete
            </button>
          </div>
        </div>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="columns">
          <section className="stack-tight grow-2" aria-label="Members">
            <h2 className="label">Members · drag or use the arrows to reorder</h2>
            {pad.members.length === 0 && <p className="muted">No members yet. Add hits on the right.</p>}
            <ol className="members">
              {pad.members.map((hitId, i) => {
                const hit = project.hits[hitId];
                if (hit === undefined) return null;
                return (
                  <li
                    key={hitId}
                    className={`member${i === 0 ? ' first' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(MEMBER_MIME, hitId)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(MEMBER_MIME)) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      const dragged = e.dataTransfer.getData(MEMBER_MIME);
                      if (dragged !== '') {
                        e.preventDefault();
                        move(dragged, i);
                      }
                    }}
                  >
                    <span className="member-num mono">{i + 1}</span>
                    <span className="dot" style={{ background: hitColor(project, hitId) }} />
                    <button type="button" className="link-text mono grow ellipsis" onClick={() => open({ hit: hitId }, 'hits')}>
                      {baseName(hit.name)}
                    </button>
                    <span className="muted small">{i === 0 ? 'default' : ''}</span>
                    <button type="button" className="icon-button small" aria-label={`Play ${hit.name}`} onClick={() => services.player.playHit(project, hitId)}>
                      <PlayIcon />
                    </button>
                    <button type="button" className="icon-button small" aria-label={`Move ${hit.name} up`} disabled={i === 0} onClick={() => move(hitId, i - 1)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={`Move ${hit.name} down`}
                      disabled={i === pad.members.length - 1}
                      onClick={() => move(hitId, i + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={`Remove ${hit.name} from pad`}
                      onClick={() => setError(run(removePadMember(pad.id, hitId)))}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel stack-tight grow-1" aria-label="Add hits">
            <h2 className="label">Add hits</h2>
            <input type="search" placeholder="Search hits" aria-label="Search hits" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="add-list">
              {available.slice(0, 200).map((h) => (
                <div key={h.id} className="add-row">
                  <span className="dot" style={{ background: hitColor(project, h.id) }} />
                  <span className="mono grow ellipsis">{baseName(h.name)}</span>
                  <button type="button" aria-label={`Add ${h.name} to pad`} onClick={() => setError(run(addPadMember(pad.id, h.id)))}>
                    Add
                  </button>
                </div>
              ))}
              {available.length === 0 && <p className="muted small">No hits to add.</p>}
            </div>
          </section>
        </div>

        <section className="panel row">
          <span className="label">Used in</span>
          {usages.length === 0 ? (
            <span className="muted small">No loops</span>
          ) : (
            usages.map(({ loop, steps }) => (
              <button key={loop.id} type="button" className="link-chip mono" onClick={() => open({ loop: loop.id, step: null }, 'loops')}>
                {loop.name} · {steps} {steps === 1 ? 'step' : 'steps'}
              </button>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
