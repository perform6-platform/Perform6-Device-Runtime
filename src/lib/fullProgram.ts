export const FULL_PROGRAM_VIDEO = '/videos/phase1-gym.mp4';

export const FULL_PROGRAM_ITEMS = [
  'All 6 Steps',
  'Immersive Guided Training Experience',
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
