#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
HOME_DIR="$ROOT/home/tuser"
STATE="$ROOT/state"
IMAGE_HOME="/home/tuser"

# Railway volumes are attached at runtime, never during image builds.
if [[ -n "${RAILWAY_PROJECT_ID:-}" && "${RAILWAY_VOLUME_MOUNT_PATH:-}" != "$ROOT" ]]; then
  echo "ERROR: Persistent Railway volume must be mounted at $ROOT." >&2
  exit 1
fi
if [[ ! -d "$ROOT" || ! -w "$ROOT" ]]; then
  echo "ERROR: Persistent storage $ROOT is missing or not writable." >&2
  exit 1
fi

install -d -m 755 "$ROOT/home" "$STATE"
install -d -o tuser -g tuser -m 700 "$HOME_DIR"
if [[ ! -f "$STATE/initialized" ]]; then
  if [[ -d "$IMAGE_HOME" && ! -L "$IMAGE_HOME" ]]; then
    cp -a "$IMAGE_HOME/." "$HOME_DIR/"
  fi
  chown -R tuser:tuser "$HOME_DIR"
  chmod 700 "$HOME_DIR"
  touch "$STATE/initialized"
  chmod 644 "$STATE/initialized"
  echo "Initialized persistent home."
fi
if [[ ! -L "$IMAGE_HOME" ]]; then
  [[ ! -e "$IMAGE_HOME" ]] || rm -rf "$IMAGE_HOME"
  ln -s "$HOME_DIR" "$IMAGE_HOME"
fi
chown tuser:tuser "$HOME_DIR"
install -d -o tuser -g tuser -m 755 "$HOME_DIR/.npm-global" "$HOME_DIR/.local" "$HOME_DIR/projects"
if [[ ! -x "$HOME_DIR/.venv/bin/python" ]]; then
  if ! gosu tuser python3 -m venv "$IMAGE_HOME/.venv"; then
    echo "WARNING: Could not set up persistent Python virtualenv." >&2
  fi
fi

# The package manager is ephemeral, while its extra-package manifest is
# persistent. Restoration is bounded; failure never hides the owner's files.
if ! /usr/local/bin/wormstar-restore-packages; then
  echo "[PERSIST] Package restoration incomplete; terminal will still start." >&2
fi

cd "$IMAGE_HOME"
export HOME="$IMAGE_HOME" WORMSTAR_PERSIST_ROOT="$ROOT"
echo "Persistent terminal home active: $IMAGE_HOME -> $HOME_DIR"
exec gosu tuser "$@"
