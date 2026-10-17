import { Fragment, useEffect, useRef, useState } from 'react';
import type { Break, Project } from '../model';
import { addSample, addTrim, bpmOf, guessBars, setBreak, trimName, unlikelyBpm } from '../model';
import { decodeAudioFile, readCues } from '../engine';
import { useApp, useProject, useRun, useSelect } from './context';
import { BreakOrigin } from './BreakOrigin';
import { DeleteBreak } from './DeleteBreak';
import { TrimEditor } from './TrimEditor';
import { InSong, useHeard } from './InSong';

/** Every break, in import order: each imported file is one, a one-shot being a break with one slot. */
export const sources = (project: Project): Break[] => Object.values(project.breaks);

function creates(project: Project, brk: Break): string {
  if (brk.bars === null) return '1 hit · 1 pad';
  const loop = brk.loop === null ? undefined : project.loops[brk.loop];
  return `${brk.markers.length} slices · ${brk.markers.length} pads${loop === undefined ? '' : ` · loop ${loop.name}`}`;
}

interface ImportViewProps {
  /** Where Play is in the open Trim's sample, in seconds from its start, while it plays it. */
  readonly playheadSeconds?: number | null;
}

export function ImportView({ playheadSeconds = null }: ImportViewProps) {
  const project = useProject();
  const run = useRun();
  const { store } = useApp();
  const heard = useHeard();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const trimming = useSelect((s) => s.trimming);
  const setTrimming = (breakId: string | null) => store.dispatch({ type: 'trimming', breakId });
  // A Trim opened from elsewhere, as from Slice, is brought into view.
  const trimCell = useRef<HTMLTableCellElement>(null);
  useEffect(() => trimCell.current?.scrollIntoView?.({ block: 'nearest' }), [trimming]);

  const importFiles = async (files: readonly File[]) => {
    const failed: string[] = [];
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const audio = decodeAudioFile(bytes);
        // A WAV with cue markers becomes a break sliced at them.
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
        <div className="small">WAV files with cue markers keep their slices</div>
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
                  <th>Type</th>
                  <th>Length</th>
                  <th>Creates</th>
                  <th>
                    <span className="sr-only">Next</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources(project).map((brk) => {
                  const sample = project.samples[brk.sampleId];
                  if (sample === undefined) return null;
                  const bpm = bpmOf(project, brk);
                  return (
                    <Fragment key={brk.id}>
                    <tr
                      title={brk.bars === null ? 'Double-click to edit the hit' : 'Double-click to slice'}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, input') !== null) return;
                        if (brk.bars !== null) goSlice(brk.id);
                        else goHit(brk.id);
                      }}
                    >
                      <td>
                        <div className="row nowrap">
                          <span className="mono grow ellipsis" title={`${sample.name}, ${trimName(sample)}`}>
                            {sample.name} <span className="muted small">trim {sample.trim}</span>
                          </span>
                          <DeleteBreak brk={brk} onError={(e) => setErrors(e === null ? [] : [e])} onDeleted={() => trimming === brk.id && setTrimming(null)} />
                          <button
                            type="button"
                            className="small-button"
                            aria-expanded={trimming === brk.id}
                            aria-label={`Trim ${trimName(sample)}`}
                            onClick={() => setTrimming(trimming === brk.id ? null : brk.id)}
                          >
                            Trim
                          </button>
                          <button
                            type="button"
                            className="small-button"
                            aria-label={`New trim of ${sample.name}`}
                            title="Another trim of the same file, on a row of its own: no need to import it again"
                            onClick={() => {
                              const before = store.getState().history.present.breaks;
                              if (run(addTrim(sample.id)) !== null) return;
                              const added = Object.values(store.getState().history.present.breaks).find((b) => !(b.id in before));
                              if (added !== undefined) setTrimming(added.id);
                            }}
                          >
                            + New trim
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="segmented" role="group" aria-label={`Type of ${brk.name}`}>
                          <button
                            type="button"
                            aria-pressed={brk.bars !== null}
                            onClick={() => run(setBreak(brk.id, brk.bars ?? guessBars(sample.duration)))}
                          >
                            Break
                          </button>
                          <button type="button" aria-pressed={brk.bars === null} onClick={() => run(setBreak(brk.id, null))}>
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
                        <div className="stack-tight">
                          <span>{creates(project, brk)}</span>
                          <div className="row nav-row">
                            <BreakOrigin brk={brk} parts={['break']} />
                            <InSong heard={heard.breaks.has(brk.id)} />
                          </div>
                        </div>
                      </td>
                      <td className="next">
                        {brk.bars === null ? (
                          <button type="button" className="link-text small" onClick={() => goHit(brk.id)}>
                            Hits →
                          </button>
                        ) : (
                          <button type="button" className="link-text small" onClick={() => goSlice(brk.id)}>
                            Slice →
                          </button>
                        )}
                      </td>
                    </tr>
                    {trimming === brk.id && (
                      <tr>
                        <td colSpan={5} className="trim-cell" ref={trimCell}>
                          <TrimEditor sample={sample} played={playheadSeconds} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
