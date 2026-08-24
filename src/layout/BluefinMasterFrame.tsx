import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  BLUEFIN_FRAME_ID,
  BLUEFIN_LOCK_CLASS,
  BLUEFIN_OVERLAY_ROOT_ID,
  BLUEFIN_VIEWPORT,
} from '../shared/bluefinViewport';

let bluefinLockCount = 0;

function fitScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / BLUEFIN_VIEWPORT.width, height / BLUEFIN_VIEWPORT.height);
}

function acquireBluefinLock() {
  bluefinLockCount += 1;
  document.documentElement.classList.add(BLUEFIN_LOCK_CLASS);
}

function releaseBluefinLock() {
  bluefinLockCount = Math.max(0, bluefinLockCount - 1);
  if (bluefinLockCount === 0) {
    document.documentElement.classList.remove(BLUEFIN_LOCK_CLASS);
  }
}

/**
 * Locks all children to the Bluefin 15.6" 1920×1080 canvas.
 * Scales the frame to fit the parent (letterboxed) so browser preview
 * keeps the same scale, spacing, type, and proportions as the device.
 */
export function BluefinMasterFrame({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = () => {
      setScale(fitScale(stage.clientWidth, stage.clientHeight));
    };

    update();
    acquireBluefinLock();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(stage);
      return () => {
        observer.disconnect();
        releaseBluefinLock();
      };
    }

    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      releaseBluefinLock();
    };
  }, []);

  const slotWidth = BLUEFIN_VIEWPORT.width * scale;
  const slotHeight = BLUEFIN_VIEWPORT.height * scale;

  return (
    <div ref={stageRef} className="p6-master-stage">
      <div
        className="p6-master-slot"
        style={{ width: slotWidth, height: slotHeight }}
      >
        <div
          id={BLUEFIN_FRAME_ID}
          className="p6-master-frame"
          data-viewport={`${BLUEFIN_VIEWPORT.width}x${BLUEFIN_VIEWPORT.height}`}
          data-display={`${BLUEFIN_VIEWPORT.inches}-in`}
          style={{ transform: `scale(${scale})` }}
        >
          {children}
          <div id={BLUEFIN_OVERLAY_ROOT_ID} className="p6-master-overlays" />
        </div>
      </div>
    </div>
  );
}
