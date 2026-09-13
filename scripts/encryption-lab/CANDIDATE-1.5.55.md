# XT2145 candidate 1.5.55

Purpose: repair a persisted plaintext playback mapping when the live manifest
now supplies an encrypted derivative for the same media-version ID.

Safety boundaries:

- Encryption activation policy and cryptography are unchanged.
- The exact manifest-derived encrypted filename must already exist on SD.
- The SD file must be at least 1 KiB and must match the declared byte length
  when one is supplied.
- Only local mapping and confirmation metadata are repaired.
- No media deletion, download, rewrite, filesystem remount, reboot, or OTA
  control change is introduced.
- The repair runs before manifest publication so native playback receives the
  encrypted SD path together with its existing decryption metadata.
