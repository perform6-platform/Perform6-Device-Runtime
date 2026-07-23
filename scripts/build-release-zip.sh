#!/bin/sh
# Legacy wrapper — prefer: npm run release:zip:xt2145 -- 1.0.0
set -e
VERSION="${1:-dev}"
PROFILE="${2:-XT2145}"
node "$(dirname "$0")/build-profile-zip.mjs" "$PROFILE" "$VERSION"
