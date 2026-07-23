import { cn } from '../../lib/cn';
import { accentBtnClassMap, type P6Accent } from './types';

type CircleArrowButtonProps = {
  variant: P6Accent;
  className?: string;
};

function ArrowIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 5h5M5.5 2.5L8 5l-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CircleArrowButton({ variant, className }: CircleArrowButtonProps) {
  return (
    <span
      className={cn('p6-circle-btn', accentBtnClassMap[variant], className)}
      aria-hidden
    >
      <ArrowIcon />
    </span>
  );
}
