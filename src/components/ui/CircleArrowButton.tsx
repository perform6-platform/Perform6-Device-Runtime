import { cn } from '../../lib/cn';

type CircleArrowButtonProps = {
  className?: string;
};

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 20" fill="none" aria-hidden>
      <path
        d="M2.5 2.5L9.5 10 2.5 17.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Outlined Perform6 primary-blue chevron — same size/position on every Home card. */
export function CircleArrowButton({ className }: CircleArrowButtonProps) {
  return (
    <span className={cn('p6-circle-btn', className)} aria-hidden>
      <ChevronIcon />
    </span>
  );
}
