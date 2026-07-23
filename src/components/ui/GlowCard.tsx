import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { accentClassMap, type P6Accent } from './types';

type GlowCardProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: P6Accent;
  children: ReactNode;
};

export function GlowCard({
  variant,
  children,
  className,
  type = 'button',
  ...props
}: GlowCardProps) {
  return (
    <button
      type={type}
      className={cn('p6-glow-card', accentClassMap[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
}
