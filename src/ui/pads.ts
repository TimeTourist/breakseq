import type { Hit, Id, Matrix, Pad, Project } from '../model';
import { baseName, padOfHit } from '../model';
import { replacedBy } from './labels';
import type { Selection } from './store';

/** What is open in Pads: the matrix in focus, a pad of it, or a hit of one of its pads. */
export type PadsOpen =
  | { readonly kind: 'matrix'; readonly matrix: Matrix }
  | { readonly kind: 'pad'; readonly matrix: Matrix; readonly pad: Pad }
  | { readonly kind: 'hit'; readonly matrix: Matrix; readonly pad: Pad; readonly hit: Hit };

/**
 * What Pads shows controls for, and Play plays: the selected hit or pad when
 * it is in the matrix in focus, else the matrix itself. null with no focus.
 */
export function padsOpen(project: Project, focus: Id | null, selection: Pick<Selection, 'hit' | 'pad'>): PadsOpen | null {
  const matrix = focus === null ? undefined : project.matrices[focus];
  if (matrix === undefined) return null;
  const hit = selection.hit === null ? undefined : project.hits[selection.hit];
  const hitPad = hit === undefined ? undefined : padOfHit(project, hit.id);
  if (hit !== undefined && hitPad !== undefined && matrix.pads.includes(hitPad.id)) return { kind: 'hit', matrix, pad: hitPad, hit };
  const pad = selection.pad === null ? undefined : project.pads[selection.pad];
  if (pad !== undefined && matrix.pads.includes(pad.id)) return { kind: 'pad', matrix, pad };
  return { kind: 'matrix', matrix };
}

export type Zoom = 'fit' | '1 bar';
export const ZOOMS: readonly Zoom[] = ['fit', '1 bar'];

/** The narrowest a pad column gets, so its number can be read. */
export const MIN_COLUMN_PX = 24;
/** An empty pad takes no steps: a narrow column of its own. */
export const EMPTY_COLUMN_PX = 24;

export interface Column {
  /** The step it starts on. */
  readonly start: number;
  readonly steps: number;
  readonly left: number;
  readonly width: number;
}

/**
 * Where each pad sits in the timeline, in px: as wide as its steps, an empty
 * pad narrow. `fit` shows the whole matrix in `width`, `1 bar` 16 steps per
 * `width`; no pad is narrower than MIN_COLUMN_PX, so a long matrix is wider
 * than `width` and scrolls in its own box.
 */
export function timelineLayout(lengths: readonly number[], zoom: Zoom, width: number): { columns: Column[]; stepPx: number; total: number } {
  const steps = lengths.reduce((a, b) => a + b, 0);
  const empties = lengths.filter((l) => l === 0).length;
  const shortest = Math.min(...lengths.filter((l) => l > 0));
  const room = Math.max(0, width - empties * EMPTY_COLUMN_PX);
  const wanted = zoom === 'fit' ? (steps === 0 ? 0 : room / steps) : width / 16;
  const stepPx = Number.isFinite(shortest) ? Math.max(wanted, MIN_COLUMN_PX / shortest) : wanted;
  let left = 0;
  let start = 0;
  const columns = lengths.map((l) => {
    const column = { start, steps: l, left, width: l === 0 ? EMPTY_COLUMN_PX : l * stepPx };
    left += column.width;
    start += l;
    return column;
  });
  return { columns, stepPx, total: left };
}

/** A row's number as it reads: 0 is "01". */
export const rowNumber = (row: number): string => String(row + 1).padStart(2, '0');

/**
 * A hit as it reads in the timeline: the slice of its row ("07"), a row that
 * plays another slice of its trim ("15→07"), or another trim's slice or a
 * one-shot ("→think 07"); in a matrix built by hand, its name.
 */
export function hitLabel(project: Project, padId: Id, row: number, hit: Hit): string {
  const by = replacedBy(project, padId, hit);
  if (by !== null) return /^\d+$/.test(by) ? `${rowNumber(row)}→${by}` : `→${by}`;
  const matrix = Object.values(project.matrices).find((m) => m.pads.includes(padId));
  if (matrix?.sampleId === hit.sampleId && hit.slice !== null) return rowNumber(hit.slice);
  return baseName(hit.name);
}

/** The name of a new matrix: Matrix 1, or the next number not taken. */
export function nextMatrixName(project: Project): string {
  const names = new Set(Object.values(project.matrices).map((m) => m.name));
  let n = 1;
  while (names.has(`Matrix ${n}`)) n += 1;
  return `Matrix ${n}`;
}
