'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {getCatalog,verifyManifest}=require('../server/tool-installer');
test('all 15 receive explicit install policy and no program is started',()=>{
 const c=getCatalog({root:'/this-path-does-not-exist',snapshot:{tools:[
 'mythic','sliver','havoc','caldera','bloodhound','certipy','impacket','netexec',
 'rubeus','mimikatz','ligolo','frida','ghidra','aflpp','syzkaller'
 ].map(id=>({id,installed:false}))}});
 assert.equal(c.tools.length,15);
 assert.ok(c.tools.every(t=>t.install.requiresApproval&&!t.install.executed));
 assert.equal(c.tools.find(t=>t.id==='rubeus').install.command,null);
 assert.equal(c.tools.find(t=>t.id==='netexec').install.policy,'owner_terminal_approval');
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
