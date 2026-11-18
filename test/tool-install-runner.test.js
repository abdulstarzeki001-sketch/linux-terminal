'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {APPROVAL,PACKAGES,APPROVED_IDS,MIN_FREE_BYTES,MIN_ROOT_FREE_BYTES,startInstall,readJobs}=require('../server/tool-install-runner');
test('installer refuses arbitrary shell strings, unapproved tools and missing owner approval',()=>{
 assert.equal(startInstall({tool_id:'frida'}).httpStatus,400);
 assert.equal(startInstall({tool_id:'mythic',approval:APPROVAL}).httpStatus,403);
 assert.equal(startInstall({tool_id:'frida',approval:APPROVAL,command:'curl evil'}).httpStatus,400);
 assert.equal(startInstall({tool_id:'frida;echo hacked',approval:APPROVAL}).httpStatus,403);
 assert.deepEqual(Object.keys(PACKAGES).sort(),['certipy','frida','impacket']);
});
test('installer checks persistent disk before allowing any child process',()=>{
 let invoked=false;
 const r=startInstall({tool_id:'frida',approval:APPROVAL},{home:'/definitely/missing',spawnFn:()=>{invoked=true;throw Error('should not run');}});
 assert.equal(r.httpStatus,503);
 assert.equal(invoked,false);
 assert.ok(MIN_FREE_BYTES>=200*1024*1024);
});
test('approved install uses fixed non-shell pinned pip invocation and writes durable outcome',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'star-allowlisted-'));
 const home=path.join(root,'home','tuser');
 fs.mkdirSync(home,{recursive:true});
 const stateFile=path.join(home,'.config','wormstar','owner-installs.json');
 let invoked=null;
 const stream=()=>new EventEmitter();
 const spawnFn=(binary,args,opts)=>{
  invoked={binary,args,opts};
  const child=new EventEmitter();
  child.stdout=stream();child.stderr=stream();
  process.nextTick(()=>{
   child.stdout.emit('data',Buffer.from('Successfully installed approved test wheel'));
   child.emit('close',0);
  });
  return child;
 };
 try{
  const opts={root,home,python:'/usr/bin/env',stateFile,freeBytes:MIN_FREE_BYTES+1,spawnFn,noThrottle:true};
  const start=startInstall({tool_id:'impacket',approval:APPROVAL},opts);
  assert.equal(start.httpStatus,202);
  assert.equal(invoked.binary,'/usr/bin/env');
  assert.equal(invoked.opts.shell,false);
  assert.equal(invoked.opts.stdio[0],'ignore');
  assert.ok(invoked.args.includes('impacket==0.13.1'));
  assert.ok(!invoked.args.some(x=>x.includes(';')||x==='-c'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(readJobs(opts).impacket.status,'succeeded');
  assert.match(readJobs(opts).impacket.output,/Successfully installed/);
  assert.equal(fs.statSync(stateFile).mode&0o777,0o600);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('HTTP installer never lacks private origin guard',()=>{
 const code=fs.readFileSync(path.join(__dirname,'..','server','index.js'),'utf8');
 assert.match(code,/app\.post\('\/api\/tools\/install\/execute',boundedToolsJSON/);
 assert.match(code,/if\(!EDGE\.enforced\)return res\.status\(503\)/);
});

test('all four approved installers are explicit, AFL++ uses only signed Debian APT helper',async()=>{
 assert.deepEqual([...APPROVED_IDS].sort(),['aflpp','certipy','frida','impacket']);
 assert.equal(startInstall({tool_id:'sliver',approval:APPROVAL}).httpStatus,403);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'star-afl-'));
 const home=path.join(root,'home','tuser');
 fs.mkdirSync(home,{recursive:true});
 const events=[];
 const spawnFn=(bin,args,opts)=>{
  events.push({bin,args,opts});
  const child=new EventEmitter();
  child.stdout=new EventEmitter();
  child.stderr=new EventEmitter();
  process.nextTick(()=>{child.stdout.emit('data','AFL++ installed');child.emit('close',0);});
  return child;
 };
 try{
  const config={home,root,python:'/usr/bin/env',stateFile:path.join(home,'jobs.json'),
   freeBytes:MIN_FREE_BYTES+1,rootFreeBytes:MIN_ROOT_FREE_BYTES+1,
   aptScript:'/usr/bin/env',sudoPath:'/usr/bin/sudo',spawnFn,noThrottle:true};
  assert.equal(startInstall({tool_id:'aflpp',approval:APPROVAL},{...config,rootFreeBytes:1}).code,'INSTALL_ROOT_DISK_SPACE_LOW');
  const result=startInstall({tool_id:'aflpp',approval:APPROVAL},config);
  assert.equal(result.httpStatus,202);
  assert.equal(events.length,1);
  assert.equal(events[0].bin,'/usr/bin/sudo');
  assert.deepEqual(events[0].args,['-n','/usr/bin/env']);
  assert.equal(events[0].opts.shell,false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(readJobs(config).aflpp.status,'succeeded');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('AFL++ script is immutable in image and never accepts user package names',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','server','install-approved-afl.sh'),'utf8');
 assert.match(source,/\[\[ \$# -eq 0/);
 assert.match(source,/apt-get install -y --no-install-recommends afl\+\+/);
 assert.match(source,/wormstar-apt-track/);
 const docker=fs.readFileSync(path.join(__dirname,'..','Dockerfile'),'utf8');
 assert.match(docker,/COPY server\/install-approved-afl\.sh/);
});
