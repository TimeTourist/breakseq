import type { Id, Project } from '../model';
import { matrixOfPad, padOfHit } from '../model';
import type { Focus, Selection } from '../ui/store';

/** The focus Pads needs to show a selection: the matrix it is in, as opening it in Pads sets. */
export function focusOn(project: Project, selection: Partial<Selection>): Focus {
  const pad: Id | undefined = selection.pad ?? (selection.hit == null ? undefined : padOfHit(project, selection.hit)?.id);
  const matrix = selection.matrix ?? (pad == null ? null : (matrixOfPad(project, pad)?.id ?? null));
  return { matrix, takeFrom: [] };
}
