import type { Matrix } from '../model';
import { sliceName, trimName } from '../model';
import { useApp, useOpen, useProject } from './context';
import { middleEllipsis } from './labels';

type Part = 'matrix' | 'slice' | 'trim' | 'file';

/**
 * Where a matrix comes from, each part a link to where it is edited: the
 * matrix (in Hits), ← Slice, ← Trim and the file (Import), its name shortened
 * in the middle as in Import. The full names are in the titles. A matrix built
 * by hand comes from no sample, and has only itself.
 */
export function MatrixOrigin({ matrix, parts }: { readonly matrix: Matrix; readonly parts: readonly Part[] }) {
  const project = useProject();
  const { store } = useApp();
  const open = useOpen();
  const sample = matrix.sampleId === null ? undefined : project.samples[matrix.sampleId];
  const toImport = () => {
    if (sample === undefined) return;
    store.dispatch({ type: 'trimming', sampleId: sample.id });
    store.dispatch({ type: 'view', view: 'import' });
  };
  const link = (part: Part) => {
    switch (part) {
      case 'matrix':
        return { text: `matrix ${matrix.name}`, title: 'Open the matrix in Hits', go: () => open({ matrix: matrix.id, pad: null, hit: null }, 'hits') };
      case 'slice':
        return sample === undefined || sample.bars === null
          ? null
          : {
              text: '← Slice',
              title: `Open ${sliceName(sample)} in Slice`,
              go: () => {
                store.dispatch({ type: 'sliceTarget', sampleId: sample.id });
                store.dispatch({ type: 'view', view: 'slice' });
              },
            };
      case 'trim':
        return sample === undefined ? null : { text: '← Trim', title: `Open ${trimName(sample)} in Import`, go: toImport };
      case 'file':
        return sample === undefined ? null : { text: middleEllipsis(sample.name), title: `${sample.name}, in Import`, go: toImport };
    }
  };
  const links = parts.flatMap((p) => {
    const l = link(p);
    return l === null ? [] : [{ part: p, ...l }];
  });
  return (
    <span className="origin row small muted">
      {links.map((l) => (
        <span key={l.part}>
          <button type="button" className="link-text small" title={l.title} onClick={l.go}>
            {l.text}
          </button>
        </span>
      ))}
    </span>
  );
}
