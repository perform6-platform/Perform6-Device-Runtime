#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const autorun = fs.readFileSync(path.join(root, 'brightsign', 'autorun.brs'), 'utf8');
const heartbeat = fs.readFileSync(path.join(root, 'src', 'services', 'heartbeat.ts'), 'utf8');
const provisioning = fs.readFileSync(
  path.join(root, 'src', 'services', 'recoveryProvisioning.ts'),
  'utf8',
);

function requireText(body, needle, label) {
  if (!body.includes(needle)) {
    throw new Error(`[firmware-recovery] missing ${label}: ${needle}`);
  }
}

requireText(heartbeat, 'recovery?: RecoveryProvisioningConfiguration | null', 'heartbeat contract');
requireText(provisioning, 'bridge.healthy', 'healthy bridge gate');
requireText(provisioning, 'bridge.duplexReady', 'duplex bridge gate');
requireText(provisioning, "recovery.protocol === 'https:'", 'HTTPS trust gate');
requireText(provisioning, 'recovery.origin === api.origin', 'same-origin trust gate');
requireText(autorun, 'Sub HandleRecoveryConfig(payload as Object)', 'autorun handler');
requireText(autorun, 'CreateObject("roRegistrySection", "networking")', 'BOS registry');
requireText(autorun, 'reg.Write("ru", url)', 'Recovery URL registry write');
requireText(autorun, 'RECOVERY|CONFIG|PROVISIONED', 'success diagnostic');

const handlerStart = autorun.indexOf('Sub HandleRecoveryConfig(payload as Object)');
const handlerEnd = autorun.indexOf('\nEnd Sub', handlerStart);
const handler = autorun.slice(handlerStart, handlerEnd);
for (const forbidden of [
  'RebootSystem',
  'RebootDeviceAfterOta',
  'EncryptStorage',
  'FormatStorage',
  'DeleteTree',
  'perform6-media-pool',
]) {
  if (handler.includes(forbidden)) {
    throw new Error(`[firmware-recovery] unsafe provisioning behavior: ${forbidden}`);
  }
}

console.log(
  '[firmware-recovery] PASS: authenticated heartbeat + healthy duplex gate; HTTPS same-origin BOS recovery URL; no reboot, encryption, format, or media mutation',
);
