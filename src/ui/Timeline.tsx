import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { Id, Matrix, Pad } from '../model';
import { PAD_CHOICES, STEPS_PER_BAR, hitSound, padSteps, sampleAudio, setPadChoice, stepDuration } from '../model';
import { matrixPassSteps } from '../engine';
import { useApp, useOpen, useProject, useRun } from './context';
import { InSongMark, useHeard } from './InSong';
import { CHOICE_LABEL, NAME_MAX, middleEllipsis, padSilent } from './labels';
import { HIT_MIME, MATRIX_MIME } from './dnd';
import type { Dragged, Over, PadsOpen, Placing, Zoom } from './pads';
import { ZOOMS, autoscrollStep, dropTarget, hitLabel, rowNumber, timelineLayout, zoneOf } from './pads';
import { Waveform } from './Waveform';

/** The width laid out before the box is measured, as in a test without layout. */
const UNMEASURED_PX = 960;
/** About how wide a character of a hit's label is, to shorten it to its column. */
const CHAR_PX = 7;
/** In Fit, a column narrower than ~4 characters shows only its number and first hit's waveform. */
const HITS_MIN_PX = 4 * CHAR_PX + 10;
const ZOOM_LABEL: Record<Zoom, string> = { fit: 'Fit', '1 bar': '1 bar' };
/** How a pad picks, short enough for its column. */
const CHOICE_SHORT: Record<Pad['choice'], string> = { top: 'Top', roundRobin: 'RR', random: 'Random', noRepeat: 'No repeat' };

/** The inner width of an element, followed as it resizes. */
function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { box, width: width > 0 ? width : UNMEASURED_PX };
}

interface TimelineProps {
  readonly matrix: Matrix;
  readonly open: PadsOpen;
  readonly zoom: Zoom;
  readonly onZoom: (zoom: Zoom) => void;
  /** Seconds into the matrix while Play plays it, else null. */
  readonly playedSeconds: number | null;
  readonly onError: (error: string | null) => void;
  readonly placing: Placing;
  /** Plays a pad one pick, as it picks. */
  readonly onPlayPad: (pad: Pad) => void;
}

/** Where in pad `padId` an event is: on a hit (its edges are between hits), or on the pad. */
function overAt(e: DragEvent | MouseEvent, padId: Id): Over {
  const chip = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-hit]') : null;
  if (chip === null || chip.dataset.hit === undefined) return { padId, hitId: null, zone: 'on' };
  const rect = chip.getBoundingClientRect();
  return { padId, hitId: chip.dataset.hit, zone: zoneOf(e.clientY, rect.top, rect.height) };
}

/** What a drop event carries, by its data; else what Pads saw start. */
function draggedOf(e: DragEvent, started: Dragged | null): Dragged | null {
  const hitId = e.dataTransfer.getData(HIT_MIME);
  if (hitId !== '') return { kind: 'hit', hitId };
  const matrixId = e.dataTransfer.getData(MATRIX_MIME);
  return matrixId !== '' ? { kind: 'matrix', matrixId } : started;
}

/**
 * The matrix in focus as a timeline: its pads one after another, each as
 * wide as it plays (an empty pad narrow), on a raster of steps and beats,
 * with its hits downwards, the first marked. A click on a pad selects it; a
 * click on a hit selects and plays it. The timeline scrolls in its own box,
 * also while dragging near its edge (U4).
 *
 * A hit or all hits dropped on a pad are added as copies; a hit dropped on a
 * hit replaces it; a hit dropped between hits of its own pad moves there
 * (decisions 4, 12, 13). While dragging, the target reads "add" or
 * "replace", or a line shows where the hit goes. With something picked on
 * the shelf, a tap on a pad or a hit places it the same way.
 */
