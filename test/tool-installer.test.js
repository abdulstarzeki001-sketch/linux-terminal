'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {getCatalog,verifyManifest,PROFILES}=require('../server/tool-installer');
test('all 15 receive explicit install policy and no program is started',()=>{
 const c=getCatalog({root:'/this-path-does-not-exist',snapshot:{tools:[
 'mythic','sliver','havoc','caldera','bloodhound','certipy','impacket','netexec',
 'rubeus','mimikatz','ligolo','frida','ghidra','aflpp','syzkaller'
 ].map(id=>({id,installed:false}))}});
 assert.equal(c.tools.length,15);
 assert.ok(c.tools.every(t=>t.install.requiresApproval&&!t.install.executed));
 assert.equal(c.tools.find(t=>t.id==='rubeus').install.command,null);
 assert.equal(c.tools.find(t=>t.id==='netexec').install.policy,'manual_review');
 assert.equal(c.tools.find(t=>t.id==='certipy').install.policy,'owner_one_click');
 assert.equal(c.summary.automatedInstallsEnabled,true);
 const compatible=getCatalog({root:'/this-path-does-not-exist',pythonVersion:'3.11.2',
  snapshot:{tools:[{id:'certipy',installed:false},{id:'frida',installed:false}]}});
 assert.equal(compatible.pythonVersion,'3.11.2');
 assert.equal(compatible.tools.find(t=>t.id==='certipy').install.canInstall,false);
 assert.equal(compatible.tools.find(t=>t.id==='certipy').install.blockedReason,'INSTALL_PYTHON_VERSION_UNSUPPORTED');
 assert.equal(compatible.tools.find(t=>t.id==='frida').install.canInstall,true);

 assert.equal(Object.keys(PROFILES).length,15);
 assert.deepEqual([...c.summary.approvedTools].sort(),['aflpp','certipy','frida','impacket']);
 assert.ok(c.tools.every(t=>Array.isArray(t.install.requirements)&&t.install.requirements.length));
 assert.ok(c.tools.every(t=>typeof t.install.target==='string' && typeof t.install.readiness==='string'));
 assert.equal(c.tools.find(t=>t.id==='aflpp').install.policy,'owner_one_click');
 assert.equal(c.tools.find(t=>t.id==='mimikatz').install.readiness,'incompatible_railway_linux');
 assert.equal(c.tools.find(t=>t.id==='syzkaller').install.target,'dedicated_kernel_vm');
 assert.equal(c.tools.find(t=>t.id==='bloodhound').install.target,'dedicated_container_stack');
});
test('persistent APT inventory is read, filtered, and never interpreted as shell',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-'));
 try {
  fs.mkdirSync(path.join(root,'state'));
  fs.mkdirSync(path.join(root,'home','tuser'),{recursive:true});
  fs.writeFileSync(path.join(root,'state','initialized'),'');
  fs.writeFileSync(path.join(root,'state','apt-manual.txt'),'nmap\nfoo;touch /tmp/nope\nfrida-tools\n');
  fs.writeFileSync(path.join(root,'state','restore-status.txt'),'2026-11-18T00:00:00Z ready\n');
  const s=verifyManifest(root);
  assert.equal(s.initialized,true);
  assert.deepEqual(s.aptSaved,['nmap','frida-tools']);
  assert.match(s.restoration,/ready/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('installer API remains behind the same Railway private origin guard',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','server','index.js'),'utf8');
 assert.match(src,/app\.post\('\/api\/tools\/install\/catalog'/);
 assert.match(src,/if\(!EDGE\.enforced\)return res\.status\(503\)/);
 assert.doesNotMatch(src,/app\.post\('\/api\/tools\/install\/run'/);
});
