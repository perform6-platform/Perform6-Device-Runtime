import { cn } from '../../lib/cn';

type SectionDividerProps = {
  children: string;
  className?: string;
};

export function SectionDivider({ children, className }: SectionDividerProps) {
  return (
    <div className={cn('p6-section-divider', className)}>
      <span className="p6-section-divider__line" />
      <span className="p6-label p6-muted">{children}</span>
      <span className="p6-section-divider__line" />
    </div>
  );
}
