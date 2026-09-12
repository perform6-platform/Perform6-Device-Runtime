# XT2145 candidate 1.5.43 — withdrawn before installation

## Purpose

This version number is quarantined. Two proposed implementations failed the
pre-install safety audit and must not be installed on a player.

## Audited change from 1.5.42

- Replacing the proven Node object with the browser-global object would put
  playback and the autorun HTTP OTA fallback on an unproven transport.
- Keeping Node outbound while constructing a second browser-global observer
  violates BrightSign's one-BSMessagePort-per-roHtmlWidget constraint.
- The generated ZIP is rejected and its hash must not be approved by the
  release assertion.

1.5.42 remains the live safe baseline. Native diagnostic results will instead
be written to SD and collected by the existing Node filesystem telemetry,
without changing the control port.

## Unchanged safety boundary

- Encryption remains disabled.
- No key creation, encrypted playback, media deletion, formatting, cache wipe,
  content synchronization, or migration.
- No changes to BrightScript startup, widget construction, output routing,
  existing playback, heartbeat, OTA commit/reboot, or recovery behavior. The
  object used to send those existing commands remains the 1.5.42 Node object.
- Failure to receive the acknowledgement remains observe-only and cannot
  reboot or recycle the player.

## Release status

Do not upload, publish, install or reboot with 1.5.43.
