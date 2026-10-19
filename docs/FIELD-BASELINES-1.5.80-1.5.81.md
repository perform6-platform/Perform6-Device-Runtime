# Perform6 XT2145 field baselines: 1.5.80 and 1.5.81

Last updated: 2026-10-20

## Status checkpoint

### 1.5.80 — field-confirmed baseline

- Gabe has confirmed that the 1.5.80 changes are correct.
- Treat 1.5.80 as the latest fully field-verified fallback and immutable
  production baseline.
- Its final change was the Full Program volume-slider midpoint correction:
  equal effective left/right internal padding and a centered 50% position in
  both Playing/Pause and Paused/Resume states.
- The reviewed Home layout, divider lines, bullet spacing, card geometry,
  secondary screens and device behavior in 1.5.80 must remain protected.
- OTA artifact:
  `releases/xt2145/perform6-xt2145-1.5.80.zip`
- SHA-256:
  `9248d54b0b92819837e615019ca89fcebbe27b4b552e4858cfb5a896a358924d`

### 1.5.81 — approved Fitness baseline

- 1.5.81 is derived directly from the field-confirmed 1.5.80 package/runtime.
- Gabe has approved these visible Fitness Home changes on the physical Bluefin:
  1. Phase 1 wording: `Move better. Build your foundation.`
  2. Phase 2 wording: `Get stronger. Elevate your performance.`
  3. Home logo: Gabe's supplied transparent SVG derived from his original EPS.
- The new SVG is used without altering its vector paths or native aspect ratio.
  Its display frame compensates for the supplied SVG's different canvas so the
  rendered logo retains 1.5.80's exact visible bounds:
  `x 43–382`, `y 47–107`, `339×60px` at 1920×1080, DPR 1.
- The new SVG's internal artwork differs slightly from the prior SVG, so its
  optical balance is not pixel-identical even though its placement and visible
  outer bounds are identical.
- Packaged simulator audit covered all 12 Bluefin UI states. No unexpected
  element geometry or diagnostic changes were introduced relative to 1.5.80.
- OTA artifact:
  `releases/xt2145/perform6-xt2145-1.5.81.zip`
- SHA-256:
  `536ccf08218d6754cb4f29d5dc0a092f4d0c132682477ca6cfdfe6f6a91c0bff`

## Protected runtime invariant

Between 1.5.80 and 1.5.81, the following remain unchanged: `autorun.brs`,
startup, OTA installation, heartbeat, remote reboot, HDMI-2 playback,
encryption, media pools, cache behavior, pairing, downloads, telemetry and
functional volume behavior.

- Reviewed `autorun.brs` SHA-256:
  `611b78cfe48383f6e3d2718314669d8bd94e5275920e694be10ed5476ba7b5c0`
- Reviewed 1.5.80 Bluefin stylesheet SHA-256, retained in 1.5.81:
  `d6fca4f905b881e2b9330e49da02fe276983822621f83be00e017ac40ba50a6f`

## Baseline selection rule

- Use **1.5.81** as the approved Fitness baseline for future Fitness work.
- Keep **1.5.80** as the preceding field-confirmed fallback.
- Do not reinterpret or modify the approved 1.5.81 Home presentation while
  working on an unrelated feature.
- Any future candidate must preserve the chosen baseline's startup/OTA/
  heartbeat/reboot path and should be rendered from its packaged ZIP through
  the 12-state Bluefin simulator before installation.

## Supporting records

- `RELEASE-NOTES-1.5.80.txt`
- `RELEASE-NOTES-1.5.81.txt`
- `tmp/bluefin-ui-engine/1.5.80-final-package-audit/`
- `tmp/bluefin-ui-engine/1.5.81-final-package-audit/`

