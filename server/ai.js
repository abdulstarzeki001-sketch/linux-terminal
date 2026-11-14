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
      if(res.status===401||res.status===403)throw new Error('AI_AUTH_FAILED');
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
module.exports={isConfigured,askAI,MAX_PROMPT};
