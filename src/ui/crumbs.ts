import type { Id, Loop, Matrix, Mod, Pad, Project, Sample } from '../model';
import { heardInSong, loopMatrices, ownMatrix, trimName } from '../model';
import { middleEllipsis, padLabel } from './labels';
import type { Action, AppState } from './store';

/** Plain text before a link or the current step: the file before its sample ("amen.wav · sample 1"). Never a link. */
export interface Context {
  readonly label: string;
  readonly title: string;
}

/** A place in the chain the row links to: what it says, the whole name on hover, and where a click takes one. */
export interface Jump {
  readonly label: string;
  readonly title: string;
  readonly go: readonly Action[];
  readonly context?: Context;
}

/** Several places of one kind (2 loops): a slim menu of them. */
export interface JumpMenu {
  readonly label: string;
  readonly title: string;
  readonly items: readonly Jump[];
}

export type Crumb = Jump | JumpMenu;

export const isMenu = (crumb: Crumb): crumb is JumpMenu => 'items' in crumb;

/** The step of the tab one is on: plain text, shown larger, with what is selected under it (pad 02 · hit 1). */
export interface Current {
  readonly label: string;
  readonly title: string;
  readonly context?: Context;
  readonly detail?: string;
}

export type Step = { readonly kind: 'link'; readonly crumb: Crumb } | { readonly kind: 'current'; readonly current: Current };

/**
 * The link row under the tabs (Magnus beslut): the same chain on every tab, in
 * one order, one step per tab: file · sample › matrices › loops › mods ›
 * ♪ Song. The tab one is on is its current step, plain text; every other step
 * that applies links there, with a count, or is a menu when there are several.
 */
export interface Trail {
  readonly steps: readonly Step[];
  /** Heard in the song, and not on Song: "♪ Song →" last. */
  readonly song: boolean;
}

const EMPTY: Trail = { steps: [], song: false };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The file, as plain text before its sample. */
const fileOf = (sample: Sample): Context => ({ label: middleEllipsis(sample.name), title: sample.name });

const sampleJump = (sample: Sample): Jump => ({
  label: `sample ${sample.trim}`,
  title: `${trimName(sample)}, in Samples`,
  context: fileOf(sample),
  go: [
    { type: 'sliceTarget', sampleId: sample.id },
    { type: 'view', view: 'samples' },
  ],
});

const toMatrices = (matrix: Matrix, pad: Id | null = null, hit: Id | null = null): Action[] => [
  { type: 'focus', matrix: matrix.id },
  { type: 'select', selection: { matrix: matrix.id, pad, hit }, view: 'pads' },
];

const matrixJump = (matrix: Matrix): Jump => ({
  label: `${middleEllipsis(matrix.name)} · ${plural(matrix.pads.length, 'pad', 'pads')}`,
  title: `Matrix ${matrix.name} (${plural(matrix.pads.length, 'pad', 'pads')}), in Matrices`,
  go: toMatrices(matrix),
});

const loopJump = (loop: Loop): Jump => ({
  label: middleEllipsis(loop.name),
  title: `Loop ${loop.name}, in Loops`,
  go: [{ type: 'select', selection: { loop: loop.id, step: null }, view: 'loops' }],
});

const modJump = (mod: Mod): Jump => ({ label: middleEllipsis(mod.name), title: `Mod ${mod.name}, in Mods`, go: [{ type: 'select', selection: { mod: mod.id }, view: 'mods' }] });

/** One sample as "file · sample N", a link to it; several as a menu ("3 samples ▾"). The file is never a link. (Magnus beslut) */
function samplesStep(samples: readonly Sample[]): Step[] {
  if (samples.length === 0) return [];
  if (samples.length === 1) return [{ kind: 'link', crumb: sampleJump(samples[0]!) }];
  const items = samples.map((s) => ({ ...sampleJump(s), label: `${middleEllipsis(s.name)} · sample ${s.trim}` }));
  return [{ kind: 'link', crumb: { label: `${samples.length} samples`, title: items.map((i) => i.title).join(', '), items } }];
}

/** One place with its count and an arrow, its name on hover ("1 loop →"); several as a menu ("2 loops ▾"). (Magnus beslut) */
function someStep(jumps: readonly Jump[], one: string, many: string): Step[] {
  if (jumps.length === 0) return [];
  if (jumps.length === 1) return [{ kind: 'link', crumb: { ...jumps[0]!, label: `1 ${one} →` } }];
  return [{ kind: 'link', crumb: { label: `${jumps.length} ${many}`, title: jumps.map((j) => j.title).join(', '), items: jumps } }];
}

const current = (c: Current): Step[] => [{ kind: 'current', current: c }];

/** The samples the hits of some pads play, in the order met. */
function padSamples(project: Project, pads: readonly Id[]): Sample[] {
  const found: Sample[] = [];
  for (const padId of pads)
    for (const hitId of project.pads[padId]?.members ?? []) {
      const sample = project.samples[project.hits[hitId]?.sampleId ?? ''];
      if (sample !== undefined && !found.includes(sample)) found.push(sample);
    }
  return found;
}

/** The loops with a step on one of the pads, a matrix's own loop first. */
function loopsWith(project: Project, pads: readonly Id[], first: Id | null = null): Loop[] {
  const set = new Set(pads);
  const all = Object.values(project.loops).filter((l) => l.steps.some((s) => s.padId !== null && set.has(s.padId)));
  return [...all.filter((l) => l.id === first), ...all.filter((l) => l.id !== first)];
}

