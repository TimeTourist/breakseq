import { Fragment, useState } from 'react';
import type { Trigger } from '../engine';
import { matrixSong } from '../engine';
import type { Id, LoopKind, Project } from '../model';
import {
  STEPS_PER_BAR,
  baseName,
  createLoop,
  holds,
  holdsIn,
  loopMatrices,
  matrixOfPad,
  matrixSteps,
  moveSteps,
  padSteps,
  placeMatrix,
  renameLoop,
  sequence,
  setLoopKind,
  setStep,
  swapMatrix,
} from '../model';
import { MATRIX_MIME, PAD_MIME, STEP_MIME, copies, useDropTargets } from './dnd';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { FocusBar } from './FocusBar';
import { MatrixKindIcon } from './icons';
import { CHOICE_LABEL, HIT_COLOR, lengthText, padLabel, padSilent, shelfGroups } from './labels';
import { LoopLength } from './LoopLength';
import { Delete } from './DeleteButton';
import { InSong, InSongMark, useHeard } from './InSong';
import type { Selection } from './store';
import type { Services } from './services';

/**
 * Plays a matrix once as it is laid out in a loop (`matrixSong`), rendered and
 * then heard as an audition: beside the transport, cutting any other audition.
 */
export async function playMatrixOnce(services: Services, project: Project, matrixId: Id): Promise<void> {
  const take = await services.renderSong(matrixSong(project, matrixId), services.rng());
  const buffer = take.full ?? take.buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  services.player.audition({ sampleRate: buffer.sampleRate, channels }, 0, buffer.duration);
}

/** The loop open in Loops: the selected one, else the first. */
export function currentLoopId(project: Project, selection: Selection): Id | null {
  if (selection.loop !== null && project.loops[selection.loop] !== undefined) return selection.loop;
  return Object.keys(project.loops)[0] ?? null;
}

interface LoopsViewProps {
  /** The trigger under the playhead while the loop plays. */
  readonly playhead: Trigger | null;
}

