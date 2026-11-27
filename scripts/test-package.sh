#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
consumer=$(mktemp -d)
trap 'rm -rf "$consumer"' EXIT
cd "$consumer"
echo '{"private":true,"type":"module"}' > package.json
npm install --offline --ignore-scripts --no-audit --no-fund "$archive"
pkg="$consumer/node_modules/@verifyrun/phaseline"
test "$(node_modules/.bin/phaseline --version)" = "$(node -p "require('$root/package.json').version")"
(cd "$pkg" && node "$root/scripts/run-checks.mjs")
cp "$root/tests/types.ts" "$root/tests/tsconfig.json" "$root/tests/property.mjs" .
"$root/node_modules/.bin/tsc" -p tsconfig.json
ln -s "$root/node_modules/fast-check" node_modules/fast-check
node property.mjs
