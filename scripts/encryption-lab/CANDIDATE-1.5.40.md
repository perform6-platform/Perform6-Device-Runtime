# XT2145 candidate 1.5.40

Purpose: test the native-to-JavaScript bridge using BrightSign's documented Node message-port binding exactly.

- Based on the healthy 1.5.39 runtime and unchanged autorun.
- For `@brightsign/messageport`, registers only `addEventListener('bsmessage', callback)`.
- Does not assign the DOM-style `onbsmessage` property to the Node object.
- Keeps the DOM fallback behavior unchanged.
- Keeps encryption disabled.
- Does not write keys, encrypt media, format storage, delete media, or sync content.
- Does not change startup, heartbeat, OTA, output configuration, native playback, or the authoritative SD playback bus.

Success evidence after an authorized field install:

1. device returns online on 1.5.40;
2. OTA remains up to date and heartbeats continue;
3. `BRIDGE|LISTENER` reports `propertyAssignment:"skipped-node-standard"`;
4. `BRIDGE|RECEIVE|callback-entered=1` appears;
5. hello acknowledgement/capability fields reach JavaScript.

Failure is non-activating: absence of the callback leaves encryption disabled and the working SD playback/OTA paths unchanged.
