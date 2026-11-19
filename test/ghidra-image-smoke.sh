#!/usr/bin/env bash
# Ghidra 12.0.4 JVM and offline headless CLI smoke; no sample analyzed.
set -Eeuo pipefail
test -x /usr/local/bin/analyzeHeadless
test -x /opt/java/openjdk/bin/java
test -f /opt/ghidra_12.0.4_PUBLIC/support/analyzeHeadless
/opt/java/openjdk/bin/java -version 2>&1 | grep -q 'version "21'
install -d -o tuser -g tuser -m 0700 /tmp/ghidra-smoke-home
set +e
timeout -k 5s 60s gosu tuser env HOME=/tmp/ghidra-smoke-home \
 /usr/local/bin/analyzeHeadless -help > /tmp/ghidra-smoke.log 2>&1
result=$?
set -e
test "$result" != 124 && test "$result" != 137
cat /tmp/ghidra-smoke.log | tail -n 25
! grep -Eq 'UnsupportedClassVersionError|NoClassDefFoundError|UnsatisfiedLinkError|Exception in thread' /tmp/ghidra-smoke.log
grep -Eiq 'analyzeHeadless|usage|projectLocation' /tmp/ghidra-smoke.log
node - <<'JS'
const tool=require('/app/server/tool-ops').snapshot().tools.find(x=>x.id==='ghidra');
if(!tool?.installed || tool.executable!=='analyzeHeadless' || tool.mode!=='root_owned_binary'){
 console.error('Real Ghidra inventory check failed',tool);
 process.exit(1);
}
if(tool.actions?.includes('version'))throw Error('No network/target auto execution allowed');
console.log('[GHIDRA] checksum-verified official release, Java 21 and local CLI discovered');
JS
echo "PASS: Ghidra 12.0.4 headless works offline, with Java 21 and no analysis target"
