#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PATH="$work:$PATH"
export CALLS="$work/calls"
EXPECTED="sha512-$(printf archive | openssl dgst -sha512 -binary | openssl base64 -A)"
export EXPECTED
cat > "$work/npm" <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$1" in
  view)
    echo read >> "$CALLS"
    case "$SCENARIO" in
      delayed) [[ $(wc -l < "$CALLS") -ge 2 ]] || exit 1 ;;
      wrong) echo sha512-other; exit 0 ;;
      absent) exit 1 ;;
    esac
    echo "$EXPECTED" ;;
  pack)
    if [[ "$SCENARIO" == delayed-tarball && $(wc -l < "$CALLS") -lt 2 ]]; then exit 1; fi
    bytes=archive
    if [[ "$SCENARIO" == corrupt ]]; then bytes=wrong; fi
    printf '%s' "$bytes" > "${!#}/package.tgz"
    echo package.tgz ;;
  *) exit 1 ;;
esac
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$work/sleep"
chmod +x "$work/npm" "$work/sleep"
run() {
  : > "$CALLS"
  SCENARIO=$1 bash "$here/confirm-published-archive.sh" '@example/test@1.0.0-rc.1' "$EXPECTED"
}
for scenario in delayed delayed-tarball; do
  run "$scenario"
  [[ $(wc -l < "$CALLS") -eq 2 ]]
done
for scenario in wrong corrupt; do
  if run "$scenario"; then exit 1; fi
  [[ $(wc -l < "$CALLS") -eq 1 ]]
done
if run absent; then exit 1; fi
[[ $(wc -l < "$CALLS") -eq 11 ]]
