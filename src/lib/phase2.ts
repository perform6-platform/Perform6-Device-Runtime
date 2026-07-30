const PHASE2_VIDEO = '/videos/phase1-gym.mp4';

export const PHASE2_ITEMS = [
  {
    title: 'Build Strength',
    description: 'Increase your ability to produce and control force',
  },
  {
    title: 'Improve Conditioning',
    description: 'Train longer and perform at a higher intensity',
  },
  {
    title: 'Recover Faster',
    description: 'Recover more efficiently between training sessions',
  },
];

export function getPhase2DefaultSessionConfig() {
  return {
    title: 'Phase 2',
    step: { current: 1, total: 6 },
    currentStepLabel: 'Strength Foundation',
    nextStepLabel: 'Energy & Recovery',
    initialTimeRemaining: 1200,
    initialProgress: 0,
    accent: 'purple' as const,
    videoSrc: PHASE2_VIDEO,
  };
}