export function Timeline({ matrix, open, zoom, onZoom, playedSeconds, onError, placing, onPlayPad }: TimelineProps) {
  const project = useProject();
  const { services } = useApp();
  const run = useRun();
  const select = useOpen();
  const heard = useHeard();
  const { box, width } = useWidth();
  const pads = matrix.pads.flatMap((id) => (project.pads[id] === undefined ? [] : [project.pads[id]]));
  const lengths = pads.map((p) => padSteps(project, p));
  const { columns, stepPx, total } = timelineLayout(lengths, zoom, width);
  const steps = lengths.reduce((a, b) => a + b, 0);
  const selectedPad = open.kind === 'matrix' ? null : open.pad.id;
  const selectedHit = open.kind === 'hit' ? open.hit.id : null;
  // Roving tabindex: the selected pad or hit is the timeline's one Tab stop, else the first pad; arrows go on from there.
  const tabPad = selectedHit !== null ? null : (selectedPad ?? pads[0]?.id ?? null);
  const [hover, setHover] = useState<Over | null>(null);
  // A drag that ends, dropped or not, leaves no mark.
  useEffect(() => {
    if (placing.dragging === null) setHover(null);
  }, [placing.dragging]);
  const target = placing.dragging === null || hover === null ? null : dropTarget(project, placing.dragging, hover);

  /** Where the playhead is, in px: within the pad whose steps it is in. */
  const playheadPx = (() => {
    if (playedSeconds === null || steps === 0) return null;
    // Play renders the matrix in whole bars over several passes; in the bar's tail after the last pad it stays at the end.
    const at = Math.min(steps, (playedSeconds / stepDuration(project.song.bpm)) % matrixPassSteps(project, matrix.id));
    const column = columns.find((c) => c.steps > 0 && at >= c.start && at < c.start + c.steps) ?? columns.at(-1);
    return column === undefined ? null : column.left + (column.steps === 0 ? 0 : ((at - column.start) / column.steps) * column.width);
  })();

  const playHit = (padId: Id, hitId: Id) => {
    select({ pad: padId, hit: hitId }, 'pads');
    services.player.playHit(project, hitId);
  };

  /** Drop handlers for a pad's column: the whole column is the pad, a hit in it its hit. */
  const dropOn = (padId: Id) => ({
    onDragOver: (e: DragEvent) => {
      if (placing.dragging === null) return;
      const over = overAt(e, padId);
      const next = dropTarget(project, placing.dragging, over);
      if (next === null) {
        setHover(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = next.kind === 'move' ? 'move' : 'copy';
      if (hover === null || hover.padId !== over.padId || hover.hitId !== over.hitId || hover.zone !== over.zone) setHover(over);
    },
    onDrop: (e: DragEvent) => {
      const dragged = draggedOf(e, placing.dragging);
      setHover(null);
      if (dragged === null) return;
      e.preventDefault();
      const at = dropTarget(project, dragged, overAt(e, padId));
      if (at !== null) placing.place(dragged, at);
      placing.endDrag();
    },
    /** With something picked: a tap on the pad adds it (a tap on a hit is the hit's). */
    onClick: (e: MouseEvent) => {
      if (placing.picked === null || (e.target instanceof Element && e.target.closest('select') !== null)) return;
      placing.place(placing.picked, { kind: 'add', padId });
    },
  });
  const autoscroll = (e: DragEvent) => {
    const element = box.current;
    if (element === null || placing.dragging === null) return;
    const rect = element.getBoundingClientRect();
    element.scrollLeft += autoscrollStep(e.clientX, rect.left, rect.right);
  };

  return (
    <section className="stack-tight" aria-label="Pads of the matrix">
      <div className="row spread">
        <span className="muted small">
          {pads.length} pad{pads.length === 1 ? '' : 's'} · {steps} step{steps === 1 ? '' : 's'}
        </span>
        <div className="segmented" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => onZoom(z)}>
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`timeline-scroll${placing.picked !== null ? ' picking' : ''}`}
        role="region"
        aria-label="Timeline"
        ref={box}
        onDragOver={autoscroll}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setHover(null);
        }}
      >
        <div className="timeline" style={{ width: total }}>
          {pads.map((pad, row) => {
            const column = columns[row]!;
            const first = pad.members[0] === undefined ? undefined : project.hits[pad.members[0]];
            const sound = first === undefined ? null : hitSound(project, first);
            const audio = sound === null ? undefined : sampleAudio(project, sound.sample);
            const roomy = zoom === '1 bar' || pad.id === selectedPad;
            const showHits = roomy || column.width >= HITS_MIN_PX;
            const chars = Math.min(NAME_MAX, Math.max(4, Math.floor((column.width - 10) / CHAR_PX)));
            const raster = {
              width: column.width,
              '--step': `${stepPx}px`,
              '--beat-at': `${-(column.start % 4) * stepPx}px`,
              '--bar-at': `${-(column.start % STEPS_PER_BAR) * stepPx}px`,
            } as CSSProperties;
            return (
              <div
                key={pad.id}
                className={`pad-column${column.steps === 0 ? ' empty' : ''}${pad.id === selectedPad ? ' current' : ''}${padSilent(project, pad) ? ' silent' : ''}${stepPx < 6 ? ' coarse' : ''}`}
                style={raster}
                data-drop={target?.kind === 'add' && target.padId === pad.id ? 'add' : undefined}
                data-pad={pad.id}
                {...dropOn(pad.id)}
              >
                <button
                  type="button"
                  className="pad-head"
                  aria-label={`Pad ${pad.name}`}
                  aria-current={pad.id === selectedPad && selectedHit === null ? 'true' : undefined}
                  tabIndex={pad.id === tabPad ? 0 : -1}
                  title={`${pad.name} · ${column.steps === 0 ? 'empty: takes no steps' : `${column.steps}/16`} · ${CHOICE_LABEL[pad.choice]}`}
                  onClick={() => {
                    // With something picked, the tap is the column's: it adds.
                    if (placing.picked !== null) return;
                    select({ pad: pad.id, hit: null }, 'pads');
                    onPlayPad(pad);
                  }}
                >
                  <span className="pad-number mono">{rowNumber(row)}</span>
                  <InSongMark heard={heard.pads.has(pad.id)} />
                </button>
                {audio !== undefined && sound !== null && sound.region.end > sound.region.start && (
                  <div className="pad-wave" aria-hidden="true">
                    <Waveform audio={audio} offset={sound.sample.offset + sound.region.start} duration={sound.region.end - sound.region.start} height={28} />
                  </div>
                )}
                {roomy && (
                  <select
                    className="pad-choice"
                    aria-label={`How ${pad.name} picks`}
                    title={CHOICE_LABEL[pad.choice]}
                    value={pad.choice}
                    onChange={(e) => onError(run(setPadChoice(pad.id, e.target.value as Pad['choice'])))}
                  >
                    {PAD_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {CHOICE_SHORT[c]}
                      </option>
                    ))}
                  </select>
                )}
                {showHits && (
                  <ol className="pad-hits" aria-label={`Hits of ${pad.name}`}>
                    {pad.members.map((id, i) => {
                      const hit = project.hits[id];
                      if (hit === undefined) return null;
                      const label = hitLabel(project, pad.id, row, hit);
                      const replaced = label.includes('→');
                      // Its place in the pad first, so the hit does not read as the pad's number (1 08, 2 →Winst…03).
                      const place = String(i + 1);
                      const shown = `${place} ${middleEllipsis(label, Math.max(2, chars - place.length - 1))}${hit.direction === 'reverse' ? ' ◂' : ''}`;
                      const insert = target?.kind === 'move' && hover?.hitId === id ? ` insert-${hover.zone}` : '';
                      return (
                        <li key={id} className={insert}>
                          <button
                            type="button"
                            className={`hit-chip mono${i === 0 ? ' first' : ''}${replaced ? ' replaced' : ''}`}
                            aria-label={`${shown}, ${hit.name}`}
                            aria-current={id === selectedHit ? 'true' : undefined}
                            tabIndex={id === selectedHit ? 0 : -1}
                            title={`${hit.name}${i === 0 ? ' · first: plays by default' : ''} · click plays it; drag it between hits to move it, or onto another pad or hit`}
                            data-hit={id}
                            data-drop={target?.kind === 'replace' && target.hitId === id ? 'replace' : undefined}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(HIT_MIME, id);
                              e.dataTransfer.effectAllowed = 'copyMove';
                              placing.startDrag({ kind: 'hit', hitId: id });
                            }}
                            onDragEnd={placing.endDrag}
                            onClick={(e) => {
                              if (placing.picked === null) {
                                playHit(pad.id, id);
                                return;
                              }
                              // With something picked, a tap on a hit replaces it.
                              e.stopPropagation();
                              const at = dropTarget(project, placing.picked, { padId: pad.id, hitId: id, zone: 'on' });
                              if (at !== null) placing.place(placing.picked, at);
                            }}
                          >
                            <span className="hit-label">
                              <span className="hit-place">{place}</span>
                              {shown.slice(place.length)}
                            </span>
                            <InSongMark heard={heard.hits.has(id)} />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
          {playheadPx !== null && <div className="playhead" style={{ left: playheadPx }} />}
        </div>
      </div>
      {pads.length === 0 && <p className="muted small">No pads yet: + Pad adds one.</p>}
    </section>
  );
}
