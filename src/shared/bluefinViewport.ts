/**
 * Bluefin 15.6" capacitive touchscreen — the locked design canvas.
 * XT HDMI-1 stays at the field-proven native 1920×1080 @ 60p. HDMI-2 owns
 * the independent 4K60 native-video rectangle.
 */
export const BLUEFIN_VIEWPORT = {
  width: 1920,
  height: 1080,
  inches: 15.6,
} as const;

export const BLUEFIN_FRAME_ID = 'p6-bluefin-frame';
export const BLUEFIN_OVERLAY_ROOT_ID = 'p6-bluefin-overlays';
export const BLUEFIN_LOCK_CLASS = 'p6-bluefin-lock';

export function getBluefinOverlayRoot(): HTMLElement {
  return document.getElementById(BLUEFIN_OVERLAY_ROOT_ID) ?? document.body;
}
