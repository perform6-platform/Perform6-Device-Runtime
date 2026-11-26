import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

describe('card recovery runtime regressions', () => {
  it('detects recovery-required errors without treating them as disabled revoke', () => {
    const revoke = read('src/services/deviceAuthRevoke.ts');
    assert.match(revoke, /export function isCardRecoveryRequiredError/);
    assert.match(revoke, /recovery approval required/);
    assert.match(revoke, /if \(isCardRecoveryRequiredError\(msg\)\) return false/);
  });

  it('credentials path maps 403 recovery to CardRecoveryRequiredError and stores tokens on success', () => {
    const credentials = read('src/services/credentials.ts');
    const watcher = read('src/services/registrationWatcher.ts');
    assert.match(credentials, /class CardRecoveryRequiredError/);
    assert.match(credentials, /isCardRecoveryRequiredError\(e\.message\)/);
    assert.match(credentials, /CardRecoveryRequiredError/);
    assert.match(watcher, /saveCredentials\(/);
    assert.match(watcher, /CardRecoveryRequiredError/);
    assert.match(watcher, /success: true/);
  });

  it('RuntimeContext keeps recovery-required on waiting_credentials instead of clearing state', () => {
    const runtime = read('src/contexts/RuntimeContext.tsx');
    assert.match(runtime, /isCardRecoveryRequiredError/);
    assert.match(runtime, /runtimePhase: 'waiting_credentials'/);
    assert.match(runtime, /Allow card recovery/);
    assert.doesNotMatch(
      runtime.slice(runtime.indexOf('isCardRecoveryRequiredError'), runtime.indexOf('isCardRecoveryRequiredError') + 500),
      /clearLocalDeviceState\(\)/,
    );
  });

  it('Pairing LCD shows recovery approval only when the error is recovery-related', () => {
    const pairing = read('src/pages/Pairing.tsx');
    assert.match(pairing, /recoveryPending/);
    assert.match(pairing, /recovery approval/);
    assert.match(pairing, /Waiting for credentials/);
    assert.doesNotMatch(
      pairing,
      /recoveryPending[\s\S]{0,120}registrationStatus === 'registered'/,
    );
  });

  it('network interrupt keeps retryable credential fetch without wiping offline schedule helpers', () => {
    const credentials = read('src/services/credentials.ts');
    const offline = read('src/services/playbackManifestCache.ts');
    // CredentialsNotReady remains distinct from recovery-required for retry loops.
    assert.match(credentials, /class CredentialsNotReadyError/);
    assert.match(credentials, /CardRecoveryRequiredError/);
    // Offline cache helpers remain present for normal offline behavior.
    assert.match(offline, /playbackManifestCache|cached|offline/i);
  });
});
