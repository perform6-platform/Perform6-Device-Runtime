const PHASE2_VIDEO = '/videos/phase1-gym.mp4';

export const PHASE2_ITEMS = [
  'Strength training',
  'Energy development',
  'Recovery protocols',
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
