import type { Hit, Id, Loop, Matrix, Pad, Project, Sample } from '../model';
import { fileSamples, heardInSong, loopMatrices, ownMatrix, trimName } from '../model';
import { middleEllipsis, padLabel } from './labels';
import type { Action, AppState } from './store';

/** A place in the chain the row links to: what it says, the whole name on hover, and where a click takes one. */
export interface Jump {
  readonly label: string;
  readonly title: string;
  readonly go: readonly Action[];
}

/** Several places of one kind (2 loops): a menu of them. */
export interface JumpMenu {
  readonly label: string;
  readonly title: string;
  readonly items: readonly Jump[];
}

export type Crumb = Jump | JumpMenu;

export const isMenu = (crumb: Crumb): crumb is JumpMenu => 'items' in crumb;

/**
 * The link row under the tabs, for what is selected on the tab one is on:
 * the way back up the chain (file › sample › matrix › pad › hit), what is
 * selected, and on to what uses it, ♪ Song last when it is heard there.
 */
export interface Trail {
  readonly back: readonly Crumb[];
  /** Plain text before what is selected, not a link: the file in Samples ("amen.wav · sample 1"). */
  readonly context?: { readonly label: string; readonly title: string };
  readonly current: { readonly label: string; readonly title: string } | null;
  readonly forward: readonly Crumb[];
  /** Heard in the song: "♪ Song →" last. */
  readonly song: boolean;
}

const EMPTY: Trail = { back: [], current: null, forward: [], song: false };

const toTrim = (sample: Sample): Action[] => [
  { type: 'sliceTarget', sampleId: sample.id },
  { type: 'view', view: 'samples' },
];

const fileJump = (project: Project, sample: Sample): Jump => ({
  label: middleEllipsis(sample.name),
  title: `${sample.name}, in Samples`,
  go: toTrim(fileSamples(project, sample.audioId)[0] ?? sample),
});

const trimJump = (sample: Sample): Jump => ({ label: `sample ${sample.trim}`, title: `${trimName(sample)}, in Samples`, go: toTrim(sample) });

const toPads = (matrix: Matrix, pad: Id | null = null, hit: Id | null = null): Action[] => [
  { type: 'focus', matrix: matrix.id },
  { type: 'select', selection: { matrix: matrix.id, pad, hit }, view: 'pads' },
];

const matrixJump = (matrix: Matrix): Jump => ({ label: middleEllipsis(matrix.name), title: `Matrix ${matrix.name}, in Matrices`, go: toPads(matrix) });

const loopJump = (loop: Loop): Jump => ({
  label: middleEllipsis(loop.name),
  title: `Loop ${loop.name}, in Loops`,
  go: [{ type: 'select', selection: { loop: loop.id, step: null }, view: 'loops' }],
});

/** One jump with its count and an arrow, its name on hover ("1 loop →"); several as a menu ("2 loops ▾"). (Magnus beslut) */
function some(jumps: readonly Jump[], one: string, many: string): Crumb[] {
  if (jumps.length === 0) return [];
  if (jumps.length === 1) return [{ ...jumps[0]!, label: `1 ${one} →` }];
  return [{ label: `${jumps.length} ${many}`, title: jumps.map((j) => j.title).join(', '), items: jumps }];
}

/** The loops with a step on one of the pads, a matrix's own loop first. */
function loopsWith(project: Project, pads: readonly Id[], first: Id | null = null): Loop[] {
  const set = new Set(pads);
  const all = Object.values(project.loops).filter((l) => l.steps.some((s) => s.padId !== null && set.has(s.padId)));
  return [...all.filter((l) => l.id === first), ...all.filter((l) => l.id !== first)];
}

/** The way back to a matrix: its file and trim, when it comes from one. */
const toMatrix = (project: Project, matrix: Matrix): Crumb[] => {
  const sample = matrix.sampleId === null ? undefined : project.samples[matrix.sampleId];
  return sample === undefined ? [] : [fileJump(project, sample), trimJump(sample)];
};

/** The way back to a loop: its matrix with its file and trim, or a menu of its matrices. */
const toLoop = (project: Project, loop: Loop): Crumb[] => {
  const matrices = loopMatrices(project, loop);
  if (matrices.length === 1) return [...toMatrix(project, matrices[0]!), matrixJump(matrices[0]!)];
  return some(matrices.map(matrixJump), 'matrix', 'matrices');
};

/** The matrices with a hit that plays a sample, its own first, and their pads that hold such a hit. */
function sampleMatrices(project: Project, sample: Sample): { matrices: Matrix[]; pads: Id[] } {
  const own = ownMatrix(project, sample.id);
  const plays = (padId: Id) => (project.pads[padId]?.members ?? []).some((h) => project.hits[h]?.sampleId === sample.id);
  const all = Object.values(project.matrices).filter((m) => m.id === own?.id || m.pads.some(plays));
  const matrices = [...all.filter((m) => m.id === own?.id), ...all.filter((m) => m.id !== own?.id)];
  return { matrices, pads: matrices.flatMap((m) => m.pads.filter(plays)) };
}