export function LoopsView({ playhead }: LoopsViewProps) {
  const project = useProject();
  const { services, store } = useApp();
  const heard = useHeard();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const focus = useSelect((s) => s.focus);
  const [shelfPad, setShelfPad] = useState<Id | null>(null);
  const [shelfMatrix, setShelfMatrix] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drops = useDropTargets();
  /** How many steps what is dragged from the shelf takes, to show where it lands. */
  const [dragSteps, setDragSteps] = useState<number | null>(null);
  // The other end of a Shift-click range; the selected step is the first end.
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const loopId = currentLoopId(project, selection);
  const loop = loopId === null ? undefined : project.loops[loopId];
  /** How much of each step the sounds cover: a hit's own step, and its tail over the steps after it. */
  // Each hit holds the steps up to the next one, drawn as one box.
  const held = loop === undefined ? [] : holds(loop.steps.map((s) => s.padId != null));
  /** Where what is dragged from the shelf would land, up to the loop's end. */
  const overStep = drops.over?.startsWith('step:') === true ? Number(drops.over.slice('step:'.length)) : null;
  const landing =
    loop === undefined || dragSteps === null || overStep === null ? null : { start: overStep, length: Math.min(dragSteps, loop.steps.length - overStep) };
  /** Pads past their sample's last slice: they play nothing until it has more. */
  const silent = new Set(Object.values(project.pads).filter((p) => padSilent(project, p)).map((p) => p.id));
  const swappable = Object.values(project.matrices);
  const groups = shelfGroups(project, focus.matrix === null ? focus.takeFrom : [focus.matrix, ...focus.takeFrom]);
  /** Opens a pad in Pads, with the matrix it is a row of in focus. */
  const openPad = (padId: Id) => {
    const matrixId = matrixOfPad(project, padId)?.id ?? null;
    store.dispatch({ type: 'focus', matrix: matrixId });
    open({ pad: padId, hit: null, matrix: matrixId }, 'pads');
  };
  const openMatrix = (matrixId: Id) => {
    store.dispatch({ type: 'focus', matrix: matrixId });
    open({ matrix: matrixId, pad: null, hit: null }, 'pads');
  };
  const playMatrix = (matrixId: Id) =>
    playMatrixOnce(services, project, matrixId).catch((e: unknown) => setError(`Could not play it: ${e instanceof Error ? e.message : String(e)}`));

  const newLoop = (kind: LoopKind) => {
    const before = store.getState().history.present.loops;
    if (run(createLoop(null, kind, kind === 'main' ? 4 : 1)) === null) {
      const id = Object.keys(store.getState().history.present.loops).find((k) => !(k in before));
      if (id !== undefined) open({ loop: id, step: null }, 'loops');
    }
  };

  const loops = Object.values(project.loops);
  const sidebar = (
    <aside className="sidebar narrow" aria-label="Loops">
      <section className="stack-tight">
        <h2 className="label">Loops</h2>
        <button type="button" className="dashed" onClick={() => newLoop('main')}>
          + New loop
        </button>
        {loops.map((l) => (
          <button
            key={l.id}
            type="button"
            className="list-item"
            aria-current={l.id === loopId ? 'true' : undefined}
            onClick={() => open({ loop: l.id, step: null }, 'loops')}
          >
            <span className={`mono loop-name ${l.kind}`}>{l.name}</span>
            <InSongMark heard={heard.loops.has(l.id)} />
            <span className="grow" />
            <span className="muted small">{l.kind}</span>
            <span className="mono muted small">{lengthText(l.steps.length)}</span>
          </button>
        ))}
      </section>
    </aside>
  );

  if (loop === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <FocusBar what={null} />
          <div className="view-head">
            <h1>Loops</h1>
            <p className="muted">No loops yet. Slice a sample to get its loop, or make a new loop.</p>
          <div className="row nav-row">
            <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'samples' })}>
              ← Slice
            </button>
          </div>
          </div>
        </main>
      </div>
    );
  }

  const selectedStep = selection.step !== null && selection.step < loop.steps.length ? selection.step : null;
  const step = selectedStep === null ? undefined : loop.steps[selectedStep];
  const stepPad = step?.padId == null ? undefined : project.pads[step.padId];

  const range =
    selectedStep === null || rangeEnd === null || rangeEnd >= loop.steps.length
      ? null
      : { from: Math.min(selectedStep, rangeEnd), to: Math.max(selectedStep, rangeEnd) };
  const inRange = (index: number) => (range === null ? index === selectedStep : index >= range.from && index <= range.to);

  const place = (index: number, padId: Id | null) => setError(run(setStep(loop.id, index, { padId })));
  /** Empties the selected steps: the range, or the one step. */
  const clearSelected = () => {
    const [from, to] = range === null ? [selectedStep, selectedStep] : [range.from, range.to];
    if (from === null || to === null) return;
    setError(run(sequence(...Array.from({ length: to - from + 1 }, (_, i) => setStep(loop.id, from + i, { padId: null })))));
  };
  /** A pad from the shelf, or another step: moved, or copied with Ctrl (or Alt). */
  const dropOnStep = (index: number) =>
    drops.bind(`step:${index}`, [PAD_MIME, MATRIX_MIME, STEP_MIME], (e, type) => {
      if (type === PAD_MIME) {
        place(index, e.dataTransfer.getData(PAD_MIME));
      } else if (type === MATRIX_MIME) {
        setError(run(placeMatrix(loop.id, e.dataTransfer.getData(MATRIX_MIME), index)));
      } else {
        // A block of steps, grabbed at one of them: that one lands here.
        const { from, count, grab } = JSON.parse(e.dataTransfer.getData(STEP_MIME)) as { from: number; count: number; grab: number };
        const to = index - grab;
        if (to === from) return;
        const failed = run(moveSteps(loop.id, from, count, to, copies(e)));
        setError(failed);
        if (failed === null) {
          const start = Math.max(0, to);
          open({ step: start }, 'loops');
          setRangeEnd(count > 1 ? Math.min(loop.steps.length - 1, to + count - 1) : null);
        }
        return;
      }
      setRangeEnd(null);
      open({ step: index }, 'loops');
    });
  const clickStep = (index: number, shift: boolean) => {
    // Shift-click selects every step from the selected one to here.
    if (shift && selectedStep !== null && shelfPad === null && shelfMatrix === null) {
      setRangeEnd(index === selectedStep ? null : index);
      return;
    }
    setRangeEnd(null);
    if (shelfPad !== null) place(index, shelfPad);
    if (shelfMatrix !== null) setError(run(placeMatrix(loop.id, shelfMatrix, index)));
    open({ step: index }, 'loops');
  };

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        <FocusBar what={null} />
        <div className="view-head row">
          <label className="sr-only" htmlFor="loop-name">
            Loop name
          </label>
          <div className="stack-tight grow">
            <input
              id="loop-name"
              className={`title-input mono loop-name ${loop.kind}`}
              value={loop.name}
              onChange={(e) => setError(run(renameLoop(loop.id, e.target.value), `loop:${loop.id}:name`))}
              onBlur={seal}
            />
            <div className="row">
              <div className="segmented" role="group" aria-label="Tag as">
                {(['main', 'fill'] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={loop.kind === k} onClick={() => setError(run(setLoopKind(loop.id, k)))}>
                    {k === 'main' ? 'Main' : 'Fill'}
                  </button>
                ))}
              </div>
              <LoopLength loop={loop} onError={setError} />
              <InSong heard={heard.loops.has(loop.id)} />
            </div>
          </div>
          <div className="row push">
            <button type="button" disabled={range === null && step?.padId == null} onClick={clearSelected}>
              {range === null ? 'Clear step' : `Clear ${range.to - range.from + 1} steps`}
            </button>
            <Delete kind="loop" id={loop.id} name={loop.name} onError={setError} onDeleted={() => open({ loop: null, step: null }, 'loops')} />
          </div>
        </div>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {loopMatrices(project, loop).length > 0 && swappable.length > 1 && (
          <div className="row matrix-swaps" aria-label="Matrices in the loop">
            {loopMatrices(project, loop).map((m) => (
              <div key={m.id} className="field inline">
                <span className="muted">Matrix</span>
                <button type="button" className="link-text mono" title="Open the matrix in Pads" onClick={() => openMatrix(m.id)}>
                  {m.name}
                </button>
                →
                <select
                  aria-label={`Swap ${m.name} for`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') setError(run(swapMatrix(loop.id, m.id, e.target.value)));
                  }}
                >
                  <option value="">swap for…</option>
                  {swappable
                    .filter((o) => o.id !== m.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="table-scroll steps-box">
          <div className="steps">
            <div className="step-row mono muted small">
              <span />
              {Array.from({ length: STEPS_PER_BAR }, (_, s) => (
                <span key={s} className={`step-num${s % 4 === 0 ? ' downbeat' : ''}`}>
                  {String(s + 1).padStart(2, '0')}
                </span>
              ))}
            </div>
            {Array.from({ length: Math.ceil(loop.steps.length / STEPS_PER_BAR) }, (_, bar) => (
              <Fragment key={bar}>
              <div className="step-row">
                <span className="mono muted small">T{bar + 1}</span>
                {Array.from({ length: Math.min(STEPS_PER_BAR, loop.steps.length - bar * STEPS_PER_BAR) }, (_, s) => {
                  const index = bar * STEPS_PER_BAR + s;
                  const cell = loop.steps[index];
                  const pad = cell?.padId == null ? undefined : project.pads[cell.padId];
                  const memberIndex = pad === undefined || cell?.memberId == null ? 0 : Math.max(0, pad.members.indexOf(cell.memberId));
                  const color = pad === undefined ? undefined : HIT_COLOR;
                  const now = playhead !== null && playhead.bar === bar && playhead.step === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      style={{ gridColumn: s + 2, gridRow: 1, ...(color === undefined ? {} : { color }) }}
                      className={`step${pad !== undefined ? ' filled' : ''}${pad !== undefined && silent.has(pad.id) ? ' silent' : ''}${inRange(index) ? ' selected' : ''}${now ? ' now' : ''}${s % 4 === 0 ? ' downbeat' : ''}${drops.isOver(`step:${index}`) ? ' drop-over' : ''}`}
                      draggable={pad !== undefined || (range !== null && inRange(index))}
                      onDragStart={(e) => {
                        const block = range !== null && inRange(index) ? range : { from: index, to: index };
                        e.dataTransfer.setData(STEP_MIME, JSON.stringify({ from: block.from, count: block.to - block.from + 1, grab: index - block.from }));
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onDragEnd={drops.clear}
                      {...dropOnStep(index)}
                      aria-label={`Bar ${bar + 1}, step ${s + 1}: ${pad === undefined ? 'empty' : cell?.memberId == null && pad.choice !== 'top' ? `${pad.name}, ${CHOICE_LABEL[pad.choice].toLowerCase()}` : `${pad.name}, member ${memberIndex + 1}`}`}
                      onClick={(e) => clickStep(index, e.shiftKey)}
                      onDoubleClick={() => {
                        if (pad !== undefined) openPad(pad.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault();
                          if (range !== null && inRange(index)) clearSelected();
                          else if (pad !== undefined) place(index, null);
                        }
                      }}
                    >
                      <span className="cell-label">{pad === undefined ? '' : padLabel(pad)}</span>
                      <span className="cell-sub">
                        {pad === undefined ? '' : `${pad.members.length > 1 ? `${memberIndex + 1}/${pad.members.length}` : ''}${cell?.ignoreMods === true ? ' ⊘' : ''}`}
                      </span>
                    </button>
                  );
                })}
                {holdsIn(held, bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).map((h) => (
                  <span key={`hold-${h.start}`} className="hold" style={{ gridColumn: `${h.start - bar * STEPS_PER_BAR + 2} / span ${h.length}`, gridRow: 1 }} aria-hidden="true" />
                ))}
                {landing !== null &&
                  holdsIn([landing], bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).map((h) => (
                    <span key="landing" className="hold landing" style={{ gridColumn: `${h.start - bar * STEPS_PER_BAR + 2} / span ${h.length}`, gridRow: 1 }} aria-hidden="true" />
                  ))}
              </div>
              </Fragment>
            ))}
          </div>
        </div>

        <section className="panel stack-tight">
          <div className="row spread">
            <h2 className="label">Pads</h2>
            <button type="button" className="link-text small" title="Opens Pads" onClick={() => open({}, 'pads')}>
              Build pads →
            </button>
          </div>
          <div className="shelf">
          {groups.length === 0 && <p className="muted small">Choose a matrix in focus above, and the ones to take from.</p>}
          {groups.map((group) => (
            <div key={group.matrixId} className="shelf-group">
              <span className="muted small shelf-label ellipsis row nowrap" title={group.name}>
                <MatrixKindIcon kind={group.kind} /> {group.name}
              </span>
              <div className="row">
                <button
                  type="button"
                  draggable
                  className="chip parent-chip"
                  aria-pressed={shelfMatrix === group.matrixId}
                  aria-label={`Matrix ${group.name}: lay out all its pads`}
                  title="The whole matrix: a click plays it once and selects it; it lays out its pads one after another from the step. Double-click to edit it in Pads"
                  onDoubleClick={() => openMatrix(group.matrixId)}
                  onClick={() => {
                    setShelfMatrix(shelfMatrix === group.matrixId ? null : group.matrixId);
                    void playMatrix(group.matrixId);
                    setShelfPad(null);
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MATRIX_MIME, group.matrixId);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragSteps(matrixSteps(project, group.matrixId));
                  }}
                  onDragEnd={() => {
                    setDragSteps(null);
                    drops.clear();
                  }}
                >
                  {baseName(group.name)} ▸ all <span className="chip-steps">{lengthText(matrixSteps(project, group.matrixId))}</span>
                </button>
                {group.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    draggable
                    className={`chip mono${silent.has(p.id) ? ' silent' : ''}`}
                    onDoubleClick={() => openPad(p.id)}
                    aria-pressed={shelfPad === p.id}
                    aria-label={`Pad ${p.name}`}
                    title={silent.has(p.id) ? `${p.name}: silent, its sample has fewer slices` : `${p.name} · ${lengthText(Math.max(1, padSteps(project, p)))} · double-click to edit in Pads`}
                    style={{ color: HIT_COLOR, boxShadow: `inset 0 -3px 0 ${HIT_COLOR}` }}
                    onClick={() => {
                      setShelfPad(shelfPad === p.id ? null : p.id);
                      setShelfMatrix(null);
                      if (p.members[0] !== undefined) services.player.playHit(project, p.members[0]);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PAD_MIME, p.id);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDragSteps(Math.max(1, padSteps(project, p)));
                    }}
                    onDragEnd={() => {
                      setDragSteps(null);
                      drops.clear();
                    }}
                  >
                    {padLabel(p)}
                    {padSteps(project, p) > 0 && <span className="chip-steps"> ·{padSteps(project, p)}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
          <p className="muted small">Drag a pad or a whole matrix onto a step, or select it and click steps. A click on a pad plays it once; a double-click edits it in Pads.</p>
        </section>
      </main>

      <aside className="sidebar right" aria-label="Step">
        <section className="stack-tight">
          <h2 className="label">Step</h2>
          {selectedStep === null ? (
            <p className="muted small">Click a step to edit it.</p>
          ) : (
            <>
              <div className="mono step-title">
                T{Math.floor(selectedStep / STEPS_PER_BAR) + 1} · {String((selectedStep % STEPS_PER_BAR) + 1).padStart(2, '0')}
              </div>
              {stepPad === undefined ? (
                <p className="muted small">Empty. Drag a pad here, or select one below and click the step.</p>
              ) : (
                <div className="panel row spread">
                  <span className="mono" style={{ color: HIT_COLOR }}>
                    {stepPad.name}
                  </span>
                  <button type="button" className="link-text small" onClick={() => openPad(stepPad.id)}>
                    Pads →
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {stepPad !== undefined && step !== undefined && selectedStep !== null && (
          <>
            <section className="stack-tight" aria-label="Member on this step">
              <h2 className="label">Member on this step</h2>
              {stepPad.members.length > 0 && (
                <button
                  type="button"
                  className="list-item"
                  aria-pressed={step.memberId === null}
                  onClick={() => setError(run(setStep(loop.id, selectedStep, { memberId: null })))}
                >
                  <span className="mono muted">·</span>
                  <span className="grow">The pad picks</span>
                  <span className="muted small">{CHOICE_LABEL[stepPad.choice]}</span>
                </button>
              )}
              {stepPad.members.map((hitId, i) => (
                <button
                  key={hitId}
                  type="button"
                  className="list-item"
                  aria-pressed={step.memberId === hitId}
                  onClick={() => setError(run(setStep(loop.id, selectedStep, { memberId: hitId })))}
                >
                  <span className="mono muted">{i + 1}</span>
                  <span className="mono grow ellipsis">{baseName(project.hits[hitId]?.name ?? '')}</span>
                  <span className="muted small">{step.memberId === hitId ? 'locked' : ''}</span>
                </button>
              ))}
              {stepPad.members.length === 0 && <p className="muted small">The pad is empty and plays nothing.</p>}
            </section>
            <section className="stack-tight">
              <h2 className="label">Step locks</h2>
              <label className="check spread">
                Ignore mods
                <input
                  type="checkbox"
                  checked={step.ignoreMods}
                  onChange={(e) => setError(run(setStep(loop.id, selectedStep, { ignoreMods: e.target.checked })))}
                />
              </label>
              <label className="check spread muted">
                Nudge <span className="mono small">later</span>
                <input type="range" disabled min={-50} max={50} value={0} readOnly />
              </label>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
