'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createMinisHandler}=require('../ai-gateway/minis');
const {completeForMinis}=require('../ai-gateway/minis-provider');
const {createMcpHandler}=require('../ai-gateway/mcp');
const MINIS_KEY='unit-test-minis-key-abcdefghijklmnopqrstuvwxyz',MCP_KEY='unit-test-mcp-key-abcdefghijklmnopqrstuvwxyz';
async function host(handler,fn){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{return await fn('http://127.0.0.1:'+s.address().port);}finally{await new Promise(r=>s.close(r));}}
const call=(url,stream=false)=>fetch(url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+MINIS_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'star-ai',messages:[{role:'user',content:'use tool'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{}}}}],stream})});
test('Minis JSON tool_calls and SSE work',async()=>{
 const answer={message:{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'read_file',arguments:'{}'}}]},finish_reason:'tool_calls'};
 const h=createMinisHandler({env:{STAR_MINIS_API_KEY:MINIS_KEY},configured:()=>true,complete:async()=>answer});
 await host(h,async url=>{
   const x=await call(url);assert.equal(x.status,200);assert.equal((await x.json()).choices[0].finish_reason,'tool_calls');
   const y=await call(url,true);assert.equal(y.status,200);const body=await y.text();assert.match(body,/tool_calls/);assert.match(body,/\[DONE\]/);
 });
});
test('Model-native OpenAI function tool call is parsed',async()=>{
 const env={AI_ENABLED:'1',AI_API_KEY:'unit-test-fake-openai-key',AI_MODEL:'gpt-4.1',AI_PROVIDER:'openai'};
 let posted;
 const result=await completeForMinis({messages:[{role:'user',content:'use tool'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{}}}}]},{env,fetchFn:async(_u,opt)=>{posted=JSON.parse(opt.body);return {ok:true,json:async()=>({output:[{type:'function_call',call_id:'tool-1',name:'read_file',arguments:'{}'}]})};}});
 assert.equal(result.finish_reason,'tool_calls');assert.equal(posted.tools[0].name,'read_file');
});
test('Model-native Kimi chat function tool call is parsed',async()=>{
 const env={AI_ENABLED:'1',AI_API_KEY:'unit-test-fake-kimi-key',AI_MODEL:'kimi-k3.1-pro',AI_PROVIDER:'kimi'};
 const result=await completeForMinis({messages:[{role:'user',content:'use tool'}],tools:[{type:'function',function:{name:'search_code',parameters:{type:'object',properties:{}}}}]},{env,fetchFn:async()=>({ok:true,json:async()=>({choices:[{message:{role:'assistant',tool_calls:[{id:'abc',type:'function',function:{name:'search_code',arguments:'{}'}}]}}]})})});
 assert.equal(result.message.tool_calls[0].function.name,'search_code');
});
test('MCP is authenticated and saves/searches memory',async()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'star-mcp-')),'state.json');
 const h=createMcpHandler({env:{STAR_MINIS_MCP_KEY:MCP_KEY,STAR_AGENT_STATE_FILE:file},modelConfigured:()=>true}).handler;
 const rpc=(url,name,args)=>fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+MCP_KEY,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}).then(x=>x.json());
 await host(h,async url=>{
   assert.equal((await fetch(url+'/mcp')).status,401);
   const saved=JSON.parse((await rpc(url,'memory_save',{text:'Remember secure coding preference'})).result.content[0].text);
   assert.equal(saved.saved,true);
   const search=JSON.parse((await rpc(url,'memory_search',{query:'coding'})).result.content[0].text);
   assert.equal(search.matches.length,1);
 });
});
test('MCP refuses unsafe path and arbitrary shell',async()=>{
 const h=createMcpHandler({env:{STAR_MINIS_MCP_KEY:MCP_KEY,STAR_GITHUB_REPO:'owner/repo'},modelConfigured:()=>true}).handler;
 await host(h,async url=>{
   for(const [name,args] of [['github_read_file',{path:'../../.env'}],['run_shell',{cmd:'whoami'}]]){
     const response=await fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+MCP_KEY,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
     assert.equal((await response.json()).result.isError,true);
   }
 });
});
test('Minis text part messages and returned shell tool output pass to the upstream model',async()=>{
 const {checkedMessages}=require('../ai-gateway/minis-provider');
 const messages=[
   {role:'user',content:[{type:'text',text:'Read Python version'}]},
   {role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'shell_read',arguments:'{}'}}]},
   {role:'tool',tool_call_id:'call_1',content:[{type:'text',text:'Python 3.12.16'}]}
 ];
 assert.equal(checkedMessages(messages)[0].content,'Read Python version');
 let upstream;
 const env={AI_ENABLED:'1',AI_API_KEY:'unit-test-openai-valid-fake-key',AI_MODEL:'gpt-4.1'};
 const result=await completeForMinis({messages},{env,fetchFn:async(_url,options)=>{
   upstream=JSON.parse(options.body);
   return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:'Verified version'}]}]})};
 }});
 assert.equal(upstream.input.find(x=>x.type==='function_call_output').output,'Python 3.12.16');
 assert.equal(result.message.content,'Verified version');
});
test('Minis accepts bounded large tool schemas and rejects unsupported media blocks',()=>{
 const {checkedTools,checkedMessages}=require('../ai-gateway/minis-provider');
 const tools=Array.from({length:35},(_,i)=>({type:'function',function:{
   name:'tool_'+i,description:'documentation '.repeat(60),parameters:{type:'object',properties:{}}
 }}));
 assert.ok(JSON.stringify(tools).length>22000);
 assert.equal(checkedTools(tools).length,35);
 assert.throws(()=>checkedMessages([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,abc'}}]}]),/AI_INVALID_INPUT/);
 assert.throws(()=>checkedMessages(Array.from({length:97},()=>({role:'user',content:'hello'}))),/AI_INVALID_INPUT/);
 assert.throws(()=>checkedTools(Array.from({length:65},()=>tools[0])),/AI_INVALID_INPUT/);
});
test('Minis returns HTTP 400 for unsupported client message format, not misleading 502',async()=>{
 const h=createMinisHandler({env:{STAR_MINIS_API_KEY:MINIS_KEY},configured:()=>true,complete:async()=>{
   throw Error('AI_INVALID_INPUT');
 }});
 await host(h,async url=>{
   const r=await fetch(url+'/v1/chat/completions',{method:'POST',
     headers:{Authorization:'Bearer '+MINIS_KEY,'Content-Type':'application/json'},
     body:JSON.stringify({model:'star-ai',messages:[{role:'user',content:'hi'}]})
   });
   assert.equal(r.status,400);
   const payload=await r.json();
   assert.equal(payload.error.code,'AI_INVALID_INPUT');
 });
});
