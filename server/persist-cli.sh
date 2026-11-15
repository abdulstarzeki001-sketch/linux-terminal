#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
STATE="$ROOT/state"
usage(){
  printf '%s\n' "Wormstar persistent terminal" \
    "  persist status           Show saved data and installed APT tools" \
    "  persist save             Rescan manually installed APT packages" \
    "  persist upgrade          Upgrade Debian and replay upgrades after redeploy" \
    "  persist auto-upgrade on  Replay upgrades on every redeploy" \
    "  persist auto-upgrade off Disable upgrade replay" \
    "  persist help             Show help"
}
case "${1:-status}" in
  status)
    echo "Data root: $ROOT"
    if [[ -f "$STATE/initialized" ]]; then
      echo "Persistent home: /home/tuser -> $ROOT/home/tuser"
    else echo "WARNING: Persistent storage has not been initialized"; fi
    if [[ -f "$STATE/apt-manual.txt" ]]; then
      echo "Tracked APT packages: $(wc -l < "$STATE/apt-manual.txt")"
    else echo "Tracked APT packages: 0"; fi
    if [[ -f "$STATE/auto-upgrade-enabled" ]]; then
      echo "Reapply apt upgrade after deployment: enabled"
    else echo "Reapply apt upgrade after deployment: disabled"; fi
    echo "Python: /home/tuser/.venv"
    echo "npm global: /home/tuser/.npm-global"
    echo "APT restore log: $STATE/restore.log"
    ;;
  save)
    if [[ "$(id -u)" -eq 0 ]]; then /usr/local/bin/wormstar-apt-track
    else sudo /usr/local/bin/wormstar-apt-track; fi
    echo "APT package catalog saved."
    ;;
  upgrade)
    if [[ "$(id -u)" -ne 0 ]]; then exec sudo "$0" upgrade; fi
    [[ -f "$STATE/initialized" ]] || { echo "Volume is not ready" >&2; exit 1; }
    /usr/bin/apt-get update
    /usr/bin/apt-get upgrade -y
    touch "$STATE/auto-upgrade-enabled"
    /usr/local/bin/wormstar-apt-track
    echo "System upgrade complete; upgrade replay enabled."
    ;;
  auto-upgrade)
    case "${2:-}" in
      on|off)
        if [[ "$(id -u)" -ne 0 ]]; then exec sudo "$0" auto-upgrade "$2"; fi
        [[ -f "$STATE/initialized" ]] || { echo "Volume is not ready" >&2; exit 1; }
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
