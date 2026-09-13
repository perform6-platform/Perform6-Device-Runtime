# XT2145 candidate 1.5.51 — native AES-CTR event proof

## Purpose

Resolve the XT2145/BOS 9.1.93.2 discrepancy where the read-only
`HasFeature("media decryption")` probe reports unsupported although BrightSign
documents AES-CTR playback and the native `PlayFile` contract is callable.

After the first successful authenticated heartbeat, and only when no server
command is pending, this release performs one bounded native decode of the
existing synthetic two-second encrypted fixture. Success requires the ordered
native event sequence `Playing` then `MediaEnded`.

## Safety invariants

- Version-locked to 1.5.51 and hardware-locked to XT2145.
- One attempt per application boot; no retry loop.
- Remote commands take priority over probe dispatch.
- Existing HDMI-2 source, loop state, and pause state are captured first.
- The probe is rejected unless HDMI-2 already has a valid restorable local
  plaintext source.
- Decoder rejection, error, stop, or eight-second timeout restores the prior
  plaintext source (or the packaged idle clip when no source exists).
- The normal SD playback reconciler cannot interrupt the active probe.
- No format, storage encryption, file deletion, cache clear, output-mode
  change, reboot, URL reload, sync-on-boot, or automatic OTA path is added.
- Full-card encryption remains disabled and the production pilot asset is not
  selected, downloaded, modified, or played.
- Lab key and IV are never emitted to device logs.

## Expected telemetry

Successful native AES-CTR support:

`MEDIA|ENCRYPTED_PROBE|state=decoded-playing|secretLogged=0`

followed by:

`MEDIA|ENCRYPTED_PROBE|state=decoded-ended-restored|secretLogged=0`

Any other terminal state is a failed capability test, not permission to alter
the production media pipeline.
