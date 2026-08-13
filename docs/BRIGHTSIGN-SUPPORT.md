# Perform6 BrightSign support matrix

## Officially supported

| Player family | Models | BrightSign OS |
|---------------|--------|---------------|
| Series 5 / Strata | XT2145, XC4055, HD226 | **8.2+** and **9.0+** (tested on 9.0.168) |

Package picks the hardware profile at build time (separate zip per model).

## Firmware-tolerant design (this runtime)

- HtmlWidget created with progressive config fallbacks (modern → minimal → classic)
- Never sets `trusted_iframes_enabled` (breaks OS &lt; 9.1)
- Never calls invalid `roTouchScreen.Enable`
- Never calls `SetMode` / DWS `Apply()` on boot (HDMI flash)
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
