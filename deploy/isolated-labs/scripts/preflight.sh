#!/usr/bin/env bash
# Non-destructive preflight: only local machine facts; no service provisioning.
set -Eeuo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${1:-audit}"
case "$profile" in
  audit) min_ram=4; min_disk=12 ;;
  analysis) min_ram=8; min_disk=20 ;;
  full) min_ram=24; min_disk=70 ;;
  *) echo "Usage: $0 [audit|analysis|full]" >&2; exit 2 ;;
esac
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker Engine is not installed. No cloud resources were provisioned." >&2
  exit 3
fi
docker info >/dev/null || { echo "ERROR: Docker daemon not running." >&2; exit 3; }
docker compose version >/dev/null || { echo "ERROR: Docker Compose plugin unavailable." >&2; exit 3; }
docker compose -f "$here/compose.yaml" config --quiet
available_gb="$(df -Pk "$here" | awk 'NR==2 {printf "%d", $4 / 1048576}')"
memory_gb=0
if [[ -r /proc/meminfo ]]; then
  memory_gb="$(awk '/^MemTotal:/ {printf "%d", $2 / 1048576}' /proc/meminfo)"
elif command -v sysctl >/dev/null 2>&1; then
  raw="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
  memory_gb="$((raw / 1073741824))"
fi
echo "PROFILE=$profile RAM_GB=$memory_gb FREE_DISK_GB=$available_gb"
if ((memory_gb < min_ram || available_gb < min_disk)); then
  echo "ERROR: Insufficient local resources for $profile (recommended >=${min_ram} GiB RAM, >=${min_disk} GiB free disk)." >&2
  exit 4
fi
echo "READY: offline lab profile $profile (no public ports, no service started)"
