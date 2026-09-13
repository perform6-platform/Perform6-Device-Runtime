# XT2145 candidate 1.5.54 — encrypted representation routing fix

## Root cause fixed

- Sync downloaded and realized the encrypted pilot derivative as a distinct SD
  file (`4831652-183.mp4`).
- Playback resolution then probed the CMS manifest's original plaintext URL
  first and overwrote the verified mapping with the old plaintext SD file
  (`5669338-98.mp4`).
- BrightSign was consequently asked to apply the AES-CTR key to plaintext and
  correctly rejected `PlayFile()` before decoding.

## Change

- The exact URL most recently downloaded and verified by sync is now
  authoritative for local playback.
- The older CMS/plaintext URL is used only to repair legacy cache state when no
  verified representation mapping exists.
- Adds a release-gate regression proving the encrypted mapping is resolved
  before the plaintext fallback probe.

## Safety boundary

- No changes to `autorun.brs`, startup, heartbeat, OTA replacement, reboot,
  output configuration, key storage, encryption parameters, or the API.
- No cache deletion, SD formatting, storage remount, or automatic playback
  selection.
- The currently playing plaintext source remains untouched. Native encrypted
  playback still preserves/restores the prior HDMI-2 source on rejection,
  decoder error, or start timeout.
