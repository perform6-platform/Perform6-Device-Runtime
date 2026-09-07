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
| 1b | Video mode | Boot log: `BrightSign pattern video_mode=1920x1080x60p:fullres` (not auto / not 4K) | ☐ | ☐ | — |
| 2 | Pair + sync | Pairing completes; playback manifest present | ☐ | ☐ | ☐ |
| 3 | Media download | Log shows asset pool realize **or** autorun fallback; playable files under `SD:/perform6-media` only | ☐ | ☐ | ☐ |
| 4 | LED / screen play | Local `file://` or `SD:/` only — no HTTPS VOD on device | ☐ | ☐ | ☐ |
| 5 | OTA (Admin Install) | Admin **Install OTA** only — asset pool or HTTP → reboot → new `runtimeVersion`. Sync Now must **not** install | ☐ | ☐ | ☐ |
| 6 | Clear SD cache mid-OTA | Media wipe only; OTA continues / not cancelled by clear; `perform6-ota-pool` untouched | ☐ | ☐ | ☐ |
| 7 | SYNC_NOW | Media refill; OTA **not** run unless Admin `forceOta` / ota-retry | ☐ | ☐ | ☐ |
| 8 | SD browser | Admin “SD card (mini-DWS)” lists folders; can open cache/pool and see video files | ☐ | ☐ | ☐ |

## Quick log greps (DWS / led.log)

- Media pool: `Media asset pool ready` / `Media asset pool fetch start`
- Media fallback: `led-cache-prefetch` / `perform6-media`
- OTA pool: `OTA asset pool ready` / `OTA via asset pool` / `OTA realized`
- OTA fallback: `falling back to autorun HTTP` / `led-ota-install`
- Bridge: `BSMessagePort ready (Node @brightsign/messageport — duplex)` then `Bridge alive` / `led-hello-ack` (bonus)
- Node-enabled HtmlWidget: inbound uses `@brightsign/messageport` (not DOM alone)
- **LED primary path:** JS `xt-playback file written (SD bus` → autorun `LED resume from file (poll|boot)` every **500ms** — works with dead bridge
- Status file: `SD:/perform6-xt-playback-status.json` (`ok=1` / `ended=1`)
- Do **not** expect `BSMessagePort reset` / `html soft recycle SetUrl`
- Keepalive does **not** auto-reboot on pong miss
- Do **not** use Admin `BRIDGE_RECYCLE` for recovery — it maps to **reboot**
- Clear: `media cache+pool cleared (OTA untouched)`
- Reconcile: `SD cache reconcile`

## Notes

- Smoke is **process**, not automated CI — physical players required.
- Prefer proving media pool on one unit before relying on OTA pool in production.
- Large video add/delete: use SD browser for inspect/delete; big uploads still via sync/OTA, not SD_WRITE (32KB cap).
- Stuck bridge (`pong miss` / ack timeout, logo on LED): confirm log `Node @brightsign/messageport — duplex`; else flash JS. Admin **REBOOT** / power cycle — never port recreate / SetUrl / keepalive auto-reboot.
- LED must NOT stay on the idle logo even with a dead bridge — autorun re-applies `SD:/perform6-xt-playback.json` on boot + every 15s. If it does stay idle: check the file exists (SD browser) and that its `src` is under `SD:/perform6-media/` with a video extension (not pool sha256).
- Video mode follows **BrightSign multi-screen docs**: fixed `1920x1080x60p:fullres` per HDMI — do **not** enable fleet-default 4K or `auto`.
- **OTA (custom, no BSN):** Admin Install only; `pauseOta: true` by default; prefer `perform6-ota-pool`; reboot after REBOOTING ack. Staged: one gym first, then fleet.
