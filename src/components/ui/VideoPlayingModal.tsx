import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { formatSessionTime } from '../../lib/format';
import { useRuntimeStore } from '../../stores/runtimeStore';
import type { SessionModalItem } from './SessionModal';
import { experienceModalClassMap, type P6Accent, type P6Experience } from './types';
import { DisplayVolumeControl } from './DisplayVolumeControl';

type ConfirmKind = 'restart' | 'exit' | null;

type VideoPlayingModalProps = {
  open: boolean;
  onClose: () => void;
  accent?: P6Accent;
  experience?: P6Experience;
  variant?: 'simple' | 'full-program';
  sessionLabel?: string;
  title?: string;
  sessionDuration?: string;
  sectionLabel?: string;
  items?: SessionModalItem[];
  /** Wall-clock session start; used for NOW PLAYING elapsed timer. */
  startedAt?: number;
  /** Total session length in seconds for progress UI (default 3600). */
  totalSeconds?: number;
};

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 4.75V8l2.25 1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden>
      <path
        d="M1.5 5l3 3L10.5 1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
      <rect x="2" y="1" width="3.5" height="14" rx="1" fill="currentColor" />
      <rect x="8.5" y="1" width="3.5" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
      <path d="M1 1.2v13.6L12.5 8 1 1.2z" fill="currentColor" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 10-2.34 5.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 7v5h-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExitArrowIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
      <path
        d="M7.5 1.5L1.5 7l6 5.5M1.5 7H16.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useElapsedSeconds(
  open: boolean,
  startedAt?: number,
  paused?: boolean,
  restartNonce?: number,
) {
  const [elapsed, setElapsed] = useState(0);
  const pauseStartedAt = useRef<number | null>(null);
  const pausedTotalMs = useRef(0);
  const baseStartedAt = useRef<number | undefined>(startedAt);

  useEffect(() => {
    if (!open || !startedAt) {
      setElapsed(0);
      pauseStartedAt.current = null;
      pausedTotalMs.current = 0;
      baseStartedAt.current = startedAt;
      return;
    }

    // Restart / new session → freeze offsets and re-base the elapsed clock.
    baseStartedAt.current = Date.now();
    pauseStartedAt.current = null;
    pausedTotalMs.current = 0;
    setElapsed(0);
  }, [open, startedAt, restartNonce]);

  useEffect(() => {
    if (!open || !baseStartedAt.current) return;

    const origin = baseStartedAt.current;

    const readElapsed = () => {
      const now = Date.now();
      const activePause =
        pauseStartedAt.current != null ? now - pauseStartedAt.current : 0;
      return Math.max(
        0,
        Math.floor((now - origin - pausedTotalMs.current - activePause) / 1000),
      );
    };

    if (paused) {
      if (pauseStartedAt.current == null) pauseStartedAt.current = Date.now();
      setElapsed(readElapsed());
      return;
    }

    if (pauseStartedAt.current != null) {
      pausedTotalMs.current += Date.now() - pauseStartedAt.current;
      pauseStartedAt.current = null;
    }

    setElapsed(readElapsed());
    const id = window.setInterval(() => setElapsed(readElapsed()), 1000);
    return () => window.clearInterval(id);
  }, [open, startedAt, paused, restartNonce]);

  return elapsed;
}

