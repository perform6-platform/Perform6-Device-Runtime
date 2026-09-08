/**
 * XT LED SD bus — thin re-export of unified ledPlaybackFile.
 * Prefer importing from ./ledPlaybackFile for new code.
 */
export {
  writeXtPlaybackFile,
  readXtPlaybackStatus,
  readXtBusHeartbeat,
  writeLedPlaybackFile,
  readLedPlaybackStatus,
  readLedPlaybackStatusForRole,
  readLedBusHeartbeat,
  isLedStatusStarted,
  type XtPlaybackRecord,
  type XtPlaybackStatus,
  type XtBusHeartbeat,
  type LedPlaybackCommand,
  type LedPlaybackFile,
  type LedPlaybackStatus,
  type LedBusHeartbeat,
  type LedPlaybackTarget,
} from './ledPlaybackFile';
