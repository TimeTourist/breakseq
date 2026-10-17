import { Fragment, useState } from 'react';
import type { Trigger } from '../engine';
import type { Id, LoopKind, Project } from '../model';
import { STEPS_PER_BAR, baseName, createLoop, holds, holdsIn, loopBreaks, moveSteps, placeBreak, renameLoop, sequence, setLoopKind, setStep, slotHeard, swapBreak } from '../model';
import { STEP_MIME, copies, useDropTargets } from './dnd';
import { useApp, useOpen, useProject, useRun, useSeal, useSelect } from './context';
import { CHOICE_LABEL, HIT_COLOR, lengthText, padGroups, padLabel, padSteps, replacedBy } from './labels';
import { LoopLength } from './LoopLength';
import { Delete } from './DeleteButton';
import { InSong, InSongMark, useHeard } from './InSong';
import type { Selection } from './store';

export const PAD_MIME = 'application/x-breakseq-pad';
/** A break's parent: dropping it lays out all its slices. */
export const BREAK_MIME = 'application/x-breakseq-break';

/** The loop open in Loops: the selected one, else the first. */
export function currentLoopId(project: Project, selection: Selection): Id | null {
  if (selection.loop !== null && project.loops[selection.loop] !== undefined) return selection.loop;
  return Object.keys(project.loops)[0] ?? null;
}

