# GitHub & CI/CD — perform6-touchscreen

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR / `develop` | Build, typecheck, ZIP artifact, Docker test |
| `docker-publish.yml` | `main`, version tags | GHCR image (nginx preview) |
| `release-r2.yml` | Tag `touchscreen-v*` | ZIP → Cloudflare R2 for device OTA |

Local profile ZIPs (before / alongside R2):

```bash
npm run release:zip:xt2145 -- 1.0.0
npm run release:zip:xc4055 -- 1.0.0
npm run release:zip:hd226 -- 1.0.0
```

Outputs under `releases/<profile>/`. Suggested R2 keys: `releases/xt2145/…`, `releases/xc4055/…`, `releases/hd226/…`.


## Secrets & variables

| Name | Type | Purpose |
|------|------|---------|
| `R2_ACCESS_KEY_ID` | Secret | R2 API token |
| `R2_SECRET_ACCESS_KEY` | Secret | R2 API secret |
| `R2_ACCOUNT_ID` | Secret | Cloudflare account ID |
| `R2_BUCKET_RELEASES` | Variable | e.g. `perform6-releases` (ZIP keys under `releases/touchscreen/`) |
| `VITE_API_BASE_URL` | Variable | Production API URL for builds |

Admin/API uploads of OTA ZIPs also land in `perform6-releases` under `releases/{uuid}.zip` when `STORAGE_DRIVER=r2`.
Media (videos/thumbnails) uses bucket `perform6-media`.

## Release tag example

```bash
git tag touchscreen-v1.0.0
git push origin touchscreen-v1.0.0
```

API serves metadata via `GET /devices/me/app-update` (Milestone 4).
