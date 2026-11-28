#!/usr/bin/env bash
# Reproduce two real Format Document runs, isolated from the user's extensions and profile.
set -euo pipefail
study=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
work=$(cd "$work" && pwd -P)
printf 'Capture directory %s\n' "$work"
export PHASELINE_EXAM_HOME="$work"
editor=${VSCODE_EXECUTABLE:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}
mkdir "$work/harness"
cp "$study/editor.cjs" "$work/harness/"
echo '{"name":"receiver-test","publisher":"phaseline-study","version":"0.0.1","engines":{"vscode":"^1.80.0"}}' > "$work/harness/package.json"
for version in 2.8.8 3.3.3; do
  npm install --ignore-scripts --no-audit --no-fund --prefix "$work/engine-$version" "prettier@$version"
done
old=-
for version in 10.4.0 11.0.0; do
  host="$work/host-$version"
  mkdir -p "$host/extensions"
  asset="prettier-vscode-$version.vsix"
  curl --fail --silent --show-error --location "https://github.com/prettier/prettier-vscode/releases/download/v$version/$asset" --output "$host/$asset"
  case "$version" in
    10.4.0) digest=3dbeb3383ff4a367a020a24e70431932fc5e91f6b8276dc91e8ed9cc0aeb085a ;;
    11.0.0) digest=d959f4bbd157fa7d37092476d41b35aca2f7df83b99df6b9546c9435fc85cac7 ;;
  esac
  echo "$digest  $host/$asset" | shasum -a 256 -c -
  unzip -q "$host/$asset" 'extension/*' -d "$host"
  mv "$host/extension" "$host/extensions/esbenp.prettier-vscode-$version"
  python3 "$study/editor-fixture.py" "$work" "$version"
  "$editor" --user-data-dir="$host/profile" --extensions-dir="$host/extensions" --disable-updates --skip-welcome --disable-telemetry --disable-workspace-trust --extensionDevelopmentPath="$work/harness" --extensionTestsPath="$work/harness/editor.cjs" "$work/product/lab.code-workspace" > "$host/editor.log" 2>&1
  python3 "$study/editor-logs.py" "$work" "$version" "$host/records.json"
  node "$study/first.mjs" "$old" "$host/records.json" "$host/answers.json"
  old="$host/records.json"
done
