'use strict';
const {selectedProvider,isConfigured,accessHeaders}=require('./provider');
// The Minis client may send text content parts and large tool schemas.
 // Keep limits finite, but do not reject ordinary multi-tool conversations.
function messageText(content){
  if(content===null||content===undefined)return '';
  if(typeof content==='string')return content;
  if(!Array.isArray(content)||content.length>64)throw Error('AI_INVALID_INPUT');
  return content.map(part=>{
    if(typeof part==='string')return part;
    if(!part||!['text','input_text'].includes(part.type)||typeof part.text!=='string')
      throw Error('AI_INVALID_INPUT'); // images/binary need an explicit future adapter
    return part.text;
  }).join('\n');
}
function checkedMessages(messages){
  if(!Array.isArray(messages)||!messages.length||messages.length>96)throw Error('AI_INVALID_INPUT');
  if(JSON.stringify(messages).length>80000)throw Error('AI_INVALID_INPUT');
  return messages.map(m=>{
    if(!m||!['system','developer','user','assistant','tool'].includes(m.role))
      throw Error('AI_INVALID_INPUT');
    if(m.role==='tool'&&(!m.tool_call_id||typeof m.tool_call_id!=='string'))
      throw Error('AI_INVALID_INPUT');
    if(m.tool_calls!==undefined){
      if(m.role!=='assistant'||!Array.isArray(m.tool_calls)||m.tool_calls.length>32)
        throw Error('AI_INVALID_INPUT');
      for(const c of m.tool_calls)
        if(c?.type!=='function'||typeof c.id!=='string'||!c.id||
           typeof c.function?.name!=='string'||!c.function.name||
           (c.function.arguments!==undefined&&typeof c.function.arguments!=='string'))
          throw Error('AI_INVALID_INPUT');
    }
    return {...m,content:messageText(m.content)};
  });
}
function checkedTools(tools){
  if(tools===undefined)return [];
  if(!Array.isArray(tools)||tools.length>64||JSON.stringify(tools).length>96000)
    throw Error('AI_INVALID_INPUT');
  for(const t of tools)
    if(t?.type!=='function'||!/^[-A-Za-z0-9_]{1,64}$/.test(t.function?.name||'')||
       typeof t.function?.parameters!=='object'||!t.function.parameters)
      throw Error('AI_INVALID_INPUT');
  return tools;
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
      model:env.AI_MODEL,messages:[{role:'system',content:prompt},...messages.map(m=>m.role==='developer'?{...m,role:'system'}:m)],stream:false,max_tokens:1500,
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
module.exports={completeForMinis,checkedMessages,checkedTools,messageText,toResponsesInput,parseResponses,parseChat,classifyUpstreamError};