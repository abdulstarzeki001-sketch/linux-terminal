'use strict';
// STAR AI Gateway. Deploy as a separate Railway service on the PRIVATE
// railway.internal network. Only this process has the provider API key.
const http=require('node:http');
const crypto=require('node:crypto');
const {askAI,isConfigured,MAX_PROMPT}=require('./provider');

function keyMatches(value,expected) {
  if(typeof expected!=='string'||expected.length<32||
     typeof value!=='string')return false;
  const a=crypto.createHash('sha256').update(value).digest();
  const b=crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a,b);
}

function json(res,status,data) {
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  });
  res.end(JSON.stringify(data));
}

function createGateway({env=process.env,fetchFn=globalThis.fetch}={}) {
  const limit=Math.min(60,Math.max(1,Number(env.AI_MAX_PER_HOUR)||30));
  let windowStart=Date.now(),count=0,inFlight=0;
  return http.createServer(async(req,res)=>{
    if(req.url==='/health'&&req.method==='GET'){
      json(res,200,{ok:true,aiConfigured:isConfigured(env)});
      return;
    }
    if(req.url!=='/answer'){json(res,404,{error:'Not found'});return;}
    if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return;}
    if(!keyMatches(req.headers['x-star-ai-token'],env.AI_GATEWAY_TOKEN)){
      json(res,401,{error:'Unauthorized'});return;
    }
    if(!isConfigured(env)){json(res,503,{error:'AI_NOT_CONFIGURED'});return;}
    if(!String(req.headers['content-type']||'').startsWith('application/json')){
      json(res,415,{error:'Unsupported Media Type'});return;
    }
    let raw='';
    try{
      for await (const chunk of req) {
        raw+=chunk.toString('utf8');
        if(Buffer.byteLength(raw,'utf8')>8192){
          json(res,413,{error:'Payload too large'});return;
        }
      }
      const body=JSON.parse(raw);
      if(typeof body?.prompt!=='string'||!body.prompt.trim()||
         body.prompt.length>MAX_PROMPT){
        json(res,400,{error:'AI_INVALID_INPUT'});return;
      }
      if(Date.now()-windowStart>=3600000){windowStart=Date.now();count=0;}
      if(count>=limit||inFlight>=2){
        json(res,429,{error:'AI_RATE_LIMIT'});return;
      }
      count++;inFlight++;
      const ctrl=new AbortController();
      res.on('close',()=>{if(!res.writableEnded)ctrl.abort();});
      try {
        const answer=await askAI(body.prompt,{env,fetchFn,signal:ctrl.signal});
        if(!res.writableEnded&&!res.destroyed)json(res,200,{answer});
      }catch(error){
        const err=error?.message||'';
        const status=err==='AI_AUTH_FAILED'?503:
          err==='AI_RATE_LIMIT'?429:err==='AI_INVALID_INPUT'?400:502;
        if(!res.writableEnded&&!res.destroyed)
          json(res,status,{error:/^AI_[A-Z_]+$/.test(err)?err:'AI_NETWORK_ERROR'});
      }finally{inFlight--;}
    }catch(_){
      if(!res.writableEnded&&!res.destroyed)
        json(res,400,{error:'Invalid request'});
    }
  });
}

if(require.main===module){
  const server=createGateway();
  const port=Number(process.env.PORT||8081);
  server.listen(port,'0.0.0.0',()=>console.log('STAR AI private gateway listening'));
}
module.exports={createGateway,keyMatches};
