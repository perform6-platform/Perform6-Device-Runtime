Perform6 BrightSign package — XT2145
Version: 1.5.67

Supported firmwares: BrightSign OS 8.2+ and 9.x (Series 5: XT/XC/HD).
Storage: plaintext SD (no EncryptStorage). App files stay readable for HtmlWidget.
Media playback store: SD:/perform6-media/ — extension-bearing files created with BrightSign AssetRealizer.
  LED NORMAL: JS PostBSMessage(xt/xc-playback) → autorun PlayFile. SD JSON = fallback if bridge one-way.
  Backing downloads: SD:/perform6-media-pool sha256 objects; never copied with Node/BrightScript CopyFile.
  Content is deployment/sync driven (Fitness/Golf libraries) — slots are generic (idle/start-here/…).
  Status: per-role sidecars (atomic) + unified roles map from in-memory merge (no disk RMW).
  Legacy SD:/perform6-media/*.mp4 and perform6-xt-playback.json still accepted. clearCache wipes pool + media.

Display mode (perform6-display.txt): MULTI
  BrightSign multi-screen pattern: fixed modes per HDMI — never auto.
  MULTI           = HDMI-1 1920x1080x60p:fullres + HDMI-2 3840x2160x60p:fullres
  MULTI_NOFULLRES = HDMI-1 remains 1080p:fullres; HDMI-2 4K60 without :fullres
  Other values (auto, SINGLE, 1080, …) are ignored → MULTI.
XT/XC always run MULTI layout. Edit only if you need MULTI_NOFULLRES.

Layout: HDMI-1 = React pairing/touch (Bluefin); HDMI-2 = native video (LED).
Bluefin UI on HDMI-1; LED plays realized SD:/perform6-media/*.mp4 via autorun PlayFile.
Audio: Bluefin HDMI-1 is silent; programme audio is routed only to LED HDMI-2.
Secondary outputs are video-only — no React UI, no pairing screen on the LED.

LED video playback:
  Authoritative playback: SD:/perform6-media/*.mp4 (AssetRealizer output) → PlayFile.
  Command bus: SD:/perform6-led-playback.json (JS → autorun poll; bridge optional).
  XT target=led (HDMI-2); XC targets=led2+led3 (HDMI-2/3). Legacy xt-playback.json OK.
  Default idle: led-idle.png (Perform6 logo) is packaged on the SD root and loops
  on the LED(s) from boot until the first deployment video arrives.
  Optional override: place led-idle.mp4 on the SD root to replace the logo.
  Troubleshooting: SD:/perform6-led.log lists every LED playback decision.
  XT/XC: HtmlWidget.Show before native players; exactly one player per LED output.

IMPORTANT: Use this zip ONLY on matching hardware.
  XT2145  -> perform6-xt2145-*.zip
  XC4055  -> perform6-xc4055-*.zip
  HD226   -> perform6-hd226-*.zip
Do NOT mix files from different zips.

HDMI wiring (XT2145):
  HDMI-1 → Bluefin touch panel (pairing + Home)
  HDMI-2 → LED program display

SD card root (copy CONTENTS of this folder, not the folder itself):
  autorun.brs
  perform6-profile.txt
  perform6-display.txt
  perform6-ops.json (field ops — pause sync/OTA, clear cache on boot)
  index.html
  assets/app.js
  assets/style.css
  assets/*.png
  led-idle.png (Perform6 logo — shows on LED until deployment video)

After copy, reboot the player.
First boot reboots once only when the output layout actually changes — that is expected.
Changing perform6-display.txt also causes one extra reboot on the next start.

OTA (custom fleet — not BSN):
  pauseOta=true in perform6-ops.json — Sync Now never installs runtime.
  Admin → Install OTA publishes files via API → device asset pool (perform6-ota-pool)
  or autorun HTTP fallback → REBOOTING ack → reboot.
  Publish a newer version than the device before Install; no downgrade.
  Roll out one device first, then fleet.

Field maintenance (perform6-ops.json on SD root):
  pauseMediaSync     = true  → stop media downloads (sync-check skipped)
  pauseOta           = true  → refuse OTA unless Admin Install (allowWhenPaused); default
                              Auto-OTA on sync is code-disabled — portal Install OTA only.
  clearCacheOnBoot   = true  → wipe SD:/perform6-media-pool + perform6-media once on next boot (auto-clears)
  rebootAfterCacheClear = true → reboot after clearCacheOnBoot
  syncOnBoot         = true  → run one sync after boot (auto-clears; bypasses pause)
  Emergency template: copy perform6-ops.emergency.json → perform6-ops.json
  See docs/CLIENT-SD-MAINTENANCE.md for full site procedure.
DWS (browser): http://<player-ip>/
