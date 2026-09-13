# XT2145 candidate 1.5.50 — corrected native decryption capability token

Purpose: repeat the read-only native encrypted-playback capability diagnostic
using BrightSign's exact documented `roDeviceInfo.HasFeature` token.

## Change from 1.5.49

- Queries `roDeviceInfo.HasFeature("media decryption")` with the documented
  literal space. Version 1.5.49 incorrectly used the unrecognized token
  `"media_decryption"`, so its `nativeDecryption=unsupported` result was not
  valid evidence about the player capability.
- Adds a regression assertion that forbids the underscored token.

## Preserved safety boundary

- The correction is a read-only string-literal change in the diagnostic gate.
- Encryption remains disabled; no encrypted playback attempt occurs on boot.
- No storage formatting, mounting, cache deletion, media replacement, sync,
  reboot command, output change, heartbeat change, or OTA change is introduced.
- Existing plaintext HDMI-2 playback and every 1.5.49 recovery guard remain
  unchanged.
