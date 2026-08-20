import { cn } from '../../lib/cn';

type SectionDividerProps = {
  children: string;
  className?: string;
};

export function SectionDivider({ children, className }: SectionDividerProps) {
  return (
    <div className={cn('p6-section-divider', className)}>
      <span className="p6-section-divider__line" aria-hidden />
      <span className="p6-section-divider__label">{children}</span>
      <span className="p6-section-divider__line" aria-hidden />
    </div>
  );
}
