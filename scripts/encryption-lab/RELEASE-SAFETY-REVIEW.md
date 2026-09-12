# Encryption release safety review — 2026-09-12

Status: NOT INSTALLABLE. Local lab tests are not a hardware certification.

## Historical checks

- Preserved incident: 1.5.33 called missing JsonEscape before creating HTML.
  Keep the packaged undefined-symbol fixture as a negative test. A source
  substring assertion or TypeScript build is not a BrightScript execution test.
- 1.5.34 was local-only, not the installed cause of that incident.
- An OS recovery URL and same-card backup are not proof that an arbitrary
  runtime crash recovers. Never use endpoint reachability as that proof.
- Existing OTA replacement unlinks before rename. Mock test reproduces a
  missing active file after failure; passing test documents an unresolved risk.
- Existing autorun capability probe can time out or find no message port.
  Encryption must not interpret local message acceptance as a remote ack.

## Mandatory integration behavior (not yet implemented)

1. No encryption module on the required startup/heartbeat/OTA dependency path.
   Do not await registry, enrollment, crypto or playback setup before app health.
2. Missing/empty keys, manifests, payloads, configuration or containers deny
   encryption. Never treat an empty object as successful capability discovery.
3. Bounded and correlated native handshake; stale/wrong-version/duplicate ack,
   absent port and timeout deny encryption only. No forced recycle or reboot.
4. Registry/API operations that reject OR never settle must not block control.
   Timeout is not cancellation: late writes must not trigger playback/retries.
5. No raw key on SD bus, logs, diagnostics or browser persistence. No plaintext
   fallback download to disguise an encrypted playback failure.
6. No formatting, remount, drive-key generation, startup replacement, updater
   mutation, shell execution or reboot in the encryption execution path.
7. Exact package review, supported BrightScript compilation and representative
   hardware boot/OTA tests remain required by the preserved incident gates.
   A reviewer must explicitly enumerate every changed startup dependency.

## Evidence versus remaining gaps

- 63 local tests passed; includes superseded whole-card lab and hazard tests.
- No imports of new lab modules found in runtime src during this review.
- Identity-store failures are sanitized and latched; hanging registry calls
  are not yet bounded inside the adapter. Must remain outside startup.
- Signed metadata checks reject substitutions; signing-key provisioning,
  manifest replay/revocation and immutable file handoff remain unresolved.
- Native playback integration, offline reboot, registry persistence on this
  OS and hardware throughput are not yet verified.
- Existing plaintext URLs and credential-resolution paths require a separate
  distribution review; see PLAINTEXT-DELIVERY-GATE.md.

## Reference discipline

Use official roVideoPlayer and registry contracts recorded in
FILE-LEVEL-RESEARCH.md. The user-supplied repositories are references, not proof
of encrypted-media interoperability or safe recovery on XT2145 OS 9.1.93.2.
Do not copy community format/reboot examples or unverified JavaScript APIs.
Do not promise zero handshake failures: demonstrate safe handling of failures.
