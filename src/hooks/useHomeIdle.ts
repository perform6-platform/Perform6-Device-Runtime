import { useCallback, useEffect, useRef, useState } from 'react';

type UseHomeIdleOptions = {
  delayMs: number;
  blocked: boolean;
};

/**
 * After `delayMs` without interaction, enter attract mode (`isOpen`).
 * Attract = hide touch UI / show full default video — not a modal.
 * Any pointer activity while attracted wakes the menu again.
 */
export function useHomeIdle({ delayMs, blocked }: UseHomeIdleOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    if (blocked) return;

    timerRef.current = setTimeout(() => {
      setIsOpen(true);
    }, delayMs);
  }, [blocked, clearTimer, delayMs]);

  useEffect(() => {
    if (blocked) {
      clearTimer();
      setIsOpen(false);
      return;
    }

    if (isOpen) {
      clearTimer();
      return;
    }

    schedule();
    return clearTimer;
  }, [blocked, isOpen, schedule, clearTimer]);

  const onActivity = useCallback(() => {
    if (blocked) return;

    // Wake from attract → show buttons again.
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    // Menu visible → reset idle countdown.
    schedule();
  }, [blocked, isOpen, schedule]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    /** Attract mode active (UI hidden). */
    isOpen,
    close,
    onActivity,
  };
}
