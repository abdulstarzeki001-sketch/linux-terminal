'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const client=require('../server/ai');
const provider=require('../ai-gateway/provider');
const {createGateway,keyMatches}=require('../ai-gateway');

const gatewayToken='integration-test-token-only-'+('x'.repeat(42));
const terminalEnv={
  AI_ENABLED:'1',
  AI_GATEWAY_URL:'http://star-ai-gateway.railway.internal:8081/answer',
  AI_GATEWAY_TOKEN:gatewayToken
};
const aiEnv={AI_API_KEY:'fake-provider-api-key-for-tests',AI_MODEL:'mock-model'};

test('AI is disabled by default and only permits exact Railway private network URLs',async()=>{
  assert.equal(client.isConfigured({}),false);
  assert.equal(client.isConfigured({...terminalEnv,AI_ENABLED:'0'}),false);
  assert.equal(client.isConfigured(terminalEnv),true);
  for(const url of [
    'https://api.openai.com/v1/responses',
    'http://127.0.0.1:8081/answer',
    'http://gateway.example.net/answer',
    'http://star-ai-gateway.railway.internal:8081/private',
    'http://star-ai-gateway.railway.internal:8081/answer?target=evil',
    'http://admin:secret@star-ai-gateway.railway.internal:8081/answer'
  ])assert.equal(client.isConfigured({...terminalEnv,AI_GATEWAY_URL:url}),false,url);
  await assert.rejects(client.askAI('test',{env:{}}),/AI_NOT_CONFIGURED/);
});

test('terminal can call only the private gateway; no direct provider credentials',async()=>{
  let calls=0;
  const fetchFn=async(url,init)=>{
    calls++;
    assert.equal(url,terminalEnv.AI_GATEWAY_URL);
    assert.equal(init.headers['x-star-ai-token'],gatewayToken);
    assert.equal(init.headers.Authorization,undefined);
    assert.deepEqual(JSON.parse(init.body),{prompt:'Explain Bash'});
    return {ok:true,json:async()=>({answer:'هذا شرح Bash'})};
  };
  assert.equal(await client.askAI('Explain Bash',{env:terminalEnv,fetchFn}),'هذا شرح Bash');
  assert.equal(calls,1);
});

test('provider keeps API key exclusively in isolated gateway',async()=>{
  assert.equal(provider.isConfigured(aiEnv),false);
  const env={...aiEnv,AI_ENABLED:'1'};
  assert.equal(provider.isConfigured(env),true);
  let count=0;
  const answer=await provider.askAI('Explain pwd',{env,fetchFn:async(url,init)=>{
    count++;
    assert.equal(url,provider.AI_ENDPOINT);
    assert.equal(init.headers.Authorization,'Bearer '+env.AI_API_KEY);
    const body=JSON.parse(init.body);
    assert.equal(body.input,'Explain pwd');
    assert.equal(body.model,'mock-model');
    assert.equal(body.store,false);
    assert.equal(body.max_output_tokens,650);
    assert.equal(Object.hasOwn(body,'tools'),false);
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Use pwd'}]}]})};
  }});
  assert.equal(answer,'Use pwd');
  assert.equal(count,1);
});

test('oversized or blank input is rejected before either fetch',async()=>{
  let count=0;const fetchFn=async()=>{count++;return {ok:true,json:async()=>({answer:'x'})}};
  for(const input of ['', ' ', 'x'.repeat(client.MAX_PROMPT+1),55]){
    await assert.rejects(client.askAI(input,{env:terminalEnv,fetchFn}),/AI_INVALID_INPUT/);
  }
  assert.equal(count,0);
});

test('private gateway authenticates requests and enforces hourly API budget',async(t)=>{
  const env={...aiEnv,AI_ENABLED:'1',AI_GATEWAY_TOKEN:gatewayToken,AI_MAX_PER_HOUR:'2'};
  let providerCalls=0;
  const service=createGateway({env,fetchFn:async()=>{
    providerCalls++;
    return {ok:true,json:async()=>({output_text:'mock answer'})};
  }});
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>service.close(resolve)));
  const url='http://127.0.0.1:'+service.address().port+'/answer';
  const send=(token)=>fetch(url,{method:'POST',headers:{
    'Content-Type':'application/json','x-star-ai-token':token
  },body:JSON.stringify({prompt:'What is ls?'})});
  assert.equal(keyMatches(gatewayToken,gatewayToken),true);
  assert.equal(keyMatches('wrong',gatewayToken),false);
  const bad=await send('wrong');
  assert.equal(bad.status,401);
  const a=await send(gatewayToken);
  const b=await send(gatewayToken);
  const c=await send(gatewayToken);
  assert.equal(a.status,200);
  assert.equal((await a.json()).answer,'mock answer');
  assert.equal(b.status,200);
  assert.equal(c.status,429);
  assert.equal(providerCalls,2);
});

test('AI WebSocket is gated by existing password auth and never calls PTY.write',()=>{
  const server=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const auth=server.indexOf("if (!authed) {");
  const shell=server.indexOf("if (!term) return;",auth);
  const ai=server.indexOf("if (msg.type === 'ai_chat')",shell);
  const write=server.indexOf("term.write(msg.data)",ai);
  assert.ok(auth>=0&&shell>auth&&ai>shell&&write>ai);
  assert.match(server,/aiRequests >= 25/);
  assert.match(server,/aiAbort\?\.abort\(\)/);
  assert.doesNotMatch(server.slice(ai,write),/term\.write\(/);
  assert.match(server,/aiEnabled:isConfigured\(\)/);
});

test('provider key is absent from terminal process, shell env and browser assets',()=>{
  const server=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const clientSource=readFileSync(join(__dirname,'..','server','ai.js'),'utf8');
  const frontend=readFileSync(join(__dirname,'..','web','app.js'),'utf8');
  const shellEnv=server.slice(server.indexOf('function shellEnv()'),server.indexOf('function send('));
  assert.doesNotMatch(shellEnv,/\b(?:AI_API_KEY|TERMINAL_PASSWORD)\s*:/);
  assert.doesNotMatch(clientSource,/api\.openai\.com|process\.env\.AI_API_KEY/);
  assert.doesNotMatch(frontend,/AI_API_KEY|Bearer |api\.openai\.com/);
  assert.match(frontend,/type:'ai_chat'/);
});
