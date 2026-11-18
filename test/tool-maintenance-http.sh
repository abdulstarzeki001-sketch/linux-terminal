#!/usr/bin/env bash
set -Eeuo pipefail
export PORT=18082
export TERMINAL_EDGE_MODE=enforce
export TERMINAL_EDGE_ORIGIN_SECRET='ci-only-maintenance-secret-0123456789abcdef'
export TERMINAL_PASSWORD='ci-only-terminal-password-0123456789'
export AI_ENABLED=0
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"
PID=''
trap '[[ -z "$PID" ]] || { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }; rm -rf "$TMP"' EXIT
node /app/server/index.js >"$TMP/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 50); do
  if curl -fsS --max-time 2 "$BASE/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then cat "$TMP/server.log";exit 1;fi
  sleep 0.2
done
request(){
 curl --silent --show-error --max-time 12 -X POST -H 'Content-Type: application/json' \
   -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
   -d "$2" "$BASE/api/tools/$1"
}
blocked="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/tools/diagnostics")"
[[ "$blocked" == 403 ]] || { echo "Diagnostics bypass: $blocked"; exit 1; }
request diagnostics '{}' > "$TMP/diag.json"
node - "$TMP/diag.json" <<'NODE'
const x=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(x.source!=='railway_live_diagnostics'||x.runtime?.healthy!==true||
   x.access?.code!=='PRIVATE_ORIGIN_AUTH_PASSED'||x.aiGateway?.liveProviderVerified!==false)process.exit(1);
console.log('[MAINTENANCE] Real runtime, Kali and AI readiness returned with no fake inference success');
NODE
request install/status '{}' > "$TMP/install.json"
node - "$TMP/install.json" <<'NODE'
const s=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(s.packages?.length!==2||s.packages[0]?.version!=='14.13.2'||s.packages[1]?.version!=='0.13.1')process.exit(1);
console.log('[MAINTENANCE] Curated install plan reflects real persistent venv state');
NODE
rejected="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
 -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
 -H 'Content-Type: application/json' \
 -d '{"tool_id":"sliver","confirm":"INSTALL_CURATED_PINNED"}' "$BASE/api/tools/install/start")"
[[ "$rejected" == 400 ]] || { echo "Unapproved install accepted: $rejected"; exit 1; }
noConfirm="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
 -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
 -H 'Content-Type: application/json' \
 -d '{"tool_id":"frida","confirm":"no"}' "$BASE/api/tools/install/start")"
[[ "$noConfirm" == 400 ]] || { echo "Unconfirmed install accepted: $noConfirm"; exit 1; }
unauthorized="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
 -H 'Content-Type: application/json' \
 -d '{"tool_id":"frida","confirm":"INSTALL_CURATED_PINNED"}' "$BASE/api/tools/install/start")"
[[ "$unauthorized" == 403 ]] || { echo "Unauthorized install accepted: $unauthorized"; exit 1; }
request live-ai '{"confirm":"RUN_ONE_PROVIDER_CHECK"}' > "$TMP/ai.json"
node - "$TMP/ai.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(d.ready!==false||d.code!=='TERMINAL_NOT_CONFIGURED')process.exit(1);
console.log('[MAINTENANCE] AI inference not misreported when gateway is disabled');
NODE
echo 'SUCCESS: phase 1 diagnostics + phase 2 install guard HTTP checks'
