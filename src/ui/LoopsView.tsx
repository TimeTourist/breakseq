import { Fragment, useEffect, useState } from 'react';
import type { Trigger } from '../engine';
import type { Id, LoopKind, Project } from '../model';
import { STEPS_PER_BAR, baseName, createLoop, remove, renameLoop, sequence, setLoopBars, setStep } from '../model';
import { STEP_MIME, copies, useDropTargets } from './dnd';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { hitColor, loopUsage, padColor, padGroups, padLabel } from './labels';
import type { Selection } from './store';
import { FillWindowStrip } from './FillWindow';

export const PAD_MIME = 'application/x-breakseq-pad';

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
  const { store } = useApp();
  const run = useRun();
  const seal = useSeal();
  const open = useOpen();
  const selection = useSelect((s) => s.selection);
  const [shelfPad, setShelfPad] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drops = useDropTargets();
  const loopId = currentLoopId(project, selection);
  const loop = loopId === null ? undefined : project.loops[loopId];
  const [barsDraft, setBarsDraft] = useState(String(loop?.bars ?? 1));
  useEffect(() => setBarsDraft(String(loop?.bars ?? 1)), [loop?.bars, loopId]);

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
      {(['main', 'fill'] as const).map((kind) => (
        <section key={kind} className="stack-tight">
          <h2 className="label">{kind === 'main' ? 'Mains' : 'Fills'}</h2>
          {loops
            .filter((l) => l.kind === kind)
            .map((l) => (
              <button
                key={l.id}
                type="button"
                className="list-item"
                aria-current={l.id === loopId ? 'true' : undefined}
                onClick={() => open({ loop: l.id, step: null }, 'loops')}
              >
                <span className={`mono loop-name ${kind}`}>{l.name}</span>
                <span className="grow" />
                <span className="mono muted small">{l.bars} bar{l.bars === 1 ? '' : 's'}</span>
              </button>
            ))}
          <button type="button" className="dashed" onClick={() => newLoop(kind)}>
            + New {kind}
          </button>
        </section>
      ))}
    </aside>
  );

  if (loop === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Loops</h1>
            <p className="muted">No loops yet. Slice a break to get M1, or make a new loop.</p>
          </div>
        </main>
      </div>
    );
  }

  const selectedStep = selection.step !== null && selection.step < loop.steps.length ? selection.step : null;
  const step = selectedStep === null ? undefined : loop.steps[selectedStep];
  const stepPad = step?.padId == null ? undefined : project.pads[step.padId];
  const usedInSong = loopUsage(project, loop.id);

  const place = (index: number, padId: Id | null) => setError(run(setStep(loop.id, index, { padId })));
  /** A pad from the shelf, or another step: moved, or copied with Alt. */
  const dropOnStep = (index: number) =>
    drops.bind(`step:${index}`, [PAD_MIME, STEP_MIME], (e, type) => {
      if (type === PAD_MIME) {
        place(index, e.dataTransfer.getData(PAD_MIME));
      } else {
        const from = Number(e.dataTransfer.getData(STEP_MIME));
        const source = loop.steps[from];
        if (source === undefined || from === index) return;
        const copy = setStep(loop.id, index, { padId: source.padId, memberId: source.memberId, ignoreMods: source.ignoreMods });
        setError(run(copies(e) ? copy : sequence(copy, setStep(loop.id, from, { padId: null, memberId: null, ignoreMods: false }))));
      }
      open({ step: index }, 'loops');
    });
  const clickStep = (index: number) => {
    if (shelfPad !== null) place(index, shelfPad);
    open({ step: index }, 'loops');
  };

  return (
    <div className="split">
      {sidebar}
      <main className="view">
        <div className="view-head row">
          <label className="sr-only" htmlFor="loop-name">
            Loop name
          </label>
          <input
            id="loop-name"
            className={`title-input mono loop-name ${loop.kind}`}
            value={loop.name}
            onChange={(e) => setError(run(renameLoop(loop.id, e.target.value), `loop:${loop.id}:name`))}
            onBlur={seal}
          />
          <span className="mono muted">{loop.kind === 'main' ? 'Main' : 'Fill'} · 1/16</span>
          <label className="field">
            Bars
            <input
              type="number"
              min={1}
              max={16}
              value={barsDraft}
              onChange={(e) => setBarsDraft(e.target.value)}
              onBlur={() => {
                const bars = Math.round(Number(barsDraft));
                if (!(bars >= 1 && bars <= 16) || run(setLoopBars(loop.id, bars)) !== null) setBarsDraft(String(loop.bars));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <div className="row push">
            <button type="button" disabled={step?.padId == null} onClick={() => selectedStep !== null && place(selectedStep, null)}>
              Clear step
            </button>
            <button
              type="button"
              disabled={usedInSong > 0}
              title={usedInSong > 0 ? 'In use: take it out of the song first' : undefined}
              onClick={() => {
                const failed = run(remove('loop', loop.id));
                if (failed === null) open({ loop: null, step: null }, 'loops');
                else setError(failed);
              }}
            >
              Delete loop
            </button>
          </div>
        </div>

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
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
            {Array.from({ length: loop.bars }, (_, bar) => (
              <Fragment key={bar}>
              {loop.kind === 'fill' && <FillWindowStrip loop={loop} bar={bar} onError={setError} />}
              <div className="step-row">
                <span className="mono muted small">T{bar + 1}</span>
                {Array.from({ length: STEPS_PER_BAR }, (_, s) => {
                  const index = bar * STEPS_PER_BAR + s;
                  const cell = loop.steps[index];
                  const pad = cell?.padId == null ? undefined : project.pads[cell.padId];
                  const memberIndex = pad === undefined || cell?.memberId == null ? 0 : Math.max(0, pad.members.indexOf(cell.memberId));
                  const color = pad === undefined ? undefined : hitColor(project, pad.members[memberIndex]);
                  const now = playhead !== null && playhead.bar === bar && playhead.step === s;
                  const through = loop.kind === 'fill' && (index < loop.window.start || index >= loop.window.end);
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`step${pad !== undefined ? ' filled' : ''}${index === selectedStep ? ' selected' : ''}${now ? ' now' : ''}${s % 4 === 0 ? ' downbeat' : ''}${through ? ' through' : ''}${drops.isOver(`step:${index}`) ? ' drop-over' : ''}`}
                      draggable={pad !== undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(STEP_MIME, String(index));
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onDragEnd={drops.clear}
                      {...dropOnStep(index)}
                      style={color === undefined ? undefined : { color, boxShadow: `inset 0 -4px 0 ${color}` }}
                      aria-label={`Bar ${bar + 1}, step ${s + 1}: ${pad === undefined ? 'empty' : `${pad.name}, member ${memberIndex + 1}`}${through ? ', main shows through' : ''}`}
                      onClick={() => clickStep(index)}
                      onDoubleClick={() => {
                        if (pad !== undefined) open({ pad: pad.id }, 'pads');
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Delete' || e.key === 'Backspace') && pad !== undefined) {
                          e.preventDefault();
                          place(index, null);
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
              </div>
              </Fragment>
            ))}
          </div>
        </div>

        <section className="panel stack-tight">
          <div className="row spread">
            <h2 className="label">Pads · drag onto a step, or select one and click steps</h2>
            <button type="button" className="link-text small" onClick={() => open({}, 'pads')}>
              Build pads in Pads →
            </button>
          </div>
          {padGroups(project).map((group) => (
            <div key={group.name} className="shelf-group">
              <span className="muted small shelf-label ellipsis" title={group.name}>
                {group.name}
              </span>
              <div className="row">
                {group.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    draggable
                    className="chip mono"
                    onDoubleClick={() => open({ pad: p.id }, 'pads')}
                    aria-pressed={shelfPad === p.id}
                    aria-label={`Pad ${p.name}`}
                    title={p.name}
                    style={{ color: padColor(project, p), boxShadow: `inset 0 -3px 0 ${padColor(project, p)}` }}
                    onClick={() => setShelfPad(shelfPad === p.id ? null : p.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PAD_MIME, p.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    {padLabel(p)}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
                  <span className="mono" style={{ color: padColor(project, stepPad) }}>
                    {stepPad.name}
                  </span>
                  <button type="button" className="link-text small" onClick={() => open({ pad: stepPad.id }, 'pads')}>
                    Edit in Pads →
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
              {stepPad.members.map((hitId, i) => {
                const chosen = (step.memberId ?? stepPad.members[0]) === hitId;
                return (
                  <button
                    key={hitId}
                    type="button"
                    className="list-item"
                    aria-pressed={chosen}
                    onClick={() => setError(run(setStep(loop.id, selectedStep, { memberId: i === 0 ? null : hitId })))}
                  >
                    <span className="mono muted">{i + 1}</span>
                    <span className="mono grow ellipsis">{baseName(project.hits[hitId]?.name ?? '')}</span>
                    <span className="muted small">{i === 0 ? 'pad default' : ''}</span>
                  </button>
                );
              })}
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
