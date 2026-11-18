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
    test -x "$HOME/.venv-py312/bin/python"
    "$HOME/.venv-py312/bin/python" -c 'import sys; assert sys.version_info[:2] == (3,12)'
    printf "certipy-venv-kept\n" > "$HOME/.venv-py312/PERSISTENCE_PROOF"
    printf "npm-state\n" > "$HOME/.npm-global/PERSISTENCE_PROOF"
    printf "do-not-export-test-secret\n" > "$HOME/projects/.env"
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
    test "$(cat "$HOME/.venv-py312/PERSISTENCE_PROOF")" = "certipy-venv-kept"
    "$HOME/.venv-py312/bin/python" -c 'import sys; assert sys.version_info[:2] == (3,12)'
    test "$(cat "$HOME/.npm-global/PERSISTENCE_PROOF")" = "npm-state"
    command -v figlet >/dev/null
    persist check
    persist status
    test -f "$HOME/.config/wormstar/pip-packages.txt"
    test -f "$HOME/.config/wormstar/npm-packages.json"
    persist backup
    persist verify
    persist unpack
    recovered="$(find "$HOME/restored" -maxdepth 1 -type d -name "star-home-*" | head -n 1)"
    test -n "$recovered"
    test "$(cat "$recovered/home/tuser/projects/reboot-proof.txt")" = "keep-on-volume"
    test ! -f "$recovered/home/tuser/projects/.env"
    # Only selected source files and inventories are exported; project .env is excluded.
    archive="$(find "$HOME/backups" -maxdepth 1 -name "star-home-*.tgz" | head -n 1)"
    test -f "$archive"
    tar -tzf "$archive" | grep -q "home/tuser/projects/reboot-proof.txt"
    if tar -tzf "$archive" | grep -q "home/tuser/projects/\.env"; then
      echo "ERROR: secret .env entered snapshot" >&2
      exit 1
    fi
    echo "SUCCESS: home files, Python/npm state, APT and backup integrity survived image replacement"
  '

echo "[TEST] Prove snapshot itself survives another fresh container"
docker run --rm -v "$VOLUME:/persist" \
  "$IMAGE" /bin/bash -lc '
    set -Eeuo pipefail
    persist verify
    persist backups
    echo "SUCCESS: verified private snapshot survived a second image replacement"
  '
