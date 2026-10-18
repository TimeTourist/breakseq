import { Fragment, useEffect, useRef, useState } from 'react';
import type { Id, Loop, Project, Sample } from '../model';
import {
  addSample,
  addTrim,
  fileSamples,
  fileUsages,
  findUsages,
  isUnsliced,
  markUnsliced,
  ownMatrix,
  removeFile,
  removeSample,
  sampleBpm,
  sampleTakes,
  setSlicing,
  sliceName,
  trimName,
  unlikelyBpm,
  unsliceTakes,
  unsliceUsages,
} from '../model';
import { decodeAudioFile, readCues } from '../engine';
import { useApp, useOpen, useProject, useRun, useSelect } from './context';
import { ConfirmDelete, DeleteButton } from './DeleteButton';
import { CropIcon, NewCropIcon, PlayIcon, StopIcon } from './icons';
import { TrimEditor } from './TrimEditor';
import { InSong, useHeard } from './InSong';
import { middleEllipsis } from './labels';

/** Every sample (trim), in import order. */
export const sources = (project: Project): Sample[] => Object.values(project.samples);

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
  const order = [...new Set(sources(project).map((s) => s.audioId))];
  return order.map((audioId) => [audioId, fileSamples(project, audioId)]);
}

/** What a sample is called in Import: its own matrix's name, or its trim's when that is gone. */
const sampleLabel = (project: Project, sample: Sample): string => ownMatrix(project, sample.id)?.name ?? trimName(sample);

interface ImportViewProps {
  /** Where Play is in the open Trim's sample, in seconds from its start, while it plays it. */
  readonly playheadSeconds?: number | null;
}

export function ImportView({ playheadSeconds = null }: ImportViewProps) {
  const project = useProject();
  const run = useRun();
  const { store, services } = useApp();
  const heard = useHeard();
  const open = useOpen();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const trimming = useSelect((s) => s.trimming);
  // The file whose ▶ plays it whole, once.
  const [previewing, setPreviewing] = useState<string | null>(null);
  /** The sliced sample Don't slice is asking about. */
  const [toUnslice, setToUnslice] = useState<string | null>(null);
  const asked = toUnslice === null ? undefined : project.samples[toUnslice];
  /** The samples a hit heard in the song plays. */
  const heardSamples = new Set([...heard.hits].flatMap((h) => project.hits[h]?.sampleId ?? []));
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
    setPreviewing(audioId);
    services.player.audition(audio, 0, (audio.channels[0]?.length ?? 0) / audio.sampleRate, () => setPreviewing((p) => (p === audioId ? null : p)), false);
  };
  const setTrimming = (sampleId: string | null) => store.dispatch({ type: 'trimming', sampleId });
  // A Trim opened from elsewhere, as from Slice, is brought into view.
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
        const audio = decodeAudioFile(bytes);
        // A WAV with cue markers is marked Slice, not sliced: Slice offers its cues.
        const error = run(addSample({ name: file.name, audio, cues: readCues(bytes) }));
        if (error !== null) failed.push(`${file.name}: ${error}`);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setErrors(failed);
  };

  /** A sample's own matrix, open in Hits: a sliced one on its own, a sample not sliced on its one pad. */
  const goHits = (sampleId: string) => {
    const own = ownMatrix(project, sampleId);
    if (own === undefined) return;
    const pad = own.pads.length === 1 ? own.pads[0]! : null;
    open({ matrix: own.id, pad, hit: null }, 'hits');
  };

  const goSlice = (id: string) => {
    store.dispatch({ type: 'sliceTarget', sampleId: id });
    store.dispatch({ type: 'view', view: 'slice' });
  };

  return (
    <main className="view">
      <div className="view-head">
        <h1>Import</h1>
        <p className="muted">Every file gets a matrix with a pad and a hit. Samples to slice continue to Slice.</p>
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
        <div className="dropzone-title">Drop WAV or AIFF files here</div>
        <div className="small">WAV files with cue markers keep them for Slice</div>
        <button type="button" onClick={() => input.current?.click()}>
          Browse files
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".wav,.aif,.aiff,.aifc,audio/wav,audio/aiff"
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
        <h2 className="label">Sources</h2>
        {sources(project).length === 0 ? (
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
                    return (
                      <Fragment key={sample.id}>
                        <tr
                          data-trim-open={trimming === sample.id || undefined}
                          title={!sliced && !unsliced ? 'Double-click to edit it in Hits' : 'Double-click to slice'}
                          onDoubleClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, input') !== null) return;
                            if (sliced || unsliced) goSlice(sample.id);
                            else goHits(sample.id);
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
                              <span className="mono">{sample.trim}</span>
                              <div className="trim-actions">
                                <DeleteButton
                                  icon
                                  label="Delete trim"
                                  name={trimName(sample)}
                                  usages={findUsages(project, 'sample', sample.id)}
                                  goes={sampleTakes(project, sample.id)}
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
                                title="Slice it in Slice into a matrix with a pad per slice"
                                onClick={() => {
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
                              <span className="bars" title="Bars are set in Slice">
                                {sample.bars} bar{sample.bars === 1 ? '' : 's'} · {bpm.toFixed(2)} BPM
                                {unlikelyBpm(bpm) && <span className="warn-text">check bars in Slice</span>}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="row creates">
                              {unsliced ? (
                                <button type="button" className="link-text small" title={`Slice ${name} in Slice: set its bars and how to slice it`} onClick={() => goSlice(sample.id)}>
                                  Create Slices →
                                </button>
                              ) : !sliced ? (
                                own !== undefined && (
                                  <span>
                                    1 hit{' '}
                                    <button type="button" className="link-text small" title={`Matrix ${own.name}, in Hits`} onClick={() => goHits(sample.id)}>
                                      Hits →
                                    </button>
                                  </span>
                                )
                              ) : (
                                <>
                                  <span>
                                    {sample.markers.length}{' '}
                                    <button type="button" className="link-text small" title={`${sample.markers.length} slices: ${sliceName(sample)}, in Slice`} onClick={() => goSlice(sample.id)}>
                                      Slice →
                                    </button>
                                  </span>
                                  {own !== undefined && (
                                    <span>
                                      {own.pads.length}{' '}
                                      <button type="button" className="link-text small" title={`${own.pads.length} pads: matrix ${own.name}, in Hits`} onClick={() => goHits(sample.id)}>
                                        Hits →
                                      </button>
                                    </span>
                                  )}
                                  {loop !== undefined && (
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
                                </>
                              )}
                              <InSong heard={heardSamples.has(sample.id)} />
                            </div>
                          </td>
                        </tr>
                        {trimming === sample.id && (
                          <tr data-trim-open>
                            <td colSpan={5} className="trim-cell" ref={trimCell}>
                              <TrimEditor sample={sample} played={playheadSeconds} />
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
