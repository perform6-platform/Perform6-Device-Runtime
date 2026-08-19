import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { CircleArrowButton } from './CircleArrowButton';

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
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

export function DurationBadge({
  duration,
  className,
}: {
  duration: string;
  className?: string;
}) {
  return (
    <span className={cn('p6-duration', className)}>
      <ClockIcon />
      <span>{duration}</span>
    </span>
  );
}

type CardThumbnailProps = {
  src: string;
  alt: string;
  className?: string;
};

export function CardThumbnail({ src, alt, className }: CardThumbnailProps) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-lg', className)}>
      <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-black/40" />
    </div>
  );
}

function KeywordRow({
  keywords,
  className,
}: {
  keywords: string;
  className?: string;
}) {
  const parts = keywords.split(/\s*[•·▪]\s*/).filter(Boolean);

  return (
    <div className={cn('p6-keyword-row', className)}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="p6-keyword-row__item">
          {index > 0 && (
            <span className="p6-keyword-row__sep" aria-hidden>
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </div>
  );
}

type StartHereContentProps = {
  title: string;
  bullets: string;
  description: string;
  duration: string;
};

export function StartHereContent({
  title,
  bullets,
  description,
  duration,
}: StartHereContentProps) {
  return (
    <div className="p6-start-here-card">
      <h2 className="p6-title p6-start-here-card__title">{title}</h2>
      <CircleArrowButton />
      <KeywordRow keywords={bullets} className="p6-start-here-card__bullets" />
      <p className="p6-start-here-card__description">{description}</p>
      <DurationBadge duration={duration} />
    </div>
  );
}

type PhaseCardContentProps = {
  title: string;
  keywords: string;
  steps?: string;
  description: string;
  duration: string;
  thumbnail?: ReactNode;
};

export function PhaseCardContent({
  title,
  keywords,
  steps,
  description,
  duration,
}: PhaseCardContentProps) {
  return (
    <div className="p6-phase-card">
      <h3 className="p6-title p6-phase-card__title">{title}</h3>
      <CircleArrowButton />
      <KeywordRow keywords={keywords} className="p6-phase-card__keywords" />
      {steps ? <p className="p6-phase-card__steps">{steps}</p> : null}
      <p className="p6-phase-card__description">{description}</p>
      <DurationBadge duration={duration} />
    </div>
  );
}

type FullProgramContentProps = {
  title: string;
  subtitle: string;
  description: string;
  duration: string;
};

export function FullProgramContent({
  title,
  subtitle,
  description: _description,
  duration,
}: FullProgramContentProps) {
  return (
    <div className="p6-full-program-content">
      <h3 className="p6-title p6-full-program-content__title">{title}</h3>
      <CircleArrowButton />
      <p className="p6-full-program-content__subtitle">{subtitle}</p>
      <p className="p6-full-program-content__description">
        <span>Experience the complete</span>
        <span>Perform6 training system.</span>
      </p>
      <DurationBadge duration={duration} />
    </div>
  );
}
