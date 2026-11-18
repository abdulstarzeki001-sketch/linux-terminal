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

# Create an isolated Certipy Python 3.12 venv on the persistent volume.
# Never migrate or overwrite the existing .venv (Debian Python 3.11).
CERTIPY_ENV="$IMAGE_HOME/.venv-py312"
if [[ ! -e "$CERTIPY_ENV/bin/python" ]]; then
  if ! gosu tuser /usr/local/bin/python3.12 -m venv "$CERTIPY_ENV"; then
    echo "WARNING: Python 3.12 Certipy environment initialization failed; existing venv is unchanged." >&2
  fi
fi
if [[ -x "$CERTIPY_ENV/bin/python" ]]; then
  if gosu tuser "$CERTIPY_ENV/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12)' 2>/dev/null; then
    echo "[PERSIST] Certipy Python 3.12 environment ready on persistent volume."
  else
    echo "WARNING: existing Certipy environment does not use Python 3.12; refusing to overwrite it." >&2
  fi
fi

# Immutable Certipy release installed during Docker build (not through browser).
# Verify it exists at runtime and emit a verifiable, secret-free health marker.
if [[ -x /opt/certipy-ad312/bin/certipy ]] &&
   gosu tuser /opt/certipy-ad312/bin/python -c 'import sys,importlib.metadata as m; assert sys.version_info[:2] == (3,12); assert m.version("certipy-ad") == "5.1.0"' >/dev/null 2>&1; then
  echo "[STAR TOOLS] CERTIPY_AD=5.1.0 PYTHON=3.12 EXECUTABLE=/opt/certipy-ad312/bin/certipy VERIFIED"
else
  echo "[STAR TOOLS] ERROR: immutable Certipy runtime verification failed" >&2
  exit 1
fi

# Detect the exact owner-approved local CLIs on each startup before opening
# the terminal. These checks do not access remote hosts or start tool services.
if gosu tuser /opt/impacket312/bin/python -c 'import importlib.metadata as m; assert m.version("impacket") == "0.13.1"' >/dev/null 2>&1 &&
   [[ -x /opt/impacket312/bin/impacket-lookupsid ]] &&
   gosu tuser /opt/frida312/bin/python -c 'import importlib.metadata as m; assert m.version("frida-tools") == "14.13.2"' >/dev/null 2>&1 &&
   [[ -x /opt/frida312/bin/frida ]] &&
   [[ -x /usr/bin/afl-fuzz ]] &&
   dpkg-query -W -f='${Status}' 'afl++' | grep -qx 'install ok installed'; then
  echo "[STAR TOOLS] IMPACKET=0.13.1 EXECUTABLE=/opt/impacket312/bin/impacket-lookupsid VERIFIED"
  echo "[STAR TOOLS] FRIDA_TOOLS=14.13.2 EXECUTABLE=/opt/frida312/bin/frida VERIFIED"
  echo "[STAR TOOLS] AFL_PLUS_PLUS=debian-bookworm EXECUTABLE=/usr/bin/afl-fuzz VERIFIED"
else
  echo "[STAR TOOLS] ERROR: one or more approved immutable CLI installations failed runtime checks" >&2
  exit 1
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
