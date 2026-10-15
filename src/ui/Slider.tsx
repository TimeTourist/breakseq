import { useId } from 'react';

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
  /** The drag or key press has ended: close its undo step. */
  readonly onCommit: () => void;
}

export function Slider({ label, value, min, max, step, format, onChange, onCommit }: SliderProps) {
  const id = useId();
  return (
    <div className="panel slider">
      <label htmlFor={id} className="slider-head">
        <span className="label">{label}</span>
        <span className="mono">{format(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  );
}
