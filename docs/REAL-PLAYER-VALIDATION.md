# Real-player production validation

Automated validation is run with:

```sh
npm run validate:production-runtime
```

It type-checks the runtime, verifies cached offline boot and local-midnight
rotation logic, verifies reconnection behavior and encryption contracts, and
builds all three production candidates through their package safety gates.

The tests below are the remaining physical proof. Run the complete matrix for
XT2145 Fitness, XT2145 Golf, and HD226. Record the player serial, package
version, facility timezone, start/end time, and relevant Portal/device logs.

## Offline boot and playback

1. With Ethernet connected, allow Content Syncing to report the required media
   as Cached.
2. Play one scheduled program and confirm normal output.
3. Power down the player and touchscreen, where applicable. Disconnect Ethernet.
4. Restore power with Ethernet still disconnected.
5. Confirm the correct UI/output launches without pairing, `/sync/check` errors,
   or a network overlay covering the cached runtime.
6. Confirm the scheduled cached program plays completely from SD.

## Local-midnight rotation

1. Keep Ethernet disconnected across midnight in the deployment's named
   facility timezone.
2. Confirm the next rotation day is selected without a server sync. For day 36,
   confirm rollover to day 1.
3. Confirm non-rotating Start Here and Default content remains available.

## Reconnection

1. Reconnect Ethernet without replacing or reformatting the SD card.
2. Confirm the existing registration remains active and no pairing code appears.
3. Confirm the player checks in, refreshes its schedule, and resumes missing
   downloads automatically.
4. Confirm online playback, Portal monitoring, and future OTA eligibility remain
   intact.

## Encrypted media

1. Use a clean card prepared from the matching candidate package.
2. Sync at least one item and verify the API supplies an encrypted derivative,
   envelope, IV, checksum, and byte size.
3. Confirm the downloaded representation is reported as encrypted and plays on
   the intended output while online and after an offline reboot.
4. Remove the powered-down SD card and verify the protected media is not usable
   as an ordinary plaintext MP4 on a computer.
5. Reinsert the same card and confirm playback and later synchronization still
   work. Do not format, duplicate, or reuse the card as another player.

Any failure blocks production approval for that hardware/edition. A pass on one
XT2145 edition does not replace the smoke test on the other edition, although
they share the same runtime behavior.
