# Deploy to BrightSign (no BSN)

Profile-specific startup packages for SD cards. Same `autorun.brs` + React app; each build bakes a different `VITE_HARDWARE_PROFILE`.

## 1. Configure API URL

Edit the profile env file before building (local API for lab, production API for field):

| Profile | Env file |
|---------|----------|
| XT2145 | `.env.brightsign-xt2145` |
| XC4055 | `.env.brightsign-xc4055` |
| HD226 | `.env.brightsign-hd226` |

Set `VITE_API_BASE_URL` (e.g. `https://api.yourdomain.com/api/v1`).

## 2. Build packages (saved under `releases/`)

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

Each run writes **both**:

- a **ready folder** (no extract needed)
- a matching **`.zip`** (optional — cloud / R2 / single-file share)

```
releases/xt2145/perform6-xt2145-1.0.0/
releases/xt2145/perform6-xt2145-1.0.0.zip
releases/xc4055/perform6-xc4055-1.0.0/
releases/hd226/perform6-hd226-device_a-1.0.0/
```

## 3. Copy to SD card (player storage root)

**Admin Portal:** Startup Files → **Download folder** (Chrome/Edge). Pick a parent once (e.g. Downloads) — a ready folder such as `perform6-xt2145-0.1.0` is written there (not a ZIP). Copy that folder's **contents** to the card **root**.

**From disk / build output:** open the release **folder** and copy its **contents** to the card **root** (do not nest the folder itself on the card):

| File / folder | Required |
|---------------|----------|
| `autorun.brs` | yes |
| `index.html` | yes |
| `assets/` | yes |
| `perform6-release.json` | optional (build metadata) |

Insert SD → boot → pairing code → Admin claim/register → sync → playback.

## 4. Production R2 (later)

Upload the `.zip` files to your releases bucket, e.g.:

```
releases/xt2145/perform6-xt2145-1.0.0.zip
releases/xc4055/perform6-xc4055-1.0.0.zip
releases/hd226/perform6-hd226-device_a-1.0.0.zip
```

Then publish via Admin Releases / `GET /devices/me/app-update` OTA metadata.

GitHub workflow `release-r2.yml` can be extended to a profile matrix; local `releases/` is the source of truth for now.

## Dev without device

```bash
npm run dev
```

Open http://localhost:5173 — Simulator Mode launcher (`VITE_RUNTIME_MODE=SIMULATOR`).
