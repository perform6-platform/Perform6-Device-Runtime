# Local implementation status — 2026-09-12

These modules are prototypes outside the runtime build, not a release candidate.
The whole-card operation prototype is superseded as the preferred direction by
file-level encryption; do not wire it into the app.

Implemented locally:
- Streaming AES-128-CTR media preparation, random per-asset key and IV.
- Separate public ciphertext manifest and secret material.
- Registry adapter: one key/IV record, flush then readback, no SD fallback.
- RSA-OAEP/SHA256 key envelopes for a pinned recipient public key. The device
  private key must stay in internal registry, never on the card.
- Offline decryption roundtrip and wrong-recipient/binding/tamper tests.
- Ciphertext size/hash verification against trusted metadata.
- Device identity generation, registry flush/readback and secret-free diagnostic
  events (mock adapters only, not hardware persistence proof).
- RSA-PSS signed delivery metadata with pinned verification key, recipient
  binding and immutable verified snapshot; replay policy is not implemented.
- Separate API key-vault primitives tested locally (AES-GCM at rest); not routed.

Not implemented or proven:
- Backend storage, routes, schema, enrollment and public-key pinning.
- Hardware device key generation/persistence and secure initial enrollment.
- Runtime imports, native playback integration and secret-free SD bus.
- Signed/trusted manifest enforcement, mutable-file verification race handling.
- Real device RSA/registry behavior, encrypted native/HTML playback, 4K60.

Enrollment must not use serial/deviceId/bearer token alone to approve or replace
the pinned key. Source review found public credentials/resolve and pairing
credential routes; runtime persists apiToken in its device store. This is not a
live exploit test or proof of current server deployment, but disqualifies those
identifiers as sufficient independent proof of physical-device identity.

Proposed enrollment: generate key on device, independently approve its fingerprint
through an authenticated administrative channel, then pin it on the server.
Subsequent bearer-authorized requests may receive ONLY wrapped media keys for
that pin. Key replacement requires separate administrator approval. Verifying
the initial fingerprint remotely still needs an authenticated trusted path;
do not claim that generic CMS enrollment alone solves this bootstrap question.

Threat scope: protects against possession of SD alone, provided the private key
and registry dumps never reach SD or exported logs. Does not protect against an
attacker controlling the player/diagnostics or malicious runtime code. Ordinary
registry is not a hardware secure enclave. OAEP envelopes are not server
signatures; trusted metadata is required. CTR has no intrinsic authentication.

No production files, services, device settings, media or OTA releases changed.

## Latest verification

- Runtime local lab: 78 tests pass (includes superseded/hazard tests).
- API key-vault primitive: 4 tests pass.
- Runtime TypeScript check passes; production-field source assertion passes.
- Legacy assert:ota-bootstrap cannot run: required 1.5.12 release directory is
  absent. It has not been weakened or counted as a pass.
- Combined signature/ciphertext/key validation now rejects on timeout and
  suppresses late success. No activation callback exists in this prototype.
- Reference-only command schema rejects additional fields, including secrets
  and file paths. It is not implemented by current autorun.
- Native integration and representative hardware gates remain open. These
  modules are outside the build and are not an installable encryption release.
