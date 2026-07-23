import { useRef, type PointerEvent } from 'react';
import { cn } from '../../lib/cn';
import { formatVideoClock } from '../../lib/format';

type VideoControlBarProps = {
  currentTime: number;
  duration: number;
  bufferedRatio: number;
  paused: boolean;
  volume: number;
  muted?: boolean;
  visible?: boolean;
  variant?: 'full' | 'minimal' | 'program';
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onFullscreen?: () => void;
  onReturnToMenu?: () => void;
  onRestart?: () => void;
  onInteract?: () => void;
  className?: string;
};

function VolumeIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" fill="none" aria-hidden>
      <path
        d="M1 5.5h3l4-3.5v13l-4-3.5H1V5.5zM12 4.5a4.5 4.5 0 010 7M14.5 2a7.5 7.5 0 010 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted && (
        <path
          d="M2 14L16 2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
      <path d="M2 1.5v13l10-6.5L2 1.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="9" y="1" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden>
      <path
        d="M1 6l7-5 7 5v7H9V9H7v4H1V6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VideoControlBar({
  currentTime,
  duration,
  bufferedRatio,
  paused,
  volume,
  muted = false,
  visible = true,
  variant = 'full',
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onFullscreen,
  onReturnToMenu,
  onRestart,
  onInteract,
  className,
}: VideoControlBarProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  const playedRatio = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const bufferEnd = Math.min(bufferedRatio, 1);

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    onSeek(ratio * duration);
  };

  if (variant === 'minimal') {
    return (
      <div
        className={cn(
          'p6-vc-bar',
          'p6-vc-bar--minimal',
          !visible && 'p6-vc-bar--hidden',
          className,
        )}
        onPointerDown={onInteract}
      >
        {onReturnToMenu && (
          <button
            type="button"
            className="p6-vc-bar__btn p6-vc-bar__return"
            onClick={onReturnToMenu}
            aria-label="Return to menu"
          >
            Return to Menu
          </button>
        )}
      </div>
    );
  }

  if (variant === 'program') {
    return (
      <div
        className={cn(
          'p6-vc-bar',
          'p6-vc-bar--program',
          !visible && 'p6-vc-bar--hidden',
          className,
        )}
        onPointerDown={onInteract}
      >
        <div className="p6-vc-bar__row">
          <div className="p6-vc-bar__left">
            {onReturnToMenu && (
              <button
                type="button"
                className="p6-vc-bar__btn p6-vc-bar__return"
                onClick={onReturnToMenu}
                aria-label="Return to menu"
              >
                Return to Menu
              </button>
            )}
            {onRestart && (
              <button
                type="button"
                className="p6-vc-bar__btn p6-vc-bar__return"
                onClick={onRestart}
                aria-label="Restart video"
              >
                Restart
              </button>
            )}
          </div>

          <div className="p6-vc-bar__center">
            <button
              type="button"
              className="p6-vc-bar__play"
              onClick={onTogglePlay}
              aria-label={paused ? 'Play' : 'Pause'}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          </div>

          <div className="p6-vc-bar__right">
            <button
              type="button"
              className="p6-vc-bar__btn"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon muted={muted} />
            </button>
            <div className="p6-vc-bar__volume-wrap">
              <input
                type="range"
                className="p6-vc-bar__volume"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                style={{ ['--p6-volume' as string]: `${(muted ? 0 : volume) * 100}%` }}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'p6-vc-bar',
        !visible && 'p6-vc-bar--hidden',
        className,
      )}
      onPointerDown={onInteract}
    >
      <div
        ref={progressRef}
        className="p6-vc-bar__progress"
        onPointerDown={seekFromPointer}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div className="p6-vc-bar__progress-track" />
        <div
          className="p6-vc-bar__progress-buffer"
          style={{ width: `${bufferEnd * 100}%` }}
        />
        <div
          className="p6-vc-bar__progress-played"
          style={{ width: `${playedRatio * 100}%` }}
        />
        <div
          className="p6-vc-bar__progress-thumb"
          style={{ left: `${playedRatio * 100}%` }}
        />
      </div>

      <div className="p6-vc-bar__row">
        <div className="p6-vc-bar__left">
          {onReturnToMenu && (
            <button
              type="button"
              className="p6-vc-bar__btn"
              onClick={onReturnToMenu}
              aria-label="Return to menu"
            >
              <HomeIcon />
            </button>
          )}
          <button
            type="button"
            className="p6-vc-bar__btn"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon muted={muted} />
          </button>
          <div className="p6-vc-bar__volume-wrap">
            <input
              type="range"
              className="p6-vc-bar__volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              style={{ ['--p6-volume' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
        </div>

        <div className="p6-vc-bar__center">
          <span className="p6-vc-bar__time">{formatVideoClock(currentTime)}</span>
          <button
            type="button"
            className="p6-vc-bar__play"
            onClick={onTogglePlay}
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <span className="p6-vc-bar__time">{formatVideoClock(duration)}</span>
        </div>

        <div className="p6-vc-bar__right">
          <button
            type="button"
            className="p6-vc-bar__btn"
            onClick={onFullscreen}
            aria-label="Fullscreen"
          >
            <FullscreenIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
