import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import p6LogoIcon from '../../assets/P6_logo_icon.png';

function CardChevron({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="24"
      viewBox="0 0 14 24"
      fill="none"
      aria-hidden
      className={cn('text-white/90', className)}
    >
      <path
        d="M2 2l10 10-10 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type CardThumbnailProps = {
  src: string;
  alt: string;
  className?: string;
};

export function CardThumbnail({ src, alt, className }: CardThumbnailProps) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-lg',
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-black/40" />
    </div>
  );
}

type StartHereContentProps = {
  title: string;
  bullets: string;
  description: string;
  duration: string;
};

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
          {index > 0 && <span className="p6-keyword-row__sep" aria-hidden />}
          {part}
        </span>
      ))}
    </div>
  );
}

export function StartHereContent({
  title,
  bullets,
  description,
  duration,
}: StartHereContentProps) {
  return (
    <div className="p6-start-here-card">
      <div className="p6-start-here-card__text">
        <h2 className="p6-hero p6-start-here-card__title">{title}</h2>
        <KeywordRow keywords={bullets} className="p6-start-here-card__bullets" />
        <p className="p6-small p6-muted p6-start-here-card__description">{description}</p>
      </div>

      <div className="p6-start-here-card__footer">
        <span className="p6-small text-white/85">{duration}</span>
      </div>

      <div className="p6-start-here-card__chevron" aria-hidden>
        <CardChevron />
      </div>
    </div>
  );
}

type PhaseCardContentProps = {
  title: string;
  keywords: string;
  description: string;
  duration: string;
  thumbnail?: ReactNode;
};

export function PhaseCardContent({
  title,
  keywords,
  description,
  duration,
}: PhaseCardContentProps) {
  return (
    <div className="p6-phase-card">
      <div className="p6-phase-card__text">
        <h3 className="p6-heading p6-phase-card__title">{title}</h3>
        <KeywordRow keywords={keywords} className="p6-phase-card__keywords" />
        <p className="p6-small p6-muted p6-phase-card__description">{description}</p>
      </div>

      <div className="p6-phase-card__footer">
        <span className="p6-small text-white/85">{duration}</span>
      </div>

      <div className="p6-phase-card__chevron" aria-hidden>
        <CardChevron className="h-5 w-3" />
      </div>
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
    <>
      <div className="p6-full-program-content">
        <h3 className="p6-title p6-full-program-content__title">{title}</h3>
        <p className="p6-full-program-content__subtitle">{subtitle}</p>
        <img
          src={p6LogoIcon}
          alt=""
          className="p6-full-program-content__icon"
          draggable={false}
        />
        <p className="p6-full-program-content__description">
          <span>Experience the complete</span>
          <span>Perform6 training system.</span>
        </p>
        <span className="p6-full-program-content__chevron" aria-hidden>
          <CardChevron />
        </span>
      </div>
      <span className="p6-home__full-program-duration">{duration}</span>
    </>
  );
}
