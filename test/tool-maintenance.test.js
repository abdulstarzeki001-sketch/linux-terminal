'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const maint=require('../server/tool-maintenance');

test('only two reviewed, pinned non-root packages are installable',async()=>{
 assert.deepEqual(maint.CATALOG.map(x=>x.id),['frida','impacket']);
 assert.deepEqual(maint.CATALOG.map(x=>x.version),['14.13.2','0.13.1']);
 for(const p of maint.CATALOG){
  assert.match(p.source,/^https:\/\/pypi\.org\/project\//);
  assert.ok(/^[\w-]+$/.test(p.package));
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-catalog-'));
 try{
  const s=await maint.status({stateFile:path.join(dir,'state.json'),venv:path.join(dir,'venv'),root:dir});
  assert.equal(s.packages.length,2);
  assert.ok(s.packages.every(x=>!x.installed));
  assert.equal(s.installRoot,'persistent_non_root_venv');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rejected installation cannot run arbitrary packages, root or small disks',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-reject-'));
 let calls=0;
 const opts={stateFile:path.join(dir,'state.json'),uid:1001,freeMiB:250,execute:async()=>{calls++;}};
 try{
  assert.equal(maint.start({tool_id:'mythic',confirm:'INSTALL_CURATED_PINNED'},opts).httpStatus,400);
  assert.equal(maint.start({tool_id:'frida',confirm:'yes'},opts).httpStatus,400);
  assert.equal(maint.start({tool_id:'frida',confirm:'INSTALL_CURATED_PINNED'},{...opts,uid:0}).httpStatus,403);
  assert.equal(maint.start({tool_id:'frida',confirm:'INSTALL_CURATED_PINNED'},{...opts,freeMiB:99}).httpStatus,507);
  assert.equal(calls,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('approved installation performs one asynchronous job, persists verified state and blocks overlap',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-allowed-'));
 let release,called=0;
 const gate=new Promise(resolve=>{release=resolve;});
 const opts={stateFile:path.join(dir,'state.json'),uid:1001,freeMiB:250,
  execute:async record=>{called++;assert.equal(record.package,'frida-tools');await gate;}};
 try{
  const a=maint.start({tool_id:'frida',confirm:'INSTALL_CURATED_PINNED'},opts);
  assert.equal(a.httpStatus,202);
  assert.equal(a.job.status,'running');
  assert.equal(maint.start({tool_id:'impacket',confirm:'INSTALL_CURATED_PINNED'},opts).httpStatus,409);
  assert.equal(maint.read(opts.stateFile).job.status,'running');
  release();
  await maint.waitForIdle();
  assert.equal(called,1);
  const disk=maint.read(opts.stateFile);
  assert.equal(disk.job.status,'verified');
  assert.equal(disk.history[0].tool_id,'frida');
  assert.equal(disk.history.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed installations and interrupted container sessions never report verified',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-fail-'));
 const file=path.join(dir,'state.json');
 try{
  const r=maint.start({tool_id:'impacket',confirm:'INSTALL_CURATED_PINNED'},
    {stateFile:file,uid:1001,freeMiB:250,execute:async()=>{throw Error('secret url with token');}});
  assert.equal(r.httpStatus,202);
  await maint.waitForIdle();
  assert.equal(maint.read(file).job.status,'failed');
  assert.equal(maint.read(file).job.errorCode,'INSTALL_FAILED');
  assert.ok(!JSON.stringify(maint.read(file)).includes('secret url'));
  const state=maint.read(file);
  state.job={...state.job,status:'running'};
  fs.writeFileSync(file,JSON.stringify(state));
  const repaired=maint.resolveRecord(file);
  assert.equal(repaired.job.status,'interrupted');
  assert.equal(repaired.job.errorCode,'INSTALL_INTERRUPTED');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('managed wheel installation uses fixed pip args and checks package version and executable',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-installer-exec-'));
 const venv=path.join(dir,'venv');
 const record=maint.CATALOG[0];
 let commands=[];
 const run=async(binary,args,options)=>{
  commands.push({binary,args,options});
  if(binary==='/usr/bin/python3'){
   assert.deepEqual(args,['-m','venv',venv]);
   fs.mkdirSync(path.join(venv,'bin'),{recursive:true});
   fs.writeFileSync(path.join(venv,'bin','python'),'stub',{mode:0o755});
   return {stdout:'',stderr:''};
  }
  if(args[0]==='-m'){
   assert.ok(args.includes('--only-binary=:all:'));
   assert.ok(args.includes('--no-input'));
   assert.ok(args.includes('frida-tools==14.13.2'));
   assert.equal(options.timeout,150000);
   fs.writeFileSync(path.join(venv,'bin','frida'),'stub',{mode:0o755});
   return {stdout:'installed',stderr:''};
  }
  return {stdout:'14.13.2\n',stderr:''};
 };
 try{
  assert.equal(await maint.execute(record,{venv,run}),true);
  assert.equal(commands.length,3);
  assert.equal(commands[1].binary,path.join(venv,'bin','python'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('route checks, Docker deployment and safe runtime path stay present',()=>{
 const src=fs.readFileSync(require.resolve('../server/index.js'),'utf8');
 const docker=fs.readFileSync(require.resolve('../Dockerfile'),'utf8');
 for(const route of ['diagnostics','live-ai','install/status','install/start']){
  assert.ok(src.includes("app.post('/api/tools/"+route+"'"));
 }
 assert.ok(src.indexOf('app.use((req, res, next)')<src.indexOf("app.post('/api/tools/install/start'"));
 assert.match(src,/RUN_ONE_PROVIDER_CHECK/);
 assert.match(src,/INSTALL_CURATED_PINNED/);
 assert.match(docker,/COPY server\/tool-maintenance\.js/);
 assert.match(docker,/COPY server\/tool-diagnostics\.js/);
 const installer=fs.readFileSync(require.resolve('../server/tool-maintenance.js'),'utf8');
 assert.match(installer,/shell:false/);
 assert.doesNotMatch(installer,/npm install|apt-get|shell:true|eval\(/);
});
