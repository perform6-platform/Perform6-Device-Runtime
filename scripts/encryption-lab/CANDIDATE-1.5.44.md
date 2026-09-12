# XT2145 candidate 1.5.44 — post-heartbeat registry interoperability

## Purpose

Prove that a random AES-128 key and IV can be delivered over the existing
field-proven Node control port, persisted in the player's internal registry,
flushed, and independently read by BrightScript. This candidate does not
encrypt or play encrypted media.

## Execution boundary

- The normal 1.5.42-derived application, credentials and first API heartbeat
  must succeed before the probe can run.
- The probe is hard-gated to XT2145 runtime version 1.5.44 and latches before
  any fallible work, so it executes at most once per boot.
- Chromium creates a random 16-byte key and 16-byte IV in memory and sends one
  `p6-media-key-probe` message over the existing shared Node port.
- BrightScript accepts only the reserved `probe_1_5_44` record, validates its
  exact shape, writes it to `perform6_media_keys`, flushes the registry, then
  reads it independently as one 32-byte key-plus-IV container.
- Only fixed success/failure status is written to `perform6-led.log`; no key,
  IV, record or payload is logged or written to SD.

## Preserved hard lines

- One message-port object only; no DOM observer or port recreation.
- No media download, playback change, cache mutation or plaintext deletion.
- No storage encryption, formatting, mounting or filesystem mutation.
- No startup-file operation, `SetUrl`, output-mode change, OTA commit, reboot,
  bridge healing, retry loop or automatic follow-up release.
- Any failure affects only the probe and leaves startup, heartbeat, playback,
  OTA and remote reboot available.
- OTA asset activation no longer unlinks a working destination before rename;
  if the replacement rename fails, the active file remains in place and the
  installation fails without committing or rebooting.

## Required field evidence

After an explicitly authorized installation and normal OTA reboot:

1. runtime 1.5.44 reports a successful API heartbeat and existing playback;
2. OTA remains responsive;
3. SD telemetry contains exactly one of the fixed `MEDIA|KEY_PROBE` outcomes;
4. advance only on `state=stored-readback-ok|bytes=32|secretLogged=0`.

Absence or failure of that line denies encrypted playback work but must not
trigger another installation or reboot.
