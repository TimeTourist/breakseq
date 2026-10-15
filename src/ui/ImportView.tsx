import { useRef, useState } from 'react';
import type { Project, Sample } from '../model';
import { addSample, replaceProject, setBreak } from '../model';
import { decodeAudioFile, readProjectFile, writeProjectFile } from '../engine';
import { useApp, useProject, useRun } from './context';
import { timestamp } from './services';

const DEFAULT_BREAK_BARS = 4;

/** Files imported directly, in import order (slices are not sources). */
export const sources = (project: Project): Sample[] => Object.values(project.samples).filter((s) => s.sliceOf === null);

/** The loop made when this break was sliced: the one whose pads play its slices. */
function sliceLoopName(project: Project, breakId: string): string | null {
  const isSlicePad = (padId: string | null) => {
    const hitId = padId === null ? undefined : project.pads[padId]?.members[0];
    const hit = hitId === undefined ? undefined : project.hits[hitId];
    return hit !== undefined && project.samples[hit.sampleId]?.sliceOf === breakId;
  };
  return Object.values(project.loops).find((l) => l.steps.some((s) => isSlicePad(s.padId)))?.name ?? null;
}

function creates(project: Project, sample: Sample): string {
  if (sample.break === null) return '1 sample · 1 hit · 1 pad';
  if (!sample.break.sliced) return 'Slice to make samples, hits, pads and a loop';
  const n = Object.values(project.samples).filter((s) => s.sliceOf === sample.id).length;
  const loop = sliceLoopName(project, sample.id);
  return `${n} samples · ${n} hits · ${n} pads${loop === null ? '' : ` · loop ${loop}`}`;
}

export function ImportView() {
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

  const importFiles = async (files: readonly File[]) => {
    const failed: string[] = [];
    for (const file of files) {
      try {
        const audio = decodeAudioFile(await file.arrayBuffer());
        const error = run(addSample({ name: file.name, audio }));
        if (error !== null) failed.push(`${file.name}: ${error}`);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setErrors(failed);
  };

  const goSlice = (id: string) => {
    store.dispatch({ type: 'sliceTarget', sampleId: id });
    store.dispatch({ type: 'view', view: 'slice' });
  };

  return (
    <main className="view">
      <div className="view-head">
        <h1>Import</h1>
        <p className="muted">Every sample gets a hit and a pad. Breaks continue to Slice.</p>
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
                {sources(project).map((sample) => {
                  const sliced = sample.break?.sliced === true;
                  return (
                    <tr key={sample.id}>
                      <td className="mono">{sample.name}</td>
                      <td>
                        <div className="segmented" role="group" aria-label={`Type of ${sample.name}`}>
                          <button
                            type="button"
                            aria-pressed={sample.break !== null}
                            disabled={sliced}
                            onClick={() => run(setBreak(sample.id, sample.break?.bars ?? DEFAULT_BREAK_BARS))}
                          >
                            Break
                          </button>
                          <button
                            type="button"
                            aria-pressed={sample.break === null}
                            disabled={sliced}
                            onClick={() => run(setBreak(sample.id, null))}
                          >
                            One-shot
                          </button>
                        </div>
                      </td>
                      <td className="mono muted">
                        {sample.break === null ? (
                          `${sample.duration.toFixed(2)} s`
                        ) : (
                          <span className="bars">
                            <input
                              type="number"
                              min={1}
                              max={64}
                              aria-label={`Bars in ${sample.name}`}
                              value={sample.break.bars}
                              disabled={sliced}
                              onChange={(e) => {
                                const bars = Math.round(Number(e.target.value));
                                if (bars >= 1) run(setBreak(sample.id, bars));
                              }}
                            />
                            bars · {sample.break.bpm.toFixed(1)} BPM
                          </span>
                        )}
                      </td>
                      <td>{creates(project, sample)}</td>
                      <td className="next">
                        {sample.break === null ? (
                          <button type="button" onClick={() => store.dispatch({ type: 'view', view: 'tag' })}>
                            Tag →
                          </button>
                        ) : sliced ? (
                          <button type="button" onClick={() => store.dispatch({ type: 'view', view: 'song' })}>
                            Song →
                          </button>
                        ) : (
                          <button type="button" onClick={() => goSlice(sample.id)}>
                            Slice →
                          </button>
                        )}
                      </td>
                    </tr>
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
