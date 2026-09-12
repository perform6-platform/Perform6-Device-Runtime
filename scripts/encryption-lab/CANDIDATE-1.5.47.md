# XT2145 candidate 1.5.47 — allow-listed asset encryption pilot

## Purpose

Add the production transport for one AES-128-CTR media derivative while
preserving the field-proven full-card, startup, heartbeat, OTA, recovery, and
HDMI layout behavior.

## Safety boundary

- Full-card encryption, formatting, sync-on-boot, cache-wipe-on-boot, and
  automatic OTA remain disabled.
- Completed 1.5.44–1.5.46 lab probes are not armed or packaged.
- The server must enable one exact serial and one exact media-version ID.
- The player reports plaintext and encrypted cache identities separately so a
  plaintext asset is evicted once and an encrypted asset cannot loop.
- Key material is accepted only as 16-byte key + 16-byte IV hex, stored in the
  internal registry, independently read back, never logged, and never written
  to browser storage or the SD card.
- Missing/mismatched keys fail before playback state changes or `StopClear`, so
  the current HDMI-2 source, heartbeat, OTA, and startup remain untouched.
- The encrypted derivative retains an `.encrypted.mp4` object name so the
  proven AssetPool → AssetRealizer path yields an extension-bearing local file.

## Observability cleanup

- Expected one-way bridge states and Node control-port readiness are INFO.
- Normal media-ended status is INFO and deduplicated by nonce/source.
- Verified 100% cache evidence overrides stale FAILED/RUNNING jobs in Admin.

## Required rollout order

1. Deploy the API migration and code with encryption disabled.
2. Install 1.5.47 and confirm boot, heartbeat, OTA readiness, and playback.
3. Prepare one derivative while preserving plaintext.
4. Enable only serial `UTF54M000145` and one exact media-version ID.
5. Run sync; verify one-time eviction, encrypted download, registry readback,
   native acceptance, Playing events, and continued heartbeats.
6. Perform the final offline SD-card readability check only after remote proof.
