import type { Break, Usage } from '../model';
import { breakUsages, removeBreak } from '../model';
import { useOpen, useProject, useRun } from './context';

interface DeleteBreakProps {
  readonly brk: Break;
  /** After the break is gone, as when the view showed it. */
  readonly onDeleted?: () => void;
  readonly onError: (error: string | null) => void;
  /** Where the break is used as links, rather than as plain text. */
  readonly links?: boolean;
}

const usageText = (u: Usage) => (u.kind === 'song' ? 'Song' : `${u.kind} ${u.name}`);

/**
 * Removes a break with everything only it uses. Where it is used shows next to
 * the button; removing it anyway asks first, and it goes silent there.
 */
export function DeleteBreak({ brk, onDeleted, onError, links = false }: DeleteBreakProps) {
  const project = useProject();
  const run = useRun();
  const open = useOpen();
  const usages = breakUsages(project, brk.id);
  const label = brk.bars === null ? 'Delete one-shot' : 'Delete break';
  const where = usages.map(usageText).join(', ');
  return (
    <div className="row delete-break">
      <button
        type="button"
        className="small-button"
        aria-label={`${label} ${brk.name}`}
        title={usages.length > 0 ? `In use by ${where}: it goes silent there` : `${label}: its pads, hits and own loop go with it`}
        onClick={() => {
          if (usages.length > 0 && !window.confirm(`${brk.name} is used by ${where}. Delete it anyway? It goes silent there.`)) return;
          const failed = run(removeBreak(brk.id));
          onError(failed);
          if (failed === null) onDeleted?.();
        }}
      >
        {label}
      </button>
      {usages.length > 0 && (
        <span className="warn-text small in-use">
          In use by{' '}
          {links
            ? usages.map((u) => (
                <button
                  key={`${u.kind}:${u.id ?? ''}`}
                  type="button"
                  className="link-chip mono"
                  onClick={() => (u.kind === 'loop' ? open({ loop: u.id, step: null }, 'loops') : u.kind === 'pad' ? open({ pad: u.id, hit: null }, 'hits') : open({}, 'song'))}
                >
                  {usageText(u)}
                </button>
              ))
            : where}
        </span>
      )}
    </div>
  );
}
