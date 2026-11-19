#!/usr/bin/env bash
# Read-only prerequisite check for the dedicated seven-tool lab.
# It does not start any container, download an image, allocate a VM or
# write outside a caller-owned temporary directory.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker Engine not found"; exit 3
fi
if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker daemon not reachable"; exit 3
fi
docker compose version >/dev/null 2>&1 || { echo "BLOCKED: Compose plugin unavailable"; exit 3; }
available_kb="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
available_mb="$((available_kb/1024))"
disk_mb="$(df -Pm "$HERE" | awk 'NR==2 {print $4}')"
printf 'AVAILABLE_RAM_MB=%s FREE_DISK_MB=%s\n' "$available_mb" "$disk_mb"
# BloodHound CE: separate app, PostgreSQL and Neo4j + realistic headroom.
if ((available_mb < 12000 || disk_mb < 30000)); then
  echo "BLOCKED: BloodHound CE stack needs a dedicated VM with >=12 GB available RAM and >=30 GB free disk."
  echo "Do not run this on 3.8 GB WSL or the Railway terminal's 500 MB volume."
  exit 4
fi
# Secrets must be injected by the operator. No default passwords.
if [[ -z "${STAR_BH_PG_PASSWORD:-}" || -z "${STAR_BH_NEO4J_PASSWORD:-}" ]]; then
  echo "BLOCKED: provide unique STAR_BH_PG_PASSWORD and STAR_BH_NEO4J_PASSWORD externally."
  exit 5
fi
docker compose -f "$HERE/compose.yaml" --profile bloodhound config --quiet
echo "READY: private BloodHound lab infrastructure can be started on this VM, after authorized access check."
echo "CALDERA is image-check-only. Mythic, Sliver, Havoc and Windows tools require separate offline environments."
