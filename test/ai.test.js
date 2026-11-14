'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {isConfigured,askAI,textFromResponse,MAX_PROMPT,AI_ENDPOINT}=require('../server/ai');

const env={AI_ENABLED:'1',AI_API_KEY:'fake-api-key-only-for-local-tests',AI_MODEL:'test-model'};
test('AI is disabled by default and cannot respond without Railway secret configuration',async()=>{
  assert.equal(isConfigured({}),false);
  assert.equal(isConfigured({AI_API_KEY:env.AI_API_KEY,AI_MODEL:'m'}),false);
  assert.equal(isConfigured(env),true);
  await assert.rejects(askAI('hi',{env:{}}),/AI_NOT_CONFIGURED/);
});

test('AI request uses fixed official endpoint and never enables shell tools or stored conversations',async()=>{
  let called=0;
  const fetchFn=async(url,init)=>{
    called++;
    assert.equal(url,AI_ENDPOINT);
    assert.equal(init.method,'POST');
    assert.equal(init.headers.Authorization,'Bearer '+env.AI_API_KEY);
    const request=JSON.parse(init.body);
    assert.equal(request.model,'test-model');
    assert.equal(request.input,'Explain ls');
    assert.equal(request.store,false);
    assert.equal(request.max_output_tokens,650);
    assert.equal(Object.hasOwn(request,'tools'),false);
    assert.match(request.instructions,/never claim/);
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Use ls -la'}]}]})};
  };
  const reply=await askAI('Explain ls',{env,fetchFn});
  assert.equal(reply,'Use ls -la');
  assert.equal(called,1);
});
test('empty, oversized or badly typed prompts never call a provider',async()=>{
  let count=0;
  const fetchFn=async()=>{count++;return {ok:true,json:async()=>({output_text:'test'})}};
  for(const input of ['', '  ', 'x'.repeat(MAX_PROMPT+1),42]){
    await assert.rejects(askAI(input,{env,fetchFn}),/AI_INVALID_INPUT/);
  }
  assert.equal(count,0);
});
test('no upstream API error body or secrets are forwarded to terminal clients',async()=>{
  for(const status of [401,403,429,502]){
    const response={ok:false,status};
    await assert.rejects(askAI('hello',{env,fetchFn:async()=>response}),err=>{
      assert.match(err.message,/^AI_[A-Z_]+$/);
      assert.ok(!err.message.includes(env.AI_API_KEY));
      return true;
    });
  }
  const out=textFromResponse({output:[{content:[
    {type:'reasoning',text:'private reasoning must not appear'},
    {type:'output_text',text:'public answer'}
  ]}]});
  assert.equal(out,'public answer');
});
test('WebSocket only processes AI chat after terminal password authentication; no PTY auto commands',()=>{
  const server=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const auth=server.indexOf("if (!authed) {");
  const shell=server.indexOf("if (!term) return;",auth);
  const ai=server.indexOf("if (msg.type === 'ai_chat')",shell);
  const write=server.indexOf("term.write(msg.data)",ai);
  assert.ok(auth>=0 && shell>auth && ai>shell && write>ai);
  assert.match(server,/aiRequests >= 25/);
  assert.match(server,/aiPending/);
  assert.match(server,/aiAbort\?\.abort\(\)/);
  const branch=server.slice(ai,write);
  assert.doesNotMatch(branch,/term\.write\(/);
  assert.match(server,/aiEnabled:isConfigured\(\)/);
});
test('no AI keys leak into the shell environment or static frontend',()=>{
  const server=readFileSync(join(__dirname,'..','server','index.js'),'utf8');
  const frontend=readFileSync(join(__dirname,'..','web','app.js'),'utf8');
  const html=readFileSync(join(__dirname,'..','web','index.html'),'utf8');
  const shellEnv=server.slice(server.indexOf('function shellEnv()'),server.indexOf('function send('));
  assert.doesNotMatch(shellEnv,/\b(?:AI_API_KEY|TERMINAL_PASSWORD)\s*:/);
  assert.doesNotMatch(frontend,/AI_API_KEY|Bearer |api\.openai\.com/);
  assert.doesNotMatch(html,/AI_API_KEY|api\.openai\.com/);
  assert.match(html,/id="aiPanel"/);
  assert.match(html,/id="aiExplain"/);
});
