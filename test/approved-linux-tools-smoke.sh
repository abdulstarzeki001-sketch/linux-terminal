#!/usr/bin/env bash
# Read-only proof: actual installed files, versions, CLI and Railway inventory.
# Never probe a network host, attach devices or launch a fuzzing session.
set -Eeuo pipefail
set -o pipefail

IMPACKET_PY=/opt/impacket312/bin/python
FRIDA_PY=/opt/frida312/bin/python

test -x "$IMPACKET_PY"
test -x /opt/impacket312/bin/impacket-lookupsid
test -x "$FRIDA_PY"
test -x /opt/frida312/bin/frida
test -x /usr/bin/afl-fuzz

gosu tuser "$IMPACKET_PY" - <<'PY'
import importlib.metadata as m
import sys
assert sys.version_info[:2] == (3,12)
assert m.version('impacket') == '0.13.1'
print("[TOOLS] Impacket 0.13.1 verified in Python 3.12")
PY

gosu tuser "$FRIDA_PY" - <<'PY'
import importlib.metadata as m
import sys
assert sys.version_info[:2] == (3,12)
assert m.version('frida-tools') == '14.13.2'
print("[TOOLS] Frida Tools 14.13.2 verified in Python 3.12")
PY

gosu tuser /opt/impacket312/bin/impacket-lookupsid -h >/dev/null
gosu tuser /opt/frida312/bin/frida --version >/dev/null
dpkg-query -W -f='${Status}' 'afl++' | grep -qx 'install ok installed'

node - <<'JS'
const {snapshot}=require('/app/server/tool-ops');
const list=snapshot().tools;
const required={
  certipy:'certipy',
  impacket:'impacket-lookupsid',
  frida:'frida',
  aflpp:'afl-fuzz',
  netexec:'nxc',
  ligolo:'ligolo-proxy'
};
if(list.length!==15)throw Error('Expected original catalog of 15 tools');
for (const [id,executable] of Object.entries(required)) {
  const t=list.find(x=>x.id===id);
  if(!t?.installed||t.executable!==executable||(id!=='ligolo'&&!t.versionAllowed)||t.mode!=='root_owned_binary'){
    throw Error('Missing or untrusted CLI '+id+': '+JSON.stringify(t));
  }
  console.log('[INVENTORY] '+id+' installed, executable='+executable);
}
const installed=list.filter(t=>t.installed);
if(installed.length!==6)throw Error('Unexpected installed tool count: '+installed.length);
console.log('[INVENTORY] 6/15 real tools installed');
JS
echo "PASS: pinned NetExec, Certipy, Impacket, Frida and AFL++ binaries and catalog verified"
