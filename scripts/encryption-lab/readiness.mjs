// Read-only local prototype. No activation, write, reboot or retry capability.
// Adapters must themselves be read-only. Timeout does not cancel their work.
export async function assessEncryptionReadiness({ readHealth, probe, requestId, timeoutMs = 1000 }) {
  let timer;
  try {
    if (typeof readHealth !== 'function' || typeof probe !== 'function'
      || !/^[a-z0-9_-]{1,80}$/.test(requestId ?? '')
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error();
    const check = async () => {
      const healthy = h => h?.heartbeat === true && h?.ota === true && h?.bootComplete === true;
      if (!healthy(await readHealth())) return false;
      const ack = await probe(requestId);
      if (ack?.requestId !== requestId || ack?.protocol !== 1
        || ack?.encryptedPlayback !== true || ack?.secretFreeTransport !== true) return false;
      return healthy(await readHealth());
    };
    const result = await Promise.race([check(), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    })]);
    // An observation only, not a durable authorization or hardware proof.
    return Object.freeze({ ready: result === true });
  } catch { return Object.freeze({ ready: false }); }
  finally { clearTimeout(timer); }
}
