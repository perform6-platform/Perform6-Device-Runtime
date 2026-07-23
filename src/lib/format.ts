function safeSeconds(seconds: number) {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/** MM:SS — session sidebar countdown */
export function formatSessionTime(seconds: number) {
  const safe = safeSeconds(seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** HH:MM:SS — video control bar */
export function formatVideoClock(seconds: number) {
  const safe = safeSeconds(seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
