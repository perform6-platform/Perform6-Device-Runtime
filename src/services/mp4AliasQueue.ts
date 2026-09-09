/**
 * Extensionless AssetPool paths play pool-direct (autorun ProbeString).
 * Do NOT hardlink or sync-copy multi-GB blobs — freezes Bluefin and doubles SD.
 * Do NOT enqueue autorun CopyFile — thin autorun has no drain queue.
 */
/** Legacy path kept for wipe/diagnostics only — never written by JS anymore. */
export const MP4_ALIAS_QUEUE_SD = 'SD:/perform6-mp4-alias-queue.json';

/**
 * No-op: BA-style pool PlayFile does not need a .mp4 alias copy.
 * Call sites may remain for API stability after AssetPool mark.
 */
export function enqueueMp4PlayAlias(_poolPath: string): void {
  /* intentionally empty — pool-direct only */
}
