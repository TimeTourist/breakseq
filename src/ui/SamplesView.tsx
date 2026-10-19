import { Fragment, useEffect, useRef, useState } from 'react';
import type { Id, Loop, Matrix, Project, Sample } from '../model';
import {
  addSample,
  addSlicedSample,
  addTrim,
  fileSamples,
  fileUsages,
  findUsages,
  isUnsliced,
  markUnsliced,
  matrixTakes,
  ownMatrix,
  removeFile,
  removeSample,
  sampleBpm,
  sampleTakes,
  setSlicing,
  sliceName,
  stepDuration,
  trimName,
  unlikelyBpm,
  unsliceTakes,
  unsliceUsages,
} from '../model';
import { decodeAudioFile, decodeRex, isRexFile, matrixPassSteps, readCues } from '../engine';
import { useApp, useOpen, useProject, useRun, useSelect } from './context';
import { ConfirmDelete, DeleteButton } from './DeleteButton';
import { CropIcon, NewCropIcon, PlayIcon, StopIcon } from './icons';
import { TrimEditor } from './TrimEditor';
import { TrimSlicing } from './SliceEditor';
import { InSong, useHeard } from './InSong';
import { heardSamples, middleEllipsis, sampleLabel } from './labels';

/** The loops that play the pads of a sample's own matrix, its own loop first. */
export function sampleLoops(project: Project, sampleId: Id): Loop[] {
  const own = ownMatrix(project, sampleId);
  if (own === undefined) return [];
  const pads = new Set(own.pads);
  const first = own.loop === null ? undefined : project.loops[own.loop];
  const others = Object.values(project.loops).filter((l) => l.id !== own.loop && l.steps.some((st) => st.padId !== null && pads.has(st.padId)));
  return [...(first === undefined ? [] : [first]), ...others];
}

/** The samples grouped by file, files in import order and each file's trims in trim order. */
function files(project: Project): [string, Sample[]][] {
  const order = [...new Set(Object.values(project.samples).map((s) => s.audioId))];
  return order.map((audioId) => [audioId, fileSamples(project, audioId)]);
}

/** What Delete trim takes with it: its matrix, pads and hits, and the file with its last trim. */
export function trimTakes(project: Project, sample: Sample): string[] {
  const last = fileSamples(project, sample.audioId).length === 1;
  return [...sampleTakes(project, sample.id), ...(last ? [`file ${sample.name}`] : [])];
}

/** The trim shown below the table: the one picked, else the first. */
export const selectedTrim = (project: Project, picked: Id | null): Sample | undefined =>
  project.samples[picked ?? ''] ?? Object.values(project.samples)[0];

/** A REX2 file, ReCycle's sliced loops: by its header, or by its name (so a damaged one says it is damaged). */
const isRex = (name: string, bytes: Uint8Array): boolean => isRexFile(bytes) || name.toLowerCase().endsWith('.rx2');

/** A WAV or AIFF file. One with cue markers is marked Slice, not sliced: its cues are offered when it is. */
const addWave = (name: string, bytes: ArrayBuffer) => addSample({ name, audio: decodeAudioFile(bytes), cues: readCues(bytes) });

/** A REX2 file comes sliced: its slices are the markers and its bars come from the file. */
function addRex(name: string, bytes: Uint8Array) {
  const rex = decodeRex(bytes);
  return addSlicedSample({ name, audio: rex.audio, bars: rex.bars, markers: rex.slices });
}

/** Play in the header, as Samples sees it. */
export interface SamplesTransport {
  /** What the header plays (a subject's key), or null when it plays nothing of this tab. */
  readonly playingKey: string | null;
  /** Seconds into what it plays, and how long that is. */
  readonly seconds: number | null;
  readonly duration: number | null;
  /** The key of what Play would start now: the latest render, which may still be of what was shown before. */
  readonly shownKey: string | null;
  readonly onPlay: () => void;
  readonly onStop: () => void;
}

/**
 * Samples (decision 2): the files and their trims in a table, and the
 * selected trim's waveform with its slicing below, on one page. WAV, AIFF and
 * REX2 are dropped in here. Links to Pads open a trim's matrix in focus.
 */
