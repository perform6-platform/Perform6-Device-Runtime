/**
 * Bluefin 15.6" capacitive touchscreen — the locked design canvas.
 * HDMI-1 HtmlWidget is 3840×2160 @ 60p; this 1920×1080 design is scaled to fit
 * so CSS/offsets stay stable. Do not rewrite layout numbers to 4K.
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
