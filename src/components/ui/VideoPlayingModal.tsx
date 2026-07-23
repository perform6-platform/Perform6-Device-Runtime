import { useEffect } from 'react';
import { cn } from '../../lib/cn';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { DisplayVolumeControl } from './DisplayVolumeControl';
import type { P6Accent } from './types';

type VideoPlayingModalProps = {
  open: boolean;
  onClose: () => void;
  accent?: P6Accent;
  variant?: 'simple' | 'full-program';
  sessionLabel?: string;
};

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 2l10 10M12 2L2 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VideoPlayingModal({
  open,
  onClose,
  accent = 'cyan',
  variant = 'simple',
  sessionLabel,
}: VideoPlayingModalProps) {
  const displayPaused = useRuntimeStore((s) => s.displayPaused);
  const toggleDisplayPaused = useRuntimeStore((s) => s.toggleDisplayPaused);
  const restartDisplayVideo = useRuntimeStore((s) => s.restartDisplayVideo);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isFullProgram = variant === 'full-program';
  const message = sessionLabel ? `Now video play ${sessionLabel}` : 'Now video play';

  return (
    <div
      className="p6-modal-overlay p6-modal-overlay--contained"
      onClick={isFullProgram ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={message}
        className={cn(
          'p6-session-modal p6-video-playing-modal',
          `p6-session-modal--${accent}`,
          isFullProgram && 'p6-video-playing-modal--program',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {!isFullProgram && (
          <button
            type="button"
            className="p6-session-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        )}

        <div className="p6-video-playing-modal__message">
          <span className="p6-video-playing-modal__message-line">Now video play</span>
          {sessionLabel && (
            <span className="p6-video-playing-modal__message-line p6-video-playing-modal__message-session">
              {sessionLabel}
            </span>
          )}
        </div>

        <div className="p6-session-modal__actions p6-video-playing-modal__actions">
          {isFullProgram ? (
            <>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--primary"
                onClick={onClose}
              >
                RETURN TO MENU
              </button>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--back"
                onClick={restartDisplayVideo}
              >
                RESTART
              </button>
              <button
                type="button"
                className="p6-session-modal__btn p6-session-modal__btn--back"
                onClick={toggleDisplayPaused}
              >
                {displayPaused ? 'RESUME' : 'PAUSE'}
              </button>
              <DisplayVolumeControl />
            </>
          ) : (
            <button
              type="button"
              className="p6-session-modal__btn p6-session-modal__btn--primary p6-video-playing-modal__btn"
              onClick={onClose}
            >
              RETURN TO MENU
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
