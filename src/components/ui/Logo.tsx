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
        'p6-logo block h-auto w-[8.5rem] max-w-full object-contain object-left md:w-[12rem]',
        className,
      )}
      draggable={false}
    />
  );
}
