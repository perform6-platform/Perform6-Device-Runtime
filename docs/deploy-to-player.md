# Deploy to BrightSign (no BSN)

Profile-specific startup packages for SD cards. Same `autorun.brs` + React app; each build bakes a different `VITE_HARDWARE_PROFILE`.

## 1. Configure API URL

Edit the profile env file before building (local API for lab, production API for field):

| Profile | Env file |
|---------|----------|
| XT2145 | `.env.brightsign-xt2145` |
| XC4055 | `.env.brightsign-xc4055` |
| HD226 | `.env.brightsign-hd226` |

Set `VITE_API_BASE_URL` (production: `https://portal.perform6.com/api/v1`).

## 2. Build packages → local `releases/` + Cloudflare R2

```bash
# One profile (version optional — default package.json version)
npm run release:zip:xt2145 -- 1.0.0
npm run release:zip:xc4055 -- 1.0.0
npm run release:zip:hd226 -- 1.0.0

# HD226 other cluster member (DEVICE_B … DEVICE_J)
npm run release:zip:hd226 -- 1.0.0 DEVICE_B

# All three (HD226 defaults to DEVICE_A)
npm run release:zip:all -- 1.0.0
```

Each run:

1. Builds with baked `VITE_API_BASE_URL` from `.env.brightsign-*`
2. Writes folder + ZIP under `releases/<profile>/`
3. Uploads that profile to R2 (`perform6-releases`) using `backend/perform6-api/.env` credentials

Skip upload: `SKIP_R2_UPLOAD=1 npm run release:zip:hd226 -- 1.0.0`

## 3. Admin Portal + SD card

With API `STORAGE_DRIVER=r2`, **Startup Files** lists/downloads packages **from R2**.

Pick a parent once → folder like `perform6-hd226-device_a-1.1.0` is saved → copy its **contents** to the SD **root** (not nested in a subfolder):

| File / folder | Required |
|---------------|----------|
| `autorun.brs` | yes — BrightSign boots this from storage root |
| `index.html` | yes |
| `assets/` | yes |
| `perform6-release.json` | optional |

BrightSign production builds use **HashRouter** (`file:///index.html#/…`) so routing works under `file://`.

Insert SD → boot → pairing UI (`#/pairing`) → Admin claim/register → sync → playback.

## Dev without device

```bash
npm run dev
```

Open http://localhost:5173 — Simulator Mode launcher (`VITE_RUNTIME_MODE=SIMULATOR`).
