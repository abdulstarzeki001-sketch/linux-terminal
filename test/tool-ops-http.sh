#!/usr/bin/env bash
set -Eeuo pipefail
export PORT=18081
export TERMINAL_EDGE_MODE=enforce
export TERMINAL_EDGE_ORIGIN_SECRET='ci-only-tool-origin-secret-0123456789abcdef'
export TERMINAL_PASSWORD='ci-only-terminal-password-0123456789'
export AI_ENABLED=0
DIR="$(mktemp -d)"
export STAR_TOOLS_LOG_PATH="$DIR/tools-activity.json"
BASE="http://127.0.0.1:$PORT"
PID=''
cleanup(){
 [[ -z "$PID" ]] || { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
 rm -rf "$DIR"
}
trap cleanup EXIT
post(){
 local route="$1" body="$2"
 curl -fsS --max-time 10 -X POST \
  -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
  -H 'Content-Type: application/json' -d "$body" "$BASE/api/tools/$route"
}
start_server(){
 node /app/server/index.js >"$DIR/server.log" 2>&1 &
 PID=$!
 for _ in $(seq 1 50); do
   if curl -fsS --max-time 1 "$BASE/health" >/dev/null 2>&1; then return; fi
   if ! kill -0 "$PID" 2>/dev/null; then cat "$DIR/server.log";exit 1;fi
   sleep 0.2
 done
 cat "$DIR/server.log";echo "Tools HTTP server failed" >&2;exit 1
}
start_server
blocked="$(curl --silent --show-error --max-time 10 -X POST -o /dev/null -w '%{http_code}' "$BASE/api/tools/catalog")"
[[ "$blocked" == 403 ]] || { echo "Expected 403 for direct catalog, got $blocked" >&2;exit 1; }
post catalog '{}' > "$DIR/catalog.json"
node - "$DIR/catalog.json" <<'NODE'
const s=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(s.tools?.length!==15||s.source!=='railway_linux')process.exit(1);
if(s.tools.some(x=>typeof x.installed!=='boolean'))process.exit(1);
console.log('[TOOLS] All 15 tool install statuses returned by live Railway HTTP');
NODE
post run '{"tool_id":"frida","action":"inspect"}' > "$DIR/inspect.json"
node - "$DIR/inspect.json" <<'NODE'
const r=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8')).result;
if(!r||r.tool_id!=='frida'||r.action!=='inspect'||r.executed!==false)process.exit(1);
console.log('[TOOLS] Real binary inventory:',r.outcome,'installed=',r.installed);
NODE
sleep 0.4
post assistant '{"prompt":"AI افحص أداة NetExec"}' > "$DIR/ai.json"
node - "$DIR/ai.json" <<'NODE'
const r=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(!r.result||r.plan?.tool_id!=='netexec'||r.plan?.action!=='inspect'||
   r.result.executed!==false||r.aiSource!=='rules')process.exit(1);
console.log('[TOOLS] Natural-language owner request invoked an allowed local probe');
NODE
unsafe="$(curl --silent --show-error --max-time 10 -X POST -o /dev/null -w '%{http_code}' \
 -H "X-Star-Edge-Origin: $TERMINAL_EDGE_ORIGIN_SECRET" \
 -H 'Content-Type: application/json' \
 -d '{"tool_id":"frida","action":"shell","command":"id"}' "$BASE/api/tools/run")"
[[ "$unsafe" == 400 ]] || { echo "Arbitrary shell was not rejected: HTTP $unsafe" >&2;exit 1; }
kill "$PID" && wait "$PID" 2>/dev/null || true
PID=''
start_server
post catalog '{}' > "$DIR/restarted.json"
node - "$DIR/restarted.json" <<'NODE'
const s=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if(s.history?.length<2||!s.history.some(x=>x.tool_id==='frida')||!s.history.some(x=>x.tool_id==='netexec'))process.exit(1);
console.log('[TOOLS] Real results persisted after actual terminal server restart');
NODE
echo "SUCCESS: real origin-gated tools catalog, AI dispatch, output and persistence"
