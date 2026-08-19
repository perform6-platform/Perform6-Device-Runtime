import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import {
  accentClassMap,
  experienceCardClassMap,
  type P6Accent,
  type P6Experience,
} from './types';

type GlowCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: P6Accent;
  experience?: P6Experience;
  children: ReactNode;
};

export function GlowCard({
  variant = 'blue',
  experience,
  children,
  className,
  type = 'button',
  ...props
}: GlowCardProps) {
  return (
    <button
      type={type}
      className={cn(
        'p6-glow-card',
        experience ? experienceCardClassMap[experience] : accentClassMap[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
