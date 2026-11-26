import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pairing = fs.readFileSync('src/simulator/hdClusterPairing.ts', 'utf8');
const display = fs.readFileSync('src/components/pairing/PairingCodeDisplay.tsx', 'utf8');
const runtime = fs.readFileSync('src/config/runtime.ts', 'utf8');

test('HD226 package members are ordered DEVICE_A through DEVICE_J', () => {
  const keys = [...runtime.matchAll(/'DEVICE_([A-J])'/g)].map((match) => match[1]);
  assert.deepEqual(keys.slice(0, 10), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
});

test('pairing labels derive device and screen number from the package member slot', () => {
  assert.match(pairing, /CLUSTER_MEMBERS\.indexOf\(member\)/);
  assert.match(pairing, /return `Device \$\{number\} • Screen \$\{number\}`/);
  assert.match(display, /hdPairingAssignmentLabel\(clusterMember\)/);
});
