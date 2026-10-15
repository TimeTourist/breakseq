import type { Tape } from '../engine';
import { effectPreview, tapePasses, tapeSpeed, wobbles } from '../engine';
import type { Project, StepEffect, TapeEffect } from '../model';
import { STEPS_PER_BAR } from '../model';
import { formatValues } from './modText';

const WIDTH = 640;
const HEIGHT = 120;
const PAD = 18;

/** A small seeded generator, so a drawing stays put while you edit. */
const seeded = (seed: number) => {
  let state = 1 + Math.abs(Math.floor(seed)) % 2147483646;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
};

/**
 * What a step effect does over one bar: a bar per step. Random draws one
 * example roll, from `seed`; each take rolls its own.
 */
export function StepGraph({ effect, project, seed }: { effect: StepEffect; project: Project; seed: number }) {
  const points = effectPreview(effect, STEPS_PER_BAR, seeded(seed));
  const numbers = points.filter((p): p is number => p !== null);
  // Random's whole range sets the scale, so rolling again does not rescale it.
  const range = effect.shape.kind === 'random' ? [effect.shape.min, effect.shape.max] : [];
  const low = Math.min(0, ...numbers, ...range);
  const high = Math.max(effect.target === 'tempo' ? 1 : 0, ...numbers, ...range);
  const span = high - low || 1;
  const y = (v: number) => HEIGHT - PAD - ((v - low) / span) * (HEIGHT - 2 * PAD);
  const w = WIDTH / STEPS_PER_BAR;
  // Write a value where it changes, the way it is typed.
  // Values are rounded to a tenth here, so a random pitch does not print three decimals.
  const label = (p: number | null, i: number) =>
    p === null || (i > 0 && points[i - 1] === p) ? null : formatValues(effect, [Math.round(p * 10) / 10], project);
  return (
    <svg className="mod-graph" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="What the effect does over one bar">
      {Array.from({ length: STEPS_PER_BAR }, (_, i) => (
        <line key={i} x1={i * w} x2={i * w} y1={0} y2={HEIGHT} className={i % 4 === 0 ? 'grid beat' : 'grid'} />
      ))}
      <line x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} className="grid zero" />
      {points.map((p, i) => {
        if (p === null) return null;
        const top = Math.min(y(p), y(0));
        const text = label(p, i);
        return (
          <g key={i} className="step-value">
            <rect x={i * w + 2} width={w - 4} y={top} height={Math.max(2, Math.abs(y(p) - y(0)))} />
            {text !== null && (
              <text x={i * w + w / 2} y={Math.max(11, top - 4)} textAnchor="middle">
                {text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** How a Tape's speed goes over a clip, with its passes marked: F forwards, R backwards. */
export function TapeGraph({ tape, clipSteps, stepSeconds }: { tape: TapeEffect; clipSteps: number; stepSeconds: number }) {
  const end = clipSteps * stepSeconds;
  // A fixed seed, so the drawing does not jump while you edit; a take sways its own way.
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const model: Tape = {
    time: 0,
    end,
    start: 0,
    source: [],
    length: tape.length * stepSeconds,
    direction: tape.direction,
    speed: { from: tape.speed.from, to: tape.speed.to, ramp: (tape.rampOver ?? clipSteps) * stepSeconds, curve: tape.curve },
    wobble: wobbles(tape, rng),
  };
  const samples = 240;
  const speeds = Array.from({ length: samples + 1 }, (_, i) => tapeSpeed(model, (i / samples) * end));
  const high = Math.max(1, ...speeds);
  const x = (t: number) => (t / end) * WIDTH;
  const y = (s: number) => HEIGHT - PAD - (s / high) * (HEIGHT - 2 * PAD);
  const passes = tapePasses(model);
  const path = speeds.map((s, i) => `${i === 0 ? 'M' : 'L'}${((i / samples) * WIDTH).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  return (
    <svg className="mod-graph tape" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Tape speed over the clip">
      {passes.map((p, i) => (
        <g key={i} className={`pass ${p.direction}`}>
          <rect x={x(p.time)} width={Math.max(0.5, x(p.end) - x(p.time))} y={0} height={HEIGHT} />
          {x(p.end) - x(p.time) > 12 && (
            <text x={(x(p.time) + x(p.end)) / 2} y={12} textAnchor="middle">
              {p.direction === 'forward' ? 'F' : 'R'}
            </text>
          )}
        </g>
      ))}
      <line x1={0} x2={WIDTH} y1={y(1)} y2={y(1)} className="grid zero" />
      <text x={4} y={y(1) - 4} className="axis">
        1×
      </text>
      <path d={path} className="speed" />
    </svg>
  );
}
