import { useEffect, useState } from 'react';
import type { Loop } from '../model';
import { MAX_LOOP_STEPS, STEPS_PER_BAR, setLoopLength } from '../model';
import { useRun, useSeal } from './context';
import { useCommitAfterPause } from './usePause';

const PARTS = [
  { key: 'bars', label: 'Bars', size: STEPS_PER_BAR, max: 16 },
  { key: 'beats', label: 'Beats', size: 4, max: 3 },
  { key: 'sixteenths', label: '1/16', size: 1, max: 3 },
] as const;

/** The steps the fields add up to, or null if one is not a whole number ≥ 0. */
function totalOf(drafts: readonly string[]): number | null {
  const values = drafts.map((d) => (d.trim() === '' ? NaN : Number(d)));
  if (values.some((v) => !Number.isInteger(v) || v < 0)) return null;
  return values.reduce((sum, v, i) => sum + v * PARTS[i]!.size, 0);
}

const split = (length: number) => [Math.floor(length / STEPS_PER_BAR), Math.floor((length % STEPS_PER_BAR) / 4), length % 4];

/** A loop's length as bars, beats and sixteenths; the smallest step is 1/16. */
export function LoopLength({ loop, onError }: { loop: Loop; onError: (error: string | null) => void }) {
  const run = useRun();
  const seal = useSeal();
  const length = loop.steps.length;
  const [drafts, setDrafts] = useState(() => split(length).map(String));
  useEffect(() => {
    setDrafts(split(length).map(String));
  }, [length, loop.id]);

  // Saved when you leave the fields, press Enter or rest typing, so a length on the way (4 bars → 0 → 6/16) drops no steps.
  const commit = (leaving: boolean, pausing = false) => {
    const total = totalOf(drafts);
    if (pausing && (total === null || total === 0 || total > MAX_LOOP_STEPS)) return;
    if (total === 0) {
      onError('A loop is at least 1/16');
      if (leaving) setDrafts(split(length).map(String));
    } else if (total === null || total > MAX_LOOP_STEPS) {
      setDrafts(split(length).map(String));
    } else if (total !== length) {
      onError(run(setLoopLength(loop.id, total)));
      seal();
    }
  };

  const typed = drafts.join(' ');
  useCommitAfterPause(typed === split(length).join(' ') ? null : typed, () => commit(false, true));

  return (
    <div
      className="row loop-length"
      role="group"
      aria-label="Length"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) commit(true);
      }}
    >
      {PARTS.map((part, i) => (
        <label key={part.key} className="field">
          {part.label}
          <input
            type="number"
            min={0}
            max={part.max}
            value={drafts[i]}
            onChange={(e) => setDrafts(drafts.map((d, k) => (k === i ? e.target.value : d)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(false);
            }}
          />
        </label>
      ))}
    </div>
  );
}
