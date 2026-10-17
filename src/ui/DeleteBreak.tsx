import type { Break } from '../model';
import { breakUsages, removeBreak } from '../model';
import { useProject, useRun } from './context';
import { DeleteButton } from './DeleteButton';

interface DeleteBreakProps {
  readonly brk: Break;
  /** After the break is gone, as when the view showed it. */
  readonly onDeleted?: () => void;
  readonly onError: (error: string | null) => void;
}

/** Removes a break with everything only it uses; where it is used goes silent. */
export function DeleteBreak({ brk, onDeleted, onError }: DeleteBreakProps) {
  const project = useProject();
  const run = useRun();
  return (
    <DeleteButton
      label={brk.bars === null ? 'Delete one-shot' : 'Delete break'}
      name={brk.name}
      usages={breakUsages(project, brk.id)}
      takes="its pads, hits and own loop go with it"
      onDelete={() => run(removeBreak(brk.id))}
      onDeleted={onDeleted}
      onError={onError}
    />
  );
}
