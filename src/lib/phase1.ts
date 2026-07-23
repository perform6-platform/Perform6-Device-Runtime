export type Phase1Sport = 'fitness' | 'golf';
export type Phase1Wall = 'wall' | 'no-wall';

export type Phase1CategoryId = `${Phase1Sport}-${Phase1Wall}`;

export type Phase1Selection = {
  sport: Phase1Sport;
  wall: Phase1Wall;
};

export type Phase1Video = {
  id: string;
  title: string;
  duration: string;
  thumbnail: string;
  videoSrc: string;
};

export type Phase1Category = {
  id: Phase1CategoryId;
  sport: Phase1Sport;
  wall: Phase1Wall;
  label: string;
};

export const PHASE1_CATEGORIES: Phase1Category[] = [
  { id: 'fitness-wall', sport: 'fitness', wall: 'wall', label: 'Fitness · Wall' },
  { id: 'fitness-no-wall', sport: 'fitness', wall: 'no-wall', label: 'Fitness · No Wall' },
  { id: 'golf-wall', sport: 'golf', wall: 'wall', label: 'Golf · Wall' },
  { id: 'golf-no-wall', sport: 'golf', wall: 'no-wall', label: 'Golf · No Wall' },
];

const PHASE1_GYM_VIDEO = '/videos/phase1-gym.mp4';

const THUMBNAILS = {
  fitness: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=480&q=80&auto=format&fit=crop',
  golf: 'https://images.unsplash.com/photo-1535131749006-b7f58c990a46?w=480&q=80&auto=format&fit=crop',
};

export const PHASE1_VIDEOS: Record<Phase1CategoryId, Phase1Video[]> = {
  'fitness-wall': [
    {
      id: 'fw-mobility',
      title: 'Mobility Warmup',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'fw-stability',
      title: 'Stability & Balance',
      duration: '6 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'fw-power',
      title: 'Power Foundation',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
  ],
  'fitness-no-wall': [
    {
      id: 'fnw-mobility',
      title: 'Open Space Mobility',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'fnw-stability',
      title: 'Core Stability',
      duration: '6 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'fnw-power',
      title: 'Explosive Prep',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.fitness,
      videoSrc: PHASE1_GYM_VIDEO,
    },
  ],
  'golf-wall': [
    {
      id: 'gw-rotation',
      title: 'Rotation & Posture',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'gw-mobility',
      title: 'Hip & Thoracic Mobility',
      duration: '6 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'gw-stability',
      title: 'Single-Leg Stability',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
  ],
  'golf-no-wall': [
    {
      id: 'gnw-rotation',
      title: 'Swing Prep Rotation',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'gnw-mobility',
      title: 'Full-Body Mobility',
      duration: '6 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
    {
      id: 'gnw-stability',
      title: 'Balance & Control',
      duration: '5 MIN',
      thumbnail: THUMBNAILS.golf,
      videoSrc: PHASE1_GYM_VIDEO,
    },
  ],
};

export function getPhase1Category(id: Phase1CategoryId) {
  return PHASE1_CATEGORIES.find((c) => c.id === id);
}

export function getPhase1OptionLabel(sport: Phase1Sport, wall: Phase1Wall) {
  const category = getPhase1Category(`${sport}-${wall}`);
  return category?.label ?? `${sport} · ${wall}`;
}

export function getPhase1SessionConfig(
  selection: Phase1Selection,
  video: Phase1Video,
) {
  const label = getPhase1OptionLabel(selection.sport, selection.wall);
  return {
    title: 'Phase 1',
    step: { current: 1, total: 6 },
    currentStepLabel: video.title,
    nextStepLabel: `${label} — Next Step`,
    initialTimeRemaining: 900,
    initialProgress: 0,
    accent: 'cyan' as const,
    videoSrc: video.videoSrc,
  };
}

export function getPhase1DefaultSessionConfig() {
  return {
    title: 'Phase 1',
    step: { current: 1, total: 6 },
    currentStepLabel: 'Mobility Warmup',
    nextStepLabel: 'Stability & Balance',
    initialTimeRemaining: 900,
    initialProgress: 0,
    accent: 'cyan' as const,
    videoSrc: PHASE1_GYM_VIDEO,
  };
}

export const PHASE1_ITEMS = [
  'Mobility training',
  'Stability & balance',
  'Power foundation',
];
