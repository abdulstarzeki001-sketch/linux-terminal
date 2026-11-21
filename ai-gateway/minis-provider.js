'use strict';
const {selectedProvider,isConfigured,accessHeaders}=require('./provider');
// Minis sends tool-rich agent contexts; avoid rejecting valid larger tool lists.
// The outer HTTP handler still enforces a strict 64-KiB request-body limit.
const MAX_AGENT_MESSAGES=96;
const MAX_AGENT_TOOLS=96;
function checkSize(value,max,code){
  let bytes;
  try{bytes=Buffer.byteLength(JSON.stringify(value),'utf8');}
  catch(_){throw Error(code);}
  if(bytes>max)throw Error(code);
}
function normalizeContent(content){
  if(content===undefined||content===null||typeof content==='string')return content;
  // Chat Completions permits text-part arrays. Images/audio are not handled by
  // this gateway and must fail explicitly instead of being silently discarded.
  if(Array.isArray(content)&&content.every(x=>x&&x.type==='text'&&typeof x.text==='string'))
    return content.map(x=>x.text).join('\n');
  throw Error('AI_UNSUPPORTED_MODALITY');
}
function checkedMessages(messages){
  if(!Array.isArray(messages)||!messages.length)throw Error('AI_INVALID_MESSAGE_FORMAT');
  if(messages.length>MAX_AGENT_MESSAGES)throw Error('AI_TOO_MANY_MESSAGES');
  checkSize(messages,57000,'AI_MESSAGE_TOO_LARGE');
  return messages.map(m=>{
    if(!m||!['system','developer','user','assistant','tool'].includes(m.role))
      throw Error('AI_INVALID_MESSAGE_FORMAT');
    const content=normalizeContent(m.content);
    if(m.role==='tool'&&(typeof m.tool_call_id!=='string'||!m.tool_call_id.trim()))
      throw Error('AI_INVALID_TOOL_MESSAGE');
    if(m.role==='assistant'&&m.tool_calls!==undefined){
      if(!Array.isArray(m.tool_calls)||m.tool_calls.length>20||
        m.tool_calls.some(x=>x?.type!=='function'||typeof x.id!=='string'||
          !x.id||typeof x.function?.name!=='string'||
          typeof x.function?.arguments!=='string'))
        throw Error('AI_INVALID_TOOL_MESSAGE');
    }
    return {...m,content};
  });
}
function checkedTools(tools){
  if(tools===undefined||tools===null)return [];
  if(!Array.isArray(tools))throw Error('AI_INVALID_TOOL_SCHEMA');
  if(tools.length>MAX_AGENT_TOOLS)throw Error('AI_TOO_MANY_TOOLS');
  checkSize(tools,59000,'AI_TOOL_SCHEMA_TOO_LARGE');
  return tools.map(t=>{
    if(t?.type!=='function'||!/^[-A-Za-z0-9_]{1,64}$/.test(t.function?.name||''))
      throw Error('AI_INVALID_TOOL_SCHEMA');
    const params=t.function.parameters??{type:'object',properties:{}};
    if(!params||typeof params!=='object'||Array.isArray(params))
      throw Error('AI_INVALID_TOOL_SCHEMA');
    return {...t,function:{...t.function,parameters:params}};
  });
}
function toResponsesInput(messages){
  const input=[];
  for(const m of messages){
    if(m.role==='tool'){input.push({type:'function_call_output',call_id:m.tool_call_id,output:m.content||''});continue;}
    if(m.role==='assistant'&&Array.isArray(m.tool_calls)){
      for(const c of m.tool_calls){
        if(c.type!=='function'||!c.id||!c.function?.name)throw Error('AI_INVALID_INPUT');
        input.push({type:'function_call',call_id:c.id,name:c.function.name,arguments:String(c.function.arguments||'{}')});
      }
      if(m.content)input.push({role:'assistant',content:m.content});
      continue;
    }
    input.push({role:m.role,content:m.content||''});
  }
  return input;
}
function parseResponses(data){
  const calls=[],contents=[];
  if(typeof data.output_text==='string')contents.push(data.output_text);
  for(const item of Array.isArray(data.output)?data.output:[]){
    if(item.type==='function_call')calls.push({id:item.call_id,type:'function',function:{name:item.name,arguments:String(item.arguments||'{}')}});
    if(!data.output_text&&Array.isArray(item.content))for(const c of item.content)if(c.type==='output_text'&&typeof c.text==='string')contents.push(c.text);
  }
  return {role:'assistant',content:contents.join('\n').slice(0,16000)||null,...(calls.length?{tool_calls:calls}:{})};
}
function parseChat(data){
  const m=data?.choices?.[0]?.message;if(!m)throw Error('AI_EMPTY_RESPONSE');
  const calls=Array.isArray(m.tool_calls)?m.tool_calls.filter(x=>x?.type==='function').map(x=>({id:String(x.id||''),type:'function',function:{name:String(x.function?.name||''),arguments:String(x.function?.arguments||'{}')}})):[];
  const content=typeof m.content==='string'?m.content.slice(0,16000):null;
  return {role:'assistant',content,...(calls.length?{tool_calls:calls}:{})};
}
function defaultRules(env){
  return 'You are STAR AI, an Iraqi Arabic-first expert assistant for software engineering and authorized cybersecurity work. Be precise, effective and technically detailed. Do not claim to run tools that were not executed. Use provided function tools when warranted and respect their scope, provenance and result.\n'+String(env.STAR_CUSTOM_INSTRUCTIONS||'').slice(0,2500);
}
// Return only a fixed, non-sensitive error class. Never forward provider error text.
async function classifyUpstreamError(response){
  const status=response.status;
  if(status===401||status===403)return 'AI_AUTH_FAILED';
  if(status===402)return 'AI_BILLING_REQUIRED';
  let code='';
  if(status===400||status===404||status===422||status===429){
    try{
      const payload=await response.json();
      code=String(payload?.error?.code||payload?.error?.type||'').slice(0,100);
    }catch(_){}
  }
  if(status===429){
    return /insufficient_quota|quota_exceeded|billing_required|exceeded_quota/i.test(code)
      ?'AI_QUOTA_EXCEEDED':'AI_RATE_LIMIT';
  }
  if(status===400||status===404||status===422){
    return /model_not_found|unsupported_model|invalid_model|model_not_available/i.test(code)
      ?'AI_MODEL_ERROR':'AI_REQUEST_REJECTED';
  }
  return 'AI_UPSTREAM_ERROR';
}
async function completeForMinis(request,{env=process.env,fetchFn=globalThis.fetch,signal}={}){
  if(!isConfigured(env))throw Error('AI_NOT_CONFIGURED');
  const messages=checkedMessages(request.messages),tools=checkedTools(request.tools);
  const provider=selectedProvider(env);if(!provider)throw Error('AI_NOT_CONFIGURED');
  const prompt=defaultRules(env),ctrl=new AbortController(),abort=()=>ctrl.abort();
  if(signal?.aborted)ctrl.abort();signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,provider.name==='selfhosted'?75000:35000);
  try{
    const isResponses=provider.name==='openai';
    const body=isResponses?{
      model:env.AI_MODEL,instructions:prompt,input:toResponsesInput(messages),store:false,max_output_tokens:1500,
      ...(tools.length?{tools:tools.map(x=>({type:'function',name:x.function.name,description:String(x.function.description||'').slice(0,500),parameters:x.function.parameters})),tool_choice:'auto'}:{})
    }:{
      model:env.AI_MODEL,messages:[{role:'system',content:prompt},...messages],stream:false,max_tokens:1500,
      ...(tools.length?{tools,tool_choice:'auto'}:{})
    };
    const response=await fetchFn(provider.url,{method:'POST',signal:ctrl.signal,redirect:'error',headers:{
      'Content-Type':'application/json',
      Authorization:'Bearer '+(provider.name==='selfhosted'?env.AI_SELFHOST_API_KEY:env.AI_API_KEY),
      ...(provider.name==='selfhosted'?(accessHeaders(env)||{}):{})
    },body:JSON.stringify(body)});
    if(!response.ok)throw Error(await classifyUpstreamError(response));
    const data=await response.json(),message=isResponses?parseResponses(data):parseChat(data);
    if(!message.content&&!message.tool_calls?.length)throw Error('AI_EMPTY_RESPONSE');
    return {message,finish_reason:message.tool_calls?.length?'tool_calls':'stop'};
  }catch(e){
    if(ctrl.signal.aborted)throw Error('AI_TIMEOUT');
    if(/^AI_[A-Z_]+$/.test(e?.message||''))throw e;
    throw Error('AI_NETWORK_ERROR');
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
module.exports={completeForMinis,checkedMessages,checkedTools,toResponsesInput,parseResponses,parseChat,classifyUpstreamError};