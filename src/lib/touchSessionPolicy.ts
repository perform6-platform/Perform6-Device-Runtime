/**
 * Touch-screen deployment session policy only.
 * Default / DISPLAY deployments keep all-day looping — do not use these there.
 */

/** Start Here / Phase 1 / Phase 2: loop the day's video for this long, then return to menu. */
export const TOUCH_LOOP_SESSION_MS = 45 * 60 * 1000;

export type TouchProgramSource = 'start-here' | 'phase1' | 'phase2' | 'full-program';

/** Full Program plays once; looping programs use the timed loop window. */
export function isTouchLoopingProgram(source: TouchProgramSource): boolean {
  return source !== 'full-program';
}
