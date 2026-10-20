import type { Command, Hit, Id, Matrix, Pad, Project } from '../model';
import { addPadWith, addVariant, baseName, copyHits, matrixOfPad, movePad, movePadMember, ok, padOfHit, sequence, setPadChoice } from '../model';
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

/** How many pads a row of the grid holds: Fit packs 8, 1 bar gives 4 more room each. (Claudes val.) */
export const PADS_PER_ROW: Record<Zoom, number> = { fit: 8, '1 bar': 4 };

/** A row's number as it reads: 0 is "01". */
export const rowNumber = (row: number): string => String(row + 1).padStart(2, '0');

/**
 * A hit as it reads in the grid and the list: the slice of its row ("07"), a row that
 * plays another slice of its trim ("15→07"), or another trim's slice or a
 * one-shot ("→think 07"); in a matrix built by hand, its name.
 */
export function hitLabel(project: Project, padId: Id, row: number, hit: Hit): string {
  const by = replacedBy(project, padId, hit);
  const matrix = matrixOfPad(project, padId);
  if (by !== null) return hit.sampleId === matrix?.sampleId ? `${rowNumber(row)}→${by}` : `→${by}`;
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

/**
 * What is dragged in Matrices (Magnus beslut): a pad or a hit from the list,
 * always copied; a hit chip in the grid, copied, or reordered within its pad;
 * or a pad by its number in the grid, moved or copied.
 */
export type Dragged =
  | { readonly kind: 'pad'; readonly padId: Id; readonly from: 'list' | 'grid' }
  | { readonly kind: 'hit'; readonly hitId: Id; readonly from: 'list' | 'grid' };

/** Where on a hit chip the pointer is: its upper or lower half, where a reordered hit goes. */
export type Zone = 'before' | 'after';

/** Where on a pad's tile a dragged pad is: its outer quarter at either side (or the gap beside it), or its middle. */
export type Side = 'before' | 'middle' | 'after';

/**
 * What the pointer is over in the grid: a pad and the hit chip in it if any
 * (for a hit), a pad and the side of it (for a pad), or the empty place after
 * the pads.
 */
export type Over =
  | { readonly kind: 'pad'; readonly padId: Id; readonly hitId: Id | null; readonly zone: Zone; readonly side: Side }
  | { readonly kind: 'new'; readonly matrixId: Id };

/**
 * What a drop does: adds copies last to a pad, moves a hit within its pad to
 * index `to`, moves a pad to place `to` in its matrix, or makes a new pad last
 * with copies.
 */
export type DropTarget =
  | { readonly kind: 'add'; readonly padId: Id; readonly hitIds: readonly Id[] }
  | { readonly kind: 'reorder'; readonly padId: Id; readonly hitId: Id; readonly to: number }
  | { readonly kind: 'variant'; readonly padId: Id; readonly hitId: Id }
  | { readonly kind: 'movePad'; readonly matrixId: Id; readonly padId: Id; readonly to: number }
  | { readonly kind: 'new'; readonly matrixId: Id; readonly hitIds: readonly Id[] };

/** The zone of a hit chip at `y`, for a chip `height` high from `top`: its upper or its lower half. */
export const zoneOf = (y: number, top: number, height: number): Zone => (height > 0 && y - top > height / 2 ? 'after' : 'before');

/** The outer part of a pad's tile at each side where a dragged pad goes beside it, not into it. (Claudes val.) */
export const SIDE_PART = 0.25;

/** The side of a pad's tile at `x`, for a tile `width` wide from `left`. */
export const sideOf = (x: number, left: number, width: number): Side => {
  if (width <= 0) return 'middle';
  const at = (x - left) / width;
  return at < SIDE_PART ? 'before' : at > 1 - SIDE_PART ? 'after' : 'middle';
};

/** The hits a drag brings: all of a pad's, or the one hit. */
const hitsOf = (project: Project, dragged: Dragged): Id[] => (dragged.kind === 'pad' ? [...(project.pads[dragged.padId]?.members ?? [])] : [dragged.hitId]);

/**
 * What dropping `dragged` over `over` does, or null when nothing (Magnus
 * beslut). Hits are always copied, from the list or the grid; within its own
 * pad a hit chip reorders, before or after the chip it is over. A pad dragged
 * in the grid moves beside another pad (its outer quarter, or the gap), copies
 * its hits into the middle of one, or makes a copy on the new pad's place; on
 * itself it does nothing.
 */
export function dropTarget(project: Project, dragged: Dragged, over: Over): DropTarget | null {
  const hits = hitsOf(project, dragged);
  if (over.kind === 'new') return hits.length === 0 ? null : { kind: 'new', matrixId: over.matrixId, hitIds: hits };
  const pad = project.pads[over.padId];
  if (pad === undefined) return null;
  if (dragged.kind === 'pad' && dragged.from === 'grid') {
    const matrix = matrixOfPad(project, pad.id);
    if (matrix === undefined || !matrix.pads.includes(dragged.padId)) return null;
    if (over.side === 'middle') return pad.id === dragged.padId || hits.length === 0 ? null : { kind: 'add', padId: pad.id, hitIds: hits };
    const gap = matrix.pads.indexOf(pad.id) + (over.side === 'after' ? 1 : 0);
    const from = matrix.pads.indexOf(dragged.padId);
    const to = gap > from ? gap - 1 : gap;
    return to === from ? null : { kind: 'movePad', matrixId: matrix.id, padId: dragged.padId, to };
  }
  if (dragged.kind === 'hit' && dragged.from === 'grid' && pad.members.includes(dragged.hitId)) {
    // Off the hit chips, on its own pad (its number or the empty part of its tile): a variant, as the Variant button makes. (Magnus beslut; the split is Claudes val.)
    if (over.hitId === null || !pad.members.includes(over.hitId)) return { kind: 'variant', padId: pad.id, hitId: dragged.hitId };
    const at = pad.members.indexOf(dragged.hitId);
    const to = over.hitId === dragged.hitId ? at : pad.members.filter((m) => m !== dragged.hitId).indexOf(over.hitId) + (over.zone === 'after' ? 1 : 0);
    return to === at ? null : { kind: 'reorder', padId: pad.id, hitId: dragged.hitId, to };
  }
  return hits.length === 0 ? null : { kind: 'add', padId: pad.id, hitIds: hits };
}

/** What a drop says on its target while dragging: Copy, Move pad here, or Copy 3 hits into 02 for a pad dropped into another. */
export function dropLabel(project: Project, dragged: Dragged, target: DropTarget): string {
  if (target.kind === 'movePad') return 'Move pad here';
  if (target.kind === 'reorder') return 'Move';
  if (target.kind === 'variant') return 'Variant';
  if (target.kind === 'add' && dragged.kind === 'pad' && dragged.from === 'grid') {
    const matrix = matrixOfPad(project, target.padId);
    const n = target.hitIds.length;
    return `Copy ${n} hit${n === 1 ? '' : 's'} into ${rowNumber(matrix?.pads.indexOf(target.padId) ?? 0)}`;
  }
  return 'Copy';
}

/** A pad on Top that now has more than one hit turns Round robin, so what was added is heard. */
const roundRobinIfMore =
  (padId: Id): Command =>
  (project, ctx) => {
    const pad = project.pads[padId];
    return pad !== undefined && pad.choice === 'top' && pad.members.length > 1 ? setPadChoice(padId, 'roundRobin')(project, ctx) : ok(project);
  };

/** The command for a drop, as one undo step. */
export function dropCommand(target: DropTarget): Command {
  switch (target.kind) {
    case 'add':
      return sequence(copyHits(target.hitIds, target.padId), roundRobinIfMore(target.padId));
    case 'movePad':
      return movePad(target.matrixId, target.padId, target.to);
    case 'reorder':
      return movePadMember(target.padId, target.hitId, target.to);
    case 'variant':
      return (project, ctx) => addVariant(target.hitId, `${project.hits[target.hitId]?.name ?? ''} var`)(project, ctx);
    case 'new':
      return addPadWith(target.matrixId, target.hitIds);
  }
}

/** How near the edge of a scrolling box a drag starts to scroll it, and the most it scrolls per dragover. */
export const AUTOSCROLL_EDGE_PX = 48;
export const AUTOSCROLL_MAX_PX = 24;

/**
 * How far to scroll a box from `start` to `end` with the pointer at `at` while
 * dragging (U4): back near the start, on near the end, faster nearer the edge.
 */
export function autoscrollStep(at: number, start: number, end: number): number {
  const edge = Math.min(AUTOSCROLL_EDGE_PX, (end - start) / 3);
  if (edge <= 0) return 0;
  if (at < start + edge) return -Math.round(AUTOSCROLL_MAX_PX * Math.min(1, (start + edge - at) / edge));
  if (at > end - edge) return Math.round(AUTOSCROLL_MAX_PX * Math.min(1, (at - (end - edge)) / edge));
  return 0;
}

/**
 * Where an arrow key takes the selection in Pads, or null at an end: ←/→
 * from pad to pad (from the matrix to its first or last), ↑/↓ through the
 * selected pad's hits, ↑ from its first back to the pad.
 */
export function stepSelection(open: PadsOpen, key: string): { pad: Id; hit: Id | null } | null {
  const pads = open.matrix.pads;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const step = key === 'ArrowRight' ? 1 : -1;
    const at = open.kind === 'matrix' ? (step === 1 ? 0 : pads.length - 1) : pads.indexOf(open.pad.id) + step;
    const pad = pads[at];
    return at < 0 || pad === undefined ? null : { pad, hit: null };
  }
  if ((key !== 'ArrowUp' && key !== 'ArrowDown') || open.kind === 'matrix') return null;
  const members = open.pad.members;
  const at = (open.kind === 'hit' ? members.indexOf(open.hit.id) : -1) + (key === 'ArrowDown' ? 1 : -1);
  if (at === -1 && open.kind === 'hit') return { pad: open.pad.id, hit: null };
  const hit = members[at];
  return at < 0 || hit === undefined ? null : { pad: open.pad.id, hit };
}

/** Drag in Matrices: what is dragged, if anything, while it is. */
export interface Placing {
  readonly dragging: Dragged | null;
  readonly startDrag: (dragged: Dragged) => void;
  readonly endDrag: () => void;
  readonly place: (target: DropTarget) => void;
}
