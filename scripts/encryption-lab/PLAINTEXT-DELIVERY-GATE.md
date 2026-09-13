# Plaintext delivery gate — source finding, not live exploit test

API source `src/modules/sync/sync.service.ts` builds device media entries using
`fileUrl: mv.fileUrl`. Existing device deliveries therefore refer to the existing
media objects, not the new ciphertext objects. Runtime device-store persistence
includes the API token. Neither public accessibility nor current signed-URL
expiry was tested against production in this review.

File encryption cannot protect against copying SD credentials/URLs and requesting
the same original objects. Before declaring card-removal protection:

- Enrolled encrypted devices must receive ciphertext-only media manifests.
- Copied credentials must not authorize raw keys or public-key replacement.
- Old plaintext URLs on SD must be assessed for continuing access; revocation or
  object migration may affect other players. Obtain approval for such production
  changes, not just OTA installation.
- Preserve authorized CMS original access separately from device distribution.
- Do not revoke/delete/move source objects during this local investigation.

This is an additional distribution requirement, not a reason to remount or
encrypt the filesystem. Existing playback and production remain unchanged.