/** The matrices with a hit that plays a sample, its own first, and their pads that hold such a hit. */
function sampleMatrices(project: Project, sample: Sample): { matrices: Matrix[]; pads: Id[] } {
  const own = ownMatrix(project, sample.id);
  const plays = (padId: Id) => (project.pads[padId]?.members ?? []).some((h) => project.hits[h]?.sampleId === sample.id);
  const all = Object.values(project.matrices).filter((m) => m.id === own?.id || m.pads.some(plays));
  const matrices = [...all.filter((m) => m.id === own?.id), ...all.filter((m) => m.id !== own?.id)];
  return { matrices, pads: matrices.flatMap((m) => m.pads.filter(plays)) };
}

/** The pads a loop steps on. */
const loopPads = (loop: Loop): Id[] => [...new Set(loop.steps.flatMap((s) => (s.padId === null ? [] : [s.padId])))];

/** A loop's way back: the samples and the matrices it plays. */
const backToLoop = (project: Project, loop: Loop): Step[] => [
  ...samplesStep(padSamples(project, loopPads(loop))),
  ...someStep(loopMatrices(project, loop).map(matrixJump), 'matrix', 'matrices'),
];

function samplesTrail(state: AppState, project: Project): Trail {
  const sample = project.samples[state.sliceTarget ?? ''] ?? Object.values(project.samples)[0];
  if (sample === undefined) return EMPTY;
  const own = ownMatrix(project, sample.id);
  const { matrices, pads } = sampleMatrices(project, sample);
  return {
    steps: [
      ...current({ label: `sample ${sample.trim}`, title: trimName(sample), context: fileOf(sample) }),
      ...someStep(matrices.map(matrixJump), 'matrix', 'matrices'),
      ...someStep(loopsWith(project, pads, own?.loop ?? null).map(loopJump), 'loop', 'loops'),
    ],
    song: [...heardInSong(project).hits].some((h) => project.hits[h]?.sampleId === sample.id),
  };
}

/**
 * Matrices: the matrix in focus is the current step, with the pad and hit
 * selected in it as its detail ("amen 1", then "pad 02 · hit 1"); the samples
 * and loops follow what is selected. (Claudes val.)
 */
function matricesTrail(state: AppState, project: Project): Trail {
  const matrix = project.matrices[state.focus.matrix ?? ''];
  if (matrix === undefined) return EMPTY;
  const heard = heardInSong(project);
  const pad: Pad | undefined = matrix.pads.includes(state.selection.pad ?? '') ? project.pads[state.selection.pad!] : undefined;
  const hitId = pad !== undefined && pad.members.includes(state.selection.hit ?? '') ? state.selection.hit! : undefined;
  const hit = hitId === undefined ? undefined : project.hits[hitId];
  const hitSample = hit === undefined ? undefined : project.samples[hit.sampleId];
  const samples = hit !== undefined ? (hitSample === undefined ? [] : [hitSample]) : padSamples(project, pad === undefined ? matrix.pads : [pad.id]);
  const detail = pad === undefined ? undefined : `pad ${padLabel(pad)}${hit === undefined ? '' : ` · hit ${pad.members.indexOf(hit.id) + 1}`}`;
  const loops = pad === undefined ? loopsWith(project, matrix.pads, matrix.loop) : loopsWith(project, [pad.id]);
  return {
    steps: [
      ...samplesStep(samples),
      ...current({ label: middleEllipsis(matrix.name), title: `Matrix ${matrix.name}`, ...(detail === undefined ? {} : { detail }) }),
      ...someStep(loops.map(loopJump), 'loop', 'loops'),
    ],
    song: hit !== undefined ? heard.hits.has(hit.id) : pad !== undefined ? heard.pads.has(pad.id) : heard.matrices.has(matrix.id),
  };
}

function loopsTrail(state: AppState, project: Project): Trail {
  const loop = project.loops[state.selection.loop ?? ''] ?? Object.values(project.loops)[0];
  if (loop === undefined) return EMPTY;
  return {
    steps: [...backToLoop(project, loop), ...current({ label: middleEllipsis(loop.name), title: `Loop ${loop.name}` })],
    song: heardInSong(project).loops.has(loop.id),
  };
}

/** Mods: the mod alone, and on to ♪ Song; mods have nothing to do with samples, matrices or loops. (Magnus beslut) */
function modsTrail(state: AppState, project: Project): Trail {
  const mod = project.mods[state.selection.mod ?? ''] ?? Object.values(project.mods)[0];
  if (mod === undefined) return EMPTY;
  return { steps: current({ label: middleEllipsis(mod.name), title: `Mod ${mod.name}` }), song: heardInSong(project).mods.has(mod.id) };
}

/** Song: the song, back through the selected clip's loop (with its matrices and samples) or mod. */
function songTrail(state: AppState, project: Project): Trail {
  const clip = project.song.clips.find((c) => c.id === (state.selection.clip ?? null));
  const song = current({ label: 'Song', title: 'The song' });
  const loop = clip === undefined ? undefined : project.loops[clip.ref];
  const mod = clip === undefined ? undefined : project.mods[clip.ref];
  if (loop !== undefined) return { steps: [...backToLoop(project, loop), ...someStep([loopJump(loop)], 'loop', 'loops'), ...song], song: false };
  // A mod clip: just the mod, by name, before the song. (Magnus beslut)
  if (mod !== undefined) return { steps: [{ kind: 'link', crumb: { ...modJump(mod), label: `${middleEllipsis(mod.name)} →` } }, ...song], song: false };
  return { steps: song, song: false };
}

/** The link row for the tab one is on (Project has none). */
export function trail(state: AppState): Trail {
  const project = state.history.present;
  switch (state.view) {
    case 'samples':
      return samplesTrail(state, project);
    case 'pads':
      return matricesTrail(state, project);
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

