import { isGolfEdition } from '../config/experience';

export const FULL_PROGRAM_VIDEO = '/videos/phase1-gym.mp4';

export const FULL_PROGRAM_ITEMS = [
  {
    title: 'Move Better',
    description: 'Improve mobility, stability, and movement efficiency.',
  },
  {
    title: 'Develop Strength & Power',
    description: isGolfEdition
      ? 'Increase strength and explosive power for golf.'
      : 'Increase force production and explosive power.',
  },
  {
    title: 'Improve Conditioning',
    description: isGolfEdition
      ? 'Build endurance for better energy and focus on the course.'
      : 'Enhance endurance to sustain and repeat high-intensity efforts.',
  },
  {
    title: 'Recover Faster',
    description: isGolfEdition
      ? 'Enhance recovery between rounds and training sessions.'
      : 'Improve recovery between training sessions.',
  },
  {
    title: 'Optimize Performance',
    description: isGolfEdition
      ? 'Integrate all 6 Steps to elevate physical performance for golf.'
      : 'Integrate all 6 Steps to maximize physical performance.',
  },
];

export function getFullProgramSessionConfig() {
  return {
    title: 'Full Program',
    step: { current: 1, total: 6 },
    currentStepLabel: 'Step 1 — Guided Introduction',
    nextStepLabel: 'Step 2 — Mobility',
    initialTimeRemaining: 3600,
    initialProgress: 0,
    accent: 'gold' as const,
    videoSrc: FULL_PROGRAM_VIDEO,
  };
}
