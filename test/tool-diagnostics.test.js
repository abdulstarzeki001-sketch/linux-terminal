'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const d=require('../server/tool-diagnostics');

test('live diagnostic reflects actual service checks, not invented model status',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-diagnostics-'));
 try{
  const first=await d.snapshot({
   root:dir,home:dir,
   kaliFn:async()=>({ready:true,code:'KALI_READY'}),
   aiFn:async()=>({ready:true,reason:'GATEWAY_READY'})
  });
  assert.equal(first.source,'railway_live_diagnostics');
  assert.equal(first.persistence.ready,true);
  assert.equal(first.kali.ready,true);
  assert.equal(first.aiGateway.ready,true);
  assert.equal(first.aiGateway.liveProviderVerified,false);
  assert.equal(first.access.code,'PRIVATE_ORIGIN_AUTH_PASSED');
  const failed=await d.snapshot({root:dir,home:dir,
   kaliFn:async()=>({ready:false,code:'KALI_UNREACHABLE'}),
   aiFn:async()=>({ready:false,reason:'GATEWAY_UNREACHABLE'})
  });
  assert.equal(failed.kali.ready,false);
  assert.equal(failed.aiGateway.ready,false);
  assert.equal(failed.aiGateway.code,'GATEWAY_UNREACHABLE');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('opt-in live AI probe uses at most one model request and persists a 15-minute cooldown',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-live-ai-'));
 const marker=path.join(dir,'probe.json');
 let calls=0;
 try{
  const a=await d.liveAI({
   marker,aiFn:async()=>({ready:true,reason:'GATEWAY_READY'}),
   askFn:async prompt=>{calls++;assert.match(prompt,/READY/);return 'READY';}
  });
  assert.equal(a.httpStatus,200);
  assert.equal(a.code,'AI_INFERENCE_SUCCESS');
  assert.equal(a.ready,true);
  assert.equal(a.responseStored,false);
  const b=await d.liveAI({
   marker,aiFn:async()=>({ready:true}),askFn:async()=>{calls++;return 'READY';}
  });
  assert.equal(b.httpStatus,429);
  assert.equal(b.code,'AI_PROBE_COOLDOWN');
  assert.equal(calls,1);
  assert.equal(d.readMarker(marker).lastStatus,'AI_INFERENCE_SUCCESS');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed gateway never triggers paid inference and never discloses provider errors',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-live-ai-fail-'));
 let invoked=0;
 try{
  const first=await d.liveAI({marker:path.join(dir,'probe.json'),
   aiFn:async()=>({ready:false,reason:'GATEWAY_UNREACHABLE'}),
   askFn:async()=>{invoked++;throw Error('private-token');}
  });
  assert.equal(first.httpStatus,200);
  assert.equal(first.ready,false);
  assert.equal(first.code,'GATEWAY_UNREACHABLE');
  assert.equal(invoked,0);
  const second=await d.liveAI({marker:path.join(dir,'second.json'),
   aiFn:async()=>({ready:true,reason:'GATEWAY_READY'}),
   askFn:async()=>{throw Error('private-token');}
  });
  assert.equal(second.httpStatus,200);
  assert.equal(second.code,'UNKNOWN_ERROR');
  assert.ok(!JSON.stringify(second).includes('private-token'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Kali loopback probe is HTTP GET and respects real backend readiness',async()=>{
 let request,options;
 const result=await d.kaliHealth(async(u,opts)=>{
  request=u;options=opts;
  return {ok:true,json:async()=>({status:'ok'})};
 });
 assert.equal(result.ready,true);
 assert.equal(result.code,'KALI_READY');
 assert.equal(request,'http://127.0.0.1:8000/api/v1/health');
 assert.equal(options.method,'GET');
});
