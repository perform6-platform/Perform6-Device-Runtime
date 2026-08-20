export const FULL_PROGRAM_VIDEO = '/videos/phase1-gym.mp4';

export const FULL_PROGRAM_ITEMS = [
  {
    title: 'Move Better',
    description: 'Improve mobility, stability, and movement efficiency',
  },
  {
    title: 'Build Strength & Power',
    description: 'Increase force production and explosive performance',
  },
  {
    title: 'Improve Conditioning',
    description: 'Train longer and perform at a higher intensity',
  },
  {
    title: 'Recover Faster',
    description: 'Enhance recovery between training sessions',
  },
  {
    title: 'Improve Overall Performance',
    description: 'Develop the physical qualities that drive performance',
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
