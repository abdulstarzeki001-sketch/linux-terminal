#!/usr/bin/env bash
# Owner-facing controls for the Railway /persist volume. Never prints secrets.
set -Eeuo pipefail
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
STATE="$ROOT/state"
HOME_DIR="$ROOT/home/tuser"
USER_META="$HOME_DIR/.config/wormstar"

usage(){
  printf '%s\n' \
    "STAR persistent terminal — Railway volume" \
    "  persist status           Saved data, package catalog, last restore and space" \
    "  persist check            Verify volume, Python/npm and saved APT packages" \
    "  persist save             Save APT list and safe Python/npm package inventory" \
    "  persist repair           Retry missing APT packages without redeploying" \
    "  persist repair-user      Reinstall pinned Python/npm packages on demand" \
    "  persist backup           Export safe project/package metadata to private .tgz" \
    "  persist backups          List local snapshots (not offsite)" \
    "  persist verify [name]    Check local snapshot SHA-256 and tar integrity" \
    "  persist upgrade          Update Debian and replay updates after redeploy" \
    "  persist auto-upgrade on  Replay Debian upgrades on each redeploy" \
    "  persist auto-upgrade off Disable upgrade replay" \
    "  persist help             Show help"
}
count_missing(){
  local p
  MISSING=0
  [[ -s "$STATE/apt-manual.txt" ]] || return 0
  while IFS= read -r p || [[ -n "$p" ]]; do
    [[ "$p" =~ ^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$ ]] || continue
    if ! dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -qx 'install ok installed'; then
      MISSING=$((MISSING+1))
    fi
  done < "$STATE/apt-manual.txt"
}
ready_volume(){
  [[ -f "$STATE/initialized" ]] || { echo "Volume is not ready: $ROOT" >&2; exit 1; }
}
status(){
  echo "Persistent Railway volume: $ROOT"
  if [[ -f "$STATE/initialized" ]]; then
    echo "Persistent home: /home/tuser -> $HOME_DIR"
  else
    echo "WARNING: Persistent storage is not initialized."
  fi
  local total=0
  if [[ -f "$STATE/apt-manual.txt" ]]; then
    total="$(grep -Ec '^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$' "$STATE/apt-manual.txt" || true)"
  fi
  count_missing
  echo "Saved extra APT packages: $total (missing from image: $MISSING)"
  if [[ -r "$STATE/restore-status.txt" ]]; then
    echo "Last package restore: $(cat "$STATE/restore-status.txt")"
  else
    echo "Last package restore: no recorded status"
  fi
  if [[ -f "$STATE/auto-upgrade-enabled" ]]; then
    echo "Replay Debian upgrades after redeploy: enabled"
  else
    echo "Replay Debian upgrades after redeploy: disabled"
  fi
  echo "Python packages: $HOME_DIR/.venv (on volume)"
  echo "Global npm packages: $HOME_DIR/.npm-global (on volume)"
  echo "Projects and settings: $HOME_DIR"
  if [[ -d "$ROOT" ]]; then
    df -h -P "$ROOT" | tail -n 1 | awk '{ print "Volume capacity: "$2", available: "$4" ("$5" used)" }'
  fi
  echo "APT restore log: $STATE/restore.log (use sudo to read)"
}
check(){
  ready_volume
  local failed=0
  if [[ -L /home/tuser && "$(readlink -f /home/tuser)" == "$(readlink -f "$HOME_DIR")" ]]; then
    echo "OK: home directory is connected to the Railway volume"
  else
    echo "ERROR: /home/tuser is not linked to the persistent volume" >&2; failed=1
  fi
  if [[ -x "$HOME_DIR/.venv/bin/python" ]] &&
     "$HOME_DIR/.venv/bin/python" -m pip --version >/dev/null 2>&1; then
    echo "OK: persistent Python virtual environment"
  else
    echo "WARNING: Python virtualenv is missing or broken" >&2; failed=1
  fi
  if [[ -d "$HOME_DIR/.npm-global" ]]; then
    echo "OK: persistent npm global prefix"
  else
    echo "WARNING: npm prefix directory is missing" >&2; failed=1
  fi
  count_missing
  if (( MISSING == 0 )); then echo "OK: all saved APT tools are installed"
  else echo "WARNING: $MISSING APT packages need repair (persist repair)" >&2; failed=1; fi
  if [[ -r "$STATE/restore-status.txt" ]] &&
     grep -q ' degraded$' "$STATE/restore-status.txt"; then
    echo "WARNING: latest APT restoration was degraded" >&2; failed=1
  fi
  if (( failed > 0 )); then return 1; fi
  echo "READY: persistent shell, applications and package tracking available"
}
save_inventory(){
  ready_volume
  if [[ "$(id -u)" -eq 0 ]]; then
    /usr/local/bin/wormstar-apt-track
    exec gosu tuser "$0" save-user
  fi
  sudo /usr/local/bin/wormstar-apt-track
  "$0" save-user
}
save_user(){
  ready_volume
  [[ "$(id -u)" -ne 0 ]] || { echo "Refusing to save user package inventories as root" >&2; exit 1; }
  install -d -m 700 "$USER_META"
  local tmp
  if [[ -x "$HOME_DIR/.venv/bin/python" ]]; then
    tmp="$(mktemp "$USER_META/.pip-packages.XXXXXXXX")"
    if "$HOME_DIR/.venv/bin/python" -m pip list --format=freeze --disable-pip-version-check >"$tmp" 2>/dev/null; then
      chmod 600 "$tmp"; mv "$tmp" "$USER_META/pip-packages.txt"
    else rm -f "$tmp"; echo "WARNING: cannot snapshot pip packages" >&2; fi
  fi
  if command -v npm >/dev/null 2>&1; then
    tmp="$(mktemp "$USER_META/.npm-packages.XXXXXXXX")"
    # npm ls can exit non-zero for an empty prefix or broken dependencies
    # while still writing valid JSON. Keep the inventory, not its exit code.
    NPM_CONFIG_PREFIX="$HOME_DIR/.npm-global" npm ls -g --depth=0 --json >"$tmp" 2>/dev/null || true
    if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$tmp" >/dev/null 2>&1; then
      printf '{"status":"unavailable","dependencies":{}}\n' > "$tmp"
      echo "WARNING: npm inventory unavailable; globally installed packages remain on the volume" >&2
    fi
    chmod 600 "$tmp"
    mv "$tmp" "$USER_META/npm-packages.json"
  fi
  echo "Saved APT catalog and Python/npm inventories to the existing Railway volume."
}
case "${1:-status}" in
  status) status ;;
  check|doctor|ready) check ;;
  save) save_inventory ;;
  save-user) save_user ;; # internal: invoked with non-root user after APT catalog update
  repair)
    ready_volume
    if [[ "$(id -u)" -eq 0 ]]; then exec /usr/local/bin/wormstar-restore-packages; fi
    exec sudo /usr/local/bin/wormstar-restore-packages
    ;;
  backup|backups|verify)
    exec /usr/local/bin/wormstar-persist-backup "$@"
    ;;
  repair-user)
    exec /usr/local/bin/wormstar-restore-user-tools
    ;;
  upgrade)
    if [[ "$(id -u)" -ne 0 ]]; then exec sudo "$0" upgrade; fi
    ready_volume
    /usr/bin/apt-get update
    /usr/bin/apt-get upgrade -y
    touch "$STATE/auto-upgrade-enabled"
    /usr/local/bin/wormstar-apt-track
    echo "System upgraded. Future container starts will replay Debian upgrades."
    ;;
  auto-upgrade)
    case "${2:-}" in
      on|off)
        if [[ "$(id -u)" -ne 0 ]]; then exec sudo "$0" auto-upgrade "$2"; fi
        ready_volume
        if [[ "$2" == on ]]; then touch "$STATE/auto-upgrade-enabled"
        else rm -f "$STATE/auto-upgrade-enabled"; fi
        echo "Upgrade replay: $2"
        ;;
      *) usage; exit 2 ;;
    esac
    ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
