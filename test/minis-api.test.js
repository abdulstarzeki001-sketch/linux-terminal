'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createMinisHandler,normalizePrompt}=require('../ai-gateway/minis');
const KEY='strong-minis-key-for-testing-0123456789';
async function harness(action,{conf=true,answer='Hello from STAR AI',envExtra={}}={}){
  const handler=createMinisHandler({env:{STAR_MINIS_API_KEY:KEY,...envExtra},configured:()=>conf,ask:async()=>answer});
  const server=http.createServer(handler);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{return await action('http://127.0.0.1:'+server.address().port,KEY);}
  finally{await new Promise(ok=>server.close(ok));}
}
function auth(key){return {Authorization:'Bearer '+key};}
test('model list requires token',async()=>{
  await harness(async(url,key)=>{
    const r=await fetch(url+'/v1/models',{headers:auth(key)});
    assert.equal(r.status,200);
    assert.equal((await r.json()).data[0].id,'star-ai');
    assert.equal((await fetch(url+'/v1/models')).status,401);
  });
});
test('unconfigured backend returns 503',async()=>{
  await harness(async(url,key)=>assert.equal((await fetch(url+'/v1/models',{headers:auth(key)})).status,503),{conf:false});
});
test('chat completions include assistant content',async()=>{
  await harness(async(url,key)=>{
    const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{...auth(key),'Content-Type':'application/json'},body:JSON.stringify({model:'star-ai',messages:[{role:'user',content:'hello'}]})});
    assert.equal(r.status,200);
    assert.equal((await r.json()).choices[0].message.content,'Hello from STAR AI');
  });
});
test('SSE streaming format ends with DONE',async()=>{
  await harness(async(url,key)=>{
    const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{...auth(key),'Content-Type':'application/json'},body:JSON.stringify({model:'star-ai',stream:true,messages:[{role:'user',content:'hello'}]})});
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-type'),/event-stream/);
    assert.match(await r.text(),/\[DONE\]/);
  });
});
test('unsupported model and message formats fail safely',async()=>{
  await harness(async(url,key)=>{
    for (const body of [
      {model:'wrong-model',messages:[{role:'user',content:'hello'}]},
      {model:'star-ai',messages:[{role:'user',content:'a'.repeat(5000)}]},
      {model:'star-ai',messages:[{role:'tool',content:'x'}]}
    ]){
      const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{...auth(key),'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(r.status,400);
    }
  });
});
test('weak key is refused',async()=>{
  await harness(async(url)=>assert.equal((await fetch(url+'/v1/models',{headers:auth('short')})).status,401));
});
test('normalization requires user text',()=>{
  assert.equal(normalizePrompt([]),null);
  assert.match(normalizePrompt([{role:'user',content:'hi'}]),/USER: hi/);
});
