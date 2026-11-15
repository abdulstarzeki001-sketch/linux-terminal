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

manifest="$STATE/apt-manual.txt"
upgrade_marker="$STATE/auto-upgrade-enabled"
restore_log="$STATE/restore.log"
touch "$restore_log"
chmod 644 "$restore_log"
missing=()
if [[ -s "$manifest" ]]; then
  while IFS= read -r pkg; do
    [[ "$pkg" =~ ^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$ ]] || continue
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qx 'install ok installed'; then
      missing+=("$pkg")
    fi
  done < "$manifest"
fi
if (( ${#missing[@]} > 0 )) || [[ -f "$upgrade_marker" ]]; then
  echo "$(date -u +%FT%TZ) Restoring ${#missing[@]} APT packages" >> "$restore_log"
  export WORMSTAR_BOOTSTRAP=1 DEBIAN_FRONTEND=noninteractive
  if /usr/bin/apt-get update -qq >> "$restore_log" 2>&1; then
    if (( ${#missing[@]} > 0 )); then
      if ! /usr/bin/apt-get install -y --no-install-recommends "${missing[@]}" >> "$restore_log" 2>&1; then
        echo "Batch restoration failed; trying packages individually." >> "$restore_log"
        for pkg in "${missing[@]}"; do
          /usr/bin/apt-get install -y --no-install-recommends "$pkg" >> "$restore_log" 2>&1 ||
            echo "WARNING: Could not restore $pkg" >> "$restore_log"
        done
      fi
    fi
    if [[ -f "$upgrade_marker" ]]; then
      /usr/bin/apt-get upgrade -y >> "$restore_log" 2>&1 ||
        echo "WARNING: OS upgrade failed; inspect $restore_log" >&2
    fi
  else
    echo "WARNING: APT mirrors unreachable; skipping package restoration." >&2
  fi
  unset WORMSTAR_BOOTSTRAP DEBIAN_FRONTEND
fi

cd "$IMAGE_HOME"
export HOME="$IMAGE_HOME" WORMSTAR_PERSIST_ROOT="$ROOT"
echo "Persistent terminal home active: $IMAGE_HOME -> $HOME_DIR"
exec gosu tuser "$@"
