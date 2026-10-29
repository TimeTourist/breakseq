import { useRef, useState } from 'react';
import { replaceProject } from '../model';
import { readProjectFile, writeProjectFile } from '../engine';
import { useApp, useProject, useRun } from './context';
import { timestamp } from './services';

/** The whole project with its audio as one .zip, to move it elsewhere; importing one replaces the project. */
export function ProjectFile() {
  const project = useProject();
  const run = useRun();
  const { services } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const importZip = async (file: File) => {
    try {
      setError(run(replaceProject(readProjectFile(new Uint8Array(await file.arrayBuffer())))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel stack-tight" aria-label="Project file">
      <h2 className="label">Project file</h2>
      <div className="row">
        <span className="muted small grow">The whole project with its audio, as one .zip. Importing one replaces this project; undo brings it back.</span>
        <button type="button" onClick={() => services.download(`breakseq-project-${timestamp()}.zip`, writeProjectFile(project), 'application/zip')}>
          Export .zip
        </button>
        <button type="button" onClick={() => input.current?.click()}>
          Import .zip
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".zip,application/zip"
          aria-label="Project file to import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void importZip(file);
            e.target.value = '';
          }}
        />
      </div>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
