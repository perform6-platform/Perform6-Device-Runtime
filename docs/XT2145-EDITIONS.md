# XT2145 Fitness and Golf editions

The XT2145 has one shared BrightSign runtime and two approved presentation
editions. The edition is selected at build time; it is not a runtime device
mode and does not change the physical hardware profile.

| Edition | Approved version | Build command | Release channel |
| --- | --- | --- | --- |
| Fitness | 1.5.81 | `npm run release:zip:xt2145:fitness` | `xt2145-fitness` |
| Golf | 2.1.3 | `npm run release:zip:xt2145:golf` | `xt2145-golf` |

Both packages retain `XT2145` in `perform6-profile.txt`. Their release
manifests additionally carry `edition: fitness` or `edition: golf`, allowing
the CMS to list and store them as separate product tracks without changing
the device protocol.

## Approved artifacts

- Fitness 1.5.81 source artifact SHA-256:
  `536ccf08218d6754cb4f29d5dc0a092f4d0c132682477ca6cfdfe6f6a91c0bff`
- Golf 2.1.3 source artifact SHA-256:
  `942e3011095b06f4eb6ddd10025da59d6bb0e870209243a25d93fca2f6639da0`
- Shared approved `autorun.brs` SHA-256:
  `611b78cfe48383f6e3d2718314669d8bd94e5275920e694be10ed5476ba7b5c0`

The consolidated source was rebuilt for each edition and rendered from the
resulting ZIP across all 12 Bluefin UI states at 1920×1080, DPR 1. Every
Fitness render matched the approved Fitness artifact pixel-for-pixel, and
every Golf render matched the approved Golf artifact pixel-for-pixel.

The runtime boundary is shared and protected: `autorun.brs`, startup, OTA,
heartbeat, reboot, CMS communication, HDMI routing, playback, telemetry,
downloads, cache, encryption and media-pool behavior are identical between
the two editions.

## CMS integration contract

The CMS should expose separate XT2145 Fitness and XT2145 Golf package tracks.
XC4055 and HD226 remain independent existing tracks. Selecting an XT2145
edition changes which approved ZIP is offered; it must not rewrite the ZIP or
alter its `perform6-profile.txt` hardware identity.
