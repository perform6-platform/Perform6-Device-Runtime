# Deploy to BrightSign (no BSN)

Profile-specific startup packages for SD cards. React app is baked per `VITE_HARDWARE_PROFILE`.
`autorun.brs` + `perform6-profile.txt` enable the correct multi-HDMI layout.

## HDMI architecture

| Profile | Player role | Ports |
|---------|-------------|-------|
| XT2145 | One player | HDMI-1 Bluefin touch · HDMI-2 LED |
| XC4055 | One player → three LEDs | HDMI-1/2/3 = SCREEN_1/2/3 |
| HD226 | One player → one LED | Single HDMI (cluster = N players) |

Deployment / content scheduling still uses logical screens (`SCREEN_1`…); only physical outputs changed.

## 1. Configure API URL

Edit the profile env file before building:

| Profile | Env file |
|---------|----------|
| XT2145 | `.env.brightsign-xt2145` |
| XC4055 | `.env.brightsign-xc4055` |
| HD226 | `.env.brightsign-hd226` |

Set `VITE_API_BASE_URL` (production: `https://portal.perform6.com/api/v1`).

## 2. Build packages → local `releases/` + Cloudflare R2

```bash
npm run release:zip:xt2145 -- 1.0.22
npm run release:zip:xc4055 -- 1.0.22
npm run release:zip:hd226 -- 1.0.22

# HD226 other cluster member (DEVICE_B … DEVICE_J)
npm run release:zip:hd226 -- 1.0.22 DEVICE_B

# All three (HD226 defaults to DEVICE_A)
SKIP_R2_UPLOAD=1 npm run release:zip:all -- 1.0.22
```

Each run builds, writes `releases/<profile>/`, and uploads to R2 unless `SKIP_R2_UPLOAD=1`.

## 3. Admin Portal + SD card

With API `STORAGE_DRIVER=r2`, **Startup Files** lists/downloads packages **from R2**.

Copy folder **contents** to the SD **root**:

| File / folder | Required |
|---------------|----------|
| `autorun.brs` | yes |
| `perform6-profile.txt` | yes (XT2145 / XC4055 / HD226) |
| `index.html` | yes |
| `assets/` | yes |
| `perform6-release.json` | optional |

First boot may reboot once after `SetScreenModes` — expected. Then pairing on HDMI-1.

## Dev without device

```bash
npm run dev
```

Open http://localhost:5173 — Simulator Mode launcher (`VITE_RUNTIME_MODE=SIMULATOR`).
