import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Command, Config, Hit, HitDelay, HitDist, HitFilter, HitReverb, HitStretch, Id, Matrix, Pad, Project, StretchMode } from '../model';
import {
  DEFAULT_GRAIN,
  MAX_CUTOFF,
  MAX_FEEDBACK,
  MAX_GRAIN,
  MIN_CUTOFF,
  MIN_GRAIN,
  PAD_CHOICES,
  addPad,
  addVariant,
  baseName,
  clampStretch,
  cloneMatrix,
  copyHits,
  copyMatrix,
  copyPad,
  createMatrix,
  hitStretch,
  matrixKind,
  matrixOfPad,
  movePadMember,
  padOfHit,
  removePadMember,
  renameMatrix,
  renamePad,
  sampleAudio,
  sampleBpm,
  setHitSource,
  setMatrixConfig,
  setPadChoice,
  setPadConfig,
  sliceWindow,
  trimName,
  updateHit,
} from '../model';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import type { Selection } from './store';
import { MatrixOrigin } from './MatrixOrigin';
import { DeleteMatrix } from './DeleteMatrix';
import { Delete } from './DeleteButton';
import { HIT_MIME, MATRIX_MIME, PAD_MIME, useDropTargets } from './dnd';
import { InSong, InSongMark, useHeard } from './InSong';
import { PlayControls } from './PlayControls';
import { RegionHandle } from './RegionHandle';
import { MatrixKindIcon, PlayIcon } from './icons';
import { CHOICE_LABEL, DELAY_TIMES, DIST_MODES, FILTER_TYPES, padGroups, padLabel, padSilent, replacedBy, sizeText } from './labels';
import { Slider } from './Slider';
import { Waveform } from './Waveform';

