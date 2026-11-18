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


test('production Docker image includes every required AI module, and gateway remains isolated',()=>{
  const docker=readFileSync(join(__dirname,'..','Dockerfile'),'utf8');
  const terminal=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const gatewayDocker=readFileSync(join(__dirname,'..','ai-gateway','Dockerfile'),'utf8');
  assert.match(terminal,/require\('\.\/ai'\)/);
  assert.match(docker,/COPY server\/index\.js \.\//);
  assert.match(docker,/COPY server\/edge-guard\.js \.\//);
  assert.match(docker,/COPY server\/ai\.js \.\//);
  assert.doesNotMatch(docker,/COPY ai-gateway\/provider\.js|ENV\s+AI_API_KEY=/);
  assert.match(gatewayDocker,/COPY ai-gateway\/index\.js ai-gateway\/provider\.js/);
  assert.doesNotMatch(gatewayDocker,/COPY server\/index\.js|TERMINAL_PASSWORD/);
});


test('authenticated AI connection probe checks only private gateway health',async()=>{
  let observedURL='',options;
  const result=await client.checkAIStatus({env:terminalEnv,fetchFn:async(url,opts)=>{
    observedURL=url;options=opts;return {ok:true,json:async()=>({ok:true,aiConfigured:true})};
  }});
  assert.equal(observedURL,'http://star-ai-gateway.railway.internal:8081/health');
  assert.equal(options.method,'GET');
  assert.equal(options.headers,undefined);
  assert.deepEqual(result,{ready:true,reason:'GATEWAY_READY'});
  assert.deepEqual(await client.checkAIStatus({env:{}}),{
    ready:false,reason:'TERMINAL_NOT_CONFIGURED'
  });
  assert.deepEqual(await client.checkAIStatus({env:terminalEnv,fetchFn:async()=>({
    ok:true,json:async()=>({ok:true,aiConfigured:false})
  })}),{ready:false,reason:'GATEWAY_NOT_CONFIGURED'});
  assert.deepEqual(await client.checkAIStatus({env:terminalEnv,fetchFn:async()=>{throw Error('offline')}}),{
    ready:false,reason:'GATEWAY_UNREACHABLE'
  });
});

test('gateway token mismatches are distinct from OpenAI account failures',async()=>{
  await assert.rejects(client.askAI('hello',{env:terminalEnv,fetchFn:async()=>({
    ok:false,status:401,json:async()=>({error:'Unauthorized'})
  })}),/AI_GATEWAY_AUTH_FAILED/);
  for(const code of ['AI_AUTH_FAILED','AI_QUOTA_EXCEEDED','AI_MODEL_ERROR']){
    await assert.rejects(client.askAI('hello',{env:terminalEnv,fetchFn:async()=>({
      ok:false,status:503,json:async()=>({error:code})
    })}),new RegExp(code));
  }
});

test('provider maps invalid key, quota, model and provider rate limits to safe codes',async()=>{
  const env={...aiEnv,AI_ENABLED:'1'};
  for(const [status,providerCode,expected] of [
    [401,'invalid_api_key','AI_AUTH_FAILED'],
    [429,'insufficient_quota','AI_QUOTA_EXCEEDED'],
    [429,'rate_limit_exceeded','AI_RATE_LIMIT'],
    [404,'model_not_found','AI_MODEL_ERROR'],
    [400,'invalid_request_error','AI_MODEL_ERROR']
  ]){
    await assert.rejects(provider.askAI('hello',{env,fetchFn:async()=>({
      ok:false,status,json:async()=>({error:{code:providerCode}})
    })}),new RegExp(expected));
  }
});

test('AI check remains behind terminal login and cannot expose provider API keys',()=>{
  const server=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const frontend=readFileSync(join(__dirname,'..','web','app.js'),'utf8');
  const html=readFileSync(join(__dirname,'..','web','index.html'),'utf8');
  assert.ok(server.indexOf("if(msg.type==='ai_check')")>server.indexOf("if (!term) return;"));
  assert.match(server,/type:'ai_status'/);
  assert.match(html,/id="aiCheck"/);
  assert.match(frontend,/type:'ai_check'/);
  assert.match(frontend,/GATEWAY_UNREACHABLE/);
  assert.doesNotMatch(frontend,/AI_GATEWAY_TOKEN|AI_API_KEY/);
});

test('Kimi K3.1 Pro is opt-in and has a fixed official endpoint',async()=>{
  const env={...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'kimi',AI_MODEL:'kimi-k3.1-pro'};
  assert.equal(provider.isConfigured(env),true);
  assert.equal(provider.selectedProvider(env).url,'https://api.moonshot.ai/v1/chat/completions');
  let calls=0;
  const result=await provider.askAI('Explain ls',{env,fetchFn:async(url,init)=>{
    calls++;
    assert.equal(url,provider.KIMI_ENDPOINT);
    assert.equal(init.headers.Authorization,'Bearer '+env.AI_API_KEY);
    assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'kimi-k3.1-pro');
    assert.equal(body.reasoning_effort,'high');
    assert.equal(body.max_tokens,1024);
    assert.equal(body.messages[0].role,'system');
    assert.deepEqual(body.messages[1],{role:'user',content:'Explain ls'});
    assert.equal(Object.hasOwn(body,'tools'),false);
    assert.equal(Object.hasOwn(body,'store'),false);
    return {ok:true,json:async()=>({choices:[{message:{content:'Use ls safely'}}]})};
  }});
  assert.equal(result,'Use ls safely');
  assert.equal(calls,1);
});

test('unknown provider, invalid Kimi model and arbitrary API URL are rejected',async()=>{
  for(const env of [
    {...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'other'},
    {...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'kimi'},
    {...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'kimi',AI_MODEL:'mock-model'},
    {...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'https://evil.example'},
  ]){
    assert.equal(provider.isConfigured(env),false);
    await assert.rejects(provider.askAI('hello',{env,fetchFn:async()=>{throw Error('should not fetch')}}),/AI_NOT_CONFIGURED/);
  }
  const highspeed={...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'kimi',AI_MODEL:'kimi-k3.1-pro-highspeed'};
  assert.equal(provider.isConfigured(highspeed),true);
});

test('Kimi provider errors are sanitized and secrets stay in gateway',async()=>{
  const env={...aiEnv,AI_ENABLED:'1',AI_PROVIDER:'kimi',AI_MODEL:'kimi-k3.1-pro'};
  await assert.rejects(provider.askAI('Hello',{env,fetchFn:async()=>({
    ok:false,status:401,json:async()=>({error:{message:'secret key in request'}})
  })}),/AI_AUTH_FAILED/);
  await assert.rejects(provider.askAI('Hello',{env,fetchFn:async()=>({
    ok:false,status:429,json:async()=>({error:{code:'insufficient_quota'}})
  })}),/AI_QUOTA_EXCEEDED/);
});

test('self-hosted OpenAI-compatible endpoint is opt-in, HTTPS and host-pinned',async()=>{
  const env={
    AI_ENABLED:'1',
    AI_PROVIDER:'selfhosted',
    AI_MODEL:'qwen35b',
    AI_SELFHOST_URL:'https://inference.example.com/v1/chat/completions',
    AI_SELFHOST_ALLOWED_HOST:'inference.example.com',
    AI_SELFHOST_API_KEY:'local-private-bearer-token-not-an-openai-key',
    AI_API_KEY:'DO_NOT_SEND_TO_CUSTOM_ENDPOINT',
  };
  assert.equal(provider.isConfigured(env),true);
  assert.equal(provider.selectedProvider(env).name,'selfhosted');
  const result=await provider.askAI('Explain grep',{env,fetchFn:async(url,init)=>{
    assert.equal(url,env.AI_SELFHOST_URL);
    assert.equal(init.headers.Authorization,'Bearer '+env.AI_SELFHOST_API_KEY);
    assert.ok(!init.headers.Authorization.includes(env.AI_API_KEY));
    assert.equal(init.redirect,'error');
    const payload=JSON.parse(init.body);
    assert.equal(payload.model,'qwen35b');
    assert.equal(payload.messages[0].role,'system');
    assert.deepEqual(payload.messages[1],{role:'user',content:'Explain grep'});
    assert.equal(payload.stream,false);
    assert.equal(Object.hasOwn(payload,'tools'),false);
    assert.equal(Object.hasOwn(payload,'reasoning_effort'),false);
    return {ok:true,json:async()=>({choices:[{message:{content:'grep searches text'}}]})};
  }});
  assert.equal(result,'grep searches text');

  for(const wrong of [
    {AI_SELFHOST_URL:'http://inference.example.com/v1/chat/completions'},
    {AI_SELFHOST_URL:'https://evil.example.net/v1/chat/completions'},
    {AI_SELFHOST_URL:'https://inference.example.com/other/path'},
    {AI_SELFHOST_URL:'https://inference.example.com/v1/chat/completions?x=1'},
    {AI_SELFHOST_URL:'https://user:pass@inference.example.com/v1/chat/completions'},
    {AI_SELFHOST_URL:'https://127.0.0.1/v1/chat/completions',AI_SELFHOST_ALLOWED_HOST:'127.0.0.1'},
    {AI_SELFHOST_URL:'https://metadata.google.internal/v1/chat/completions',AI_SELFHOST_ALLOWED_HOST:'metadata.google.internal'},
    {AI_SELFHOST_API_KEY:''},
  ]){
    assert.equal(provider.isConfigured({...env,...wrong}),false,JSON.stringify(wrong));
  }
});

test('selfhosted provider never uses remote endpoint when inactive or unapproved',async()=>{
  const env={
    AI_ENABLED:'0',AI_PROVIDER:'selfhosted',AI_MODEL:'qwen35b',
    AI_SELFHOST_URL:'https://inference.example.com/v1/chat/completions',
    AI_SELFHOST_ALLOWED_HOST:'inference.example.com',
    AI_SELFHOST_API_KEY:'local-private-bearer-token-not-an-openai-key',
  };
  let requests=0;
  await assert.rejects(provider.askAI('Hello',{env,fetchFn:async()=>{requests++;}}),/AI_NOT_CONFIGURED/);
  assert.equal(requests,0);
});
