import type { Command, Hit, Id, Matrix, Pad, Project } from '../model';
import { baseName, copyHits, copyMatrix, matrixOfPad, movePadMember, ok, padOfHit, replaceHit, sequence, setPadChoice } from '../model';
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

/** What is dragged, or picked by a tap: a hit, or all hits of a matrix. */
export type Dragged = { readonly kind: 'hit'; readonly hitId: Id } | { readonly kind: 'matrix'; readonly matrixId: Id };

/** Where on a hit the pointer is: its top or bottom edge (between hits), or on it. */
export type Zone = 'before' | 'on' | 'after';

/** What the pointer is over in the timeline: a pad, and the hit in it if any. */
export interface Over {
  readonly padId: Id;
  readonly hitId: Id | null;
  readonly zone: Zone;
}

/** What a drop does (decisions 4, 12, 13): adds copies last to a pad, replaces a hit, or moves a hit within its pad to index `to`. */
export type DropTarget =
  | { readonly kind: 'add'; readonly padId: Id }
  | { readonly kind: 'replace'; readonly padId: Id; readonly hitId: Id }
  | { readonly kind: 'move'; readonly padId: Id; readonly hitId: Id; readonly to: number };

/** The part of a hit's height at its top and at its bottom that counts as between hits. */
const EDGE = 0.3;

/** The zone of a hit at `y`, for a hit `height` high from `top`. */
export function zoneOf(y: number, top: number, height: number): Zone {
  if (height <= 0) return 'on';
  const at = (y - top) / height;
  return at < EDGE ? 'before' : at > 1 - EDGE ? 'after' : 'on';
}

/**
 * What dropping `dragged` over `over` does, or null when it does nothing. A
 * hit dropped between hits of its own pad moves there; on a hit, a hit
 * replaces it (from another pad, all of the hit replaces); anywhere else in a
 * pad, and all hits of a matrix anywhere, it adds copies last.
 */
export function dropTarget(project: Project, dragged: Dragged, over: Over): DropTarget | null {
  if (dragged.kind === 'matrix' || over.hitId === null) return { kind: 'add', padId: over.padId };
  const pad = project.pads[over.padId];
  if (pad === undefined) return null;
  if (dragged.hitId === over.hitId) return null;
  if (pad.members.includes(dragged.hitId) && over.zone !== 'on') {
    const to = pad.members.filter((m) => m !== dragged.hitId).indexOf(over.hitId) + (over.zone === 'after' ? 1 : 0);
    return to === pad.members.indexOf(dragged.hitId) ? null : { kind: 'move', padId: pad.id, hitId: dragged.hitId, to };
  }
  return { kind: 'replace', padId: pad.id, hitId: over.hitId };
}

/** A pad on Top that now has more than one hit turns Round robin, so what was added is heard. */
const roundRobinIfMore =
  (padId: Id): Command =>
  (project, ctx) => {
    const pad = project.pads[padId];
    return pad !== undefined && pad.choice === 'top' && pad.members.length > 1 ? setPadChoice(padId, 'roundRobin')(project, ctx) : ok(project);
  };

/** The command for a drop, as one undo step. */
export function dropCommand(dragged: Dragged, target: DropTarget): Command {
  switch (target.kind) {
    case 'add':
      return sequence(dragged.kind === 'hit' ? copyHits([dragged.hitId], target.padId) : copyMatrix(dragged.matrixId, { padId: target.padId }), roundRobinIfMore(target.padId));
    case 'replace':
      return dragged.kind === 'hit' ? replaceHit(target.hitId, dragged.hitId) : dropCommand(dragged, { kind: 'add', padId: target.padId });
    case 'move':
      return movePadMember(target.padId, target.hitId, target.to);
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

/**
 * Drag and tap to place in Pads: what is dragged or picked (decision 8), and
 * how it is placed. Picking is for touch: a tap on a hit or all hits on the
 * shelf, then on a pad or a hit.
 */
export interface Placing {
  readonly dragging: Dragged | null;
  readonly picked: Dragged | null;
  readonly startDrag: (dragged: Dragged) => void;
  readonly endDrag: () => void;
  readonly pick: (dragged: Dragged | null) => void;
  readonly place: (dragged: Dragged, target: DropTarget) => void;
}

/** Whether two drags or picks are of the same thing. */
export const sameDragged = (a: Dragged | null, b: Dragged | null): boolean =>
  a !== null && b !== null && (a.kind === 'hit' ? b.kind === 'hit' && a.hitId === b.hitId : b.kind === 'matrix' && a.matrixId === b.matrixId);
