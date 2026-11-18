#!/usr/bin/env bash
# Restore only the extra APT packages explicitly installed by the terminal owner.
# A Railway volume persists the manifest; a new Docker image does NOT persist /usr/bin.
set -Eeuo pipefail
umask 077

ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
STATE="$ROOT/state"
MANIFEST="$STATE/apt-manual.txt"
UPGRADE="$STATE/auto-upgrade-enabled"
LOG="$STATE/restore.log"
STATUS="$STATE/restore-status.txt"

[[ "$(id -u)" == 0 ]] || { echo "APT restoration requires root" >&2; exit 77; }
[[ -f "$STATE/initialized" ]] || { echo "Persistent Railway volume is not initialized" >&2; exit 1; }
install -d -m 755 "$STATE"
touch "$LOG"
chmod 600 "$LOG"

# Serialize automatic restores with manually requested repairs.
exec 9>"$STATE/restore.lock"
if ! flock -w 20 9; then
  echo "[PERSIST] Another package restore is already in progress." >&2
  exit 1
fi

set_status() {
  local status="$1"
  local temporary
  temporary="$(mktemp "$STATE/.restore-status.XXXXXX")"
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$status" > "$temporary"
  chmod 644 "$temporary"
  mv -f "$temporary" "$STATUS"
}
declare -a missing=()
if [[ -s "$MANIFEST" ]]; then
  while IFS= read -r pkg || [[ -n "$pkg" ]]; do
    [[ "$pkg" =~ ^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$ ]] || continue
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qx 'install ok installed'; then
      missing+=("$pkg")
    fi
  done < "$MANIFEST"
fi

if (( ${#missing[@]} == 0 )) && [[ ! -f "$UPGRADE" ]]; then
  set_status "ready"
  echo "[PERSIST] Package manifest checked; no restoration needed."
  exit 0
fi

set_status "restoring"
printf '%s Restoring %d extra APT package(s); upgrades=%s\n' \
  "$(date -u +%FT%TZ)" "${#missing[@]}" "$([[ -f "$UPGRADE" ]] && echo on || echo off)" >> "$LOG"
export WORMSTAR_BOOTSTRAP=1 DEBIAN_FRONTEND=noninteractive
errors=0

# Bound each network/package-manager operation so startup cannot hang forever.
if ! timeout -k 10s 180s /usr/bin/apt-get update -qq >> "$LOG" 2>&1; then
  echo "[PERSIST] APT repository refresh failed; terminal files remain safe." >&2
  errors=1
else
  if (( ${#missing[@]} > 0 )); then
    if ! timeout -k 10s 480s /usr/bin/apt-get install -y --no-install-recommends "${missing[@]}" >> "$LOG" 2>&1; then
      echo "[PERSIST] Batch install failed; retrying missing packages individually." >&2
      for pkg in "${missing[@]}"; do
        if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qx 'install ok installed'; then
          continue
        fi
        if ! timeout -k 10s 180s /usr/bin/apt-get install -y --no-install-recommends "$pkg" >> "$LOG" 2>&1; then
          printf '%s WARN package restoration failed: %s\n' "$(date -u +%FT%TZ)" "$pkg" >> "$LOG"
          errors=1
        fi
      done
    fi
  fi
  if [[ -f "$UPGRADE" ]]; then
    if ! timeout -k 10s 480s /usr/bin/apt-get upgrade -y >> "$LOG" 2>&1; then
      echo "[PERSIST] APT upgrade replay failed; inspect persist status." >&2
      errors=1
    fi
  fi
fi

# Check actual package state after installation, not only the apt exit status.
for pkg in "${missing[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qx 'install ok installed'; then
    errors=1
  fi
done
if (( errors > 0 )); then
  set_status "degraded"
  echo "[PERSIST] Some packages or updates could not be restored. Run: persist repair" >&2
  exit 1
fi
set_status "ready"
echo "[PERSIST] Saved applications and updates restored."
