import type { P6Accent } from '../ui/types';

export type SessionPlayerStep = {
  current: number;
  total: number;
};

export type SessionPlayerConfig = {
  open: boolean;
  onClose: () => void;
  videoSrc: string;
  attractMode?: boolean;
  title?: string;
  step?: SessionPlayerStep;
  currentStepLabel?: string;
  nextStepLabel?: string;
  initialTimeRemaining?: number;
  initialProgress?: number;
  accent?: P6Accent;
  className?: string;
  controlVariant?: 'full' | 'minimal' | 'program';
};
