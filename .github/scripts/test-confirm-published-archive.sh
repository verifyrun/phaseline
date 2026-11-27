#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PATH="$work:$PATH"
export CALLS="$work/calls"
cat > "$work/npm" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ "$1" == view ]]
echo read >> "$CALLS"
case "$SCENARIO" in
  delayed) [[ $(wc -l < "$CALLS") -ge 2 ]] && echo sha512-example ;;
  wrong) echo sha512-other ;;
  absent) exit 1 ;;
esac
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$work/sleep"
chmod +x "$work/npm" "$work/sleep"
run() {
  : > "$CALLS"
  SCENARIO=$1 bash "$here/confirm-published-archive.sh" '@example/test@1.0.0-rc.1' sha512-example
}
run delayed
[[ $(wc -l < "$CALLS") -eq 2 ]]
if run wrong; then exit 1; fi
[[ $(wc -l < "$CALLS") -eq 1 ]]
if run absent; then exit 1; fi
[[ $(wc -l < "$CALLS") -eq 9 ]]
