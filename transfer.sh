#!/bin/bash
#
# Build the tool and stage it into content-spa/tools/what-runs-first/.
#
# Same shape as ../docs/transfer.sh: THIS builds and stages, content-spa's
# deploy.sh publishes. There is no deploy from this repo, deliberately — the
# site has one deploy script and adding a second way to put files in that
# bucket is how the docs directory drifted.
#
# Run this, then run ../content-spa/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"

DEST="../content-spa/tools/what-runs-first"

# ── Refuse if the staged output would be committed ───────────────────────────
# content-spa/tools is BUILD OUTPUT. If it is not ignored there, a staging run
# adds a 17 MB wasm blob to that repo's working tree and somebody commits it.
if ! grep -qE '^tools/$' ../content-spa/.gitignore 2>/dev/null; then
    echo "✋ content-spa/.gitignore does not ignore tools/."
    echo "   Add a 'tools/' line to it first — this stages build output, and"
    echo "   an unignored 17 MB .wasm will end up in a commit."
    exit 1
fi

echo "→ building package"
npm run build

echo "→ staging web assets"
node scripts/build-web.mjs

echo "→ replacing $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R web/. "$DEST/"

# The sample estate ships: it is the page's default state, and an empty
# dropzone loses most first-time visitors before they see a finding.
echo "→ staged $(find "$DEST" -type f | wc -l | tr -d ' ') files"
echo
echo "Next: ../content-spa/deploy.sh"
echo "Make sure the bucket serves .wasm as application/wasm and compresses it;"
echo "uncompressed it is 17 MB against about 2.1 MB brotli."
