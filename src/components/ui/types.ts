export type P6Accent = 'blue' | 'cyan' | 'purple' | 'gold';

/** Home card / overview panel border treatment (functional UI stays #1155CC). */
export type P6Experience = 'start-here' | 'phase' | 'full-program';

export const accentClassMap: Record<P6Accent, string> = {
  blue: 'p6-glow-card--blue',
  cyan: 'p6-glow-card--cyan',
  purple: 'p6-glow-card--purple',
  gold: 'p6-glow-card--gold',
};

export const accentBtnClassMap: Record<P6Accent, string> = {
  blue: 'p6-circle-btn--blue',
  cyan: 'p6-circle-btn--cyan',
  purple: 'p6-circle-btn--purple',
  gold: 'p6-circle-btn--gold',
};

export const experienceCardClassMap: Record<P6Experience, string> = {
  'start-here': 'p6-glow-card--start-here',
  phase: 'p6-glow-card--phase',
  'full-program': 'p6-glow-card--full-program',
};

export const experienceModalClassMap: Record<P6Experience, string> = {
  'start-here': 'p6-session-modal--start-here',
  phase: 'p6-session-modal--phase',
  'full-program': 'p6-session-modal--full-program',
};
