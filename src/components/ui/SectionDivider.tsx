import { cn } from '../../lib/cn';

type SectionDividerProps = {
  children: string;
  className?: string;
};

export function SectionDivider({ children, className }: SectionDividerProps) {
  return (
    <div className={cn('p6-section-divider', className)}>
      <span className="text-white">{children}</span>
    </div>
  );
}
