#!/usr/bin/env bash
# Safe image-only Certipy installation proof. No targets, credentials or network scans.
set -Eeuo pipefail
BIN=/opt/certipy-ad312/bin/certipy
PY=/opt/certipy-ad312/bin/python
test -x "$BIN"
test -x "$PY"

# Verify executable, package metadata, Python runtime and CLI under the unprivileged user.
gosu tuser "$PY" - <<'PY'
import importlib.metadata as metadata
import pathlib
import sys
assert sys.version_info[:2] == (3, 12), sys.version
assert metadata.version('certipy-ad') == '5.1.0'
assert pathlib.Path('/opt/certipy-ad312/bin/certipy').is_file()
print('[CERTIPY TEST] certipy-ad==5.1.0 on Python 3.12 verified')
PY
gosu tuser "$BIN" -h > /dev/null

# Browser-facing owner catalog must detect it as installed, not merely planned.
node - <<'JS'
const {snapshot} = require('/app/server/tool-ops');
const tool = snapshot().tools.find(x => x.id === 'certipy');
if (!tool || !tool.installed || !['certipy','certipy-ad'].includes(tool.executable) || !tool.versionAllowed) {
  console.error('Certipy executable missing from live tool inventory:',tool);
  process.exit(1);
}
console.log('[CERTIPY TEST] 15-tool catalog detects verified executable:',tool.executable);
JS
echo "SUCCESS: Certipy 5.1.0 installed in Docker image, executable discovered and CLI healthy"
