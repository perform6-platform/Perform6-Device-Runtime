# OTA / encryption compatibility audit — 2026-09-12

Scope: local source inspection and mocked failure characterization only. No
upload, installation, reboot, encryption, or live configuration change.

## Findings

- `src/services/otaAssetPool.ts`, `replaceFile` now writes a complete temporary
  file and renames it directly over the destination on the same SD filesystem.
  It never unlinks the active path first; a rejected rename retains the active
  file and the complete temporary file. The offline test exercises the actual
  function body.
- `activateStagedPackage` also attempts restoration in a catch block. It still
  cannot cover an inaccessible SD mount or prove filesystem crash durability;
  the local test establishes only the no-unlink failure invariant.
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

The direct rename follows Node's replacement contract and fails closed in the
mock. Hardware filesystem crash durability, encrypted mount behavior and
recovery independence remain separate field unknowns; do not call this a
complete transactional package updater.

Keep the present player unchanged. Keep encryption activation blocked until
these storage/control dependencies are resolved. No vendor contact or source
disclosure is authorized. Public documentation and local analysis may continue;
hardware-only unknowns must stay explicitly unverified.

Run: `node --test scripts/encryption-lab/*.test.mjs`.
