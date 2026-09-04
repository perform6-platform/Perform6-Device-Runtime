# Perform6 field smoke checklist

Run once per hardware profile after deploying `autorun.brs` + device package.  
Mark pass/fail; on fail capture `SD:/perform6-led.log`, Admin SD browser listing, and heartbeat/OTA status.

## Profiles

- [ ] **XT2145** (touch + LED)
- [ ] **XC4055** (HDMI-1 React + LED 2/3; Bluefin not required)
- [ ] **HD226** (single HtmlWidget)

## Checklist (each profile)

| # | Test | Pass criteria | XT | XC | HD |
|---|------|---------------|----|----|-----|
| 1 | Cold boot | HtmlWidget up, DWS reachable, no FatalHang loop | ☐ | ☐ | ☐ |
| 2 | Pair + sync | Pairing completes; playback manifest present | ☐ | ☐ | ☐ |
| 3 | Media download | Log shows asset pool **or** cache fallback; files under `SD:/perform6-media-pool` and/or `SD:/perform6-cache` | ☐ | ☐ | ☐ |
| 4 | LED / screen play | Local `file://` or `SD:/` only — no HTTPS VOD on device | ☐ | ☐ | ☐ |
| 5 | OTA | Manifest → download (pool `SD:/perform6-ota-pool` or HTTP fallback) → reboot → new runtime version | ☐ | ☐ | ☐ |
| 6 | Clear SD cache mid-OTA | Media wipe only; OTA continues / not cancelled by clear; `perform6-ota-pool` untouched | ☐ | ☐ | ☐ |
| 7 | SYNC_NOW | Media refill; OTA **not** cancelled unless forceOta / ota-retry | ☐ | ☐ | ☐ |
| 8 | SD browser | Admin “SD card (mini-DWS)” lists folders; can open cache/pool and see video files | ☐ | ☐ | ☐ |

## Quick log greps (DWS / led.log)

- Media pool: `Media asset pool ready` / `Media asset pool fetch start`
- Media fallback: `led-cache-prefetch` / `perform6-cache`
- OTA pool: `OTA asset pool ready` / `OTA via asset pool` / `OTA realized`
- OTA fallback: `falling back to autorun HTTP` / `led-ota-install`
- Bridge: `bridge watchdog armed` / `Bridge keepalive` / `led-hello-ack protocol=2`
- Clear: `media cache+pool cleared (OTA untouched)`
- Reconcile: `SD cache reconcile`

## Notes

- Smoke is **process**, not automated CI — physical players required.
- Prefer proving media pool on one unit before relying on OTA pool in production.
- Large video add/delete: use SD browser for inspect/delete; big uploads still via sync/OTA, not SD_WRITE (32KB cap).