/**
 * Samples: the file as plain text, the sample, and on to the matrices that
 * play it and their loops: "amen.wav · sample 1 › 1 matrix → · 2 loops ▾ · ♪ Song →". (Magnus beslut)
 */
function samplesTrail(state: AppState, project: Project): Trail {
  const sample = project.samples[state.sliceTarget ?? ''] ?? Object.values(project.samples)[0];
  if (sample === undefined) return EMPTY;
  const own = ownMatrix(project, sample.id);
  const heard = heardInSong(project);
  const { matrices, pads } = sampleMatrices(project, sample);
  const count = (n: number) => `${n} pad${n === 1 ? '' : 's'}`;
  const matrixJumps = matrices.map((m) => ({ ...matrixJump(m), label: `${middleEllipsis(m.name)} · ${count(m.pads.length)}`, title: `Matrix ${m.name} (${count(m.pads.length)}), in Matrices` }));
  return {
    back: [],
    context: { label: middleEllipsis(sample.name), title: sample.name },
    current: { label: `sample ${sample.trim}`, title: trimName(sample) },
    forward: [...some(matrixJumps, 'matrix', 'matrices'), ...some(loopsWith(project, pads, own?.loop ?? null).map(loopJump), 'loop', 'loops')],
    song: [...heard.hits].some((h) => project.hits[h]?.sampleId === sample.id),
  };
}

function padsTrail(state: AppState, project: Project): Trail {
  const matrix = project.matrices[state.focus.matrix ?? ''];
  if (matrix === undefined) return EMPTY;
  const heard = heardInSong(project);
  const pad: Pad | undefined = matrix.pads.includes(state.selection.pad ?? '') ? project.pads[state.selection.pad!] : undefined;
  const hit: Hit | undefined = pad !== undefined && pad.members.includes(state.selection.hit ?? '') ? project.hits[state.selection.hit!] : undefined;
  const back = [...toMatrix(project, matrix)];
  if (pad === undefined) {
    return {
      back,
      current: { label: middleEllipsis(matrix.name), title: `Matrix ${matrix.name}` },
      forward: some(loopsWith(project, matrix.pads, matrix.loop).map(loopJump), 'loop', 'loops'),
      song: heard.matrices.has(matrix.id),
    };
  }
  back.push(matrixJump(matrix));
  const padJump: Jump = { label: padLabel(pad), title: `Pad ${pad.name}, in Matrices`, go: toPads(matrix, pad.id) };
  const loops = some(loopsWith(project, [pad.id]).map(loopJump), 'loop', 'loops');
  if (hit === undefined) return { back, current: { label: padJump.label, title: `Pad ${pad.name}` }, forward: loops, song: heard.pads.has(pad.id) };
  back.push(padJump);
  const sample = project.samples[hit.sampleId];
  // A hit that plays another sample than its matrix's links back to that sample too.
  const plays: Crumb[] = sample !== undefined && sample.id !== matrix.sampleId ? [{ ...trimJump(sample), label: `plays ${middleEllipsis(trimName(sample))}` }] : [];
  return {
    back,
    current: { label: `hit ${pad.members.indexOf(hit.id) + 1}`, title: hit.name },
    forward: [...plays, ...loops],
    song: heard.hits.has(hit.id),
  };
}

function loopsTrail(state: AppState, project: Project): Trail {
  const loop = project.loops[state.selection.loop ?? ''] ?? Object.values(project.loops)[0];
  if (loop === undefined) return EMPTY;
  return { back: toLoop(project, loop), current: { label: middleEllipsis(loop.name), title: `Loop ${loop.name}` }, forward: [], song: heardInSong(project).loops.has(loop.id) };
}

function modsTrail(state: AppState, project: Project): Trail {
  const mod = project.mods[state.selection.mod ?? ''] ?? Object.values(project.mods)[0];
  if (mod === undefined) return EMPTY;
  return { back: [], current: { label: middleEllipsis(mod.name), title: `Mod ${mod.name}` }, forward: [], song: heardInSong(project).mods.has(mod.id) };
}

function songTrail(state: AppState, project: Project): Trail {
  const clip = project.song.clips.find((c) => c.id === (state.selection.clip ?? null));
  const song = { label: 'Song', title: 'The song' };
  if (clip === undefined) return { ...EMPTY, current: song };
  const loop = project.loops[clip.ref];
  if (loop !== undefined) return { ...EMPTY, back: [...toLoop(project, loop), loopJump(loop)], current: song };
  const mod = project.mods[clip.ref];
  if (mod === undefined) return { ...EMPTY, current: song };
  const modJump: Jump = { label: middleEllipsis(mod.name), title: `Mod ${mod.name}, in Mods`, go: [{ type: 'select', selection: { mod: mod.id }, view: 'mods' }] };
  return { ...EMPTY, back: [modJump], current: song };
}

/** The link row for the tab one is on (Project has none). */
export function trail(state: AppState): Trail {
  const project = state.history.present;
  switch (state.view) {
    case 'samples':
      return samplesTrail(state, project);
    case 'pads':
      return padsTrail(state, project);
    case 'loops':
      return loopsTrail(state, project);
    case 'mods':
      return modsTrail(state, project);
    case 'song':
      return songTrail(state, project);
    case 'project':
      return EMPTY;
  }
}
