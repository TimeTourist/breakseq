import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Hit, Id, Project } from '../model';
import { baseName, createMatrix, createMatrixFrom, matrixKind } from '../model';
import { useApp, useOpen, useProject } from './context';
import { useRunAdding } from './ControlsPanel';
import { nextMatrixName } from './pads';

/** The loaded one-shots' hits, in the order of their matrices: what a new matrix can be filled from. */
export function oneShotHits(project: Project): Hit[] {
  return Object.values(project.matrices)
    .filter((m) => matrixKind(m) === 'one-shot')
    .flatMap((m) => m.pads.flatMap((p) => project.pads[p]?.members ?? []))
    .flatMap((id) => (project.hits[id] === undefined ? [] : [project.hits[id]]));
}

/**
 * + New matrix (decisions 6, 15): a name and a list of the loaded one-shots to
 * tick. Create makes a matrix of one pad holding a copy of each ticked one,
 * or an empty pad with none ticked, and puts it in focus. A click on ▶ plays
 * a one-shot. Escape cancels.
 */
export function NewMatrixDialog({ onClose }: { readonly onClose: () => void }) {
  const project = useProject();
  const { store, services } = useApp();
  const open = useOpen();
  const [name, setName] = useState(() => nextMatrixName(project));
  const [ticked, setTicked] = useState<readonly Id[]>([]);
  const [error, setError] = useState<string | null>(null);
  const adding = useRunAdding(setError);
  const hits = oneShotHits(project);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.querySelector('input')?.select(), []);

  const create = () => {
    // In the order of the list, not of the ticks.
    const picked = hits.filter((h) => ticked.includes(h.id)).map((h) => h.id);
    adding(picked.length === 0 ? createMatrix(name) : createMatrixFrom(name, picked), 'matrices', (id) => {
      store.dispatch({ type: 'focus', matrix: id });
      open({ matrix: id, pad: null, hit: null }, 'pads');
      onClose();
    });
  };

  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="dialog panel stack new-matrix" role="alertdialog" aria-modal="true" aria-label="New matrix">
        <h2>New matrix</h2>
        <label className="field">
          <span className="label">Name</span>
          <input
            aria-label="Name"
            className="mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
        </label>
        {hits.length === 0 ? (
          <p className="muted small">No one-shots loaded. The matrix starts with an empty pad.</p>
        ) : (
          <>
            <p className="muted small">Tick the one-shots to start with: each is copied into the matrix's pad. Click ▶ to hear one.</p>
            <ul className="one-shot-list">
              {hits.map((h) => (
                <li key={h.id} className="row nowrap">
                  <label className="check grow ellipsis">
                    <input
                      type="checkbox"
                      aria-label={`Take ${h.name}`}
                      checked={ticked.includes(h.id)}
                      onChange={(e) => setTicked(e.target.checked ? [...ticked, h.id] : ticked.filter((t) => t !== h.id))}
                    />
                    <span className="mono ellipsis" title={h.name}>
                      {baseName(h.name)}
                    </span>
                  </label>
                  <button type="button" className="icon-button small" aria-label={`Play ${h.name}`} title="Plays it once" onClick={() => services.player.playHit(project, h.id)}>
                    ▶
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row confirm-buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
