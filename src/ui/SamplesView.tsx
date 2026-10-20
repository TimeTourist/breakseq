import { useEffect, useRef, useState } from 'react';
import type { Id, Project, Sample } from '../model';
import { addSample, addSlicedSample, addTrim, fileSamples, fileUsages, findUsages, removeFile, removeSample, sampleTakes, trimName } from '../model';
import { decodeAudioFile, decodeRex, isRexFile, readCues } from '../engine';
import { useApp, useProject, useRun, useSelect } from './context';
import { DeleteButton } from './DeleteButton';
import { FoldAllIcon, FoldIcon, NewSampleIcon } from './icons';
import { SampleEditor } from './SliceEditor';
import { sampleMatrices, toMatrices } from './crumbs';
import { middleEllipsis } from './labels';

/** The samples grouped by file, files in import order and each file's samples in number order. */
function files(project: Project): [string, Sample[]][] {
  const order = [...new Set(Object.values(project.samples).map((s) => s.audioId))];
  return order.map((audioId) => [audioId, fileSamples(project, audioId)]);
}

/** What Delete sample takes with it: its matrix, pads and hits, and the file with its last sample. */
export function trimTakes(project: Project, sample: Sample): string[] {
  const last = fileSamples(project, sample.audioId).length === 1;
  return [...sampleTakes(project, sample.id), ...(last ? [`file ${sample.name}`] : [])];
}

/** The sample shown in the editor: the one picked, else the first. */
export const selectedTrim = (project: Project, picked: Id | null): Sample | undefined =>
  project.samples[picked ?? ''] ?? Object.values(project.samples)[0];

/** A REX2 file, ReCycle's sliced loops: by its header, or by its name (so a damaged one says it is damaged). */
const isRex = (name: string, bytes: Uint8Array): boolean => isRexFile(bytes) || name.toLowerCase().endsWith('.rx2');

/** A WAV or AIFF file. One with cue markers keeps them, offered as Cues when it is sliced. */
const addWave = (name: string, bytes: ArrayBuffer) => addSample({ name, audio: decodeAudioFile(bytes), cues: readCues(bytes) });

