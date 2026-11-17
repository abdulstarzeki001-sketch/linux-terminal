#!/usr/bin/env bash
# Starts an authenticated loopback-only FastAPI sidecar inside the EXISTING Railway terminal.
# The UI remains password-protected. Never bind Kali FastAPI on 0.0.0.0.
set -Eeuo pipefail
umask 077

if [[ "${STAR_KALI_ENABLED:-1}" != "1" ]]; then
  exec node /app/server/index.js
fi

AUTH_DIR="$HOME/.config/kali-osint-star"
AUTH_FILE="$AUTH_DIR/local-auth.env"
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
if [[ ! -e "$AUTH_FILE" ]]; then
  python3 - "$AUTH_FILE" <<'PY'
from pathlib import Path
import secrets, sys
file = Path(sys.argv[1])
with file.open('x', encoding='ascii') as out:
    out.write('STAR_OPERATOR_TOKEN=' + secrets.token_hex(32) + '\n')
    out.write('STAR_APPROVAL_TOKEN=' + secrets.token_hex(32) + '\n')
PY
fi
chmod 600 "$AUTH_FILE"
echo "[STAR KALI] Starting local-only FastAPI service on 127.0.0.1:8000 (no public port)."
(
  set -a
  # local private file is owned by the current user, not downloaded from the Internet
  source "$AUTH_FILE"
  set +a
  export STAR_LAB_CIDRS=''  # fail closed: no external or private lab target allowed on Railway
  export STAR_DB_PATH="$HOME/.local/share/kali-osint-star/operations.sqlite"
  exec /opt/star-kali-venv/bin/uvicorn app.main:app \
    --app-dir /opt/kali-osint-star/services/api \
    --host 127.0.0.1 --port 8000 --no-access-log
) &
api_pid=$!

# One-time authorized, read-only local inventory. Stores no credentials in logs.
(
  for i in {1..20}; do
    if curl -fsS --max-time 2 http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
      echo "[STAR KALI] Local API health verified."
      if [[ ! -f "$AUTH_DIR/bootstrap-inventory.done" ]]; then
        if /usr/local/bin/star-kali inventory; then
          touch "$AUTH_DIR/bootstrap-inventory.done"
          echo "[STAR KALI] Approved local inventory completed."
        else
          echo "[STAR KALI] Local inventory failed; remains available for manual retry." >&2
        fi
      fi
      exit 0
    fi
    sleep 1
  done
  echo "[STAR KALI] Local API readiness check failed." >&2
) &

node /app/server/index.js &
server_pid=$!

shutdown() {
  kill "$server_pid" "$api_pid" 2>/dev/null || true
  wait "$server_pid" "$api_pid" 2>/dev/null || true
}
trap shutdown EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Stop the deployment if either essential process fails, so Railway can restart both.
if wait -n "$api_pid" "$server_pid"; then
  echo "[STAR KALI] A service stopped; restarting the container is necessary." >&2
else
  echo "[STAR KALI] A service stopped unexpectedly." >&2
fi
exit 1
