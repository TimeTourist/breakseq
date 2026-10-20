import { useRef, useState } from 'react';
import type { Command, Hit, Id, Matrix, Pad } from '../model';
import {
  PAD_CHOICES,
  addVariant,
  effectiveHit,
  fitBpm,
  hitStretch,
  matrixOfPad,
  movePad,
  padOfHit,
  renamePad,
  sampleAudio,
  setHitSource,
  setMatrixConfig,
  setPadChoice,
  setPadConfig,
  sliceWindow,
  trimName,
  updateHit,
} from '../model';
import { ConfigPanels, anyTempo, ownStretch } from './ConfigPanels';
import type { Layer } from './ConfigPanels';
import { useApp, useOpen, useProject, useRun, useSeal } from './context';
import { Delete } from './DeleteButton';
import { CHOICE_LABEL } from './labels';
import type { PadsOpen } from './pads';
import { rowNumber } from './pads';
import { RenameInPlace } from './RenameInPlace';
import { RegionHandle } from './RegionHandle';
import { Waveform } from './Waveform';

/** The main Play while it plays what Pads shows: the key of what plays (see subjectOf), seconds into its take and the take's length. */
export interface PadsPlay {
  readonly playing: boolean;
  readonly onToggle: () => void;
  readonly played: { readonly key: string; readonly seconds: number; readonly duration: number } | null;
}

const ms = (seconds: number) => Math.round(seconds * 1000);

/**
 * Runs a command that adds one object to `key` of the project, then hands
 * the new object's id to `then`, as when + Pad or Variant opens what it made.
 */
export function useRunAdding(onError: (error: string | null) => void) {
  const { store } = useApp();
  const run = useRun();
  return <K extends 'matrices' | 'pads' | 'hits'>(command: Command, key: K, then: (id: Id) => void) => {
    const before = store.getState().history.present[key];
    const failed = run(command);
    onError(failed);
    if (failed !== null) return;
    const id = Object.keys(store.getState().history.present[key]).find((k) => !(k in before));
    if (id !== undefined) then(id);
  };
}

interface ControlsProps {
  readonly open: PadsOpen;
  readonly onError: (error: string | null) => void;
  /** Asks to delete what is selected each time this changes (the Delete key). */
  readonly ask?: number | undefined;
}

/**
 * The controls under the grid, for what is selected: a hit, a pad, or the
 * matrix. The link row under the tabs says which; every setting shows, none
 * folded away (Magnus beslut).
 */
export function ControlsPanel({ open, onError, ask }: ControlsProps) {
  return open.kind === 'hit' ? (
    <HitControls key={open.hit.id} hit={open.hit} onError={onError} ask={ask} />
  ) : open.kind === 'pad' ? (
    <PadControls key={open.pad.id} pad={open.pad} matrix={open.matrix} onError={onError} ask={ask} />
  ) : (
    <MatrixControls matrix={open.matrix} onError={onError} />
  );
}

/** A panel's sound settings under a label and a line of help. */
function Sound({ label, help, layer }: { readonly label: string; readonly help: string; readonly layer: Layer }) {
  return (
    <div className="stack-tight" role="group" aria-label={label}>
      <div className="sound-head">
        <span className="label">{label}</span>
        <span className="muted small">{help}</span>
      </div>
      <ConfigPanels layer={layer} />
    </div>
  );
}

/** The matrix's config, laid over every pad. */
function MatrixControls({ matrix, onError }: { readonly matrix: Matrix; readonly onError: (error: string | null) => void }) {
  const project = useProject();
  const run = useRun();
  const layer: Layer = {
    config: matrix.config,
    set: (patch, field) => onError(run(setMatrixConfig(matrix.id, patch), `matrix:${matrix.id}:${field}`)),
    above: [],
    canFit: anyTempo(project, matrix.pads),
    pitchPlays: null,
    played: ownStretch(matrix.config, []),
  };
  return (
    <section className="panel stack" aria-label="Matrix controls">
      <Sound label="Matrix sound" help="Applies to every pad of the matrix. Click a pad or a hit for its own." layer={layer} />
    </section>
  );
}

/**
 * A pad (Magnus beslut): one header row with Rename, ← and → that move it a
 * place in the matrix, Delete, how it picks (Pad plays) and how many hits it
 * has; under it the pad's sound, laid over all its hits. Its hits are in the
 * grid: dragged up or down there to reorder, and dragged in from the list.
 */
