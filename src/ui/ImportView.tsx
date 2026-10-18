import { Fragment, useEffect, useRef, useState } from 'react';
import type { Break, Loop, Project } from '../model';
import { addSample, addTrim, bpmOf, breakTakes, fileBreaks, fileUsages, isUnsliced, makeOneShot, markBreak, oneShotTakes, oneShotUsages, removeFile, sliceName, trimName, unlikelyBpm } from '../model';
import { decodeAudioFile, readCues } from '../engine';
import { useApp, useOpen, useProject, useRun, useSelect } from './context';
// TODO(fas-22 Task 7b): use DeleteMatrix (props matrix) or removeSample here; aliased so the module resolves until then.
import { DeleteMatrix as DeleteBreak } from './DeleteMatrix';
import { ConfirmDelete, DeleteButton } from './DeleteButton';
import { CropIcon, NewCropIcon, PlayIcon, StopIcon } from './icons';
import { TrimEditor } from './TrimEditor';
import { InSong, useHeard } from './InSong';
import { middleEllipsis } from './labels';

/** Every break, in import order: each imported file is one, a one-shot being a break with one slot. */
export const sources = (project: Project): Break[] => Object.values(project.breaks);

/** The loops that play a break's pads, its own loop first. */
export function breakLoops(project: Project, brk: Break): Loop[] {
  const pads = new Set(brk.pads);
  const own = brk.loop === null ? undefined : project.loops[brk.loop];
  const others = Object.values(project.loops).filter((l) => l.id !== brk.loop && l.steps.some((st) => st.padId !== null && pads.has(st.padId)));
  return [...(own === undefined ? [] : [own]), ...others];
}

