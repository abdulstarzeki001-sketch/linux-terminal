'use strict';
// This file runs in the unprivileged-by-design AI CLIENT of the Railway terminal.
// No OpenAI API keys are stored here or passed to the shell. Provider credentials
// must live in an isolated Railway AI gateway service.
const MAX_PROMPT=4000;
const TIMEOUT_MS=28000;

function isConfigured(env=process.env) {
  if(env.AI_ENABLED!=='1' || typeof env.AI_GATEWAY_TOKEN!=='string' ||
      env.AI_GATEWAY_TOKEN.length<32) return false;
  try{
    const u=new URL(env.AI_GATEWAY_URL||'');
    return u.protocol==='http:' &&
      /^[a-z0-9-]+\.railway\.internal$/i.test(u.hostname) &&
      /^\d{2,5}$/.test(u.port) &&
      u.pathname==='/answer' && !u.search && !u.hash &&
      !u.username && !u.password;
  }catch(_){return false}
}

// Check only the internal Railway gateway after authenticated WebSocket login.
// No provider key, user prompt, or shared secret is sent to this GET endpoint.
// Provider key/credit validity requires a real AI request, not this health probe.
async function checkAIStatus({env=process.env,fetchFn=globalThis.fetch}={}) {
  if(!isConfigured(env))return {ready:false,reason:'TERMINAL_NOT_CONFIGURED'};
  const url=new URL(env.AI_GATEWAY_URL);
  url.pathname='/health';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4000);
  try {
    const res=await fetchFn(url.toString(),{method:'GET',signal:controller.signal,redirect:'error'});
    if(!res.ok)return {ready:false,reason:'GATEWAY_ERROR'};
    const data=await res.json();
    if(data?.ok!==true)return {ready:false,reason:'GATEWAY_ERROR'};
    if(data?.aiConfigured!==true)return {ready:false,reason:'GATEWAY_NOT_CONFIGURED'};
    return {ready:true,reason:'GATEWAY_READY'};
  }catch(_){return {ready:false,reason:'GATEWAY_UNREACHABLE'};}
  finally{clearTimeout(timer);}
}

async function askAI(prompt,{env=process.env,fetchFn=globalThis.fetch,signal}={}) {
  if(!isConfigured(env))throw new Error('AI_NOT_CONFIGURED');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>MAX_PROMPT)
    throw new Error('AI_INVALID_INPUT');
  const ctrl=new AbortController();
  const abort=()=>ctrl.abort();
  if(signal?.aborted)ctrl.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,TIMEOUT_MS);
  try{
    const res=await fetchFn(env.AI_GATEWAY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-star-ai-token':env.AI_GATEWAY_TOKEN},
      body:JSON.stringify({prompt}),
      signal:ctrl.signal,
      redirect:'error'
    });
    if(!res.ok){
      // Only allow pre-defined error codes from the private gateway.
      let code='';
      try{const data=await res.json();if(typeof data?.error==='string')code=data.error;}catch(_){}
      const safeCodes=new Set([
        'AI_AUTH_FAILED','AI_RATE_LIMIT','AI_QUOTA_EXCEEDED',
        'AI_MODEL_ERROR','AI_NOT_CONFIGURED','AI_TIMEOUT',
        'AI_UPSTREAM_UNAVAILABLE','AI_EMPTY_RESPONSE','AI_BILLING_REQUIRED'
      ]);
      if(res.status===401||res.status===403)throw new Error('AI_GATEWAY_AUTH_FAILED');
      if(safeCodes.has(code))throw new Error(code);
      if(res.status===429)throw new Error('AI_RATE_LIMIT');
      if(res.status===503)throw new Error('AI_NOT_CONFIGURED');
      throw new Error('AI_UPSTREAM_UNAVAILABLE');
    }
    const json=await res.json();
    const answer=typeof json?.answer==='string'?json.answer.slice(0,8000):'';
    if(!answer.trim())throw new Error('AI_EMPTY_RESPONSE');
    return answer;
  }catch(error){
    if(ctrl.signal.aborted)throw new Error('AI_TIMEOUT');
    if(/^AI_[A-Z_]+$/.test(error?.message||''))throw error;
    throw new Error('AI_NETWORK_ERROR');
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener('abort',abort);
  }
}
module.exports={isConfigured,checkAIStatus,askAI,MAX_PROMPT};