/** A stretch factor as it reads: 2×, 0.5×, 1.33×. */
const formatFactor = (f: number) => `${Math.round(f * 100) / 100}×`;
/** A pan as it reads: L 50, C, R 100. */
const panText = (pan: number) => (Math.round(pan * 100) === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'} ${Math.abs(Math.round(pan * 100))}`);
/** A frequency as it reads: 200 Hz, 2.5 kHz. */
const formatHz = (hz: number) => (hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${Math.round(hz)} Hz`);

const ms = (seconds: number) => Math.round(seconds * 1000);
const signed = (v: number, unit: string) => `${v > 0 ? '+' : ''}${v} ${unit}`;
const number = (i: number) => String(i + 1).padStart(2, '0');

/** The pad open in Hits: the selected one, else the one the selected hit is in, else the first. */
function currentPad(project: Project, padId: Id | null, hitId: Id | null): Pad | undefined {
  const selected = padId === null ? undefined : project.pads[padId];
  if (selected !== undefined) return selected;
  const pads = Object.values(project.pads);
  return (
    (hitId === null ? undefined : pads.find((p) => p.members.includes(hitId))) ??
    padGroups(project)[0]?.items[0] ??
    project.pads[Object.values(project.matrices)[0]?.pads[0] ?? '']
  );
}

/**
 * What is open in Hits. A matrix is edited on its own, with no pad, when it is
 * selected and no pad or hit is. Otherwise the open pad, and the hit picked in
 * it; with none picked, Play plays the pad's choice and its first hit is the
 * one edited.
 */
export function hitsOpen(
  project: Project,
  selection: Pick<Selection, 'pad' | 'hit' | 'matrix'>,
): { matrix: Matrix | undefined; pad: Pad | undefined; hit: Hit | undefined; picked: boolean } {
  const matrix = selection.matrix === null ? undefined : project.matrices[selection.matrix];
  if (matrix !== undefined && selection.pad === null && selection.hit === null) return { matrix, pad: undefined, hit: undefined, picked: false };
  const selectedHit = selection.hit === null ? undefined : project.hits[selection.hit];
  const pad = currentPad(project, selection.pad, selection.hit);
  const picked = selectedHit !== undefined && pad?.members.includes(selectedHit.id) === true;
  return { matrix: undefined, pad, hit: picked ? selectedHit : project.hits[pad?.members[0] ?? ''], picked };
}

/** A hit copied into a matrix: a new pad last in it, with a copy of the hit (decision 8). One undo step. */
const copyHitAsPad =
  (hitId: Id, matrixId: Id): Command =>
  (project, ctx) => {
    const added = addPad(matrixId)(project, ctx);
    if (!added.ok) return added;
    const padId = added.project.matrices[matrixId]?.pads.at(-1);
    return padId === undefined ? added : copyHits([hitId], padId)(added.project, ctx);
  };

/** What a drop of a hit, pad or matrix onto a pad does: copies of its hits, last in the pad. null for a drop on itself. */
function dropOnPad(project: Project, padId: Id, type: string, id: Id): Command | null {
  const pad = project.pads[padId];
  if (pad === undefined) return null;
  if (type === HIT_MIME) return pad.members.includes(id) ? null : copyHits([id], padId);
  if (type === PAD_MIME) return id === padId ? null : copyHits(project.pads[id]?.members ?? [], padId);
  if (type === MATRIX_MIME) return copyMatrix(id, { padId });
  return null;
}

/** What a drop onto a matrix does: a hit as a new pad, a pad as a copy of it, a matrix as copies of its pads. null for a drop on itself. */
function dropOnMatrix(matrixId: Id, type: string, id: Id): Command | null {
  if (type === HIT_MIME) return copyHitAsPad(id, matrixId);
  if (type === PAD_MIME) return copyPad(id, matrixId);
  if (type === MATRIX_MIME) return id === matrixId ? null : copyMatrix(id, { matrixId });
  return null;
}

const DRAGGED = [HIT_MIME, PAD_MIME, MATRIX_MIME] as const;
const draggedId = (e: DragEvent, type: string) => e.dataTransfer.getData(type);
/** Starts a drag of a hit, pad or matrix, which makes copies wherever it is dropped. */
const dragStart = (type: string, id: Id) => (e: DragEvent) => {
  e.dataTransfer.setData(type, id);
  e.dataTransfer.effectAllowed = 'copy';
};

/** A layer of config being edited: a hit's own, a pad's or a matrix's. */
interface Layer {
  readonly config: Config;
  readonly set: (patch: Partial<Config>, field: string) => void;
  /** The layers laid over it, nearest first: for a hit its pad and matrix, for a pad its matrix. */
  readonly above: readonly { readonly name: 'pad' | 'matrix'; readonly config: Config }[];
  /** Whether Fit to tempo can be chosen: something under it has a tempo. */
  readonly canFit: boolean;
  /** How it is stretched as it plays: a hit with every layer, a pad or matrix by its own. */
  readonly played: { readonly factor: number; readonly grain: number };
}

/** The main Play while it plays what Hits shows: where it is in the take, and how long the take is. */
export interface HitsPlay {
  readonly playing: boolean;
  readonly onToggle: () => void;
  /** The key of what plays (see subjectOf), with seconds into its take and the take's length. */
  readonly played: { readonly key: string; readonly seconds: number; readonly duration: number } | null;
}

/**
 * Matrices, their pads and the hits in each, in one place. On the left each
 * matrix with a break or one-shot icon and its pads in order. On the right the
 * open matrix with its config, or the open pad's hits, its sound and the hit
 * being edited. Anything dragged onto a pad or matrix is copied there.
 */
export function HitsView({ transport }: { readonly transport: HitsPlay }) {
  const project = useProject();
  const { services, store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [padSound, setPadSound] = useState(false);
  const drops = useDropTargets();

  const { matrix: matrixOpen, pad, hit, picked } = hitsOpen(project, selection);
  const heard = useHeard();
  const hitsLoop = useSelect((s) => s.hitsLoop);
  const unfolded = useSelect((s) => s.unfolded);
  const isFolded = (id: Id) => !unfolded.includes(id);
  const playsText =
    matrixOpen !== undefined
      ? `${matrixOpen.name} as laid out, pad after pad`
      : picked
        ? (hit?.name ?? '')
        : pad === undefined
          ? 'nothing'
          : `pad ${pad.name}, as it picks (${CHOICE_LABEL[pad.choice]})`;
  /** Once/Loop and ▶, next to what the main Play plays here: the matrix, the pad, or the hit picked in it. */
  const playControls = (what: string) => (
    <PlayControls
      what={what}
      playing={transport.playing}
      onToggle={transport.onToggle}
      loop={hitsLoop}
      onLoop={(loop) => store.dispatch({ type: 'hitsLoop', loop })}
      title={`Plays ${playsText} · Space plays and stops`}
    />
  );
  const matrices = Object.values(project.matrices);
  const [replacing, setReplacing] = useState(false);
  const wave = useRef<HTMLDivElement>(null);

  /** Runs a command that adds one object to `key` and opens it. */
  const runAndOpen = <K extends 'matrices' | 'pads' | 'hits'>(command: Command, key: K, then: (id: Id) => void) => {
    const before = store.getState().history.present[key];
    const failed = run(command);
    setError(failed);
    if (failed !== null) return;
    const id = Object.keys(store.getState().history.present[key]).find((k) => !(k in before));
    if (id !== undefined) then(id);
  };

  const newMatrix = () => {
    const names = new Set(matrices.map((m) => m.name));
    let n = matrices.length + 1;
    while (names.has(`Matrix ${n}`)) n += 1;
    runAndOpen(createMatrix(`Matrix ${n}`), 'matrices', (id) => {
      store.dispatch({ type: 'fold', matrixIds: [id], folded: false });
      open({ matrix: id, pad: null, hit: null }, 'hits');
    });
  };

  const drop = (command: Command | null) => {
    if (command !== null) setError(run(command));
  };

  /** Pads a loop plays: a silent pad shows only while one does. */
  const inLoops = new Set(Object.values(project.loops).flatMap((l) => l.steps.flatMap((s) => (s.padId === null ? [] : [s.padId]))));
  /** The matrices that fold: breaks. A one-shot's one pad always shows. */
  const foldable = matrices.filter((m) => matrixKind(m) === 'break').map((m) => m.id);
  const allOpen = foldable.every((id) => !isFolded(id));
  const sidebar = (
    <aside className="sidebar" aria-label="Matrices and pads">
      <div className="row spread">
        <h2 className="label">Matrices</h2>
        {foldable.length > 0 && (
          <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'fold', matrixIds: foldable, folded: allOpen })}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <button type="button" className="dashed" onClick={newMatrix}>
        + New matrix
      </button>
      {matrices.map((m) => {
        const kind = matrixKind(m);
        const folded = kind === 'break' && isFolded(m.id);
        return (
          <section key={m.id} className="stack-tight">
            <div className={`row nowrap fold-head${drops.isOver(`matrix:${m.id}`) ? ' drop-over' : ''}`} {...drops.bind(`matrix:${m.id}`, DRAGGED, (e, type) => drop(dropOnMatrix(m.id, type, draggedId(e, type))))}>
              {kind === 'break' && (
                <button
                  type="button"
                  className="icon-button small fold"
                  aria-expanded={!folded}
                  aria-label={`${folded ? 'Show' : 'Hide'} the pads of ${m.name}`}
                  onClick={() => store.dispatch({ type: 'fold', matrixIds: [m.id], folded: !folded })}
                >
                  {folded ? '▸' : '▾'}
                </button>
              )}
              <button
                type="button"
                className="list-item matrix-head grow"
                aria-label={`Matrix ${m.name}`}
                aria-current={matrixOpen?.id === m.id ? 'true' : undefined}
                title="The matrix: its config applies to every pad · drag onto a pad or matrix to copy it there"
                draggable
                onDragStart={dragStart(MATRIX_MIME, m.id)}
                onClick={() => open({ matrix: m.id, pad: null, hit: null }, 'hits')}
              >
                <MatrixKindIcon kind={kind} />
                <span className="label grow ellipsis">{m.name}</span>
                <InSongMark heard={heard.matrices.has(m.id)} />
              </button>
            </div>
            {!folded &&
              m.pads.map((padId) => {
                const p = project.pads[padId];
                if (p === undefined) return null;
                const silent = padSilent(project, p);
                if (silent && !inLoops.has(p.id)) return null;
                return (
                  <div
                    key={p.id}
                    className={`pad-row${p.id === pad?.id ? ' current' : ''}${silent ? ' silent' : ''}${drops.isOver(`pad:${p.id}`) ? ' drop-over' : ''}`}
                    title={silent ? 'Silent: its sample has fewer slices than this pad plays' : undefined}
                    {...drops.bind(`pad:${p.id}`, DRAGGED, (e, type) => drop(dropOnPad(project, p.id, type, draggedId(e, type))))}
                  >
                    <button
                      type="button"
                      className="pad-row-name mono"
                      aria-label={`Pad ${p.name}`}
                      title="Drag onto a pad or matrix to copy it there"
                      draggable
                      onDragStart={dragStart(PAD_MIME, p.id)}
                      onClick={() => open({ pad: p.id, hit: null }, 'hits')}
                    >
                      {padLabel(p)}
                      <InSongMark heard={heard.pads.has(p.id)} />
                    </button>
                    {p.members.map((id, i) => {
                      const h = project.hits[id];
                      const by = h === undefined ? null : replacedBy(project, p.id, h);
                      return h === undefined ? null : (
                        <button
                          key={id}
                          type="button"
                          className={`hit-chip mono${i === 0 ? ' first' : ''}${by !== null ? ' replaced' : ''}${p.id === pad?.id && picked && id === hit?.id ? ' current' : ''}`}
                          title={`${h.name}${by !== null ? ` · plays ${by} instead` : ''}${i === 0 && p.choice === 'top' ? ' · plays by default' : ''} · drag onto a pad or matrix to copy it there`}
                          draggable
                          onDragStart={dragStart(HIT_MIME, id)}
                          onClick={() => open({ pad: p.id, hit: id }, 'hits')}
                        >
                          {baseName(h.name).replace(/^.*\s(\d{2,})$/, '$1')}
                          {by !== null && `→${by}`}
                          {h.direction === 'reverse' ? ' ◂' : ''}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
          </section>
        );
      })}
    </aside>
  );

  if (matrixOpen === undefined && hit === undefined && pad === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Hits</h1>
            <p className="muted">No hits yet. Every imported sample gets a matrix with one, or make a matrix and drag hits into it.</p>
            <div className="row nav-row">
              <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'import' })}>
                ← Import
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {matrixOpen !== undefined && matrixEditor(matrixOpen)}
        {pad !== undefined && padPanel(pad, hit?.id ?? null)}
        {hit !== undefined && hitEditor(hit)}
        {hit === undefined && pad !== undefined && <p className="muted">This pad has no hits yet. Add one above.</p>}
      </main>
    </div>
  );

  /** Whether any hit under these pads plays a sample with a tempo, so it can fit to the song's. */
  function anyTempo(padIds: readonly Id[]): boolean {
    return padIds.some((p) =>
      (project.pads[p]?.members ?? []).some((h) => {
        const sample = project.samples[project.hits[h]?.sampleId ?? ''];
        return sample !== undefined && sampleBpm(sample) !== null;
      }),
    );
  }

  /** How a pad's or matrix's own config stretches, with the grain from the nearest layer that has one. */
  function ownStretch(config: Config, above: Layer['above']) {
    return {
      factor: config.stretch.mode === 'factor' ? clampStretch(config.stretch.factor) : 1,
      grain: config.stretch.grain ?? above.find((a) => a.config.stretch.grain !== null)?.config.stretch.grain ?? DEFAULT_GRAIN,
    };
  }

  /**
   * The open pad: its name, its hits in order (the first plays by default),
   * adding more as copies, and its sound, laid over all its hits. A plain
   * function, not a component, so its inputs keep focus.
   */
  function padPanel(pad: Pad, hitId: Id | null) {
    const onError = setError;
    const query = search.trim().toLowerCase();
    const available = Object.values(project.hits).filter((h) => !pad.members.includes(h.id) && (query === '' || h.name.toLowerCase().includes(query)));
    const move = (id: Id, to: number) => onError(run(movePadMember(pad.id, id, to)));
    const add = (id: Id) => onError(run(copyHits([id], pad.id)));
    const matrix = matrixOfPad(project, pad.id);
    const above = matrix === undefined ? [] : [{ name: 'matrix' as const, config: matrix.config }];
    const layer: Layer = {
      config: pad.config,
      set: (patch, field) => onError(run(setPadConfig(pad.id, patch), `pad:${pad.id}:${field}`)),
      above,
      canFit: anyTempo([pad.id]),
      played: ownStretch(pad.config, above),
    };
    return (
      <section className="panel stack" aria-label="Pad">
        <div className="row">
          <label className="sr-only" htmlFor="pad-name">
            Pad name
          </label>
          <input
            id="pad-name"
            className="title-input mono"
            value={pad.name}
            onChange={(e) => onError(run(renamePad(pad.id, e.target.value), `pad:${pad.id}:name`))}
            onBlur={seal}
          />
          <InSong heard={heard.pads.has(pad.id)} />
          <div className="row push">
            {!picked && pad.members.length > 0 && playControls('pad')}
            {matrix !== undefined && (
              <button type="button" title={`An empty pad last in ${matrix.name}`} onClick={() => runAndOpen(addPad(matrix.id), 'pads', (id) => open({ pad: id, hit: null }, 'hits'))}>
                + Pad
              </button>
            )}
            <Delete kind="pad" id={pad.id} name={pad.name} onError={onError} onDeleted={() => open({ pad: null, hit: null, matrix: matrix?.id ?? null }, 'hits')} />
          </div>
        </div>
        {matrix !== undefined && (
          <p className="muted small">
            Row {number(matrix.pads.indexOf(pad.id))} of <MatrixOrigin matrix={matrix} parts={['matrix']} />
          </p>
        )}

        <div className="row">
          <span className="label">Pad plays</span>
          <div className="segmented" role="group" aria-label="Pad plays">
            {PAD_CHOICES.map((c) => (
              <button key={c} type="button" aria-pressed={pad.choice === c} onClick={() => onError(run(setPadChoice(pad.id, c)))}>
                {CHOICE_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <ol
          className={`members${drops.isOver(`members:${pad.id}`) ? ' drop-over' : ''}`}
          aria-label="Hits in this pad"
          {...drops.bind(`members:${pad.id}`, DRAGGED, (e, type) => drop(dropOnPad(project, pad.id, type, draggedId(e, type))))}
        >
          {pad.members.map((id, i) => {
            const h = project.hits[id];
            if (h === undefined) return null;
            return (
              <li
                key={id}
                className={`member${i === 0 ? ' first' : ''}${id === hitId ? ' current' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(HIT_MIME, id)}
                onDrop={(e) => {
                  const dragged = e.dataTransfer.getData(HIT_MIME);
                  if (dragged === '' || !pad.members.includes(dragged)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  drops.clear();
                  move(dragged, i);
                }}
              >
                <span className="member-num mono">{i + 1}</span>
                <button type="button" className="link-text mono grow ellipsis" aria-current={id === hitId ? 'true' : undefined} onClick={() => open({ pad: pad.id, hit: id }, 'hits')}>
                  {baseName(h.name)}
                </button>
                <span className="muted small">{i === 0 && pad.choice === 'top' ? 'default' : ''}</span>
                <button type="button" className="icon-button small" aria-label={`Play ${h.name}`} onClick={() => services.player.playHit(project, id)}>
                  <PlayIcon />
                </button>
                <button type="button" className="icon-button small" aria-label={`Move ${h.name} up`} disabled={i === 0} onClick={() => move(id, i - 1)}>
                  ↑
                </button>
                <button type="button" className="icon-button small" aria-label={`Move ${h.name} down`} disabled={i === pad.members.length - 1} onClick={() => move(id, i + 1)}>
                  ↓
                </button>
                <button type="button" className="icon-button small" aria-label={`Delete ${h.name}`} title={`Delete ${h.name}`} onClick={() => onError(run(removePadMember(pad.id, id)))}>
                  ×
                </button>
              </li>
            );
          })}
        </ol>

        <details className="add-hits">
          <summary>+ Hit · or drag a hit, pad or matrix from the left onto the list: it is copied here</summary>
          <input type="search" placeholder="Search hits" aria-label="Search hits" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="add-list">
            {available.slice(0, 200).map((h) => (
              <div key={h.id} className="add-row">
                <span className="mono grow ellipsis">{baseName(h.name)}</span>
                <button type="button" aria-label={`Add ${h.name} to pad`} onClick={() => add(h.id)}>
                  Add
                </button>
              </div>
            ))}
            {available.length === 0 && <p className="muted small">No hits to add.</p>}
          </div>
        </details>

        <div className="stack-tight">
          <button type="button" className="link-text small" aria-expanded={padSound} onClick={() => setPadSound(!padSound)}>
            {padSound ? '▾' : '▸'} Pad sound
          </button>
          {padSound && (
            <div className="stack" role="group" aria-label="Pad sound">
              <p className="muted small">Laid over every hit of the pad: pitch, volume and pan add, the rest applies where a hit has none of its own.</p>
              {configPanels(layer)}
            </div>
          )}
        </div>

        <p className="muted small">A step lock goes first, then a mod, then the pad's own choice.</p>
      </section>
    );
  }

  /** The open matrix: its name, where it comes from, its sample with the slice lines, and its config over every pad. */
  function matrixEditor(matrix: Matrix) {
    const onError = setError;
    const sample = matrix.sampleId === null ? undefined : project.samples[matrix.sampleId];
    const audio = sample === undefined ? undefined : sampleAudio(project, sample);
    const played = transport.played;
    const through = played === null || played.duration <= 0 || !played.key.startsWith(`matrix:${matrix.id}:`) ? null : Math.min(1, Math.max(0, played.seconds / played.duration));
    const layer: Layer = {
      config: matrix.config,
      set: (patch, field) => onError(run(setMatrixConfig(matrix.id, patch), `matrix:${matrix.id}:${field}`)),
      above: [],
      canFit: anyTempo(matrix.pads),
      played: ownStretch(matrix.config, []),
    };
    return (
      <section className="stack" aria-label="Matrix">
        <div className="view-head row">
          <div className="stack-tight grow">
            <label className="sr-only" htmlFor="matrix-name">
              Matrix name
            </label>
            <input
              id="matrix-name"
              className="title-input mono"
              value={matrix.name}
              onChange={(e) => onError(run(renameMatrix(matrix.id, e.target.value), `matrix:${matrix.id}:name`))}
              onBlur={seal}
            />
            <div className="row nav-row">
              <MatrixOrigin matrix={matrix} parts={['trim', 'slice', 'file']} />
              <InSong heard={heard.matrices.has(matrix.id)} />
            </div>
            <p className="muted">
              <MatrixKindIcon kind={matrixKind(matrix)} /> {matrix.pads.length} pad{matrix.pads.length === 1 ? '' : 's'}, played in order · its config applies to every pad
            </p>
          </div>
          <div className="row push">
            {playControls('matrix')}
            <button type="button" title="An empty pad last in the matrix" onClick={() => runAndOpen(addPad(matrix.id), 'pads', (id) => open({ pad: id, hit: null }, 'hits'))}>
              + Pad
            </button>
            <button
              type="button"
              title="A copy of the whole matrix, with its own pads and hits, to change apart from this one"
              onClick={() => runAndOpen(cloneMatrix(matrix.id), 'matrices', (id) => open({ matrix: id, pad: null, hit: null }, 'hits'))}
            >
              Clone matrix
            </button>
            <DeleteMatrix matrix={matrix} onError={onError} onDeleted={() => open({ matrix: null, pad: null, hit: null }, 'hits')} />
          </div>
        </div>

        {audio !== undefined && sample !== undefined && sample.duration > 0 && (
          <div className="panel wave-panel">
            <div className="wave-region">
              <Waveform audio={audio} offset={sample.offset} duration={sample.duration} height={180} />
              {through !== null && <div className="playhead" style={{ left: `${through * 100}%` }} />}
              {/* Where its sample's slices are; a double-click edits one in Slice, where markers are moved. */}
              {sample.bars !== null &&
                sample.markers.map((m, i) => {
                  const toSlice = () => {
                    store.dispatch({ type: 'sliceTarget', sampleId: sample.id, slice: i });
                    store.dispatch({ type: 'view', view: 'slice' });
                  };
                  return (
                    <button
                      key={i}
                      type="button"
                      className="slice-line"
                      style={{ left: `${m * 100}%` }}
                      aria-label={`Slice ${number(i)}: double-click to edit in Slice`}
                      title="Double-click to edit in Slice"
                      onDoubleClick={toSlice}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') toSlice();
                      }}
                    >
                      <span>{number(i)}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {configPanels(layer)}
      </section>
    );
  }

  /**
   * Which sample and slice a hit plays: any sample, a slice of it or the whole
   * of it. Its own config and region stay.
   */
  function replacePanel(hit: Hit) {
    const samples = Object.values(project.samples);
    const sample = project.samples[hit.sampleId];
    const slices = sample === undefined || sample.bars === null ? 0 : Math.max(sample.markers.length, (hit.slice ?? -1) + 1);
    return (
      <section className="panel row" aria-label="Replace">
        <span className="muted">Plays</span>
        <select
          aria-label="Sample the hit plays"
          value={hit.sampleId}
          onChange={(e) => {
            const next = project.samples[e.target.value];
            if (next !== undefined) setError(run(setHitSource(hit.id, next.id, next.bars === null ? null : Math.min(hit.slice ?? 0, next.markers.length - 1))));
          }}
        >
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.bars === null ? `${trimName(s)} (one-shot)` : trimName(s)}
            </option>
          ))}
        </select>
        {sample !== undefined && sample.bars !== null && (
          <select
            aria-label="Slice the hit plays"
            value={hit.slice === null ? 'whole' : String(hit.slice)}
            onChange={(e) => setError(run(setHitSource(hit.id, sample.id, e.target.value === 'whole' ? null : Number(e.target.value))))}
          >
            {Array.from({ length: slices }, (_, i) => (
              <option key={i} value={i}>
                Slice {number(i)}
                {i >= sample.markers.length ? ' (silent)' : ''}
              </option>
            ))}
            <option value="whole">The whole sample</option>
          </select>
        )}
        <span className="muted small">Its own settings and region stay.</span>
      </section>
    );
  }

  /** The nearest layer above with something for `has`, and its name: "pad", "matrix". */
  function nearestAbove(layer: Layer, has: (c: Config) => boolean) {
    return layer.above.find((a) => has(a.config));
  }

  /** Direction, pitch, volume, pan and fade, then stretch, colour and space: the same for a hit, a pad and a matrix. */
  function configPanels(layer: Layer) {
    const { config, set } = layer;
    /** Its own value, and what it plays at with the layers above added. */
    const withAbove = (own: number, field: 'pitch' | 'volume', unit: string) => {
      const added = layer.above.reduce((sum, a) => sum + a.config[field], 0);
      return added === 0 ? signed(own, unit) : `${signed(own, unit)} · plays ${signed(own + added, unit)}`;
    };
    const panAbove = layer.above.reduce((sum, a) => sum + a.config.pan, 0);
    return (
      <>
        <div className="slider-grid">
          <div className="panel stack-tight">
            <span className="label">Direction</span>
            <div className="segmented full" role="group" aria-label="Direction">
              <button type="button" aria-pressed={config.direction === 'forward'} onClick={() => set({ direction: 'forward' }, 'direction')}>
                Forward
              </button>
              <button type="button" aria-pressed={config.direction === 'reverse'} onClick={() => set({ direction: 'reverse' }, 'direction')}>
                Reverse
              </button>
            </div>
          </div>
          <Slider label="Pitch" value={config.pitch} min={-24} max={24} step={1} format={(v) => withAbove(v, 'pitch', 'st')} onChange={(v) => set({ pitch: v }, 'pitch')} onCommit={seal} />
          <Slider label="Volume" value={config.volume} min={-24} max={6} step={0.5} format={(v) => withAbove(v, 'volume', 'dB')} onChange={(v) => set({ volume: v }, 'volume')} onCommit={seal} />
          <Slider
            label="Pan"
            value={Math.round(config.pan * 100)}
            min={-100}
            max={100}
            step={1}
            format={(v) => panText(v / 100) + (panAbove !== 0 ? ` · above ${panText(panAbove)}` : '')}
            onChange={(v) => set({ pan: v / 100 }, 'pan')}
            onCommit={seal}
          />
          <Slider label="Fade out" value={config.fadeOut} min={0} max={200} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ fadeOut: v }, 'fade')} onCommit={seal} />
        </div>
        {stretchPanel(layer)}
        {colourPanel(layer)}
        {spacePanel(layer)}
      </>
    );
  }

  /**
   * Stretch: Off, Fit to tempo or a factor, the grain length and where the
   * grains start. Without a grain length or grid of its own a layer takes the
   * nearest above's, and the factors of all layers multiply.
   */
  function stretchPanel(layer: Layer) {
    const stretch = layer.config.stretch;
    const set = (patch: Partial<HitStretch>, field: string) => layer.set({ stretch: { ...stretch, ...patch } }, `stretch:${field}`);
    const modes: [StretchMode, string][] = [
      ['off', 'Off'],
      ['fit', 'Fit to tempo'],
      ['factor', 'Factor'],
    ];
    const grainFrom = nearestAbove(layer, (c) => c.stretch.grain !== null)?.name ?? 'default';
    const hasAbove = layer.above.length > 0;
    return (
      <div className="panel stack-tight" aria-label="Stretch" role="group">
        <div className="row spread">
          <span className="label">Stretch</span>
          <span className="muted small mono">{layer.played.factor === 1 ? 'plays as it is' : `plays ${formatFactor(layer.played.factor)}${hasAbove ? ' with the layers above' : ''}`}</span>
        </div>
        <div className="segmented full" role="group" aria-label="Stretch mode">
          {modes.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={stretch.mode === mode}
              disabled={mode === 'fit' && !layer.canFit}
              title={mode === 'fit' && !layer.canFit ? 'A sample that is not sliced has no tempo to fit' : undefined}
              onClick={() => set({ mode }, 'mode')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="slider-grid">
          {stretch.mode === 'factor' && (
            <Slider
              label="Factor"
              value={Math.log2(stretch.factor)}
              min={-4}
              max={4}
              step={1 / 12}
              format={(v) => formatFactor(2 ** v)}
              onChange={(v) => set({ factor: 2 ** v }, 'factor')}
              onCommit={seal}
            />
          )}
          <Slider
            label="Grain"
            value={stretch.grain ?? layer.played.grain}
            min={MIN_GRAIN}
            max={MAX_GRAIN}
            step={1}
            format={(v) => `${v} ms${stretch.grain === null ? ` (${grainFrom})` : ''}`}
            onChange={(v) => set({ grain: v }, 'grain')}
            onCommit={seal}
          />
        </div>
        <div className="row">
          <span className="label">Grains from</span>
          <div className="segmented" role="group" aria-label="Grains from">
            {hasAbove && (
              <button type="button" aria-pressed={stretch.from === null} title="As the pad or matrix has it" onClick={() => set({ from: null }, 'from')}>
                Inherit
              </button>
            )}
            {(['sample', 'hit'] as const).map((from) => (
              <button
                key={from}
                type="button"
                aria-pressed={stretch.from === from || (!hasAbove && stretch.from === null && from === 'sample')}
                title={from === 'sample' ? 'A grid from the start of the sample, like a sampler stretching the whole sample' : 'Grains start with the hit, for clean attacks'}
                onClick={() => set({ from }, 'from')}
              >
                {from === 'sample' ? 'Sample' : 'Hit'}
              </button>
            ))}
          </div>
          {stretch.grain !== null && (
            <button type="button" className="link-text small push" onClick={() => set({ grain: null }, 'grain')}>
              Grain from {hasAbove ? 'above' : 'default'}
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * Dist, then filter. Off takes the nearest layer above's, which is shown
   * beside it; dist keeps the level as it was.
   */
  function colourPanel(layer: Layer) {
    const { config } = layer;
    const setDist = (patch: Partial<HitDist>, field: string) => layer.set({ dist: { ...config.dist, ...patch } }, `dist:${field}`);
    const setFilter = (patch: Partial<HitFilter>, field: string) => layer.set({ filter: { ...config.filter, ...patch } }, `filter:${field}`);
    const fromAbove = (on: boolean, what: string) => (layer.above.length > 0 && !on ? <span className="muted small">{what}</span> : null);
    const dist = nearestAbove(layer, (c) => c.dist.mode !== 'off');
    const filter = nearestAbove(layer, (c) => c.filter.type !== 'off');
    const distText = dist === undefined ? 'above: none' : `${dist.name}: ${DIST_MODES.find(([m]) => m === dist.config.dist.mode)?.[1]} ${Math.round(dist.config.dist.amount * 100)}%`;
    const filterText = filter === undefined ? 'above: none' : `${filter.name}: ${FILTER_TYPES.find(([t]) => t === filter.config.filter.type)?.[1]} ${formatHz(filter.config.filter.cutoff)}`;
    return (
      <div className="slider-grid">
        <div className="panel stack-tight" role="group" aria-label="Dist">
          <div className="row spread">
            <span className="label">Dist</span>
            {fromAbove(config.dist.mode !== 'off', distText)}
          </div>
          <div className="segmented full" role="group" aria-label="Dist mode">
            <button type="button" aria-pressed={config.dist.mode === 'off'} onClick={() => setDist({ mode: 'off' }, 'mode')}>
              Off
            </button>
            {DIST_MODES.map(([mode, label]) => (
              <button key={mode} type="button" aria-pressed={config.dist.mode === mode} onClick={() => setDist({ mode }, 'mode')}>
                {label}
              </button>
            ))}
          </div>
          {config.dist.mode !== 'off' && (
            <Slider label="Amount" value={config.dist.amount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setDist({ amount: v }, 'amount')} onCommit={seal} />
          )}
        </div>
        <div className="panel stack-tight" role="group" aria-label="Filter">
          <div className="row spread">
            <span className="label">Filter</span>
            {fromAbove(config.filter.type !== 'off', filterText)}
          </div>
          <div className="segmented full" role="group" aria-label="Filter type">
            <button type="button" aria-pressed={config.filter.type === 'off'} onClick={() => setFilter({ type: 'off' }, 'type')}>
              Off
            </button>
            {FILTER_TYPES.map(([type, label]) => (
              <button key={type} type="button" aria-pressed={config.filter.type === type} onClick={() => setFilter({ type }, 'type')}>
                {label}
              </button>
            ))}
          </div>
          {config.filter.type !== 'off' && (
            <>
              <Slider
                label="Cutoff"
                value={Math.log10(config.filter.cutoff)}
                min={Math.log10(MIN_CUTOFF)}
                max={Math.log10(MAX_CUTOFF)}
                step={0.01}
                format={(v) => formatHz(10 ** v)}
                onChange={(v) => setFilter({ cutoff: Math.round(10 ** v) }, 'cutoff')}
                onCommit={seal}
              />
              <Slider label="Resonance" value={config.filter.resonance} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ resonance: v }, 'resonance')} onCommit={seal} />
            </>
          )}
        </div>
      </div>
    );
  }

  /**
   * Reverb and delay: how much is sent to them, and their settings. They ring
   * out beside the hits, so the next hit does not cut them. An amount of 0
   * takes the nearest layer above's, which is shown beside it.
   */
  function spacePanel(layer: Layer) {
    const { config } = layer;
    const setReverb = (patch: Partial<HitReverb>, field: string) => layer.set({ reverb: { ...config.reverb, ...patch } }, `reverb:${field}`);
    const setDelay = (patch: Partial<HitDelay>, field: string) => layer.set({ delay: { ...config.delay, ...patch } }, `delay:${field}`);
    const fromAbove = (on: boolean, what: string) => (layer.above.length > 0 && !on ? <span className="muted small">{what}</span> : null);
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    const reverb = nearestAbove(layer, (c) => c.reverb.amount > 0);
    const delay = nearestAbove(layer, (c) => c.delay.amount > 0);
    const reverbText = reverb === undefined ? 'above: none' : `${reverb.name}: ${percent(reverb.config.reverb.amount)}`;
    const delayText = delay === undefined ? 'above: none' : `${delay.name}: ${percent(delay.config.delay.amount)} at ${DELAY_TIMES.find(([s]) => s === delay.config.delay.steps)?.[1]}`;
    return (
      <div className="slider-grid">
        <div className="panel stack-tight" role="group" aria-label="Reverb">
          <div className="row spread">
            <span className="label">Reverb</span>
            {fromAbove(config.reverb.amount > 0, reverbText)}
          </div>
          <Slider label="Reverb amount" value={config.reverb.amount} min={0} max={1} step={0.01} format={(v) => (v <= 0 ? 'Off' : percent(v))} onChange={(v) => setReverb({ amount: v }, 'amount')} onCommit={seal} />
          {config.reverb.amount > 0 && <Slider label="Size" value={config.reverb.size} min={0} max={1} step={0.01} format={sizeText} onChange={(v) => setReverb({ size: v }, 'size')} onCommit={seal} />}
        </div>
        <div className="panel stack-tight" role="group" aria-label="Delay">
          <div className="row spread">
            <span className="label">Delay</span>
            {fromAbove(config.delay.amount > 0, delayText)}
          </div>
          <Slider label="Delay amount" value={config.delay.amount} min={0} max={1} step={0.01} format={(v) => (v <= 0 ? 'Off' : percent(v))} onChange={(v) => setDelay({ amount: v }, 'amount')} onCommit={seal} />
          {config.delay.amount > 0 && (
            <>
              <div className="segmented full" role="group" aria-label="Delay time">
                {DELAY_TIMES.map(([steps, label]) => (
                  <button key={steps} type="button" aria-pressed={config.delay.steps === steps} onClick={() => setDelay({ steps }, 'steps')}>
                    {label}
                  </button>
                ))}
              </div>
              <Slider label="Feedback" value={config.delay.feedback} min={0} max={MAX_FEEDBACK} step={0.01} format={percent} onChange={(v) => setDelay({ feedback: v }, 'feedback')} onCommit={seal} />
            </>
          )}
        </div>
      </div>
    );
  }

  /** How the selected hit plays: its region of its slice, and its own config under its pad's and matrix's. */
  function hitEditor(hit: Hit) {
    const onError = setError;
    const sample = project.samples[hit.sampleId];
    const audio = sample === undefined ? undefined : sampleAudio(project, sample);
    const source = hit.variantOf === null ? undefined : project.hits[hit.variantOf];
    const edit = (patch: Partial<Omit<Hit, 'id' | 'sampleId' | 'slice'>>, field: string) => onError(run(updateHit(hit.id, patch), `hit:${hit.id}:${field}`));
    // The slice the hit plays, in seconds of its sample; the region is a part of it.
    const window = sample === undefined ? null : sliceWindow(sample, hit.slice);
    const duration = window === null ? 0 : window.end - window.start;
    const region = { start: hit.region.start * duration, end: hit.region.end * duration };
    const toPart = (seconds: number) => (duration > 0 ? seconds / duration : 0);
    const setStart = (seconds: number) => edit({ region: { start: Math.max(0, Math.min(toPart(seconds), hit.region.end - toPart(0.001))), end: hit.region.end } }, 'start');
    const setEnd = (seconds: number) => edit({ region: { start: hit.region.start, end: Math.min(1, Math.max(toPart(seconds), hit.region.start + toPart(0.001))) } }, 'end');
    /** One end of the region, as Trim's: dragged, or moved with ←/→ (Shift: 10 ms). */
    const handle = (which: 'start' | 'end') => (
      <RegionHandle
        which={which}
        left={`${(which === 'start' ? hit.region.start : hit.region.end) * 100}%`}
        label={`${which === 'start' ? 'Start' : 'End'} at ${ms(which === 'start' ? region.start : region.end)} ms`}
        onDrag={(x) => {
          const rect = wave.current?.getBoundingClientRect();
          if (rect === undefined || rect.width === 0) return;
          const t = Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * duration;
          if (which === 'start') setStart(t);
          else setEnd(t);
        }}
        onNudge={(direction, big) => {
          const delta = (direction * (big ? 10 : 1)) / 1000;
          if (which === 'start') setStart(region.start + delta);
          else setEnd(region.end + delta);
        }}
        onDone={seal}
      />
    );
    // Where the main Play is, as a part of the waveform: through the region.
    const played = transport.played;
    const through = played === null || played.duration <= 0 ? null : Math.min(1, Math.max(0, played.seconds / played.duration));
    const playhead =
      through === null || played === null || !played.key.startsWith(`hit:${hit.id}:`)
        ? null
        : hit.direction === 'reverse'
          ? hit.region.end - through * (hit.region.end - hit.region.start)
          : hit.region.start + through * (hit.region.end - hit.region.start);
    const what =
      sample === undefined
        ? 'a missing sample'
        : hit.slice === null || sample.bars === null
          ? `all of ${trimName(sample)}`
          : `slice ${number(hit.slice)} of ${trimName(sample)}`;
    const hitPad = padOfHit(project, hit.id);
    const hitMatrix = hitPad === undefined ? undefined : matrixOfPad(project, hitPad.id);
    const above = [
      ...(hitPad === undefined ? [] : [{ name: 'pad' as const, config: hitPad.config }]),
      ...(hitMatrix === undefined ? [] : [{ name: 'matrix' as const, config: hitMatrix.config }]),
    ];
    const layer: Layer = {
      config: hit,
      set: (patch, field) => edit(patch, field),
      above,
      canFit: sample !== undefined && sampleBpm(sample) !== null,
      played: hitStretch(project, hit),
    };
    return (
      <section className="stack" aria-label="Hit">
        <div className="view-head row">
          <div className="stack-tight grow">
            <label className="sr-only" htmlFor="hit-name">
              Hit name
            </label>
            <input id="hit-name" className="title-input mono" value={hit.name} onChange={(e) => edit({ name: e.target.value }, 'name')} onBlur={seal} />
            <div className="row nav-row">
              <InSong heard={heard.hits.has(hit.id)} />
            </div>
            <p className="muted">
              {source === undefined ? `Plays ${what}` : `Variant of ${source.name}, plays ${what}`}
              {window === null && sample !== undefined && ` · silent: ${trimName(sample)} has ${sample.markers.length} slices`}
            </p>
          </div>
          <div className="row push">
            {picked && playControls('hit')}
            <button type="button" aria-expanded={replacing} onClick={() => setReplacing(!replacing)}>
              Replace…
            </button>
            <button
              type="button"
              title="A copy of this hit in the same pad, to change: reversed, pitched, shorter"
              onClick={() => runAndOpen(addVariant(hit.id, `${hit.name} var`), 'hits', (id) => open({ hit: id }, 'hits'))}
            >
              Variant
            </button>
            <Delete kind="hit" id={hit.id} name={hit.name} onError={onError} onDeleted={() => open({ hit: null }, 'hits')} />
          </div>
        </div>

        {replacing && replacePanel(hit)}

        {audio !== undefined && sample !== undefined && window !== null && duration > 0 && (
          <div className="panel wave-panel">
            <div className="wave-region" ref={wave}>
              <Waveform audio={audio} offset={sample.offset + window.start} duration={duration} height={180} />
              <div className="region-shade" style={{ left: 0, width: `${hit.region.start * 100}%` }} />
              <div className="region-shade" style={{ left: `${hit.region.end * 100}%`, right: 0 }} />
              {playhead !== null && <div className="playhead" style={{ left: `${playhead * 100}%` }} />}
              {handle('start')}
              {handle('end')}
            </div>
            <div className="row">
              <label className="field">
                Start ms
                <input type="number" min={0} max={ms(region.end) - 1} value={ms(region.start)} onChange={(e) => setStart(Number(e.target.value) / 1000)} onBlur={seal} />
              </label>
              <label className="field">
                End ms
                <input type="number" min={ms(region.start) + 1} max={ms(duration)} value={ms(region.end)} onChange={(e) => setEnd(Number(e.target.value) / 1000)} onBlur={seal} />
              </label>
              <span className="mono muted small">
                {ms(region.end - region.start)} ms of {ms(duration)} ms{hit.direction === 'reverse' ? ' · plays reversed' : ''}
              </span>
            </div>
            <p className="muted small">Drag the handles, or focus one and use ←/→ (Shift: 10 ms).</p>
          </div>
        )}

        {configPanels(layer)}
      </section>
    );
  }
}
