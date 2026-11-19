#!/usr/bin/env bash
# No credentials or network targets. Verify installed package and actual local CLI.
set -Eeuo pipefail
test -x /opt/netexec312/bin/python
test -x /opt/netexec312/bin/nxc
gosu tuser /opt/netexec312/bin/python - <<'PY'
import importlib.metadata as m
import sys
assert sys.version_info[:2] == (3,12)
assert m.version('netexec').startswith('1.5.1')
assert m.version('dploot') == '3.1.2'
print('[NETEXEC] pinned release 1.5.1 and constrained dependency verified')
PY
mkdir -p /tmp/star-nxc-owner
chown tuser:tuser /tmp/star-nxc-owner
# nxc may exit non-zero for its special version command. The full output
# must contain the release and must not show a Python traceback.
timeout 15s gosu tuser env HOME=/tmp/star-nxc-owner \
  /opt/netexec312/bin/nxc --version >/tmp/star-nxc.out 2>&1 || result=$?
test "${result:-0}" != 124
cat /tmp/star-nxc.out
! grep -Eq 'Traceback|ModuleNotFoundError|ImportError|PermissionError|OperationalError' /tmp/star-nxc.out
grep -Eiq '1[.]5[.]1|NetExec' /tmp/star-nxc.out

node - <<'JS'
const t=require('/app/server/tool-ops').snapshot().tools.find(t=>t.id==='netexec');
if(!t || !t.installed || t.executable!=='nxc' || t.mode!=='root_owned_binary'){
  console.error('NetExec is not recognized in real Railway inventory',t);
  process.exit(1);
}
console.log('[NETEXEC] executable nxc discovered and root-owned');
JS
echo "PASS: NetExec 1.5.1 installed and CLI works without a network target"