function PadControls({ pad, matrix, onError, ask }: { readonly pad: Pad; readonly matrix: Matrix; readonly onError: (error: string | null) => void; readonly ask?: number | undefined }) {
  const project = useProject();
  const run = useRun();
  const open = useOpen();
  const row = matrix.pads.indexOf(pad.id);
  const above = [{ name: 'matrix' as const, config: matrix.config }];
  const layer: Layer = {
    config: pad.config,
    set: (patch, field) => onError(run(setPadConfig(pad.id, patch), `pad:${pad.id}:${field}`)),
    above,
    canFit: anyTempo(project, [pad.id]),
    pitchPlays: null,
    played: ownStretch(pad.config, above),
  };
  return (
    <section className="panel stack" aria-label="Pad controls">
      <div className="box-head">
        <span className="label">Pad</span>
        <RenameInPlace key={pad.id} name={pad.name} what="pad" onRename={(name) => run(renamePad(pad.id, name))} onError={onError} />
        <button type="button" className="icon-button small" aria-label={`Move ${pad.name} left`} title="One place earlier in the matrix" disabled={row === 0} onClick={() => onError(run(movePad(matrix.id, pad.id, row - 1)))}>
          ←
        </button>
        <button
          type="button"
          className="icon-button small"
          aria-label={`Move ${pad.name} right`}
          title="One place later in the matrix"
          disabled={row === matrix.pads.length - 1}
          onClick={() => onError(run(movePad(matrix.id, pad.id, row + 1)))}
        >
          →
        </button>
        <Delete kind="pad" id={pad.id} name={pad.name} onError={onError} ask={ask} icon onDeleted={() => open({ pad: null, hit: null, matrix: matrix.id }, 'pads')} />
        <span className="label pad-plays-label">Pad plays</span>
        <div className="segmented" role="group" aria-label="Pad plays" title="A step lock goes first, then a mod, then the pad’s own choice">
          {PAD_CHOICES.map((c) => (
            <button key={c} type="button" aria-pressed={pad.choice === c} onClick={() => onError(run(setPadChoice(pad.id, c)))}>
              {CHOICE_LABEL[c]}
            </button>
          ))}
        </div>
        <span className="muted small mono push">
          {pad.members.length} hit{pad.members.length === 1 ? '' : 's'}
        </span>
      </div>
      <Sound label="Pad sound" help="Laid over every hit of the pad: pitch, volume and pan add, the rest applies where a hit has none of its own." layer={layer} />
    </section>
  );
}

/**
 * Which sample and slice a hit plays: any sample, a slice of it or the whole
 * of it. Its own config and region stay.
 */
function ReplacePanel({ hit, onError }: { readonly hit: Hit; readonly onError: (error: string | null) => void }) {
  const project = useProject();
  const run = useRun();
  const samples = Object.values(project.samples);
  const sample = project.samples[hit.sampleId];
  const slices = sample === undefined || sample.bars === null ? 0 : Math.max(sample.markers.length, (hit.slice ?? -1) + 1);
  return (
    <section className="panel row" aria-label="Replace">
      <span className="muted">Plays</span>
      <select
        aria-label="Sample the hit plays"
        value={hit.sampleId}
        onChange={(e) => {
          const next = project.samples[e.target.value];
          if (next !== undefined) onError(run(setHitSource(hit.id, next.id, next.bars === null ? null : Math.min(hit.slice ?? 0, next.markers.length - 1))));
        }}
      >
        {samples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.bars === null ? `${trimName(s)} (not sliced)` : trimName(s)}
          </option>
        ))}
      </select>
      {sample !== undefined && sample.bars !== null && (
        <select
          aria-label="Slice the hit plays"
          value={hit.slice === null ? 'whole' : String(hit.slice)}
          onChange={(e) => onError(run(setHitSource(hit.id, sample.id, e.target.value === 'whole' ? null : Number(e.target.value))))}
        >
          {Array.from({ length: slices }, (_, i) => (
            <option key={i} value={i}>
              Slice {rowNumber(i)}
              {i >= sample.markers.length ? ' (silent)' : ''}
            </option>
          ))}
          <option value="whole">The whole sample</option>
        </select>
      )}
      <span className="muted small">Its own settings and region stay.</span>
    </section>
  );
}

/**
 * A hit (Magnus beslut): one header row with Rename, Replace…, Variant,
 * Delete and what it plays; under it its region of its slice with handles,
 * and its own sound under its pad's and matrix's.
 */