export function VideoPlayingModal({
  open,
  onClose,
  accent = 'blue',
  experience = 'phase',
  variant = 'simple',
  sessionLabel,
  title,
  sessionDuration,
  sectionLabel,
  items = [],
  startedAt,
  totalSeconds = 3600,
}: VideoPlayingModalProps) {
  const displayPaused = useRuntimeStore((s) => s.displayPaused);
  const displayRestartNonce = useRuntimeStore((s) => s.displayRestartNonce);
  const toggleDisplayPaused = useRuntimeStore((s) => s.toggleDisplayPaused);
  const restartDisplayVideo = useRuntimeStore((s) => s.restartDisplayVideo);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  useEffect(() => {
    if (!open) setConfirm(null);
  }, [open]);

  const elapsed = useElapsedSeconds(
    open,
    startedAt,
    displayPaused,
    displayRestartNonce,
  );
  const cappedElapsed = Math.min(elapsed, totalSeconds);
  const progress = totalSeconds > 0 ? Math.min(cappedElapsed / totalSeconds, 1) : 0;

  if (!open) return null;

  const isFullProgram = variant === 'full-program';
  const heading = title ?? sessionLabel ?? 'Session';
  const message = sessionLabel ? `Now playing ${sessionLabel}` : 'Now playing';

  const handleConfirm = () => {
    if (confirm === 'restart') restartDisplayVideo();
    if (confirm === 'exit') onClose();
    setConfirm(null);
  };

  return (
    <div className="p6-modal-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={message}
        className={cn(
          'p6-session-modal',
          'p6-session-modal--confirm',
          'p6-video-playing-modal',
          `p6-session-modal--${accent}`,
          experienceModalClassMap[experience],
          isFullProgram && 'p6-video-playing-modal--program',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="p6-session-modal__title">{heading}</h2>

        {sessionDuration && (
          <p className="p6-session-modal__session-duration">
            <ClockIcon />
            <span>{sessionDuration}</span>
          </p>
        )}

        {sectionLabel && (
          <div className="p6-session-modal__section">
            <span className="p6-session-modal__section-line" aria-hidden />
            <span className="p6-session-modal__section-label">{sectionLabel}</span>
            <span className="p6-session-modal__section-line" aria-hidden />
          </div>
        )}

        {items.length > 0 && (
          <ul className="p6-session-modal__list">
            {items.map((item) => (
              <li key={item.title} className="p6-session-modal__item">
                <span className="p6-session-modal__check" aria-hidden>
                  <CheckIcon />
                </span>
                <span className="p6-session-modal__item-body">
                  <span className="p6-session-modal__item-text">{item.title}</span>
                  {item.description && (
                    <span className="p6-session-modal__item-desc">{item.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {isFullProgram && (
          <div className="p6-video-playing-modal__now">
            <div className="p6-video-playing-modal__now-row">
              <div className="p6-video-playing-modal__now-left">
                <span className="p6-video-playing-modal__now-label">Now Playing</span>
                {sessionLabel && (
                  <span className="p6-video-playing-modal__now-title">{sessionLabel}</span>
                )}
              </div>
              <span className="p6-video-playing-modal__now-time">
                {formatSessionTime(cappedElapsed)} / {formatSessionTime(totalSeconds)}
              </span>
            </div>
            <div
              className="p6-video-playing-modal__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span
                className="p6-video-playing-modal__progress-fill"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {isFullProgram && confirm ? (
          <div className="p6-confirm-panel" role="alertdialog" aria-modal="true">
            <p className="p6-confirm-panel__title">
              {confirm === 'restart' ? 'Restart Full Program?' : 'Exit Full Program?'}
            </p>
            <div className="p6-confirm-panel__actions">
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--back p6-video-playing-modal__ctrl-outline"
                onClick={() => setConfirm(null)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--primary p6-video-playing-modal__ctrl-primary"
                onClick={handleConfirm}
              >
                {confirm === 'restart' ? 'Restart' : 'Exit Session'}
              </button>
            </div>
          </div>
        ) : isFullProgram ? (
          <div className="p6-video-playing-modal__controls">
            <div className="p6-video-playing-modal__controls-row">
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--primary p6-video-playing-modal__ctrl-primary"
                onClick={toggleDisplayPaused}
              >
                {displayPaused ? <PlayIcon /> : <PauseIcon />}
                <span>{displayPaused ? 'RESUME' : 'PAUSE'}</span>
              </button>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--back p6-video-playing-modal__ctrl-outline"
                onClick={() => setConfirm('restart')}
              >
                <RestartIcon />
                <span>RESTART</span>
              </button>
            </div>
            <DisplayVolumeControl />
            <button
              type="button"
              className="p6-session-modal__btn p6-session-modal__btn--back p6-video-playing-modal__ctrl-outline p6-video-playing-modal__ctrl-exit"
              onClick={() => setConfirm('exit')}
            >
              <ExitArrowIcon />
              <span>EXIT SESSION</span>
            </button>
          </div>
        ) : (
          <div className="p6-video-playing-modal__controls">
            <button
              type="button"
              className="p6-session-modal__btn p6-session-modal__btn--back p6-video-playing-modal__ctrl-outline p6-video-playing-modal__ctrl-exit"
              onClick={onClose}
            >
              <ExitArrowIcon />
              <span>RETURN TO MENU</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