export function SamplesView({ transport }: { readonly transport: SamplesTransport }) {
  const project = useProject();
  const run = useRun();
  const { store, services } = useApp();
  const heard = useHeard();
  const open = useOpen();
  const input = useRef<HTMLInputElement>(null);
  const below = useRef<HTMLElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const trimming = useSelect((s) => s.trimming);
  const picked = useSelect((s) => s.sliceTarget);
  const selected = selectedTrim(project, picked);
  // The file whose ▶ plays it whole, once.
  const [previewing, setPreviewing] = useState<string | null>(null);
  /** The sliced sample Don't slice is asking about. */
  const [toUnslice, setToUnslice] = useState<string | null>(null);
  const asked = toUnslice === null ? undefined : project.samples[toUnslice];
  /** The samples a hit heard in the song plays. */
  const heardHere = heardSamples(project, heard);
  const playingKey = transport.playingKey;

  // Leaving the tab stops whatever is being auditioned.
  useEffect(() => () => services.player.stopAudition(), [services]);
  useEffect(() => {
    if (previewing === null) return;
    return () => services.player.stopAudition();
  }, [previewing, services]);
  const preview = (audioId: string) => {
    const audio = project.audio[audioId];
    if (previewing === audioId || audio === undefined) {
      services.player.stopAudition();
      setPreviewing(null);
      return;
    }
    if (playingKey !== null) transport.onStop();
    setPreviewing(audioId);
    services.player.audition(audio, 0, (audio.channels[0]?.length ?? 0) / audio.sampleRate, () => setPreviewing((p) => (p === audioId ? null : p)), false);
  };
  const select = (sampleId: Id) => store.dispatch({ type: 'sliceTarget', sampleId });
  const setTrimming = (sampleId: Id | null) => {
    if (sampleId !== null) select(sampleId);
    store.dispatch({ type: 'trimming', sampleId });
  };
  /** Selects a trim and brings its slicing into view. */
  const toSlicing = (sampleId: Id) => {
    select(sampleId);
    below.current?.scrollIntoView?.({ block: 'start' });
  };
  /** A matrix in Pads, in focus: one with a single pad open on it. */
  const toPads = (matrix: Matrix) => {
    store.dispatch({ type: 'focus', matrix: matrix.id });
    open({ matrix: matrix.id, pad: matrix.pads.length === 1 ? matrix.pads[0]! : null, hit: null }, 'pads');
  };
  // A Trim opened from elsewhere is brought into view.
  const trimCell = useRef<HTMLTableCellElement>(null);
  // A click anywhere but the open Trim, its row, the header, a dialog or a button in the table closes it.
  // The table's buttons do their own thing: closing on the press would move the rows under the click.
  useEffect(() => {
    if (trimming === null) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-trim-open], .header, .dialog-backdrop, .sources button') !== null) return;
      store.dispatch({ type: 'trimming', sampleId: null });
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [trimming, store]);
  // Up and down only, below the header: the table scrolls sideways on its own. A block body, as an effect
  // must not return what it calls (newer browsers' scroll methods return a promise, which React would call).
  useEffect(() => {
    const cell = trimCell.current;
    if (cell === null) return;
    const box = cell.getBoundingClientRect();
    const top = (document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0) + 8;
    const by = box.bottom > window.innerHeight ? Math.min(box.bottom - window.innerHeight + 8, box.top - top) : box.top < top ? box.top - top : 0;
    if (by !== 0) window.scrollBy({ top: by });
  }, [trimming]);

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

  /** How far through its own matrix Play in the header is, while it plays the selected trim's. */
  const selectedOwn = selected === undefined ? undefined : ownMatrix(project, selected.id);
  // Play renders the matrix over several passes (see matrixSongLooped): how far through the pass it is in.
  const pass = selectedOwn === undefined ? 0 : matrixPassSteps(project, selectedOwn.id) * stepDuration(project.song.bpm);
  const playedMatrix =
    selectedOwn !== undefined && playingKey === `matrix:${selectedOwn.id}` && transport.seconds !== null && transport.duration !== null && transport.duration > 0 && pass > 0
      ? Math.min(1, Math.max(0, (transport.seconds % pass) / pass))
      : null;

  return (
    <main className="view">
      <div className="view-head">
        <h1>Samples</h1>
        <p className="muted">Every file gets a matrix with a pad and a hit. Pick a trim to slice it below.</p>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <path d="M18 24V6M11 13l7-7 7 7M6 24v6h24v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="dropzone-title">Drop WAV, AIFF or REX2 files here</div>
        <div className="small">WAV files with cue markers keep them for slicing; REX2 files come sliced</div>
        <button type="button" onClick={() => input.current?.click()}>
          Browse files
        </button>
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

      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <section className="stack">
        <h2 className="label">Files</h2>
        {selected === undefined ? (
          <p className="muted">Nothing imported yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="sources">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Trim</th>
                  <th>Type</th>
                  <th>Length</th>
                  <th>Creates</th>
                </tr>
              </thead>
              {files(project).map(([audioId, samples]) => (
                <tbody key={audioId} className="file-group">
                  {samples.map((sample, i) => {
                    const name = sampleLabel(project, sample);
                    const own = ownMatrix(project, sample.id);
                    const bpm = sampleBpm(sample);
                    const loops = sampleLoops(project, sample.id);
                    const loop = loops[0];
                    const unsliced = isUnsliced(sample);
                    const sliced = sample.bars !== null;
                    const isSelected = sample.id === selected.id;
                    return (
                      <Fragment key={sample.id}>
                        <tr
                          data-trim-open={trimming === sample.id || undefined}
                          className={isSelected ? 'selected' : undefined}
                          aria-current={isSelected ? 'true' : undefined}
                          title={!sliced && !unsliced ? 'Click to show it below; double-click to open its matrix in Pads' : 'Click to slice it below'}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, input') === null) select(sample.id);
                          }}
                          onDoubleClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, input') !== null) return;
                            if (!sliced && !unsliced && own !== undefined) toPads(own);
                          }}
                        >
                          <td className="file">
                            {i === 0 && (
                              <div className="row nowrap">
                                <DeleteButton
                                  icon
                                  label="Delete file"
                                  name={sample.name}
                                  usages={fileUsages(project, audioId)}
                                  goes={samples.map((s) => `${trimName(s)} (${sampleTakes(project, s.id).join(', ')})`)}
                                  onDelete={() => run(removeFile(audioId))}
                                  onDeleted={() => trimming !== null && samples.some((s) => s.id === trimming) && setTrimming(null)}
                                  onError={(e) => setErrors(e === null ? [] : [e])}
                                />
                                <button
                                  type="button"
                                  className="icon-button small"
                                  aria-label={`${previewing === audioId ? 'Stop' : 'Play'} ${sample.name}`}
                                  aria-pressed={previewing === audioId}
                                  title="The whole file, once"
                                  onClick={() => preview(audioId)}
                                >
                                  {previewing === audioId ? <StopIcon /> : <PlayIcon />}
                                </button>
                                <button
                                  type="button"
                                  className="icon-button small"
                                  aria-label={`New trim of ${sample.name}`}
                                  title="New trim: another trim of the same file, on a row of its own"
                                  onClick={() => {
                                    const before = store.getState().history.present.samples;
                                    if (run(addTrim(sample.id)) !== null) return;
                                    const added = Object.keys(store.getState().history.present.samples).find((id) => !(id in before));
                                    if (added !== undefined) setTrimming(added);
                                  }}
                                >
                                  <NewCropIcon />
                                </button>
                                <span className="mono" title={sample.name}>
                                  {middleEllipsis(sample.name)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="row nowrap trim-of">
                              <button
                                type="button"
                                className="link-text mono"
                                aria-label={`Select ${trimName(sample)}`}
                                aria-pressed={isSelected}
                                title="Show it below"
                                onClick={() => select(sample.id)}
                              >
                                {sample.trim}
                              </button>
                              {!sliced && <span className="badge">not sliced</span>}
                              <div className="trim-actions">
                                <DeleteButton
                                  icon
                                  label="Delete trim"
                                  name={trimName(sample)}
                                  usages={findUsages(project, 'sample', sample.id)}
                                  goes={trimTakes(project, sample)}
                                  onDelete={() => run(removeSample(sample.id))}
                                  onDeleted={() => trimming === sample.id && setTrimming(null)}
                                  onError={(e) => setErrors(e === null ? [] : [e])}
                                />
                                <button
                                  type="button"
                                  className="icon-button small"
                                  aria-expanded={trimming === sample.id}
                                  aria-label={`Trim ${trimName(sample)}`}
                                  title={trimming === sample.id ? 'Close the Trim' : 'Trim: set where the sample starts and ends'}
                                  onClick={() => setTrimming(trimming === sample.id ? null : sample.id)}
                                >
                                  <CropIcon />
                                </button>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="segmented" role="group" aria-label={`Type of ${name}`}>
                              <button
                                type="button"
                                aria-pressed={sliced || unsliced}
                                title="Slice it below into a matrix with a pad per slice"
                                onClick={() => {
                                  select(sample.id);
                                  if (!sliced && !unsliced) run(markUnsliced(sample.id));
                                }}
                              >
                                Slice
                              </button>
                              <button
                                type="button"
                                aria-pressed={!sliced && !unsliced}
                                title="Play it whole: a matrix with one pad"
                                onClick={() => {
                                  if (unsliced) run(setSlicing(sample.id, null));
                                  // Its slicing goes: ask first, as Delete does.
                                  else if (sliced) setToUnslice(sample.id);
                                }}
                              >
                                Don't slice
                              </button>
                            </div>
                          </td>
                          <td className="mono muted">
                            {bpm === null ? (
                              `${Math.round(sample.duration * 1000)} ms`
                            ) : (
                              <span className="bars" title="Bars are set below, where it is sliced">
                                {sample.bars} bar{sample.bars === 1 ? '' : 's'} · {bpm.toFixed(2)} BPM
                                {unlikelyBpm(bpm) && <span className="warn-text">check its bars</span>}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="row creates">
                              {unsliced && (
                                <button type="button" className="link-text small" title={`Slice ${name} below: set its bars and how to slice it`} onClick={() => toSlicing(sample.id)}>
                                  Create Slices ↓
                                </button>
                              )}
                              {sliced && (
                                <span>
                                  {sample.markers.length}{' '}
                                  <button type="button" className="link-text small" title={`${sample.markers.length} slices: ${sliceName(sample)}, below`} onClick={() => toSlicing(sample.id)}>
                                    Slice ↓
                                  </button>
                                </span>
                              )}
                              {!unsliced && own !== undefined && (
                                <span>
                                  {matrixTakes(project, own.id).join(', ')}{' '}
                                  <button type="button" className="link-text small" title={`Matrix ${own.name}, in Pads`} onClick={() => toPads(own)}>
                                    Pads →
                                  </button>
                                </span>
                              )}
                              {sliced && loop !== undefined && (
                                <span>
                                  {loops.length}{' '}
                                  <button
                                    type="button"
                                    className="link-text small"
                                    title={`Played in ${loops.map((l) => `loop ${l.name}`).join(', ')}: opens ${loop.name} in Loops`}
                                    onClick={() => open({ loop: loop.id, step: null }, 'loops')}
                                  >
                                    Loops →
                                  </button>
                                </span>
                              )}
                              <InSong heard={heardHere.has(sample.id)} />
                            </div>
                          </td>
                        </tr>
                        {trimming === sample.id && (
                          <tr data-trim-open>
                            <td colSpan={5} className="trim-cell" ref={trimCell}>
                              <TrimEditor
                                sample={sample}
                                played={playingKey === `sample:${sample.id}` ? transport.seconds : null}
                                transport={{
                                  playing: playingKey === `sample:${sample.id}`,
                                  // Until the trim's own render is in, Play would start what was shown before.
                                  ready: transport.shownKey === `sample:${sample.id}`,
                                  onToggle: () => (playingKey === `sample:${sample.id}` ? transport.onStop() : transport.onPlay()),
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      {selected !== undefined && (
        <section className="stack" aria-label="Slicing" ref={below}>
          <TrimSlicing
            sample={selected}
            played={playedMatrix}
            toTrim={() => setTrimming(selected.id)}
            toPads={toPads}
            stopTransport={() => {
              if (playingKey !== null) transport.onStop();
            }}
          />
        </section>
      )}

      {asked !== undefined && (
        <ConfirmDelete
          name={sampleLabel(project, asked)}
          question={`Don't slice ${sampleLabel(project, asked)}?`}
          action="Don't slice"
          goes={unsliceTakes(project, asked.id)}
          usages={unsliceUsages(project, asked.id)}
          onAnswer={(yes) => {
            setToUnslice(null);
            if (yes) run(setSlicing(asked.id, null));
          }}
        />
      )}
    </main>
  );
}
