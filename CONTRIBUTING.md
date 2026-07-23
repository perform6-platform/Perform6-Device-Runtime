# Contributing — perform6-touchscreen

Branch flow: `feature/*` → `develop` → `main`.

## Docker

```bash
# Production-like (nginx)
docker compose up -d --build

# Hot reload dev
docker compose -f docker-compose.dev.yml up --build
```

## BrightSign ZIP

```bash
sh scripts/build-release-zip.sh 1.0.0
```

See [docs/GITHUB.md](./docs/GITHUB.md) for CI and R2 release secrets.
