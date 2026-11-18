#!/usr/bin/env bash
# Real HTTP smoke inside the actual Railway Docker image, without external targets.
set -Eeuo pipefail
export PORT=18080
export TERMINAL_EDGE_MODE=enforce
export TERMINAL_EDGE_ORIGIN_SECRET='ci-only-training-origin-secret-0123456789-abcdef'
export TERMINAL_PASSWORD='ci-only-terminal-password-0123456789'
DIR="$(mktemp -d)"
export STAR_TRAINING_STATE_PATH="$DIR/training-progress.json"
BASE="http://127.0.0.1:$PORT"
PID=''
cleanup(){
  [[ -z "$PID" ]] || { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
  rm -rf "$DIR"
}
trap cleanup EXIT

start_server(){
  node /app/server/index.js >"$DIR/server.log" 2>&1 &
  PID=$!
  local healthy=false
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 2 "$BASE/health" >/dev/null 2>&1; then
      healthy=true
      break
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      cat "$DIR/server.log" >&2
      exit 1
    fi
    sleep 0.25
  done
  if [[ "$healthy" != true ]]; then
    echo "ERROR: training HTTP server failed to start" >&2
    cat "$DIR/server.log" >&2
    exit 1
  fi
}

status_request(){
  curl -fsS --max-time 8 -X POST -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" "$BASE/api/training/status"
}
verify_request(){
  local body="$1"
  curl -fsS --max-time 8 -X POST \
    -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
    -H 'Content-Type: application/json' \
    --data "$body" "$BASE/api/training/verify"
}
start_server
echo "[TRAINING] Authenticated Railway HTTP service started"
blocked="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/training/status")"
[[ "$blocked" == 403 ]] || { echo "ERROR: bypass allowed HTTP $blocked" >&2; exit 1; }
echo "[TRAINING] Direct unauthenticated training API blocked (403)"

status_request >"$DIR/initial.json"
node - "$DIR/initial.json" <<'NODE'
const f=require('node:fs');
const data=JSON.parse(f.readFileSync(process.argv[2],'utf8'));
if(data.summary?.completed!==0||data.summary?.total!==8||data.labs?.length!==8)process.exit(1);
if(data.labs[0]?.mode!=='live'||data.labs[1]?.mode!=='fixture')process.exit(1);
if(data.labs.slice(1).some(x=>!x.evidence||!x.command))process.exit(1);
console.log('[TRAINING] Eight real backend lab records loaded');
NODE

verify_request '{"week":"W02","answers":{"a":"99","b":"wrong"}}' >"$DIR/wrong.json"
node - "$DIR/wrong.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(d.passed!==false||d.score!==0||d.summary?.completed!==0)process.exit(1);
console.log('[TRAINING] Incorrect answers did not earn completion');
NODE

verify_request '{"week":"W02","answers":{"a":"3","b":"AdminTo"}}' >"$DIR/correct.json"
node - "$DIR/correct.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(d.passed!==true||d.score!==100||d.summary?.completed!==1||
   d.summary?.percent!==13||!d.verifiedAt)process.exit(1);
console.log('[TRAINING] Server graded the fixture and wrote a verified completion');
NODE

status_request >"$DIR/after.json"
node - "$DIR/after.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(!d.summary.weeks.find(w=>w.id==='W02')?.verified||d.summary.completed!==1)process.exit(1);
console.log('[TRAINING] Completion read back from persistent progress file');
NODE

kill "$PID" && wait "$PID" 2>/dev/null || true
PID=''
start_server
status_request >"$DIR/restarted.json"
node - "$DIR/restarted.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(d.summary.completed!==1||!d.summary.weeks.find(w=>w.id==='W02')?.verified)process.exit(1);
console.log('[TRAINING] Verified completion survived actual HTTP server restart');
NODE
echo "SUCCESS: isolated real HTTP training smoke passed"