function HitControls({ hit, onError, ask }: { readonly hit: Hit; readonly onError: (error: string | null) => void; readonly ask?: number | undefined }) {
  const project = useProject();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const adding = useRunAdding(onError);
  const [replacing, setReplacing] = useState(false);
  const wave = useRef<HTMLDivElement>(null);
  const sample = project.samples[hit.sampleId];
  const audio = sample === undefined ? undefined : sampleAudio(project, sample);
  const source = hit.variantOf === null ? undefined : project.hits[hit.variantOf];
  const edit = (patch: Partial<Omit<Hit, 'id' | 'sampleId' | 'slice'>>, field: string) => onError(run(updateHit(hit.id, patch), `hit:${hit.id}:${field}`));
  // The slice the hit plays, in seconds of its sample; the region is a part of it.
  const window = sample === undefined ? null : sliceWindow(sample, hit.slice);
  const duration = window === null ? 0 : window.end - window.start;
  const region = { start: hit.region.start * duration, end: hit.region.end * duration };
  const toPart = (seconds: number) => (duration > 0 ? seconds / duration : 0);
  const setStart = (seconds: number) => edit({ region: { start: Math.max(0, Math.min(toPart(seconds), hit.region.end - toPart(0.001))), end: hit.region.end } }, 'start');
  const setEnd = (seconds: number) => edit({ region: { start: hit.region.start, end: Math.min(1, Math.max(toPart(seconds), hit.region.start + toPart(0.001))) } }, 'end');
  /** One end of the region, as Trim's: dragged, or moved with ←/→ (Shift: 10 ms). */
  const handle = (which: 'start' | 'end') => (
    <RegionHandle
      which={which}
      left={`${(which === 'start' ? hit.region.start : hit.region.end) * 100}%`}
      label={`${which === 'start' ? 'Start' : 'End'} at ${ms(which === 'start' ? region.start : region.end)} ms`}
      onDrag={(x) => {
        const rect = wave.current?.getBoundingClientRect();
        if (rect === undefined || rect.width === 0) return;
        const t = Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * duration;
        if (which === 'start') setStart(t);
        else setEnd(t);
      }}
      onNudge={(direction, big) => {
        const delta = (direction * (big ? 10 : 1)) / 1000;
        if (which === 'start') setStart(region.start + delta);
        else setEnd(region.end + delta);
      }}
      onDone={seal}
    />
  );
  const what =
    sample === undefined ? 'a missing sample' : hit.slice === null || sample.bars === null ? `all of ${trimName(sample)}` : `slice ${rowNumber(hit.slice)} of ${trimName(sample)}`;
  const hitPad = padOfHit(project, hit.id);
  const hitMatrix = hitPad === undefined ? undefined : matrixOfPad(project, hitPad.id);
  const layers = [
    ...(hitPad === undefined ? [] : [{ name: 'pad' as const, config: hitPad.config }]),
    ...(hitMatrix === undefined ? [] : [{ name: 'matrix' as const, config: hitMatrix.config }]),
  ];
  const layer: Layer = {
    config: hit,
    set: (patch, field) => edit(patch, field),
    above: layers,
    canFit: sample !== undefined && fitBpm(sample, project.song.bpm) !== null,
    pitchPlays: effectiveHit(project, hit).pitch,
    played: hitStretch(project, hit),
  };
  return (
    <section className="panel stack" aria-label="Hit controls">
      <div className="box-head">
        <span className="label">Hit</span>
        <RenameInPlace key={hit.id} name={hit.name} what="hit" onRename={(name) => run(updateHit(hit.id, { name }))} onError={onError} />
        <button type="button" aria-expanded={replacing} title="Play another slice or sample; its settings and region stay" onClick={() => setReplacing(!replacing)}>
          Replace…
        </button>
        <button
          type="button"
          title="A copy of this hit in the same pad, to change: reversed, pitched, shorter"
          onClick={() => adding(addVariant(hit.id, `${hit.name} var`), 'hits', (id) => open({ hit: id }, 'pads'))}
        >
          Variant
        </button>
        <Delete kind="hit" id={hit.id} name={hit.name} onError={onError} ask={ask} icon onDeleted={() => open({ hit: null }, 'pads')} />
        <span className="muted small mono push ellipsis" title={source === undefined ? undefined : `Variant of ${source.name}`}>
          plays {what}
        </span>
      </div>
      {window === null && sample !== undefined && <p className="muted">{`Silent: ${trimName(sample)} has ${sample.markers.length} slices`}</p>}

      {replacing && <ReplacePanel hit={hit} onError={onError} />}

      {audio !== undefined && sample !== undefined && window !== null && duration > 0 && (
        <div className="panel wave-panel">
          <div className="wave-region" ref={wave}>
            <Waveform audio={audio} offset={sample.offset + window.start} duration={duration} height={160} />
            <div className="region-shade" style={{ left: 0, width: `${hit.region.start * 100}%` }} />
            <div className="region-shade" style={{ left: `${hit.region.end * 100}%`, right: 0 }} />
            {handle('start')}
            {handle('end')}
          </div>
          <div className="row">
            <label className="field">
              Start ms
              <input type="number" min={0} max={ms(region.end) - 1} value={ms(region.start)} onChange={(e) => setStart(Number(e.target.value) / 1000)} onBlur={seal} />
            </label>
            <label className="field">
              End ms
              <input type="number" min={ms(region.start) + 1} max={ms(duration)} value={ms(region.end)} onChange={(e) => setEnd(Number(e.target.value) / 1000)} onBlur={seal} />
            </label>
            <span className="mono muted small">
              {ms(region.end - region.start)} ms of {ms(duration)} ms{hit.direction === 'reverse' ? ' · plays reversed' : ''}
            </span>
          </div>
          <p className="muted small">Drag the handles, or focus one and use ←/→ (Shift: 10 ms).</p>
        </div>
      )}

      <Sound label="Hit sound" help="Its own; the pad’s and the matrix’s are laid over it." layer={layer} />
    </section>
  );
}
