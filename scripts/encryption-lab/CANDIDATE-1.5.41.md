# XT2145 candidate 1.5.41

Local ZIP SHA256: `54d257c5a299bb80997defb6859753aba333ac81ff7e67df7087dee80af6ed25`

Purpose: isolate duplicate native message-port attachment while preserving the
healthy 1.5.40 boot, OTA, heartbeat, playback and SD-bus behavior.

- Modern Node-enabled `roHtmlWidget` config no longer supplies `cfg.port` and
  then attaches the same `roMessagePort` again.
- The widget still receives exactly one pre-`Show()` `SetPort()` attachment.
- JavaScript still follows BrightSign's maintained Node sample: one
  `@brightsign/messageport` instance and one `addEventListener('bsmessage', ...)`.
- Fallback widget constructors are unchanged and are not reached when the
  modern constructor succeeds.
- Adds the fixed diagnostic
  `BRIDGE|WIDGET_PORT|attach=setport-once|nodejs=1`.
- Encryption remains disabled. No key, encrypted playback, formatting,
  deletion, content sync, recovery action or automatic reboot is introduced.

Source cross-checks:

- https://github.com/brightsign/dev-cookbook/tree/main/examples/browser/send-plugin-message
- https://github.com/brightsign/brightscript-samples/blob/master/streaming/stream-hdmi-in/stream-hdmi-in-then-decode-and-display-on-hdmi-out/brightscript-and-html/autorun.brs
- https://docs.brightsign.biz/develop/rohtmlwidget

Success evidence after a separately authorized field installation:

1. device returns online on 1.5.41 and OTA becomes up to date;
2. heartbeat and existing native playback resume;
3. the fixed `BRIDGE|WIDGET_PORT` diagnostic appears;
4. `BRIDGE|RECEIVE|callback-entered=1` appears;
5. the JavaScript hello acknowledgement/capability state becomes healthy.

If step 4 remains absent, this candidate safely falsifies the duplicate-port
hypothesis; encryption remains disabled and the SD playback fallback remains
authoritative.
