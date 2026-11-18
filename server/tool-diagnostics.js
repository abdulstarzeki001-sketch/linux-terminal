'use strict';
// Read-only diagnostics for the existing Linux+Kali+AI service chain.
// No user supplied network destinations, shell commands, credentials or scans.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {checkAIStatus,askAI}=require('./ai');
const {freeMiB}=require('./tool-maintenance');

const PROBE_MARKER='/home/tuser/.config/wormstar/ai-live-probe.json';
const PROBE_COOLDOWN_MS=15*60*1000;
let pending=false;
function safeReason(value){
 const code=String(value||'');
 return /^[A-Z][A-Z0-9_]{2,64}$/.test(code)?code:'UNKNOWN_ERROR';
}
async function kaliHealth(fetchFn=globalThis.fetch){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),3500);
 try{
  const response=await fetchFn('http://127.0.0.1:8000/api/v1/health',{
   method:'GET',signal:controller.signal,redirect:'error',cache:'no-store'
  });
  if(!response.ok)return {ready:false,code:'KALI_HTTP_'+response.status};
  const result=await response.json().catch(()=>null);
  return {ready:result?.status==='ok',code:result?.status==='ok'?'KALI_READY':'KALI_UNHEALTHY'};
 }catch(_){return {ready:false,code:'KALI_UNREACHABLE'};}
 finally{clearTimeout(timer);}
}
async function snapshot(opts={}){
 const checkedAt=new Date().toISOString();
 let remaining=null,volume=false,home=false;
 try{remaining=freeMiB(opts.root||'/persist');volume=true;}catch(_){}
 try{home=fs.realpathSync(opts.home||'/home/tuser').startsWith(opts.root||'/persist');}catch(_){}
 const [kali,ai]=await Promise.all([
  (opts.kaliFn||kaliHealth)(),
  (opts.aiFn||checkAIStatus)()
 ]);
 const aiCode=safeReason(ai?.reason);
 return {checkedAt,source:'railway_live_diagnostics',
  runtime:{node:process.version,platform:os.platform(),uid:typeof process.getuid==='function'?process.getuid():null,
   healthy:true,code:'TERMINAL_READY'},
  persistence:{ready:volume&&home,freeMiB:remaining,homeOnVolume:home,code:volume&&home?'VOLUME_READY':'VOLUME_UNAVAILABLE'},
  kali:{ready:!!kali?.ready,code:safeReason(kali?.code)},
  aiGateway:{ready:!!ai?.ready,code:aiCode,liveProviderVerified:false},
  access:{ready:true,code:'PRIVATE_ORIGIN_AUTH_PASSED'},
  note:'AI gateway health is not an inference test. Use the separate explicitly triggered, rate-limited live AI probe.'};
}
function readMarker(file=PROBE_MARKER){
 try{
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  return {lastAttempt:Number(data.lastAttempt)||0,lastStatus:safeReason(data.lastStatus||'NOT_TESTED')};
 }catch(e){
  if(e?.code==='ENOENT')return {lastAttempt:0,lastStatus:'NOT_TESTED'};
  throw e;
 }
}
function writeMarker(value,file=PROBE_MARKER){
 const folder=path.dirname(file);
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const tmp=file+'.tmp-'+process.pid;
 try{
  fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'w'});
  fs.renameSync(tmp,file);
 }finally{try{fs.unlinkSync(tmp);}catch(e){if(e?.code!=='ENOENT')throw e;}}
}
async function liveAI(opts={}){
 const marker=opts.marker||PROBE_MARKER;
 if(pending)return {httpStatus:429,code:'AI_PROBE_BUSY'};
 let state;
 try{state=readMarker(marker);}catch(_){return {httpStatus:503,code:'AI_PROBE_STATE_UNAVAILABLE'};}
 const now=Date.now();
 if(now-state.lastAttempt<PROBE_COOLDOWN_MS)
  return {httpStatus:429,code:'AI_PROBE_COOLDOWN',retryAfterSec:Math.ceil((PROBE_COOLDOWN_MS-(now-state.lastAttempt))/1000),
   previous:state.lastStatus};
 pending=true;
 const started=Date.now();
 try{
  // Persist the attempt BEFORE contacting the paid AI provider, across deploys.
  writeMarker({lastAttempt:now,lastStatus:'AI_PROBE_IN_PROGRESS'},marker);
  const health=await (opts.aiFn||checkAIStatus)();
  let code,ready=false;
  if(!health?.ready)code=safeReason(health?.reason);
  else {
   try{
    const answer=await (opts.askFn||askAI)('Minimal paid connectivity test. Reply with exactly READY.');
    ready=typeof answer==='string'&&answer.trim().length>0;
    code=ready?'AI_INFERENCE_SUCCESS':'AI_EMPTY_RESPONSE';
   }catch(e){code=safeReason(e?.message);}
  }
  writeMarker({lastAttempt:now,lastStatus:code},marker);
  return {httpStatus:200,ready,code,durationMs:Date.now()-started,checkedAt:new Date().toISOString(),
   responseStored:false,note:'This probe made at most one real provider request when the private gateway was ready.'};
 }catch(_){return {httpStatus:503,code:'AI_PROBE_FAILED'};}
 finally{pending=false;}
}
module.exports={snapshot,kaliHealth,liveAI,readMarker,PROBE_COOLDOWN_MS};
