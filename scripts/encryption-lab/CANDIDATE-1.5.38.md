# 1.5.38 — bridge diagnostic isolation

Local package only; not uploaded, published or installed.

Scope confirmed by user: defer adaptive output selection. Source review found
the inherited XT configuration explicitly chooses
BluefinVideoMode() = 1080p60 and FleetVideoMode() = 4K60 for HDMI-2 before
SetScreenModes. EDID/GetBestMode is logged, not used for arbitrary mode
selection in this runtime. Do not describe this package as EDID-adaptive.
Adaptive output selection is separate future work. Source-video 30fps playback is a
separate matter from HDMI output refresh. No boot configuration was changed.

ZIP: releases/xt2145/perform6-xt2145-1.5.38.zip
SHA256: 2cb9a4e620596a985eeb208aa4c7b8a5f61f40b2fccdf024818c924d1f172c6d

This rebuilt unpublished package supersedes the earlier 1.5.38 local ZIP.

## Change from 1.5.37

- Diagnostic introspection uses constructor prototype metadata, never a second native MessagePort instance.
- Existing rate-limited hello logging also emits MEDIA|PROBE|disabled|registry=...|keyContainer=... to the native SD log. Only fixed status strings, no key material.
- XT output reporting checks configured HDMI-1 mode rather than treating the combined canvas as one physical output. HDMI-2 configured4k60 no longer depends on GetFPS. GetFPS remains informational on XT; actual playback FPS is not asserted. Genuine configured-mode mismatch/missing diagnostics remain. No output-setting call changed.
- No boot, heartbeat, OTA, playback routing, registry-key operation, encrypted playback, recovery, formatting, media deletion or sync change.

## Validation

- TypeScript passes; 87 lab tests pass (includes broader prototypes, not hardware tests).
- Strict diagnostic-only mode helper compares complete resolution/rate tokens; accepts 60p and 59.94p, rejects 30p/24p/interlaced/malformed modes. Pure-model regression is tied to the exact helper source; it is not a BrightSign hardware execution test. Existing startup ModeLooks4k60 helper and its configuration call remain unchanged to avoid changing boot behavior.
- Packaged autorun BrighterScript parser: zero diagnostics. This is not the BrightSign OS compiler.
- Package gate: exact source hashes, ZIP/folder equality, expected files, no unresolved native functions; catches 1.5.33 JsonEscape fixture.
- Encryption/cache wipe/sync-on-boot/auto OTA disabled.

## Proposed field gate, requires approval

Only UTF54M000145; one normal OTA reboot. Verify installed version, fresh heartbeat, retained plaintext playback, and native MEDIA|PROBE values. Separately inspect JS inbound count and Autorun hello ack. Native probe logging alone is not evidence of duplex repair, key persistence or decryption.

If acknowledgement remains absent, do not activate encryption or automatically install another release. Retain online player and analyze evidence. Boot failure/manual recovery remains a nonzero risk; no guarantee of avoiding onsite intervention.

Extra diagnostic-port allocation is a suspect, not proven cause. The latent circular widget-lookup fallback was left unchanged to avoid combining unrelated modifications; normal initialization populates g.p6Html before message handling.
