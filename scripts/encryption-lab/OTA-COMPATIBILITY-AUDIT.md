# OTA / encryption compatibility audit — 2026-09-12

Scope: local source inspection and mocked failure characterization only. No
upload, installation, reboot, encryption, or live configuration change.

## Findings

- `src/services/otaAssetPool.ts`, `replaceFile`: writes a temporary file,
  unlinks the destination, then renames. A rename failure leaves the active
  pathname missing. The offline test exercises this actual function body.
- `activateStagedPackage` attempts restoration in a catch block, but restoration
  needs the same filesystem and uses the same replacement primitive. It cannot
  cover process death or an inaccessible SD mount. This test does not exercise
  the entire activation transaction or imply every rename failure is fatal.
- Active files, staging, and backups all reside under `/storage/sd`. These are
  not independent recovery storage. Encryption/mount/key failure can affect all.
- `otaApply.ts` installs autorun last. This is helpful ordering, not a complete
  atomic package commit: existing autorun may rely on already-replaced web files.
- No evidence here establishes encrypted boot, post-encryption OTA, or recovery
  on XT2145 / 9.1.93.2. These findings do not establish the historical outage's
  cause; the preserved undefined-JsonEscape incident remains separate.

## Design consequences

Do not call the custom design safer than BrightSign's documented provisioning
flow. Additional preflight checks reduce certain mistakes but extra code adds
failure paths. Public documentation does not provide comparative failure rates.

Before selecting an updater change, verify overwrite-rename semantics on the
target filesystem/OS and package-level crash consistency. Do not simply remove
unlink and claim hardware-safe atomicity. Local mock tests cannot establish
durability, encrypted mount behavior, or recovery independence.

Keep the present player unchanged. Keep encryption activation blocked until
these storage/control dependencies are resolved. No vendor contact or source
disclosure is authorized. Public documentation and local analysis may continue;
hardware-only unknowns must stay explicitly unverified.

Run: `node --test scripts/encryption-lab/*.test.mjs`.
