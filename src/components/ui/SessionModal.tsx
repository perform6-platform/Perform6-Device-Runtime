import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getBluefinOverlayRoot } from '../../shared/bluefinViewport';
import { cn } from '../../lib/cn';
import { experienceModalClassMap, type P6Accent, type P6Experience } from './types';

export type SessionModalItem = {
  title: string;
  description?: string;
};

type SessionModalProps = {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onPrimary?: () => void;
  title: string;
  eyebrow?: string;
  items: Array<string | SessionModalItem>;
  /** Shown under the title with a clock icon, e.g. "5–10 Minutes". */
  sessionDuration?: string;
  /** Centered divider label, e.g. "THIS SESSION WILL HELP YOU". */
  sectionLabel?: string;
  duration?: string;
  showDuration?: boolean;
  backLabel?: string;
  primaryLabel?: string;
  accent?: P6Accent;
  experience?: P6Experience;
  icon?: ReactNode;
  className?: string;
};

function normalizeItems(items: Array<string | SessionModalItem>): SessionModalItem[] {
  return items.map((item) => (typeof item === 'string' ? { title: item } : item));
}

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Figma frame 24×24 — vector inset left 25% / right 12.5% / top-bottom 12.5% */}
      <path d="M6 3v18l15-9L6 3z" fill="currentColor" />
    </svg>
  );
}

function BackArrowIcon() {
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

function ClockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden>
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

export function SessionModal({
  open,
  onClose,
  onBack,
  onPrimary,
  title,
  eyebrow,
  items,
  sessionDuration,
  sectionLabel,
  duration,
  showDuration = true,
  backLabel = 'Back',
  primaryLabel = 'BEGIN SESSION',
  accent = 'blue',
  experience = 'phase',
  className,
}: SessionModalProps) {
  const normalizedItems = normalizeItems(items);

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
        className={cn(
          'p6-session-modal',
          'p6-session-modal--confirm',
          `p6-session-modal--${accent}`,
          experienceModalClassMap[experience],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="p6-session-modal-title" className="p6-session-modal__title">
          {eyebrow && <span className="p6-session-modal__eyebrow">{eyebrow}</span>}
          {title}
        </h2>

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

        <ul className="p6-session-modal__list">
          {normalizedItems.map((item) => (
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

        {showDuration && duration && (
          <p className="p6-session-modal__duration">{duration}</p>
        )}

        <div className="p6-session-modal__actions">
          <button
            type="button"
            className="p6-session-modal__btn p6-session-modal__btn--primary"
            onClick={onPrimary}
          >
            <PlayIcon />
            <span>{primaryLabel}</span>
          </button>
          <button
            type="button"
            className="p6-session-modal__btn p6-session-modal__btn--back"
            onClick={handleBack}
          >
            <BackArrowIcon />
            <span>{backLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    getBluefinOverlayRoot(),
  );
}
