'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {latestSnapshot,verifySnapshot,MAX_DOWNLOAD_BYTES}=require('../server/backup-export');

test('safe snapshot selection excludes symlinks, unknown names, and missing checksums',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-export-'));
  try{
    assert.equal(latestSnapshot(dir),null);
    const name='star-home-20261118T120000Z-123.tgz';
    const file=path.join(dir,name);
    const content=Buffer.from('verified test-only archive');
    fs.writeFileSync(file,content);
    fs.writeFileSync(file+'.sha256',crypto.createHash('sha256').update(content).digest('hex')+'  '+file+'\n');
    const selected=latestSnapshot(dir);
    assert.equal(selected.name,name);
    assert.equal(await verifySnapshot(selected),true);
    assert.equal(selected.size,content.length);
    // Newest unrelated file or attacker-controlled symlink must never win.
    fs.writeFileSync(path.join(dir,'secret-key.txt'),'do not export');
    fs.symlinkSync(file,path.join(dir,'star-home-20261118T130000Z-999.tgz'));
    assert.equal(latestSnapshot(dir).name,name);
    fs.writeFileSync(file,'tampered');
    assert.equal(await verifySnapshot(latestSnapshot(dir)),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('oversize archives, missing checksum and invalid input cannot be exported',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-export-limit-'));
  try{
    const name='star-home-20261118T123000Z-222.tgz';
    const file=path.join(dir,name);
    fs.writeFileSync(file,'x');
    assert.equal(latestSnapshot(dir),null);
    fs.writeFileSync(file+'.sha256','0'.repeat(64)+'  '+file+'\n');
    assert.ok(latestSnapshot(dir));
    fs.truncateSync(file,MAX_DOWNLOAD_BYTES+1);
    assert.equal(latestSnapshot(dir),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('backup download exists only behind enforced origin authentication',()=>{
  const src=fs.readFileSync(require.resolve('../server/index.js'),'utf8');
  const docker=fs.readFileSync(require.resolve('../Dockerfile'),'utf8');
  assert.match(src,/app\.get\('\/api\/snapshots\/latest'/);
  assert.match(src,/if \(!EDGE\.enforced\) return res\.status\(503\)/);
  assert.match(src,/await verifySnapshot\(snapshot\)/);
  assert.ok(src.indexOf("app.use((req, res, next)")<src.indexOf("app.get('/api/snapshots/latest'"));
  assert.match(docker,/COPY server\/backup-export\.js/);
});
