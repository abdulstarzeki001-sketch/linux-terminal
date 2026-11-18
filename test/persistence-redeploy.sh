#!/usr/bin/env bash
# Integration proof: ephemeral Docker images sharing one durable data volume.
# This test uses only the Debian package repositories and no security scanning.
set -Eeuo pipefail
IMAGE="${1:-star-kali-terminal:ci}"
VOLUME="star-terminal-persist-test-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
docker volume create "$VOLUME" >/dev/null
cleanup() { docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[TEST] Initialize persistent home and user tool directories"
docker run --rm -v "$VOLUME:/persist" \
  "$IMAGE" /bin/bash -lc '
    set -Eeuo pipefail
    mkdir -p "$HOME/projects"
    printf "keep-on-volume\n" > "$HOME/projects/reboot-proof.txt"
    printf "pip-state\n" > "$HOME/.venv/PERSISTENCE_PROOF"
    printf "npm-state\n" > "$HOME/.npm-global/PERSISTENCE_PROOF"
    persist check
    persist save
  '

echo "[TEST] Install one extra APT tool and verify the automatic manifest"
docker run --rm -v "$VOLUME:/persist" \
  --entrypoint /bin/bash "$IMAGE" -lc '
    set -Eeuo pipefail
    apt-get update -qq
    apt-get install -y --no-install-recommends figlet >/dev/null
    grep -qx figlet /persist/state/apt-manual.txt
    echo "APT package auto-tracked in Railway volume"
  '

echo "[TEST] Simulate a full image replacement while keeping the same volume"
docker run --rm -v "$VOLUME:/persist" \
  "$IMAGE" /bin/bash -lc '
    set -Eeuo pipefail
    test "$(cat "$HOME/projects/reboot-proof.txt")" = "keep-on-volume"
    test "$(cat "$HOME/.venv/PERSISTENCE_PROOF")" = "pip-state"
    test "$(cat "$HOME/.npm-global/PERSISTENCE_PROOF")" = "npm-state"
    command -v figlet >/dev/null
    persist check
    persist status
    test -f "$HOME/.config/wormstar/pip-packages.txt"
    test -f "$HOME/.config/wormstar/npm-packages.json"
    echo "SUCCESS: home files, Python/npm state, and extra APT package survived image replacement"
  '
