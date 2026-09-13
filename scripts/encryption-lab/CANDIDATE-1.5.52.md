# XT2145 candidate 1.5.52 — single-asset native encryption pilot

## Scope

- Removes automatic execution of the completed 1.5.51 synthetic decoder test.
- Permits native AES-CTR playback only for media version
  `92744b7c-237d-41eb-b7a3-02300e6368c3`.
- Treats the false-negative BrightSign `HasFeature("media decryption")` result
  as advisory because 1.5.51 proved the documented contract through actual
  `Playing` and `MediaEnded` events on XT2145/BrightSign OS 9.1.93.2.
- Retains key preflight, ID matching, decoder-error restoration, and the
  30-second no-start restoration path.

## Non-goals and forbidden behavior

- No SD formatting, remounting, whole-card encryption, cache clear, or source
  media deletion.
- No automatic sync, automatic OTA installation, or autonomous reboot.
- No key or IV values in logs, Chromium storage, or package files.
- No encrypted-playback attempt on boot. The pilot is invoked only when the
  existing playback selection path requests this exact media version.

## Field validation

After an explicitly authorized OTA install, prove a normal boot, fresh
heartbeats, and retained OTA control before selecting the pilot. Then select
`Perform6_4K60_BrightSign_Test` and require a native-accepted event followed by
decoded-playing. A native rejection, decoder error, or 30-second no-start must
leave or restore the previously playing HDMI-2 source.
