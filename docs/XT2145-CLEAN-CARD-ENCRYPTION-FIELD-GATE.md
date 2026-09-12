# XT2145 clean-card and encryption field gate

Target: `UTF54M000145`

This plan preserves the field-proven 1.5.23 startup/OTA behavior and prevents a
full-library download from obscuring the encryption boundary.

## Non-negotiable availability gate

- Gabe must not be required for recovery during remote development.
- The player must retain authenticated heartbeat, diagnostics, and OTA control.
- No candidate may activate encryption, delete media, format storage, or replace
  the field-proven startup control path during the clean-card AssetPool proof.
- If local/package checks cannot demonstrate those properties, do not install
  the candidate on `UTF54M000145`.
- Physical involvement is reserved for the final SD-removal encryption check.

## Gate 1 — clean-card AssetPool proof (encryption still disabled)

1. Confirm the player is online and reporting the expected runtime.
2. Confirm `SD:/perform6-media-pool` is a directory.
3. Request only the **Default** and **Start Here** media assets.
4. Require byte progress, pool completion, realization into
   `SD:/perform6-media`, and playable confirmation for both assets.
5. Stop on any pool, realization, heartbeat, OTA-control, or playback failure.

Do not request Phase 1, Phase 2, Full Program, or the full rotation library in
this gate.

## Gate 2 — encryption activation

1. Preserve online heartbeat and authenticated OTA control.
2. Activate device-bound SD encryption without formatting.
3. Perform the required remount/reboot only after the activation path has passed
   its preflight.
4. Require the filesystem report to include `+ecryptfs` and require the player
   to return online before any further media request.

## Gate 3 — post-encryption write proof

1. Request only **Phase 1**, **Phase 2**, and **Full Program**.
2. Require byte progress, pool completion, realization, and playback.
3. Confirm the three post-activation files were written after encryption became
   active; do not infer this solely from successful playback.
4. Gabe performs the final physical card-removal/readability check.

Existing Default and Start Here files are expected to remain plaintext because
they predate encryption. No full-library replacement is permitted until the
three post-encryption assets pass the physical verification.

## Mandatory pre-OTA package gate

Every XT candidate must pass `scripts/assert-xt-ota-candidate.mjs` against the
final folder and ZIP before upload. The package builder runs this automatically
before its R2 upload step and fails closed. The gate requires:

- byte-identical `autorun.brs` relative to the field-proven 1.5.23 baseline;
- zero unresolved bare BrightScript calls;
- successful detection of the historical 1.5.33 undefined `JsonEscape` failure;
- only the two reviewed clean-card media-pool runtime deltas;
- no encryption, formatting, cache wipe, sync-on-boot, or automatic OTA action;
- exact folder/ZIP file and SHA-256 parity with no extra paths or symlinks.

Passing this gate reduces preventable packaging and startup risk; it does not
claim that any field OTA has literally zero hardware, power, storage, or OS risk.

## Authoritative field evidence

The CMS sync-job label is advisory and must not be used alone to approve an OTA,
retry, cache clear, or encryption step. A failed job can remain visible after a
later device-side retry succeeds. Require all applicable device evidence:

- current heartbeat and runtime version;
- AssetPool collection/file result;
- AssetRealizer completion;
- SD inventory or `SD cache reconcile` counts;
- a local `SD:/perform6-media/*.mp4` playback path with `PlayFile ... ok=1`.

On 2026-09-12, the CMS still displayed Failed after the 1.5.23 player retried,
realized eight files, reconciled `filesOnSd: 8`, and played a local MP4. That
incident is the regression case for this rule.
