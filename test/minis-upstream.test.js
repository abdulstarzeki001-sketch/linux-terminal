'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {classifyUpstreamError,completeForMinis}=require('../ai-gateway/minis-provider');
const {createMinisHandler}=require('../ai-gateway/minis');

const ENV={AI_ENABLED:'1',AI_API_KEY:'unit-test-openai-not-real-key',AI_MODEL:'gpt-4.1'};
const REQUEST={model:'star-ai',messages:[{role:'user',content:'diagnose model'}]};
const fake=(status,code)=>({status,ok:false,json:async()=>({error:{code,message:'RAW PRIVATE ERROR: secret information should never appear'}})});
const check=(status,code,expect)=>test('OpenAI upstream HTTP '+status+' is '+expect,async()=>{
 await assert.rejects(
   completeForMinis(REQUEST,{env:ENV,fetchFn:async()=>fake(status,code)}),
   e=>e?.message===expect
 );
});
check(401,'invalid_api_key','AI_AUTH_FAILED');
check(402,'billing_required','AI_BILLING_REQUIRED');
check(429,'insufficient_quota','AI_QUOTA_EXCEEDED');
check(429,'rate_limit_exceeded','AI_RATE_LIMIT');
check(404,'model_not_found','AI_MODEL_ERROR');
check(400,'invalid_request_error','AI_REQUEST_REJECTED');
check(503,'server_error','AI_UPSTREAM_ERROR');

test('error classification never uses raw upstream message',async()=>{
 const r=await classifyUpstreamError(fake(400,'invalid_request_error'));
 assert.equal(r,'AI_REQUEST_REJECTED');
 assert.equal(r.includes('PRIVATE'),false);
});
test('successful upstream response remains compatible',async()=>{
 const data={output:[{type:'message',content:[{type:'output_text',text:'STAR AI ready'}]}]};
 const answer=await completeForMinis(REQUEST,{env:ENV,fetchFn:async()=>({status:200,ok:true,json:async()=>data})});
 assert.equal(answer.message.content,'STAR AI ready');
});
test('Minis caller receives actionable status and no upstream raw error',async()=>{
 const secret='this-must-not-appear-on-client';
 const token='unit-test-minis-key-abcdefghijklmnopqrstuvwxyz';
 const server=http.createServer(createMinisHandler({
  env:{STAR_MINIS_API_KEY:token},configured:()=>true,
  complete:async()=>{throw Error('AI_AUTH_FAILED')}
 }));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(REQUEST)
  });
  assert.equal(response.status,503);
  const body=await response.text();
  assert.match(body,/AI_AUTH_FAILED/);
  assert.doesNotMatch(body,/this-must-not-appear-on-client/);
 }finally{await new Promise(done=>server.close(done));}
});
