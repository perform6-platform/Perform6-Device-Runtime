# Native integration boundary

Local inspection: TryPlayFileOnce in brightsign/autorun.brs calls string and
Filename/ProbeString variants; no encryption argument is present there.
The XT command channel has an authoritative SD file and diagnostics read it.
Therefore adding a raw EncryptionKey to the existing command is forbidden.

playback-reference.mjs is a proposed reference-only schema, NOT an autorun
capability. It carries only asset ID, request ID and ciphertext digest, and
rejects additional fields. No current runtime code sends or consumes it.

An isolated native-key-reader.brs now sketches registry-to-byte-array conversion
using documented roRegistrySection Read/Exists and roByteArray FromHexString.
It has no Main. A copy is now appended to local autorun as dormant functions;
there is no caller. It passes a local Roku-oriented syntax parser, but is NOT
compiled or executed on BrightSign. It cannot authenticate media or activate
playback on its own.
The JS registry writer and this reader must be interoperability-tested together.
Raw media keys in ordinary internal registry remain accessible to player-level
administrative/debug access; this protects SD-only possession, not a hostile OS.

Still required: native-side internal key resolution or a separately verified
memory-only transport, authenticated metadata validation, and documented
roVideoPlayer key+IV handoff. No dummy callback or empty container may stand in
for this implementation in a release gate. Do not fall back to the ordinary SD
command if the secret-capable transport is unavailable.

The combined validator is offline evidence only. Timeouts suppress late success
and later key processing; arbitrary iterators are not cancellable. Production
file readers must support abort and bounded resources. Synchronous crypto cannot
be interrupted by a JavaScript timeout. This is not process isolation.

Native source now has dormant helpers and informational hello fields. The old
execution path is otherwise byte-identical, checked by regression tests.
Exact-package and hardware gates still apply; see CANDIDATE-1.5.36.md.

User confirmed no spare player is available. Do not mark the representative
hardware gate passed or waive it implicitly. Any proposed field test requires an
explicit risk decision; local tests cannot promise uninterrupted field OTA.
