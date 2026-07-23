import { cn } from '../../lib/cn';

type TouchHintProps = {
  className?: string;
};

function HandIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="opacity-50"
    >
      <path
        d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V12M14 10V6a1.5 1.5 0 013 0v6.5a5 5 0 01-10 0V11a1.5 1.5 0 013 0v2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TouchHint({ className }: TouchHintProps) {
  return (
    <div className={cn('flex items-center gap-2 p6-caption p6-dim', className)}>
      <HandIcon />
      <span>Touch anywhere to select</span>
    </div>
  );
}
