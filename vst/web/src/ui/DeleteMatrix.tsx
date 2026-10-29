import type { Matrix } from '../model';
import { findUsages, matrixTakes, removeAnyway } from '../model';
import { useProject, useRun } from './context';
import { DeleteButton } from './DeleteButton';

interface DeleteMatrixProps {
  readonly matrix: Matrix;
  /** After the matrix is gone, as when the view showed it. */
  readonly onDeleted?: () => void;
  readonly onError: (error: string | null) => void;
  /** As an icon, in tight rows. */
  readonly icon?: boolean;
  /** Asks again each time this changes. */
  readonly ask?: number | undefined;
}

/** Removes a matrix with its pads and hits; where it is used goes silent. Its samples and loop stay (decision 9). */
export function DeleteMatrix({ matrix, onDeleted, onError, icon = false, ask }: DeleteMatrixProps) {
  const project = useProject();
  const run = useRun();
  return (
    <DeleteButton
      label="Delete matrix"
      name={matrix.name}
      usages={findUsages(project, 'matrix', matrix.id)}
      goes={matrixTakes(project, matrix.id)}
      onDelete={() => run(removeAnyway('matrix', matrix.id))}
      onDeleted={onDeleted}
      onError={onError}
      icon={icon}
      ask={ask}
    />
  );
}
