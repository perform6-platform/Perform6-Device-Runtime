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
