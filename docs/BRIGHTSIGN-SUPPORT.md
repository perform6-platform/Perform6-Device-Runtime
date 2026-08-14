# Perform6 BrightSign support matrix

## Officially supported

| Player family | Models | BrightSign OS |
|---------------|--------|---------------|
| Series 5 / Strata | XT2145, XC4055, HD226 | **8.2+** and **9.0+** (tested on 9.0.168) |

Package picks the hardware profile at build time (separate zip per model).

## Multi-HDMI architecture

| Profile | Outputs | Canvas | Content |
|---------|---------|--------|---------|
| **XT2145** | HDMI-1 + HDMI-2 | 3840×1080 | Touch UI on HDMI-1 · LED video on HDMI-2 |
| **XC4055** | HDMI-1 + HDMI-2 + HDMI-3 | 5760×1080 | SCREEN_1/2/3 each full-screen on its LED |
| **HD226** | Single HDMI | native | One player per LED (cluster) |

Autorun calls `roVideoMode.SetScreenModes` **only when** the current mode differs (avoids reboot loops). First apply may reboot once — expected.

`perform6-profile.txt` on the SD root tells autorun which layout to apply.

## Firmware-tolerant design (this runtime)

- HtmlWidget created with progressive config fallbacks (modern → minimal → classic)
- Never sets `trusted_iframes_enabled` (breaks OS &lt; 9.1)
- Never calls invalid `roTouchScreen.Enable`
- Never calls `SetMode` / DWS `Apply()` on boot (HDMI flash)
- Multi-out uses `SetScreenModes` with fixed `1920x1080x60p` (not `auto`)
- URL fallback: `file:///index.html` then `file:///SD:/index.html`
- React IIFE + HashRouter + mount shell outside `#root`
- BSDeviceInfo read with multi-name / multi-global fallbacks; profile serial if APIs missing
- Build target ES2017 for Chromium on OS 8.2+

## Not guaranteed

- BrightSign OS **before 8.2** (very old Chromium / HtmlWidget)
- Non-HTML players or presentations that replace `autorun.brs`
- BSN.cloud presentations that override local autorun without this package

## Client claim (safe wording)

> Supported on BrightSign OS 8.2 and 9.x for XT2145 / XC4055 / HD226. Older firmwares use best-effort fallbacks; smoke-test before fleet rollout.
