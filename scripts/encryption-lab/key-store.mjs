// Unwired registry adapter. Caller supplies @brightsign/registry instance.
// Ordinary registry storage is not a secure enclave. Provisioning authentication,
// diagnostic exports and hardware testing must be resolved before deployment.
const section = 'perform6_media_keys';
function entryName(assetId) {
  if (typeof assetId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(assetId)) {
    throw new Error('Invalid asset identifier');
  }
  return `asset_${assetId}`;
}
function valid(value) {
  return value && value.version === 1 && value.algorithm === 'AesCtr'
    && /^[a-f0-9]{32}$/.test(value.keyHex)
    && value.keyHex.slice(0, 16) !== value.keyHex.slice(16)
    && /^[a-f0-9]{32}$/.test(value.ivHex);
}
export function createMediaKeyStore(registry) {
  return {
    async save(assetId, material) {
      const name = entryName(assetId);
      if (!valid(material)) throw new Error('Invalid key record');
      // One record prevents independently written key/IV pairs being mixed.
      const serialized = JSON.stringify({ version: 1, algorithm: 'AesCtr',
        keyHex: material.keyHex, ivHex: material.ivHex });
      try {
        await registry.write(section, name, serialized);
        await registry.flush();
        if (await registry.read(section, name) !== serialized) throw new Error();
      } catch { throw new Error('Key persistence unverified'); }
    },
    async read(assetId) {
      const name = entryName(assetId);
      try {
        const raw = await registry.read(section, name);
        const value = JSON.parse(raw);
        if (!valid(value)) throw new Error();
        return { version: 1, algorithm: 'AesCtr', keyHex: value.keyHex, ivHex: value.ivHex };
      } catch { throw new Error('Playback key unavailable'); }
    },
  };
}
