# XT2145 candidate 1.5.48 — allow-listed asset encryption pilot

## Purpose

Add the device-scoped AES-128-CTR media pilot and report the XT2145 by its two
physical outputs. Program choices remain logical slots on HDMI-2 rather than
appearing as SCREEN_3 through SCREEN_5.

## Safety boundary

- Full-card encryption, formatting, sync-on-boot, cache-wipe-on-boot, and
  automatic OTA remain disabled.
- The server must enable one exact serial and one exact media-version ID.
- Existing plaintext media is retained until the one allow-listed derivative
  is ready and the device has already passed boot, heartbeat, OTA, and normal
  playback checks.
- Missing or mismatched key material fails before playback state changes.
- Key material is stored in the player registry, independently read back, and
  is never logged or written to SD/browser storage.
- All XT native program playback is reported as physical SCREEN_2 / HDMI-2.

## Required rollout order

1. Deploy the API migration and code with encryption disabled.
2. Install 1.5.48 and confirm boot, heartbeat, OTA readiness, and plaintext
   playback.
3. Prepare one encrypted derivative while preserving its plaintext source.
4. Enable only serial `UTF54M000145` and one exact media-version ID.
5. Sync that asset and verify registry readback, encrypted caching, native
   playback, and continued heartbeats.
6. Ask Gabe to perform the offline SD-card check only after remote proof.
