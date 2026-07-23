import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import type { P6Accent } from './types';

type SessionModalProps = {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onPrimary?: () => void;
  title: string;
  eyebrow?: string;
  items: string[];
  duration?: string;
  showDuration?: boolean;
  backLabel?: string;
  primaryLabel?: string;
  accent?: P6Accent;
  icon?: ReactNode;
  className?: string;
};

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path
        d="M8 5.5v11l9-5.5-9-5.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
      <path
        d="M1 4l2.5 2.5L9 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

export function SessionModal({
  open,
  onClose,
  onBack,
  onPrimary,
  title,
  eyebrow,
  items,
  duration,
  showDuration = true,
  backLabel = 'BACK',
  primaryLabel = 'BEGIN SESSION',
  accent = 'blue',
  icon,
  className,
}: SessionModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleBack = () => {
    if (onBack) onBack();
    else onClose();
  };

  return createPortal(
    <div className="p6-modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="p6-session-modal-title"
        className={cn('p6-session-modal', `p6-session-modal--${accent}`, className)}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="p6-session-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>

        <div className="p6-session-modal__icon-wrap">
          <div className="p6-session-modal__icon-ring">
            <div className="p6-session-modal__icon">
              {icon ?? <PlayIcon />}
            </div>
          </div>
        </div>

        <h2 id="p6-session-modal-title" className="p6-session-modal__title">
          {eyebrow && <span className="p6-session-modal__eyebrow">{eyebrow}</span>}
          {title}
        </h2>

        <ul className="p6-session-modal__list">
          {items.map((item) => (
            <li key={item} className="p6-session-modal__item">
              <span className="p6-session-modal__check" aria-hidden>
                <CheckIcon />
              </span>
              <span className="p6-session-modal__item-text">{item}</span>
            </li>
          ))}
        </ul>

        {showDuration && duration && (
          <p className="p6-session-modal__duration">{duration}</p>
        )}

        <div className="p6-session-modal__actions">
          <button
            type="button"
            className="p6-session-modal__btn p6-session-modal__btn--back"
            onClick={handleBack}
          >
            {backLabel}
          </button>
          <button
            type="button"
            className="p6-session-modal__btn p6-session-modal__btn--primary"
            onClick={onPrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
