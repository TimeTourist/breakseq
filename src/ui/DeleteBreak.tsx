import type { Break } from '../model';
import { breakTakes, breakUsages, isUnsliced, removeBreak } from '../model';
import { useProject, useRun } from './context';
import { DeleteButton } from './DeleteButton';

interface DeleteBreakProps {
  readonly brk: Break;
  /** After the break is gone, as when the view showed it. */
  readonly onDeleted?: () => void;
  readonly onError: (error: string | null) => void;
  /** As an icon, in tight rows. */
  readonly icon?: boolean;
}

/** Removes a break with everything only it uses; where it is used goes silent. */
export function DeleteBreak({ brk, onDeleted, onError, icon = false }: DeleteBreakProps) {
  const project = useProject();
  const run = useRun();
  return (
    <DeleteButton
      label={brk.bars === null && !isUnsliced(brk) ? 'Delete one-shot' : 'Delete break'}
      name={brk.name}
      usages={breakUsages(project, brk.id)}
      goes={breakTakes(project, brk.id)}
      onDelete={() => run(removeBreak(brk.id))}
      onDeleted={onDeleted}
      onError={onError}
      icon={icon}
    />
  );
}
