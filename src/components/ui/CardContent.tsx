import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { CircleArrowButton } from './CircleArrowButton';
import type { P6Accent } from './types';

type CardDurationProps = {
  duration: string;
  variant: P6Accent;
  showArrow?: boolean;
  className?: string;
};

function CardDuration({
  duration,
  variant,
  showArrow = true,
  className,
}: CardDurationProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="p6-caption text-white/80">{duration}</span>
      {showArrow && <CircleArrowButton variant={variant} />}
    </div>
  );
}

type CardMetaRowProps = {
  keywords?: string;
  description?: string;
  className?: string;
};

function CardMeta({ keywords, description, className }: CardMetaRowProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {keywords && <span className="p6-small text-white/90">{keywords}</span>}
      {description && <span className="p6-small p6-muted">{description}</span>}
    </div>
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

export function StartHereContent({
  title,
  bullets,
  description,
  duration,
}: StartHereContentProps) {
  return (
    <div className="relative flex h-full items-center justify-center p-3 text-center sm:p-4 md:p-5">
      <div>
        <h2 className="p6-hero mb-2 sm:mb-3">{title}</h2>
        <p className="p6-body mb-2 text-white/90">{bullets}</p>
        <p className="p6-small p6-muted">{description}</p>
      </div>
      <div className="absolute right-4 bottom-4 sm:right-6 sm:bottom-6">
        <CardDuration duration={duration} variant="blue" />
      </div>
    </div>
  );
}

type PhaseCardContentProps = {
  title: string;
  keywords: string;
  description: string;
  duration: string;
  variant: P6Accent;
  thumbnail: ReactNode;
};

export function PhaseCardContent({
  title,
  keywords,
  description,
  duration,
  variant,
  thumbnail,
}: PhaseCardContentProps) {
  return (
    <div className="flex h-full gap-4 px-4 pt-4 pb-5 pr-5">
      {thumbnail}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <h3 className="p6-heading mb-1">{title}</h3>
          <CardMeta keywords={keywords} description={description} />
        </div>
        <div className="-mt-1.5 flex justify-end">
          <CardDuration duration={duration} variant={variant} />
        </div>
      </div>
    </div>
  );
}

type FullProgramContentProps = {
  title: string;
  subtitle: string;
  description: string;
  duration: string;
  image: ReactNode;
};

export function FullProgramContent({
  title,
  subtitle,
  description,
  duration,
  image,
}: FullProgramContentProps) {
  return (
    <div className="relative flex h-full flex-col">
      <div className="relative z-10 flex flex-1 flex-col justify-between px-5 pt-5 pb-6 text-center">
        <div className="flex flex-1 flex-col items-center justify-center">
          <h3 className="p6-title mb-1 leading-tight">{title}</h3>
          <p className="p6-small text-white/85">{subtitle}</p>
          <p className="p6-small p6-muted mt-1">{description}</p>
        </div>
        <div className="-mt-1.5 flex justify-end">
          <CardDuration duration={duration} variant="gold" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[42%] sm:w-[50%] md:w-[55%]">
        {image}
        <div className="absolute inset-0 bg-gradient-to-r from-[#00050a] via-transparent to-transparent" />
      </div>
    </div>
  );
}
