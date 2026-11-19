#!/usr/bin/env bash
# Local CLI smoke only: never start proxy service, agent, tunnel or listener.
set -Eeuo pipefail
test -x /usr/local/bin/ligolo-proxy
output=/tmp/star-ligolo-help.txt
timeout -k 1s 5s gosu tuser /usr/local/bin/ligolo-proxy -h > "$output" 2>&1
grep -q -- '-laddr' "$output"
grep -q -- '-version' "$output"
node - <<'JS'
const t=require('/app/server/tool-ops').snapshot().tools.find(t=>t.id==='ligolo');
if(!t || !t.installed || t.executable!=='ligolo-proxy' || t.mode!=='root_owned_binary'){
 console.error('Ligolo-ng binary absent from actual server catalog',t);
 process.exit(1);
}
if(t.actions?.includes('version'))throw Error('Ligolo version action unexpectedly enabled');
console.log('[LIGOLO TEST] root-owned proxy CLI detected; no active network actions enabled');
JS
echo "PASS: Ligolo-ng 0.9.2 local CLI help succeeds without starting a listener"
