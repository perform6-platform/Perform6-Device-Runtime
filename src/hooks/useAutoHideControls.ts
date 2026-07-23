import { useCallback, useRef, useState } from 'react';

const DEFAULT_HIDE_DELAY_MS = 4000;

export function useAutoHideControls(delayMs = DEFAULT_HIDE_DELAY_MS) {
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(true);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, delayMs);
  }, [clearHideTimer, delayMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const reset = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  return {
    visible,
    reveal,
    reset,
    clearHideTimer,
    scheduleHide,
  };
}
