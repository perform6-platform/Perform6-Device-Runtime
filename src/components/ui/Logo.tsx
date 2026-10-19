import { cn } from '../../lib/cn';
import perform6Logo from '../../assets/Perform6-approved-logo.svg';

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
