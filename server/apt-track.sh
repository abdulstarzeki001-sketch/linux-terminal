#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(id -u)" -eq 0 ]] || exit 0
[[ "${WORMSTAR_BOOTSTRAP:-}" != 1 ]] || exit 0
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
STATE="$ROOT/state"
BASE="/usr/local/share/wormstar-manual-base.txt"
[[ -f "$STATE/initialized" && -f "$BASE" ]] || exit 0
tmp="$(mktemp "$STATE/.apt-manual.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
comm -13 "$BASE" <(LC_ALL=C apt-mark showmanual | LC_ALL=C sort -u) |
  awk '/^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$/ { print }' > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$STATE/apt-manual.txt"
