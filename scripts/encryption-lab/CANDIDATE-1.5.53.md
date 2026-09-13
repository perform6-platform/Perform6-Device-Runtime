# XT2145 candidate 1.5.53 — encrypted MP4 container hint

## Scope

- Retains the 1.5.52 single-device, single-media-version encryption pilot.
- Restores `ProbeString = "mp4"` on the encrypted `roVideoPlayer.PlayFile`
  request. The 1.5.51 XT2145 field fixture used this hint and reached both
  `Playing` and `MediaEnded`; 1.5.52 omitted it and the production ciphertext
  was rejected synchronously by `PlayFile`.
- Leaves the pilot assigned to Day 4 for an explicit, user-triggered retest.

## Safety boundary

- No playback attempt on boot and no automatic selection of the pilot.
- No SD formatting, remounting, cache deletion, media sync, or source deletion.
- No changes to startup, heartbeat, OTA activation, recovery, or output setup.
- The existing plaintext HDMI-2 source remains active unless encrypted
  `PlayFile` accepts the request; decoder error and no-start timeout still
  restore it.
- Encryption remains locked to serial `UTF54M000145` server-side and media
  version `92744b7c-237d-41eb-b7a3-02300e6368c3` in both API and runtime.

## Required field result

After normal boot and heartbeat verification, explicitly select Full Program.
Success requires `native-accepted` followed by `decoded-playing`. Any rejection,
decoder error, or timeout must preserve or restore the prior HDMI-2 source.