/** What the shelf's hide and fold remember a group by: its break, or its name ("One-shots", "Built"). */
const groupKey = (group: { readonly name: string; readonly breakId?: Id }): string => group.breakId ?? group.name;

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
  const shelfHidden = useSelect((s) => s.shelfHidden);
  const shelfOpen = useSelect((s) => s.shelfOpen);
  const [shelfPad, setShelfPad] = useState<Id | null>(null);
  const [shelfBreak, setShelfBreak] = useState<Id | null>(null);
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
  /** Slot pads past their break's last slice: they play nothing until it has more. */
  const silent = new Set(Object.values(project.breaks).flatMap((b) => b.pads.filter((_, slot) => !slotHeard(b, slot))));
  const swappable = Object.values(project.breaks);
  const groups = padGroups(project);
  const breakSteps = (id: Id) => (project.breaks[id]?.bars ?? 1) * STEPS_PER_BAR;
  const allOpen = groups.length > 0 && groups.every((g) => shelfOpen.includes(groupKey(g)));

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
      <section className="stack-tight" aria-label="Choose what shows">
        <div className="row spread">
          <h2 className="label" title="Tick what you want to drag from">Show in Pads</h2>
          <button
            type="button"
            className="link-text small"
            onClick={() => store.dispatch({ type: 'shelfOpen', groups: groups.map(groupKey), open: !allOpen })}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        {groups.map((group) => {
          const key = groupKey(group);
          const opened = shelfOpen.includes(key);
          return (
            <div key={key} className="stack-tight">
              <div className="row nowrap fold-head">
                <button
                  type="button"
                  className="icon-button small fold"
                  aria-expanded={opened}
                  aria-label={`${opened ? 'Hide' : 'Show'} the pads of ${group.name}`}
                  onClick={() => store.dispatch({ type: 'shelfOpen', groups: [key], open: !opened })}
                >
                  {opened ? '▾' : '▸'}
                </button>
                <div className="row nowrap grow shelf-choice">
                  <input
                    type="checkbox"
                    aria-label={`Show ${group.name} in Pads`}
                    checked={!shelfHidden.includes(key)}
                    onChange={(e) => store.dispatch({ type: 'shelfShown', group: key, shown: e.target.checked })}
                  />
                  <span
                    className="label grow ellipsis"
                    title={group.breakId === undefined ? undefined : 'Click to play it once, double-click to edit it in Hits'}
                    onClick={() => {
                      const parent = group.breakId === undefined ? null : project.breaks[group.breakId]?.parent;
                      if (parent != null) services.player.playHit(project, parent);
                    }}
                    onDoubleClick={() => {
                      const parent = group.breakId === undefined ? null : project.breaks[group.breakId]?.parent;
                      if (parent != null) open({ hit: parent, pad: null }, 'hits');
                    }}
                  >
                    {group.name}
                  </span>
                  <span className="muted small">{group.items.length}</span>
                </div>
              </div>
              {opened && group.items.map((p) => (
                <div key={p.id} className={`pad-row${silent.has(p.id) ? ' silent' : ''}`}>
                  <span className="pad-row-name mono" title="Double-click to edit in Hits" onDoubleClick={() => open({ pad: p.id, hit: null }, 'hits')}>
                  {padLabel(p)}
                </span>
                  {p.members.map((m, i) => {
                    const h = project.hits[m];
                    const by = h === undefined ? null : replacedBy(project, p.id, h);
                    return h === undefined ? null : (
                      <span
                      key={m}
                      className={`hit-chip static mono${i === 0 ? ' first' : ''}${by !== null ? ' replaced' : ''}`}
                      title={`${h.name} · click to play it once, double-click to edit it in Hits`}
                      onClick={() => services.player.playHit(project, m)}
                      onDoubleClick={() => open({ pad: p.id, hit: m }, 'hits')}
                    >
                        {baseName(h.name).replace(/^.*\s(\d{2,})$/, '$1')}
                        {by !== null && `→${by}`}
                        {h.direction === 'reverse' ? ' ◂' : ''}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </section>
    </aside>
  );

  if (loop === undefined) {
    return (
      <div className="split">
        {sidebar}
        <main className="view">
          <div className="view-head">
            <h1>Loops</h1>
            <p className="muted">No loops yet. Slice a break to get its loop, or make a new loop.</p>
          <div className="row nav-row">
            <button type="button" className="link-text small" onClick={() => store.dispatch({ type: 'view', view: 'slice' })}>
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
    drops.bind(`step:${index}`, [PAD_MIME, BREAK_MIME, STEP_MIME], (e, type) => {
      if (type === PAD_MIME) {
        place(index, e.dataTransfer.getData(PAD_MIME));
      } else if (type === BREAK_MIME) {
        setError(run(placeBreak(loop.id, e.dataTransfer.getData(BREAK_MIME), index)));
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
    if (shift && selectedStep !== null && shelfPad === null && shelfBreak === null) {
      setRangeEnd(index === selectedStep ? null : index);
      return;
    }
    setRangeEnd(null);
    if (shelfPad !== null) place(index, shelfPad);
    if (shelfBreak !== null) setError(run(placeBreak(loop.id, shelfBreak, index)));
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

        {loopBreaks(project, loop).length > 0 && swappable.length > 1 && (
          <div className="row break-swaps" aria-label="Breaks in the loop">
            {loopBreaks(project, loop).map((b) => (
              <div key={b.id} className="field inline">
                <span className="muted">Break</span>
                <button
                  type="button"
                  className="link-text mono"
                  title="Open the break in Hits"
                  onClick={() => {
                    const hit = b.parent ?? project.pads[b.pads[0] ?? '']?.members[0];
                    if (hit !== undefined) open({ hit, pad: null }, 'hits');
                  }}
                >
                  {b.name}
                </button>
                →
                <select
                  aria-label={`Swap ${b.name} for`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') setError(run(swapBreak(loop.id, b.id, e.target.value)));
                  }}
                >
                  <option value="">swap for…</option>
                  {swappable
                    .filter((o) => o.id !== b.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.bars === null ? `${o.name} (one-shot)` : o.name}
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
                        if (pad !== undefined) open({ pad: pad.id, hit: null }, 'hits');
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
            <button type="button" className="link-text small" onClick={() => open({}, 'hits')}>
              Build pads in Hits →
            </button>
          </div>
          <div className="shelf">
          {groups.length > 0 && groups.every((g) => shelfHidden.includes(groupKey(g))) && (
            <p className="muted small">Nothing ticked under Show in Pads, to the left.</p>
          )}
          {groups.filter((group) => !shelfHidden.includes(groupKey(group))).map((group) => (
            <div key={group.breakId ?? group.name} className="shelf-group">
              <span className="muted small shelf-label ellipsis" title={group.name}>
                {group.name}
              </span>
              <div className="row">
                {group.breakId !== undefined && (
                  <button
                    type="button"
                    draggable
                    className="chip parent-chip"
                    aria-pressed={shelfBreak === group.breakId}
                    aria-label={`Break ${group.name}: lay out all its slices`}
                    title="The whole break: lays out all its slices from the step. Double-click to edit it in Hits"
                    onDoubleClick={() => {
                      const parent = project.breaks[group.breakId!]?.parent;
                      if (parent != null) open({ hit: parent, pad: null }, 'hits');
                    }}
                    onClick={() => {
                      setShelfBreak(shelfBreak === group.breakId ? null : (group.breakId ?? null));
                      setShelfPad(null);
                      const parent = project.breaks[group.breakId!]?.parent;
                      if (parent != null) services.player.playHit(project, parent);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(BREAK_MIME, group.breakId!);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDragSteps(breakSteps(group.breakId!));
                    }}
                    onDragEnd={() => {
                      setDragSteps(null);
                      drops.clear();
                    }}
                  >
                    {baseName(group.name)} ▸ all <span className="chip-steps">{lengthText(breakSteps(group.breakId!))}</span>
                  </button>
                )}
                {group.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    draggable
                    className={`chip mono${silent.has(p.id) ? ' silent' : ''}`}
                    onDoubleClick={() => open({ pad: p.id, hit: null }, 'hits')}
                    aria-pressed={shelfPad === p.id}
                    aria-label={`Pad ${p.name}`}
                    title={silent.has(p.id) ? `${p.name}: silent, the break has fewer slices` : `${p.name} · ${lengthText(padSteps(project, p))} · double-click to edit in Hits`}
                    style={{ color: HIT_COLOR, boxShadow: `inset 0 -3px 0 ${HIT_COLOR}` }}
                    onClick={() => {
                      setShelfPad(shelfPad === p.id ? null : p.id);
                      setShelfBreak(null);
                      if (p.members[0] !== undefined) services.player.playHit(project, p.members[0]);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PAD_MIME, p.id);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDragSteps(padSteps(project, p));
                    }}
                    onDragEnd={() => {
                      setDragSteps(null);
                      drops.clear();
                    }}
                  >
                    {padLabel(p)} <span className="chip-steps">·{padSteps(project, p)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
          <p className="muted small">Drag a pad onto a step, or select it and click steps. A click plays it once; a double-click edits it in Hits.</p>
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
                  <button type="button" className="link-text small" onClick={() => open({ pad: stepPad.id, hit: null }, 'hits')}>
                    Hits →
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
