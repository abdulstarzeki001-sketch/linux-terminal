'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Syzkaller manager source is pinned, no fuzzing VM or target configured in image',()=>{
 const docker=fs.readFileSync(path.join(__dirname,'..','Dockerfile'),'utf8');
 assert.match(docker,/2006bdcccf565ba62831cd5ed157109e10f843a5/);
 assert.match(docker,/go build -trimpath -o \/out\/syz-manager \.\/syz-manager/);
 assert.match(docker,/COPY --from=syz_builder \/out\/syz-manager \/usr\/local\/bin\/syz-manager/);
 assert.doesNotMatch(docker,/syz-manager\s+-config|qemu-system-|kcov\.init/);
});
test('Production startup only checks existence of syz-manager, never launches fuzzers',()=>{
 const entry=fs.readFileSync(path.join(__dirname,'..','server','entrypoint.sh'),'utf8');
 assert.match(entry,/CLI_ONLY_NO_QEMU/);
 assert.match(entry,/\[\[ -x \/usr\/local\/bin\/syz-manager \]\]/);
 assert.doesNotMatch(entry,/gosu tuser \/usr\/local\/bin\/syz-manager/);
});
