import { useEffect, useState } from 'react';
import { useApp } from './context';

/** Where the audition is, in seconds of its audio, polled each frame while `active`. */
export function useAuditionPlayhead(active: boolean): number | null {
  const { services } = useApp();
  const [position, setPosition] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setPosition(null);
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      setPosition(services.player.auditionPosition());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, services]);
  return position;
}

interface PlayModeProps {
  readonly loop: boolean;
  readonly onChange: (loop: boolean) => void;
}

/** Once or Loop, for auditions. */
export function PlayMode({ loop, onChange }: PlayModeProps) {
  return (
    <div className="segmented" role="group" aria-label="Play mode">
      <button type="button" aria-pressed={!loop} onClick={() => onChange(false)}>
        Once
      </button>
      <button type="button" aria-pressed={loop} onClick={() => onChange(true)}>
        Loop
      </button>
    </div>
  );
}
