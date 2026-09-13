# Candidate 1.5.37 — read-only native capability probe

Purpose: establish whether the exact XT2145 autorun environment can construct
the native objects needed for offline media-key handling before any key or
encrypted asset is introduced.

## Active behavior

- On the existing JS-to-autorun hello only, constructs an `roRegistrySection`
  handle for `perform6_media_keys` and an empty `roByteArray`.
- Reports only `ready` or `unavailable` for those two constructors.
- Keeps encrypted-media state `disabled` and activation `probe-ready` or
  `unavailable`.

## Explicitly absent

- No registry read, write, flush, delete, key generation, or key material.
- No encrypted `PlayFile`, media download, media mutation, format, encryption,
  recovery action, or additional reboot.
- The dormant key reader remains uncalled.
- Existing plaintext playback, media paths, heartbeat, OTA and boot control are
  inherited from field-proven 1.5.23.

This candidate does not prove AES-CTR playback interoperability. It only proves
the prerequisites are available in the deployed native environment.
