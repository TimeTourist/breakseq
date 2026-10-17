import { PlayMode } from './AuditionPlayhead';
import { PlayIcon, StopIcon } from './icons';

interface PlayControlsProps {
  /** What plays, as the button reads: "Play break", "Stop break". */
  readonly what: string;
  readonly playing: boolean;
  readonly onToggle: () => void;
  /** Once or Loop, to the left of the button; left out where there is no choice. */
  readonly loop?: boolean;
  readonly onLoop?: (loop: boolean) => void;
  readonly disabled?: boolean;
  readonly title?: string;
}

/** Once/Loop and ▶/■, the same everywhere something can be played. */
export function PlayControls({ what, playing, onToggle, loop, onLoop, disabled = false, title }: PlayControlsProps) {
  return (
    <div className="row nowrap play-controls">
      {loop !== undefined && onLoop !== undefined && <PlayMode loop={loop} onChange={onLoop} />}
      <button
        type="button"
        className="icon-button"
        aria-label={`${playing ? 'Stop' : 'Play'} ${what}`}
        aria-pressed={playing}
        title={title}
        disabled={disabled}
        onClick={onToggle}
      >
        {playing ? <StopIcon /> : <PlayIcon />}
      </button>
    </div>
  );
}
