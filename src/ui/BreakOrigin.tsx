import type { Break } from '../model';
import { sliceName, trimName } from '../model';
import { useApp, useOpen, useProject } from './context';
import { middleEllipsis } from './labels';

type Part = 'break' | 'slice' | 'trim' | 'file';

/**
 * Where a break comes from, each part a link to where it is edited: the break
 * (its parent, in Hits), ← Slice, ← Trim and the file (Import), its name
 * shortened in the middle as in Import. The full names are in the titles.
 */
export function BreakOrigin({ brk, parts }: { readonly brk: Break; readonly parts: readonly Part[] }) {
  const project = useProject();
  const { store } = useApp();
  const open = useOpen();
  const sample = project.samples[brk.sampleId];
  const toImport = () => {
    store.dispatch({ type: 'trimming', breakId: brk.id });
    store.dispatch({ type: 'view', view: 'import' });
  };
  const link = (part: Part) => {
    switch (part) {
      case 'break': {
        const hit = brk.parent ?? project.pads[brk.pads[0] ?? '']?.members[0];
        return hit === undefined ? null : { text: `break ${brk.name}`, title: 'Open the break in Hits', go: () => open({ hit, pad: null }, 'hits') };
      }
      case 'slice':
        return brk.bars === null
          ? null
          : {
              text: '← Slice',
              title: `Open ${sliceName(project, brk)} in Slice`,
              go: () => {
                store.dispatch({ type: 'sliceTarget', breakId: brk.id });
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
