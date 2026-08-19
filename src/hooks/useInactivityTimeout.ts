import { useEffect, useRef } from 'react';

type UseInactivityTimeoutOptions = {
  enabled: boolean;
  delayMs: number;
  onTimeout: () => void;
};

/**
 * Calls `onTimeout` after `delayMs` without pointer/keyboard activity.
 * Any interaction while enabled resets the timer. Used for Program Overview
 * so an abandoned selection returns to Home without starting a session.
 */
export function useInactivityTimeout({
  enabled,
  delayMs,
  onTimeout,
}: UseInactivityTimeoutOptions) {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      timer = setTimeout(() => {
        onTimeoutRef.current();
      }, delayMs);
    };

    schedule();
    window.addEventListener('pointerdown', schedule);
    window.addEventListener('keydown', schedule);

    return () => {
      clearTimer();
      window.removeEventListener('pointerdown', schedule);
      window.removeEventListener('keydown', schedule);
    };
  }, [enabled, delayMs]);
}