/** The breaks grouped by file, files in import order and each file's trims in trim order. */
function files(project: Project): [string, Break[]][] {
  const order = [...new Set(sources(project).flatMap((b) => project.samples[b.sampleId]?.audioId ?? []))];
  return order.map((audioId) => [audioId, fileBreaks(project, audioId)]);
}

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
  /** The sliced break One-shot is asking about. */
  const [toOneShot, setToOneShot] = useState<string | null>(null);
  const asked = toOneShot === null ? undefined : project.breaks[toOneShot];
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
  const setTrimming = (breakId: string | null) => store.dispatch({ type: 'trimming', breakId });
  // A Trim opened from elsewhere, as from Slice, is brought into view.
  const trimCell = useRef<HTMLTableCellElement>(null);
  // A click anywhere but the open Trim, its row, the header, a dialog or a button in the table closes it.
  // The table's buttons do their own thing: closing on the press would move the rows under the click.
  useEffect(() => {
    if (trimming === null) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-trim-open], .header, .dialog-backdrop, .sources button') !== null) return;
      store.dispatch({ type: 'trimming', breakId: null });
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
        // A WAV with cue markers becomes a break, not sliced: Slice offers its cues.
        const error = run(addSample({ name: file.name, audio, cues: readCues(bytes) }));
        if (error !== null) failed.push(`${file.name}: ${error}`);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setErrors(failed);
  };

  /** A one-shot's own hit, open in Hits. */
  const goHit = (id: string) => {
    const hit = project.pads[project.breaks[id]?.pads[0] ?? '']?.members[0];
    if (hit !== undefined) store.dispatch({ type: 'select', selection: { hit, pad: null }, view: 'hits' });
  };

  const goSlice = (id: string) => {
    store.dispatch({ type: 'sliceTarget', breakId: id });
    store.dispatch({ type: 'view', view: 'slice' });
  };

  return (
    <main className="view">
      <div className="view-head">
        <h1>Import</h1>
        <p className="muted">Every file gets a hit and a pad. Breaks continue to Slice.</p>
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
              {files(project).map(([audioId, breaks]) => (
                <tbody key={audioId} className="file-group">
                  {breaks.map((brk, i) => {
                    const sample = project.samples[brk.sampleId];
                    if (sample === undefined) return null;
                    const bpm = bpmOf(project, brk);
                    const loops = breakLoops(project, brk);
                    const loop = loops[0];
                    const hit = brk.parent ?? project.pads[brk.pads[0] ?? '']?.members[0];
                    const unsliced = isUnsliced(brk);
                    return (
                      <Fragment key={brk.id}>
                        <tr
                          data-trim-open={trimming === brk.id || undefined}
                          title={brk.bars === null && !unsliced ? 'Double-click to edit the hit' : 'Double-click to slice'}
                          onDoubleClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, input') !== null) return;
                            if (brk.bars !== null || unsliced) goSlice(brk.id);
                            else goHit(brk.id);
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
                                  goes={breaks.map((b) => `${b.bars === null && !isUnsliced(b) ? 'one-shot' : 'break'} ${b.name} (${breakTakes(project, b.id).join(', ')})`)}
                                  onDelete={() => run(removeFile(audioId))}
                                  onDeleted={() => trimming !== null && breaks.some((b) => b.id === trimming) && setTrimming(null)}
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
                                    const before = store.getState().history.present.breaks;
                                    if (run(addTrim(sample.id)) !== null) return;
                                    const added = Object.values(store.getState().history.present.breaks).find((b) => !(b.id in before));
                                    if (added !== undefined) setTrimming(added.id);
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
                                <DeleteBreak icon brk={brk} onError={(e) => setErrors(e === null ? [] : [e])} onDeleted={() => trimming === brk.id && setTrimming(null)} />
                                <button
                                  type="button"
                                  className="icon-button small"
                                  aria-expanded={trimming === brk.id}
                                  aria-label={`Trim ${trimName(sample)}`}
                                  title={trimming === brk.id ? 'Close the Trim' : 'Trim: set where the sample starts and ends'}
                                  onClick={() => setTrimming(trimming === brk.id ? null : brk.id)}
                                >
                                  <CropIcon />
                                </button>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="segmented" role="group" aria-label={`Type of ${brk.name}`}>
                              <button
                                type="button"
                                aria-pressed={brk.bars !== null || unsliced}
                                onClick={() => {
                                  if (brk.bars === null && !unsliced) run(markBreak(brk.id, true));
                                }}
                              >
                                Break
                              </button>
                              <button
                                type="button"
                                aria-pressed={brk.bars === null && !unsliced}
                                onClick={() => {
                                  if (unsliced) run(markBreak(brk.id, false));
                                  // Its slicing goes: ask first, as Delete does.
                                  else if (brk.bars !== null) setToOneShot(brk.id);
                                }}
                              >
                                One-shot
                              </button>
                            </div>
                          </td>
                          <td className="mono muted">
                            {bpm === null ? (
                              `${Math.round(sample.duration * 1000)} ms`
                            ) : (
                              <span className="bars" title="Bars are set in Slice">
                                {brk.bars} bar{brk.bars === 1 ? '' : 's'} · {bpm.toFixed(2)} BPM
                                {unlikelyBpm(bpm) && <span className="warn-text">check bars in Slice</span>}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="row creates">
                              {unsliced ? (
                                <button type="button" className="link-text small" title={`Slice ${brk.name} in Slice: set its bars and how to slice it`} onClick={() => goSlice(brk.id)}>
                                  Create Slices →
                                </button>
                              ) : brk.bars === null ? (
                                <span>
                                  1 hit{' '}
                                  <button type="button" className="link-text small" title={`Hit ${brk.name}, in Hits`} onClick={() => goHit(brk.id)}>
                                    Hits →
                                  </button>
                                </span>
                              ) : (
                                <>
                                  <span>
                                    {brk.markers.length}{' '}
                                    <button type="button" className="link-text small" title={`${brk.markers.length} slices: ${sliceName(project, brk)}, in Slice`} onClick={() => goSlice(brk.id)}>
                                      Slice →
                                    </button>
                                  </span>
                                  <span>
                                    {brk.markers.length}{' '}
                                    {hit !== undefined && (
                                      <button type="button" className="link-text small" title={`${brk.markers.length} pads: break ${brk.name}, in Hits`} onClick={() => open({ hit, pad: null }, 'hits')}>
                                        Hits →
                                      </button>
                                    )}
                                  </span>
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
                              <InSong heard={heard.breaks.has(brk.id)} />
                            </div>
                          </td>
                        </tr>
                        {trimming === brk.id && (
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
          name={asked.name}
          question={`Make ${asked.name} a one-shot?`}
          action="Make one-shot"
          goes={oneShotTakes(project, asked.id)}
          usages={oneShotUsages(project, asked.id)}
          onAnswer={(yes) => {
            setToOneShot(null);
            if (yes) run(makeOneShot(asked.id));
          }}
        />
      )}
    </main>
  );
}
