import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Id, Matrix, Pad } from '../model';
import { PAD_CHOICES, STEPS_PER_BAR, hitSound, padSteps, sampleAudio, setPadChoice, stepDuration } from '../model';
import { useApp, useOpen, useProject, useRun } from './context';
import { InSongMark, useHeard } from './InSong';
import { CHOICE_LABEL, middleEllipsis, padSilent } from './labels';
import type { PadsOpen, Zoom } from './pads';
import { ZOOMS, hitLabel, rowNumber, timelineLayout } from './pads';
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
}

/**
 * The matrix in focus as a timeline: its pads one after another, each as
 * wide as it plays (an empty pad narrow), on a raster of steps and beats,
 * with its hits downwards, the first marked. A click on a pad selects it; a
 * click on a hit selects and plays it. The timeline scrolls in its own box.
 */
export function Timeline({ matrix, open, zoom, onZoom, playedSeconds, onError }: TimelineProps) {
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

  /** Where the playhead is, in px: within the pad whose steps it is in. */
  const playheadPx = (() => {
    if (playedSeconds === null || steps === 0) return null;
    const at = (playedSeconds / stepDuration(project.song.bpm)) % steps;
    const column = columns.find((c) => c.steps > 0 && at >= c.start && at < c.start + c.steps) ?? columns.at(-1);
    return column === undefined ? null : column.left + (column.steps === 0 ? 0 : ((at - column.start) / column.steps) * column.width);
  })();

  const playHit = (padId: Id, hitId: Id) => {
    select({ pad: padId, hit: hitId }, 'pads');
    services.player.playHit(project, hitId);
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
      <div className="timeline-scroll" role="region" aria-label="Timeline" ref={box}>
        <div className="timeline" style={{ width: total }}>
          {pads.map((pad, row) => {
            const column = columns[row]!;
            const first = pad.members[0] === undefined ? undefined : project.hits[pad.members[0]];
            const sound = first === undefined ? null : hitSound(project, first);
            const audio = sound === null ? undefined : sampleAudio(project, sound.sample);
            const roomy = zoom === '1 bar' || pad.id === selectedPad;
            const showHits = roomy || column.width >= HITS_MIN_PX;
            const chars = Math.min(32, Math.max(4, Math.floor((column.width - 10) / CHAR_PX)));
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
              >
                <button
                  type="button"
                  className="pad-head"
                  aria-label={`Pad ${pad.name}`}
                  aria-current={pad.id === selectedPad && selectedHit === null ? 'true' : undefined}
                  title={`${pad.name} · ${column.steps === 0 ? 'empty: takes no steps' : `${column.steps}/16`} · ${CHOICE_LABEL[pad.choice]}`}
                  onClick={() => select({ pad: pad.id, hit: null }, 'pads')}
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
                      const shown = `${middleEllipsis(label, chars)}${hit.direction === 'reverse' ? ' ◂' : ''}`;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            className={`hit-chip mono${i === 0 ? ' first' : ''}${replaced ? ' replaced' : ''}`}
                            aria-label={shown === hit.name ? hit.name : `${shown}, ${hit.name}`}
                            aria-current={id === selectedHit ? 'true' : undefined}
                            title={`${hit.name}${i === 0 ? ' · first: plays by default' : ''} · click plays it`}
                            onClick={() => playHit(pad.id, id)}
                          >
                            <span className="hit-label">{shown}</span>
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
