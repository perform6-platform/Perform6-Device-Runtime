# XT2145 candidate 1.5.42

## Purpose

Test BrightSign's documented `roHtmlWidget` port-binding arrangement after
1.5.41 proved that `SetPort()`-only still leaves native-to-JavaScript delivery
silent on the field XT2145.

## Change from 1.5.41

- Supply `port: msgPort` in every associative-array widget constructor.
- Do not call `SetPort()` after a successful associative-array constructor.
- Preserve `SetPort()` only for the legacy constructor fallback that has no
  initialization-properties object.
- Emit `BRIDGE|WIDGET_PORT|attach=constructor-only|nodejs=1` so the selected
  field path is independently visible.

This follows the BrightSign `roHtmlWidget` documentation: when initialization
properties are used, the `port` initialization parameter should be used instead
of `SetPort()`.

## Safety boundary

- Encryption remains disabled.
- No key creation or encrypted playback.
- No media deletion, formatting, cache wipe, synchronization, or migration.
- No change to OTA commit/reboot, heartbeat, SD playback, output routing, or
  recovery behavior.
- A missing acknowledgement remains observe-only and cannot reboot the player.

## Success signal

After the normal OTA reboot, require all of:

1. device online and OTA current at 1.5.42;
2. recurring API heartbeat and existing SD playback;
3. `BRIDGE|WIDGET_PORT|attach=constructor-only|nodejs=1` in the SD diagnostic;
4. JavaScript `BRIDGE|RECEIVE|callback-entered=1` and `Autorun hello ack`;
5. no `Bridge grace ended without hello-ack` warning.

Failure of items 4-5 falsifies this hypothesis but does not activate recovery,
encryption, formatting, or any automatic reboot.
