import { Fragment, useEffect, useRef, useState } from 'react';
import type { Break, Project } from '../model';
import { addSample, bpmOf, guessBars, replaceProject, setBreak, unlikelyBpm } from '../model';
import { decodeAudioFile, readCues, readProjectFile, writeProjectFile } from '../engine';
import { useApp, useProject, useRun, useSelect } from './context';
import { DeleteBreak } from './DeleteBreak';
import { timestamp } from './services';
import { TrimEditor } from './TrimEditor';

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
  const { store, services } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const openProject = async (file: File) => {
    try {
      setProjectError(run(replaceProject(readProjectFile(new Uint8Array(await file.arrayBuffer())))));
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };
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

      <section className="panel stack-tight" aria-label="Project file">
        <h2 className="label">Project file</h2>
        <p className="muted small">The whole project with its audio, as one .zip. Opening one replaces this project; undo brings it back.</p>
        <div className="row">
          <button
            type="button"
            onClick={() => services.download(`breakseq-project-${timestamp()}.zip`, writeProjectFile(project), 'application/zip')}
          >
            Save project
          </button>
          <button type="button" onClick={() => projectInput.current?.click()}>
            Open project
          </button>
          <input
            ref={projectInput}
            type="file"
            hidden
            accept=".zip,application/zip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void openProject(file);
              e.target.value = '';
            }}
          />
        </div>
        {projectError !== null && (
          <p className="error" role="alert">
            {projectError}
          </p>
        )}
      </section>

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
                        else {
                          const hit = project.pads[brk.pads[0] ?? '']?.members[0];
                          if (hit !== undefined) store.dispatch({ type: 'select', selection: { hit }, view: 'hits' });
                        }
                      }}
                    >
                      <td>
                        <div className="row nowrap">
                          <span className="mono grow ellipsis">{brk.name}</span>
                          <DeleteBreak brk={brk} onError={(e) => setErrors(e === null ? [] : [e])} onDeleted={() => trimming === brk.id && setTrimming(null)} />
                          <button
                            type="button"
                            className="small-button"
                            aria-expanded={trimming === brk.id}
                            aria-label={`Trim ${brk.name}`}
                            onClick={() => setTrimming(trimming === brk.id ? null : brk.id)}
                          >
                            Trim
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
                          `${sample.duration.toFixed(2)} s`
                        ) : (
                          <span className="bars" title="Bars are set in Slice">
                            {brk.bars} bars · {bpm.toFixed(1)} BPM
                            {unlikelyBpm(bpm) && <span className="warn-text">check bars in Slice</span>}
                          </span>
                        )}
                      </td>
                      <td>{creates(project, brk)}</td>
                      <td className="next">
                        {brk.bars === null ? (
                          <button type="button" onClick={() => store.dispatch({ type: 'view', view: 'hits' })}>
                            Hits →
                          </button>
                        ) : (
                          <button type="button" onClick={() => goSlice(brk.id)}>
                            Slice →
                          </button>
                        )}
                      </td>
                    </tr>
                    {trimming === brk.id && (
                      <tr>
                        <td colSpan={5} className="trim-cell" ref={trimCell}>
                          <TrimEditor sample={sample} loopFirst={brk.bars !== null} played={playheadSeconds} />
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
