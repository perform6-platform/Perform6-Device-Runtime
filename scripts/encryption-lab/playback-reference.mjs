// Proposed wire schema only, not a currently supported autorun command.
// Native code must resolve the reference internally and verify authorization.
// It must never interpret this message as permission to play arbitrary paths.
export function playbackReference(input) {
  const allowed = ['assetId', 'requestId', 'sha256'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !allowed.includes(k))
    || !/^[a-z0-9_-]{1,80}$/.test(input.assetId ?? '')
    || !/^[a-z0-9_-]{1,80}$/.test(input.requestId ?? '')
    || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new Error('Invalid encrypted playback reference');
  return Object.freeze({ type: 'encrypted-playback-reference-v1',
    assetId: input.assetId, requestId: input.requestId, sha256: input.sha256 });
}