/** A REX2 file comes sliced: its slices are the markers and its bars come from the file. */
function addRex(name: string, bytes: Uint8Array) {
  const rex = decodeRex(bytes);
  return addSlicedSample({ name, audio: rex.audio, bars: rex.bars, markers: rex.slices });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Play in the header, as Samples sees it. */
export interface SamplesTransport {
  /** What the header plays (a subject's key), or null when it plays nothing of this tab. */
  readonly playingKey: string | null;
  /** Seconds into what it plays. */
  readonly seconds: number | null;
  readonly onStop: () => void;
}

/** Whether a drag carries files, which this page takes wherever they are dropped. */
const carriesFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Samples (Magnus beslut): the files and their samples in a list on the left,
 * and the selected sample's editor, trim and slicing in one, on the right.
 * WAV, AIFF and REX2 files are dropped anywhere on the page.
 */
export function SamplesView({ transport }: { readonly transport: SamplesTransport }) {
  const project = useProject();
  const run = useRun();
  const { store, services } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  /** How many drag-enters the page has had without a leave: above 0, files are being dragged over it. */
  const [dragging, setDragging] = useState(0);
  /** Files folded in the list: the view's choice, not saved. */
  const [folded, setFolded] = useState<ReadonlySet<Id>>(new Set());
  const picked = useSelect((s) => s.sliceTarget);
  const selected = selectedTrim(project, picked);
  const grouped = files(project);
  const allFolded = grouped.length > 0 && grouped.every(([audioId]) => folded.has(audioId));

  // Leaving the tab stops whatever is being auditioned.
  useEffect(() => () => services.player.stopAudition(), [services]);
  const select = (sampleId: Id) => store.dispatch({ type: 'sliceTarget', sampleId });
  const fold = (audioId: Id) => setFolded((was) => (was.has(audioId) ? new Set([...was].filter((id) => id !== audioId)) : new Set([...was, audioId])));

  const importFiles = async (files: readonly File[]) => {
    const failed: string[] = [];
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const view = new Uint8Array(bytes);
        const error = isRex(file.name, view) ? run(addRex(file.name, view)) : run(addWave(file.name, bytes));
        if (error !== null) failed.push(`${file.name}: ${error}`);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setErrors(failed);
  };
  /** A new sample of the whole file, last among its samples, selected. */
  const newSample = (of: Sample) => {
    const before = store.getState().history.present.samples;
    if (run(addTrim(of.id)) !== null) return;
    const added = Object.keys(store.getState().history.present.samples).find((id) => !(id in before));
    if (added !== undefined) select(added);
  };

  /**
   * A double-click opens the sample's matrix in Matrices, pinned, as a link in
   * the row under the tabs does (Magnus beslut): its own, else the first that
   * plays it; with none, nothing. (Claudes val.)
   */
  const openMatrix = (sample: Sample) => {
    const matrix = sampleMatrices(project, sample).matrices[0];
    if (matrix !== undefined) toMatrices(matrix).forEach((action) => store.dispatch(action));
  };

  const playingKey = transport.playingKey;

  return (
    <main
      className="view samples-view"
      onDragEnter={(e) => {
        if (carriesFiles(e)) setDragging((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (carriesFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (carriesFiles(e)) setDragging((n) => Math.max(0, n - 1));
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDragging(0);
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="samples-layout">
        <section className="panel file-list" aria-label="Files">
          <div className="file-list-head">
            <button type="button" title="Or drop WAV, AIFF or REX2 files anywhere on this page" onClick={() => input.current?.click()}>
              Browse files…
            </button>
            <span className="muted small drop-hint">…or drag and drop</span>
            {grouped.length > 0 && (
              <button
                type="button"
                className="icon-button small push"
                aria-label={allFolded ? 'Expand all' : 'Collapse all'}
                title={allFolded ? 'Expand all' : 'Collapse all'}
                onClick={() => setFolded(allFolded ? new Set() : new Set(grouped.map(([audioId]) => audioId)))}
              >
                <FoldAllIcon folded={allFolded} />
              </button>
            )}
            <input
              ref={input}
              type="file"
              hidden
              multiple
              accept=".wav,.aif,.aiff,.aifc,.rx2,audio/wav,audio/aiff"
              onChange={(e) => {
                void importFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
          {grouped.length === 0 && <p className="muted small">Nothing imported yet. WAV files with cue markers keep them for slicing; REX2 files come sliced.</p>}
          {grouped.map(([audioId, samples]) => {
            const first = samples[0]!;
            const isFolded = folded.has(audioId);
            return (
              <div key={audioId} className="file-group" role="group" aria-label={first.name}>
                <div
                  className="file-row"
                  title={isFolded ? 'Click to show its samples' : 'Click to hide its samples'}
                  // A click on the file's row folds it, as ▼ does; its buttons keep their own. (Magnus beslut)
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button') === null) fold(audioId);
                  }}
                >
                  <button
                    type="button"
                    className="icon-button small fold"
                    aria-expanded={!isFolded}
                    aria-label={`${isFolded ? 'Show' : 'Hide'} the samples of ${first.name}`}
                    onClick={() => fold(audioId)}
                  >
                    <FoldIcon folded={isFolded} />
                  </button>
                  <span className="mono file-name" title={first.name}>
                    {middleEllipsis(first.name)}
                  </span>
                  {isFolded && <span className="muted small">{plural(samples.length, 'sample')}</span>}
                  <button type="button" className="icon-button small" aria-label={`New sample of ${first.name}`} title="New sample: another part of the file" onClick={() => newSample(first)}>
                    <NewSampleIcon />
                  </button>
                  <DeleteButton
                    icon
                    label="Delete file"
                    name={first.name}
                    usages={fileUsages(project, audioId)}
                    goes={samples.map((s) => `${trimName(s)} (${sampleTakes(project, s.id).join(', ')})`)}
                    onDelete={() => run(removeFile(audioId))}
                    onError={(e) => setErrors(e === null ? [] : [e])}
                  />
                </div>
                {!isFolded &&
                  samples.map((sample) => {
                    const isSelected = sample.id === selected?.id;
                    return (
                      <div key={sample.id} className={`sample-row${isSelected ? ' selected' : ''}`}>
                        <button
                          type="button"
                          className="sample-pick"
                          aria-pressed={isSelected}
                          aria-label={`Select ${trimName(sample)}`}
                          title="Double-click: open its matrix"
                          onClick={() => select(sample.id)}
                          onDoubleClick={() => openMatrix(sample)}
                        >
                          <span className="mono faint">{sample.trim}</span>
                          <span className="grow">{sample.bars === null ? 'one shot' : plural(sample.markers.length, 'slice')}</span>
                          <span className="mono faint small">{sample.bars === null ? `${Math.round(sample.duration * 1000)} ms` : plural(sample.bars, 'bar')}</span>
                        </button>
                        <DeleteButton
                          icon
                          label="Delete sample"
                          name={trimName(sample)}
                          usages={findUsages(project, 'sample', sample.id)}
                          goes={trimTakes(project, sample)}
                          onDelete={() => run(removeSample(sample.id))}
                          onError={(e) => setErrors(e === null ? [] : [e])}
                        />
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </section>

        {selected !== undefined && (
          <section className="panel sample-panel" aria-label="Sample">
            <SampleEditor
              key={selected.id}
              sample={selected}
              played={playingKey === `sample:${selected.id}` ? transport.seconds : null}
              stopTransport={() => {
                if (playingKey !== null) transport.onStop();
              }}
            />
          </section>
        )}
      </div>

      {dragging > 0 && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-title">Drop to import</div>
          <div className="muted">WAV, AIFF or REX2. Each file gets a sample of its own.</div>
        </div>
      )}
    </main>
  );
}
