import { cn } from '../../lib/cn';
import perform6Logo from '../../assets/Perform_6_trademark.png';

type LogoProps = {
  className?: string;
};

export function Logo({ className }: LogoProps) {
  return (
    <img
      src={perform6Logo}
      alt="Perform6"
      className={cn(
        'p6-logo',
        className,
      )}
      draggable={false}
    />
  );
}
