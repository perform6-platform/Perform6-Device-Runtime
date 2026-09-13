# Encryption preflight laboratory

Run `node --test scripts/encryption-lab/preflight.test.mjs`.

This is an offline evidence evaluator, not an encryption implementation or a
device probe. It is not imported by the application or included in the startup
package. Tests use synthetic evidence and cannot prove hardware recovery.

## Current field decision (2026-09-12)

Keep runtime 1.5.23 and the eight cached videos intact. Runtime logs observed
eight AssetRealizer outputs at 21:15:36 Pakistan time and reconciliation of
eight files at 21:26:59. An earlier CMS Failed label did not describe the later
successful cache state. These eight files are not post-activation test assets.
Use a distinct new asset for a future encrypted-write test.

The OS recovery implementation selects configured safeVersion (default 1.5.23).
Current production environment, registry URL readback and recovery package
checksum still need verification. Do not expose signed recovery URLs in reports.

## Unresolved requirements

- Confirm capabilities on XT2145 / OS 9.1.93.2 without activation.
- Establish prior key/attempt state without reading or exposing the key. An SD
  format does not prove that private player registry state was cleared.
- Obtain hardware evidence that control survives an unavailable/remounted SD
  and can recover unattended. A reachable OS Recovery URL is insufficient.
- Verify compatibility of subsequent startup updates with encrypted storage,
  including actual boot and OTA after activation, before claiming completion.

Starting the application before invoking encryption reduces exposure to new
startup code but cannot guarantee that the storage operation leaves it alive.
Promise rejection handling cannot recover a terminated process or failed mount.
The earlier statement that API availability was the sole remaining prerequisite
was incorrect. Do not weaken the existing package gate to bypass this gap.

The next hardware-validation step requires a representative test player. The user
has declined vendor contact and proprietary-source disclosure. Public documentation
research is allowed, but does not replace hardware evidence.
No live activation, reboot, upload or production change is implemented by this lab.

## Prototype status and remaining adapter requirements

`operation.mjs` is an unwired dependency-injected operation prototype. Its tests
use mocks only. It is not imported by the runtime. The preflight evidence in tests
is synthetic; it must never be reused as a real authorization or hardware record.

BrightSign's public roRegistry documentation specifies persistent settings and
Flush(). This supports investigating a separate application-owned attempt marker;
it does NOT establish an atomic compare-and-set primitive or independent recovery.
No real `claimAttempt` adapter has been implemented. A production adapter needs a
single serialized writer, persistence acknowledgement and readback, and must deny
all subsequent attempts, including after a new process starts. Never reset this
marker automatically after a rejected encryption call.

The reviewed devicecustomization contract documents generated private keys but
does not expose a key-presence query. We have NOT established a safe supported
query elsewhere. Do not implement invented registry paths, inspect/export private
key material, or equate a missing application marker with an absent encryption key.
The current `verified-absent` input therefore remains unproven on the field player.

Important limit: software-only tests cannot meet the user's requirement that an
encrypted-mount failure never requires physical recovery. More mock tests must
not be represented as progress toward proving that particular hardware property.

Reference: https://docs.brightsign.biz/develop/roregistry

## Reference contracts

- https://docs.brightsign.biz/develop/devicecustomization
  documents generated private-registry keys and format:false behavior.
- https://docs.brightsign.biz/develop/rostorageinfo
  documents the +ecryptfs filesystem signal.
- The preserved FIELD-INCIDENT-2026-09-12.md records the undefined JsonEscape
  failure and the absence of demonstrated unattended application-crash recovery.
