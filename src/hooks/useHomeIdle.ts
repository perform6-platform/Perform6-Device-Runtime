import { useCallback, useEffect, useRef, useState } from 'react';

type UseHomeIdleOptions = {
  delayMs: number;
  blocked: boolean;
};

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
    if (blocked || isOpen) {
      clearTimer();
      return;
    }

    schedule();
    return clearTimer;
  }, [blocked, isOpen, schedule, clearTimer]);

  const onActivity = useCallback(() => {
    if (isOpen || blocked) return;
    schedule();
  }, [isOpen, blocked, schedule]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    close,
    onActivity,
  };
}
