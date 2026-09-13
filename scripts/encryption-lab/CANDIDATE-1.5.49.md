# XT2145 candidate 1.5.49 — native encrypted-playback discriminator

Purpose: distinguish an unsupported native decryption feature from an invalid
encrypted `PlayFile` contract without changing the proven boot/control paths.

## Changes from 1.5.48

- Reports `roDeviceInfo.HasFeature("media decryption")` through the existing
  hello/SD telemetry. The probe is read-only.
- Refuses encrypted playback before touching the active transport when native
  media decryption is unsupported.
- Uses BrightSign's documented minimal `roVideoPlayer.PlayFile` associative
  array: `Filename`, `EncryptionAlgorithm="AesCtr"`, and a 32-byte
  `EncryptionKey` containing 16-byte key followed by 16-byte IV.
- Removes `ProbeString`, which is useful for extensionless pool objects but is
  neither needed nor present in BrightSign's encrypted-file example.
- Keeps the SD file-size probe advisory because BrightSign can report false
  negatives on exFAT; native `PlayFile()` remains authoritative.
- Requires native `media decryption` support before the capability reports
  ready.
- Reports one secret-free terminal reason: unsupported/probe-unavailable
  feature, key unavailable, native accepted, or `PlayFile` returned false,
  with the advisory file-probe result attached.

## Preserved safety boundary

- No storage formatting, mounting, full-card encryption, cache clearing, media
  deletion, source replacement, automatic playback attempt, reboot, or OTA
  command is introduced.
- Startup, heartbeat, OTA installer, output configuration, SD command bus, and
  plaintext playback remain unchanged.
- Encrypted playback remains reachable only for an API-allowlisted asset whose
  ciphertext is already confirmed cached and whose key passed registry
  readback. Any preflight or native rejection leaves the active plaintext video
  running.
- If native playback accepts the call but produces neither Playing nor Error,
  a 30-second watchdog restores the prior HDMI-2 source.
