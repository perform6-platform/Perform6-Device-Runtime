# 1.5.39 bridge observability only

Local ZIP SHA256: f47e9e72a0084ff27e1bde25b44d50e64c1008580524dfeba749c9eb7e91c88f

Rechecked and rebuilt: added JS diagnostic logging exception isolation and
a throwing-logger regression test. Supersedes the earlier unpublished ZIP.

Changes after deployed 1.5.38:
- Native hello reply logs PostJSMessage Boolean accepted=1/0. Acceptance is not receipt.
- JS logs addEventListener registration returned/missing/threw, and property assignment returned/threw. No raw exceptions or message bodies are added.
- Logs first entry into inbound callback before normalization/deduplication. This does not claim a valid acknowledgement.
- No retry, new port, transport replacement, output configuration, startup, OTA policy, key operation or encryption activation added.

TypeScript, 92 local lab tests, exact-package gate and packaged BrightScript parser pass. Tests are not a hardware proof. Existing 1.5.38 ZIP remains unchanged.

Requires separate approval for upload/publication/install on UTF54M000145 and one normal OTA reboot. Not installed or uploaded during preparation. Nonzero boot/manual-recovery risk remains.

Interpretation: accepted=0 localizes a rejected native send. Registration threw/missing identifies JS binding failure. Both positive with no callback points to delivery/routing. Callback entered without a valid hello ack points to payload handling. No result alone proves encryption or duplex safety.
