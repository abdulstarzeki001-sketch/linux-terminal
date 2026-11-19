#!/usr/bin/env bash
# Verify the pinned syz-manager CLI, not fuzzing or any kernel VM.
set -Eeuo pipefail
test -x /usr/local/bin/syz-manager
set +e
timeout -k 1s 6s gosu tuser /usr/local/bin/syz-manager -h > /tmp/star-syz-help.log 2>&1
rc=$?
set -e
test "$rc" != 124 && test "$rc" != 137 && test "$rc" != 139
grep -Eqi 'Usage|flag|config' /tmp/star-syz-help.log
node - <<'JS'
const t=require('/app/server/tool-ops').snapshot().tools.find(t=>t.id==='syzkaller');
if(!t?.installed || t.executable!=='syz-manager' || t.mode!=='root_owned_binary'){
 console.error('syz-manager not installed in actual Railway catalog',t);
 process.exit(1);
}
if(t.actions?.includes('version'))throw Error('Kernel fuzzing manager must remain inventory only');
console.log('[SYZKALLER TEST] safe local syz-manager CLI exists; no VM or fuzzing configured');
JS
echo "PASS: Syzkaller manager binary installed; full fuzzing still requires private QEMU/KCOV lab"
