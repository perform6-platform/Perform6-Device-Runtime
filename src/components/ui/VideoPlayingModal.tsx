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
  className?: string;
};

function ClockIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden>
      <circle cx="19" cy="19" r="14.25" stroke="#1155CC" strokeWidth="2.5" />
      <path
        d="M19 10V19L26 24.5"
        stroke="#1155CC"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 10.5L8.2 13.7L15 5.5"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Figma 24×24 — vector inset 25% sides, 12.5% top/bottom */}
      <rect x="6" y="3" width="4" height="18" fill="currentColor" />
      <rect x="14" y="3" width="4" height="18" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 3v18l15-9L6 3z" fill="currentColor" />
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
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Figma 24×24 frame — vector inset ~16.67% sides, 25% top/bottom */}
      <path
        d="M10 6L4 12l6 6M4 12h16"
        stroke="currentColor"
        strokeWidth="2"
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
  className,
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
          isFullProgram && displayPaused && !confirm && 'p6-video-playing-modal--paused',
          isFullProgram && confirm === 'restart' && 'p6-video-playing-modal--confirm-restart',
          isFullProgram && confirm === 'exit' && 'p6-video-playing-modal--confirm-exit',
          className,
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

        {isFullProgram && confirm ? (
          <div
            className="p6-video-playing-modal__controls p6-video-playing-modal__controls--confirm"
            role="alertdialog"
            aria-modal="true"
          >
            <div className="p6-video-playing-modal__now">
              <div className="p6-video-playing-modal__now-row">
                <span className="p6-video-playing-modal__now-label">NOW PLAYING</span>
                {sessionLabel && (
                  <span className="p6-video-playing-modal__now-title">{sessionLabel}</span>
                )}
                <span className="p6-video-playing-modal__now-spacer" aria-hidden />
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
            <p className="p6-confirm-panel__title">
              {confirm === 'restart' ? 'Restart Session?' : 'Exit Session?'}
            </p>
            <div className="p6-confirm-panel__actions">
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--back p6-video-playing-modal__ctrl-outline"
                onClick={() => setConfirm(null)}
              >
                <span>Cancel</span>
              </button>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--primary p6-video-playing-modal__ctrl-primary"
                onClick={handleConfirm}
              >
                <span>{confirm === 'restart' ? 'RESTART' : 'EXIT SESSION'}</span>
              </button>
            </div>
          </div>
        ) : isFullProgram ? (
          <div className="p6-video-playing-modal__controls">
            <div className="p6-video-playing-modal__now">
              <div className="p6-video-playing-modal__now-row">
                <span className="p6-video-playing-modal__now-label">NOW PLAYING</span>
                {sessionLabel && (
                  <span className="p6-video-playing-modal__now-title">{sessionLabel}</span>
                )}
                <span className="p6-video-playing-modal__now-spacer" aria-hidden />
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
              <span>Exit Session</span>
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
