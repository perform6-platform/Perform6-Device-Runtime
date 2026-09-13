# XT2145 candidate 1.5.46 — event-correlated AES-CTR playback proof

## Purpose

Distinguish native acceptance from actual encrypted decoding. Candidate 1.5.45
proved that the XT2145 accepted the documented AES-CTR `PlayFile` parameters
and that plaintext playback could be restored, but its blocking delay prevented
the main event loop from correlating native playback events to the fixture.

## Execution boundary

- Runtime 1.5.46 is hard-gated to XT2145 and runs once, two seconds after the
  first successful authenticated heartbeat.
- The same synthetic two-second AES-128-CTR fixture and test-only key are used.
  No CMS or customer video is read, replaced, encrypted, deleted, or downloaded.
- The native HDMI-2 player temporarily disables loop mode, starts the fixture,
  and leaves the main event loop fully responsive.
- Success requires the ordered native event sequence `Playing` then
  `MediaEnded` from the exact HDMI-2 player identity. `PlayFile=true` alone is
  logged only as acceptance.
- Error, post-Playing stop, or an eight-second timer restores the prior
  plaintext source. Pre-Playing stale stop/end events are ignored and cannot
  produce a false success.
- The normal two-second SD playback reconciler alone is paused while the probe
  owns HDMI-2. Heartbeat, API communication, OTA control, and timers continue.
- A server remote command takes precedence and defers probe arming to a later
  command-free heartbeat. Native playback commands received during the probe
  are deferred; their SD command is reconciled after the prior source returns.
- A native once-per-boot latch prevents duplicate delivery across native event
  shapes from starting the HDMI-2 probe twice.

## Preserved hard lines

- No format, mount/remount, full-card encryption, cache wipe, media sync,
  deletion, output reconfiguration, `SetUrl`, recovery mutation, automatic OTA,
  or probe-triggered reboot exists in the path.
- Probe state is cleared and its timer is stopped before plaintext restoration,
  preventing restoration events from being misclassified.
- All telemetry is fixed and secret-free. The registry contains only the
  synthetic test key under the version-specific probe identifier.

## Expected field evidence

Positive proof is:

1. `MEDIA|KEY_PROBE|state=stored-readback-ok|bytes=32|secretLogged=0`
2. `MEDIA|ENCRYPTED_PROBE|state=native-accepted-await-events|secretLogged=0`
3. `MEDIA|ENCRYPTED_PROBE|state=decoded-playing|secretLogged=0`
4. `MEDIA|ENCRYPTED_PROBE|state=decoded-ended-restored|secretLogged=0`
5. Recurring native heartbeat and OTA `Up to date` after restoration.

Any other terminal state blocks production encryption work but is contained to
the temporary HDMI-2 probe. This test does not prove encrypted 4K60 throughput,
production key delivery, or tamper authentication.
