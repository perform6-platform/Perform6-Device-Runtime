import { runtimeConfig } from '../config/runtime';
import { ApiError } from './api';
import { clearLocalDeviceState } from './deviceLocalReset';
import { requestDeviceReboot } from './deviceRemoteControl';

let revokeInProgress = false;

export function isDeviceAuthFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 401) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('device is disabled') ||
    msg.includes('device credentials expired') ||
    msg.includes('invalid device credentials')
  );
}

export function isDeviceDisabledCredentialError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error ?? '').toLowerCase();
  if (isCardRecoveryRequiredError(msg)) return false;
  return (
    msg.includes('device is disabled') ||
    msg.includes('re-pair') ||
    msg.includes('not active')
  );
}

/** Blank card needs Admin → Allow card recovery before a token is issued. */
export function isCardRecoveryRequiredError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error ?? '').toLowerCase();
  return (
    msg.includes('recovery approval required') ||
    msg.includes('card recovery') ||
    msg.includes('card_recovery_required')
  );
}

/** Admin disable / revoked token — clear local state and reboot into pairing. */
export function handleDeviceRevoked(reason: string): void {
  if (revokeInProgress || runtimeConfig.isSimulator) return;
  revokeInProgress = true;
  console.warn('[Perform6] Device auth revoked — clearing state and rebooting', {
    reason,
  });
  clearLocalDeviceState();
  requestDeviceReboot();
}
