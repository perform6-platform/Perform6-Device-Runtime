# Native integration boundary

Local inspection: TryPlayFileOnce in brightsign/autorun.brs calls string and
Filename/ProbeString variants; no encryption argument is present there.
The XT command channel has an authoritative SD file and diagnostics read it.
Therefore adding a raw EncryptionKey to the existing command is forbidden.

playback-reference.mjs is a proposed reference-only schema, NOT an autorun
capability. It carries only asset ID, request ID and ciphertext digest, and
rejects additional fields. No current runtime code sends or consumes it.

Still required: native-side internal key resolution or a separately verified
memory-only transport, authenticated metadata validation, and documented
roVideoPlayer key+IV handoff. No dummy callback or empty container may stand in
for this implementation in a release gate. Do not fall back to the ordinary SD
command if the secret-capable transport is unavailable.

The combined validator is offline evidence only. Timeouts suppress late success
and later key processing; arbitrary iterators are not cancellable. Production
file readers must support abort and bounded resources. Synchronous crypto cannot
be interrupted by a JavaScript timeout. This is not process isolation.

No startup or native code has been changed by this lab. Integration will change
the native/runtime boundary, so exact-package compile and hardware gates still
apply. Unmodified startup today does not prove a future integrated package safe.
