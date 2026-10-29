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

/** Loop on or off, for auditions: one toggle, as Loop in Song. Off plays once. */
export function PlayMode({ loop, onChange }: PlayModeProps) {
  return (
    <button type="button" className="loop-toggle" aria-pressed={loop} title={loop ? 'Looping: click to play once' : 'Plays once: click to loop'} onClick={() => onChange(!loop)}>
      Loop
    </button>
  );
}
