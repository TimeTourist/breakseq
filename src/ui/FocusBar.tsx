import { useState } from 'react';
import type { Matrix } from '../model';
import { matrixKind } from '../model';
import { useApp, useProject, useSelect } from './context';
import type { PadsPlay } from './ControlsPanel';
import { MatrixKindIcon } from './icons';
import { middleEllipsis } from './labels';
import { NewMatrixDialog } from './NewMatrixDialog';
import { PlayControls } from './PlayControls';

/** A break or a one-shot in a list where no icon fits, as the icons draw them. */
const kindMark = (m: Matrix) => (matrixKind(m) === 'break' ? '≡' : '•');

interface FocusBarProps {
  /** Play matrix, shown with a matrix in focus; none in Loops. */
  readonly transport?: PadsPlay;
  /** The view's name, as the heading; none in Loops, whose heading is its loop. */
  readonly title?: string;
}

/**
 * The top of Pads: the matrix in focus, the matrices taken from, + New matrix
 * and ▶ Play matrix, the same Play as in the header: the matrix in focus, in a
 * loop, whatever is selected. Focus and Take from are the view's choice, not
 * the project's, and are not undone (decision 16).
 */
export function FocusBar({ transport, title }: FocusBarProps) {
  const project = useProject();
  const { store } = useApp();
  const focus = useSelect((s) => s.focus);
  const [making, setMaking] = useState(false);
  const matrices = Object.values(project.matrices);
  const focused = focus.matrix === null ? undefined : project.matrices[focus.matrix];
  const others = matrices.filter((m) => m.id !== focus.matrix);

  const toFocus = (id: string) => store.dispatch({ type: 'focus', matrix: id === '' ? null : id });
  return (
    <div className="focus-bar row">
      {title !== undefined && <h1>{title}</h1>}
      <div className="row nowrap focus-pick">
        <span className="label">Focus</span>
        {focused !== undefined && <MatrixKindIcon kind={matrixKind(focused)} />}
        <select aria-label="Matrix in focus" value={focused?.id ?? ''} onChange={(e) => toFocus(e.target.value)}>
          {focused === undefined && <option value="">Choose a matrix…</option>}
          {matrices.map((m) => (
            <option key={m.id} value={m.id} title={m.name}>
              {kindMark(m)} {middleEllipsis(m.name)}
            </option>
          ))}
        </select>
      </div>
      {others.length > 0 && (
        <div className="row take-from" role="group" aria-label="Take from">
          <span className="label">Take from</span>
          {others.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              aria-label={m.name}
              aria-pressed={focus.takeFrom.includes(m.id)}
              title={`${m.name}: take its hits into ${focused?.name ?? 'the matrix in focus'}`}
              onClick={() => store.dispatch({ type: 'takeFrom', matrix: m.id, on: !focus.takeFrom.includes(m.id) })}
            >
              <MatrixKindIcon kind={matrixKind(m)} /> {middleEllipsis(m.name)}
            </button>
          ))}
        </div>
      )}
      <div className="row push nowrap">
        <button type="button" className="dashed" onClick={() => setMaking(true)}>
          + New matrix
        </button>
        {focused !== undefined && transport !== undefined && (
          <PlayControls
            what="matrix"
            playing={transport.playing}
            onToggle={transport.onToggle}
            title="Plays the matrix in focus, in a loop; click a pad or a hit to hear it · Space plays and stops"
          />
        )}
      </div>
      {making && <NewMatrixDialog onClose={() => setMaking(false)} />}
    </div>
  );
}
