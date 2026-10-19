import { cn } from '../../lib/cn';
import preGolfIcon from '../../assets/pre-golf-icon.svg';

type PreGolfIconProps = {
  className?: string;
};

/** Client-supplied vector artwork used only by the Golf presentation edition. */
export function PreGolfIcon({ className }: PreGolfIconProps) {
  return (
    <span className={cn('p6-pre-golf-icon', className)} aria-hidden>
      <img src={preGolfIcon} alt="" draggable={false} />
    </span>
  );
}
