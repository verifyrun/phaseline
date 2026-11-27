#!/usr/bin/env bash
set -euo pipefail
spec=$1
expected=$2
# npm can acknowledge publication before its read endpoint has indexed the version.
for delay in 0 5 10 15 30 60 60 60 60; do
  if (( delay )); then sleep "$delay"; fi
  if actual=$(npm view "$spec" dist.integrity --prefer-online --fetch-retries=0 --fetch-timeout=10000) && [[ -n "$actual" ]]; then
    if [[ "$actual" == "$expected" ]]; then exit 0; fi
    echo "Published integrity differs from the tested archive for $spec" >&2
    exit 1
  fi
done
echo "Registry readback is still unavailable for $spec. Check the version before retrying publication." >&2
exit 1
