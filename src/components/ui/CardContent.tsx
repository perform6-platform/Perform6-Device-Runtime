import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { CircleArrowButton } from './CircleArrowButton';

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
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

/** Approved chevron SVG — layout via className (Start Here / Phase 1). */
function ApprovedChevronIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width={70}
      height={70}
      viewBox="0 0 70 70"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="35" cy="35" r="31" stroke="#1155CC" strokeWidth="6" />
      <path
        d="M30 22L43 35L30 48"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Approved clock SVG — layout via className (Start Here / Phase 1). */
function ApprovedClockIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width={38}
      height={38}
      viewBox="0 0 38 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle
        cx="19"
        cy="19"
        r="14.25"
        stroke="#1155CC"
        strokeWidth="2.5"
      />
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
        <Fragment key={`${part}-${index}`}>
          {index > 0 && (
            <span className="p6-keyword-row__sep" aria-hidden>
              ·
            </span>
          )}
          <span className="p6-keyword-row__item">{part}</span>
        </Fragment>
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
      <div className="p6-card-heading">
        <h2 className="p6-title p6-start-here-card__title">{title}</h2>
      </div>
      <ApprovedChevronIcon className="p6-start-here-card__chevron" />
      <KeywordRow keywords={bullets} className="p6-start-here-card__bullets" />
      <p className="p6-start-here-card__description">{description}</p>
      <ApprovedClockIcon className="p6-start-here-card__clock" />
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
  /** Use Start Here approved chevron SVG instead of CircleArrowButton. */
  approvedChevron?: boolean;
};

export function PhaseCardContent({
  title,
  keywords,
  steps,
  description,
  duration,
  approvedChevron = false,
}: PhaseCardContentProps) {
  return (
    <div className="p6-phase-card">
      <div className="p6-card-heading">
        <h3 className="p6-title p6-phase-card__title">{title}</h3>
        {approvedChevron ? null : <CircleArrowButton />}
      </div>
      {approvedChevron ? (
        <>
          <span className="p6-phase-card__accent" aria-hidden />
          <ApprovedChevronIcon className="p6-phase-card__chevron" />
          <ApprovedClockIcon className="p6-phase-card__clock" />
        </>
      ) : null}
      <KeywordRow keywords={keywords} className="p6-phase-card__keywords" />
      {steps ? <p className="p6-phase-card__steps">{steps}</p> : null}
      <p className="p6-phase-card__description">{description}</p>
      <DurationBadge duration={duration} />
    </div>
  );
}

type FullProgramContentProps = {
  title: string;
  row1: string;
  row2: string;
  steps: string;
  description: string;
  duration: string;
};

export function FullProgramContent({
  title,
  row1,
  row2,
  steps,
  description,
  duration,
}: FullProgramContentProps) {
  return (
    <div className="p6-full-program-content">
      <div className="p6-card-heading">
        <h3 className="p6-title p6-full-program-content__title">{title}</h3>
      </div>
      <span className="p6-full-program-content__accent" aria-hidden />
      <ApprovedChevronIcon className="p6-full-program-content__chevron" />
      <KeywordRow keywords={row1} className="p6-full-program-content__row1" />
      <KeywordRow keywords={row2} className="p6-full-program-content__row2" />
      <p className="p6-full-program-content__steps">{steps}</p>
      <p className="p6-full-program-content__description">{description}</p>
      <ApprovedClockIcon className="p6-full-program-content__clock" />
      <DurationBadge duration={duration} />
    </div>
  );
}
