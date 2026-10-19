export const EXPERIENCE_EDITIONS = ['fitness', 'golf'] as const;

export type ExperienceEdition = (typeof EXPERIENCE_EDITIONS)[number];

function readEdition(): ExperienceEdition {
  const value = import.meta.env.VITE_P6_EDITION?.trim().toLowerCase();
  return value === 'golf' ? 'golf' : 'fitness';
}

/**
 * Build-time XT2145 presentation edition. Device control, playback, OTA,
 * telemetry and storage behavior remain shared between both editions.
 */
export const experienceEdition = readEdition();
export const isGolfEdition = experienceEdition === 'golf';
