import { useMemo, type CSSProperties } from 'react';
import type { PassRow } from '../engine';
import { modPassRows } from '../engine';
import type { Id, Project } from '../model';
import { LANES, norm } from '../model';
import { fullValue } from './laneText';
import { TARGET_LABELS } from './modLabels';
import { formatTempo } from './ModSentence';

/** Where Play is in the mod's passes: the pass (from 0) and the loop's step in it. */
export interface PassPlace {
  readonly pass: number;
  readonly step: number;
}

interface ModPreviewProps {
  readonly project: Project;
  readonly modId: Id;
  readonly loopId: Id | null;
  /** Where Play is, or null when it does not play the mod. */
  readonly playing: PassPlace | null;
  readonly onLoop: (loopId: Id) => void;
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
/** The end of a name, as short as a cell: "amen 1 07" → "07". */
const shortName = (name: string | undefined) => (name === undefined ? '' : (name.split(' ').at(-1) ?? name));

/**
 * The preview (see Sidan): Plays on, the loop the mod plays on, and a grid
 * with the loop's steps and a row per effect showing what each step does in
 * this pass. While Play plays the mod, the pass playing; otherwise pass 1.
 */
export function ModPreview({ project, modId, loopId, playing, onLoop }: ModPreviewProps) {
  const pass = playing?.pass ?? 0;
  const loop = loopId === null ? undefined : project.loops[loopId];
  const rows = useMemo(() => (loopId === null ? [] : modPassRows(project, modId, loopId, pass)), [project, modId, loopId, pass]);
  const steps = loop?.steps ?? [];
  const columns: CSSProperties = { gridTemplateColumns: `minmax(72px, 110px) repeat(${steps.length}, minmax(14px, 1fr))` };
  const cellClass = (i: number, extra = '') => `pass-cell${steps[i]?.padId == null ? ' empty' : ''}${playing?.step === i ? ' now' : ''}${i % 4 === 0 ? ' beat' : ''}${extra}`;

  const laneRow = (row: Extract<PassRow, { kind: 'lane' }>) => {
    const range = LANES[row.target];
    const base = range.bipolar === true ? norm(row.target, range.zero) : 0;
    return row.cells.map((c, i) => {
      const value = c.value === null ? null : range.onOff === true ? (c.value >= 0.5 ? 1 : 0) : norm(row.target, c.value);
      const lo = value === null ? 0 : range.onOff === true ? 0 : Math.min(value, base);
      const hi = value === null ? 0 : range.onOff === true ? value * 0.9 : Math.max(value, base);
      const what = c.value === null ? 'nothing (chance)' : fullValue(row.effect, c.value);
      const title = `Step ${i + 1}: lane step ${c.laneStep + 1}, ${c.band !== null ? `🎲 this pass ${what}` : what}`;
      return (
        <span key={i} className={cellClass(i, `${c.restart ? ' restart' : ''}`)} title={title}>
          {c.band !== null && range.onOff !== true && (
            <span className="pass-band" style={{ bottom: pct(norm(row.target, c.band.lo)), height: pct(norm(row.target, c.band.hi) - norm(row.target, c.band.lo)) }} />
          )}
          {value !== null && <span className={`pass-bar${c.band !== null ? ' rolled' : ''}`} style={{ bottom: pct(lo), height: `max(2px, ${pct(hi - lo)})` }} />}
        </span>
      );
    });
  };

  const rowCells = (row: PassRow) => {
    switch (row.kind) {
      case 'lane':
        return laneRow(row);
      case 'swap':
        return row.cells.map((hitId, i) => {
          const hit = hitId === null ? undefined : project.hits[hitId];
          return (
            <span key={i} className={cellClass(i, hit !== undefined ? ' swapped' : '')} title={`Step ${i + 1}: ${hit !== undefined ? `Swap plays ${hit.name}` : 'as it is'}`}>
              {shortName(hit?.name)}
            </span>
          );
        });
      case 'tempo':
        return row.cells.map((speed, i) => (
          <span key={i} className={cellClass(i)} title={`Step ${i + 1}: ${speed === null ? 'in time' : `at ${formatTempo([speed])} of the tempo`}`}>
            {speed === null ? '' : formatTempo([speed])}
          </span>
        ));
      case 'tape': {
        const top = Math.max(1, ...row.cells);
        return row.cells.map((speed, i) => (
          <span key={i} className={cellClass(i)} title={`Step ${i + 1}: tape at ${Math.round(speed * 100) / 100}×`}>
            <span className="pass-bar" style={{ bottom: 0, height: `max(2px, ${pct(speed / top)})` }} />
          </span>
        ));
      }
      case 'halftime':
        return row.cells.map((speed, i) => (
          <span key={i} className={cellClass(i)} title={`Step ${i + 1}: what is heard at ×${speed}`}>
            ×{speed}
          </span>
        ));
    }
  };

  return (
    <section className="panel mod-preview" aria-label="Preview">
      <div className="row mod-preview-head">
        <h2 className="label">Preview</h2>
        <label className="field">
          Plays on
          <select aria-label="Plays on" value={loopId ?? ''} onChange={(e) => onLoop(e.target.value)}>
            {loopId === null && <option value="">No loops yet</option>}
            {Object.values(project.loops).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small push" aria-live="polite">
          {playing === null ? 'Pass 1 · each pass rolls the dice steps again' : `Pass ${pass + 1} · each pass rolls the dice steps again`}
        </span>
      </div>
      {loop === undefined ? (
        <p className="muted small">Make a loop in Loops to try the mod on.</p>
      ) : (
        <div className="pass-scroll">
          <div className="pass-grid" style={columns} role="group" aria-label={`What the mod does on ${loop.name}, pass ${pass + 1}`}>
            <span className="pass-label loop">
              {loop.name}
            </span>
            {steps.map((s, i) => {
              const pad = s.padId === null ? undefined : project.pads[s.padId];
              return (
                <span key={i} className={cellClass(i, ' hit')} title={pad === undefined ? `No hit on step ${i + 1}` : `${pad.name} on step ${i + 1}`}>
                  {pad === undefined ? '·' : shortName(pad.name)}
                </span>
              );
            })}
            {rows.map((row) => (
              <RowCells key={row.target} label={TARGET_LABELS[row.target]}>
                {rowCells(row)}
              </RowCells>
            ))}
          </div>
        </div>
      )}
      <p className="muted small">
        What you draw is what plays: each lane runs from the loop’s start and loops on its own length, so 3 steps of 1/16 fall differently on every beat. A value holds over its step and changes every hit in it; faint cells have no hit. Each pass rolls the dice steps again; in Song a clip keeps its roll until you reroll it.
      </p>
    </section>
  );
}

function RowCells({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="pass-label">
        {label}
      </span>
      {children}
    </>
  );
}
