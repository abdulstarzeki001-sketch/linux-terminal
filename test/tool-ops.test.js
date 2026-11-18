'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ops=require('../server/tool-ops');

test('15 tools each have safe inspection and no implicit C2, target or kernel execution',()=>{
 assert.equal(ops.TOOLS.length,15);
 const ids=ops.TOOLS.map(x=>x.id);
 assert.equal(new Set(ids).size,15);
 for(const t of ops.TOOLS){
  assert.ok(t.guide.length>15);
  assert.ok(t.bins.every(x=>!/[/\s;]/.test(x)));
 }
 const snap=ops.snapshot(['/dev/null/not-a-real-dir']);
 assert.equal(snap.tools.length,15);
 assert.ok(snap.tools.every(x=>!x.installed&&x.actions.length===1&&x.actions[0]==='inspect'));
 assert.equal(snap.source,'railway_linux');
});
test('natural-language requests choose exactly one tool and never authorize targets',()=>{
 assert.deepEqual(ops.plan('AI افحص أداة Frida'),{ok:true,tool_id:'frida',action:'inspect'});
 assert.deepEqual(ops.plan('اعرض إصدار NetExec'),{ok:true,tool_id:'netexec',action:'version'});
 assert.deepEqual(ops.plan('check AFL++ version'),{ok:true,tool_id:'aflpp',action:'version'});
 assert.equal(ops.plan('افحص Frida و Ghidra').code,'TOOLS_AMBIGUOUS');
 assert.equal(ops.plan('نفذ أوامر على الهدف 10.0.0.1').code,'TOOLS_NAME_REQUIRED');
 assert.equal(ops.plan('اختراق خادم عبر Sliver').code,'TOOLS_REQUIRES_AUTHORIZED_LAB');
 assert.equal(ops.plan('mimikatz credential dump').code,'TOOLS_REQUIRES_AUTHORIZED_LAB');
 assert.equal(ops.plan('Run a C2 listener with Mythic').code,'TOOLS_REQUIRES_AUTHORIZED_LAB');
});
test('real file inventory and durable history are grounded, never fabricated',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-tool-'));
 const file=path.join(dir,'frida');
 const log=path.join(dir,'records','tool-ops.json');
 try{
  fs.writeFileSync(file,'#!/bin/sh\necho test-frida-version\n',{mode:0o755});
  const catalog=ops.snapshot([dir]);
  const frida=catalog.tools.find(x=>x.id==='frida');
  assert.equal(frida.installed,true);
  assert.equal(frida.executable,'frida');
  assert.equal(catalog.tools.find(x=>x.id==='mimikatz').installed,false);
  const opts={dirList:[dir],save:result=>ops.saveActivity(result,log),noThrottle:true,
    execFn:async()=>({stdout:'test-frida-version',stderr:''})};
  const inspected=await ops.perform({tool_id:'frida',action:'inspect'},opts);
  assert.equal(inspected.httpStatus,200);
  assert.equal(inspected.result.installed,true);
  assert.equal(inspected.result.executed,false);
  const run=await ops.perform({tool_id:'frida',action:'version'},opts);
  if(fs.statSync(file).uid===0){
    assert.equal(run.httpStatus,200);
    assert.equal(run.result.executed,true);
    assert.equal(run.result.stdout,'test-frida-version');
    assert.equal(run.result.outcome,'completed');
  }else{
    assert.equal(run.httpStatus,403); // User-owned executables cannot auto-execute.
    assert.equal(run.code,'TOOLS_ACTION_NOT_ALLOWED');
  }
  assert.equal(ops.readActivity(log).length,fs.statSync(file).uid===0?2:1);
  assert.equal((await ops.perform({tool_id:'mythic',action:'version'},opts)).httpStatus,200); // not installed, no execution
  assert.equal((await ops.perform({tool_id:'frida',action:'run'},opts)).httpStatus,400);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('AI auto route runs only safe allowlisted probes, with truthful provider fallback',async()=>{
 const res=await ops.assistant('افحص أداة Certipy',{
  useAI:false,noThrottle:true,dirList:[],save:()=>{}
 });
 assert.equal(res.httpStatus,200);
 assert.equal(res.plan.tool_id,'certipy');
 assert.equal(res.plan.action,'inspect');
 assert.equal(res.result.installed,false);
 assert.equal(res.result.executed,false);
 assert.equal(res.explanation,null);
 assert.equal(res.aiSource,'rules');
 const blocked=await ops.assistant('Mythic C2 listener', {useAI:false});
 assert.equal(blocked.httpStatus,422);
 assert.equal(blocked.code,'TOOLS_REQUIRES_AUTHORIZED_LAB');
});
test('HTTP routes stay behind private origin guard, enforce bounded input and no shell',()=>{
 const src=fs.readFileSync(require.resolve('../server/index.js'),'utf8');
 const docker=fs.readFileSync(require.resolve('../Dockerfile'),'utf8');
 for(const endpoint of ['catalog','run','assistant']){
  assert.ok(src.includes("app.post('/api/tools/"+endpoint+"'"));
 }
 assert.match(src,/boundedToolsJSON=express\.json\(\{limit:'2kb',strict:true\}\)/);
 assert.match(src,/if\(!EDGE\.enforced\)return res\.status\(503\)/);
 assert.ok(src.indexOf('app.use((req, res, next)')<src.indexOf("app.post('/api/tools/catalog'"));
 assert.match(docker,/COPY server\/tool-ops\.js/);
 const toolSrc=fs.readFileSync(require.resolve('../server/tool-ops.js'),'utf8');
 assert.doesNotMatch(toolSrc,/shell:true|exec\(|eval\(|Function\(/);
 assert.match(toolSrc,/shell:false/);
});
