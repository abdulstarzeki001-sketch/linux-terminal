'use strict';
/**
 * Owner-approved single-package installer. Never accepts executable paths,
 * package names, shell commands, or network targets from the browser.
 * This process runs as tuser; packages persist only in the mounted venv.
 */
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const APPROVAL='I_APPROVE_RAILWAY_TOOL_INSTALL';
const HOME='/home/tuser';
const PERSIST_ROOT=process.env.WORMSTAR_PERSIST_ROOT||'/persist';
const PYTHON=path.join(HOME,'.venv/bin/python');
const STATE_PATH=path.join(HOME,'.config/wormstar/owner-installs.json');
const MIN_FREE_BYTES=250*1024*1024;
const MAX_DURATION_MS=300000;
const PACKAGES=Object.freeze({
  certipy:'certipy-ad==5.1.0',
  impacket:'impacket==0.13.1',
  frida:'frida-tools==14.13.2'
});
let active=null;
let lastStarted=0;

function stateFile(opts){return opts?.stateFile||STATE_PATH;}
function readJobs(opts){
 let jobs={};
 try {
  const raw=fs.readFileSync(stateFile(opts),'utf8');
  if(raw.length>32000)throw Error('state too large');
  const doc=JSON.parse(raw);
  if(doc&&doc.schema===1&&doc.jobs&&typeof doc.jobs==='object'&&!Array.isArray(doc.jobs))
   jobs=doc.jobs;
 }catch(e){if(e?.code!=='ENOENT')jobs={};}
 const sanitized={};
 for(const id of Object.keys(PACKAGES)){
  const job=jobs[id];
  if(!job||typeof job!=='object')continue;
  const status=(job.status==='running'&&active!==id)?'interrupted':job.status;
  if(!['running','interrupted','succeeded','failed','timed_out'].includes(status))continue;
  sanitized[id]={tool_id:id,status,startedAt:job.startedAt||null,
   finishedAt:job.finishedAt||null,exitCode:Number.isInteger(job.exitCode)?job.exitCode:null,
   output:String(job.output||'').slice(-3000)};
 }
 return sanitized;
}
function writeJobs(jobs,opts){
 const file=stateFile(opts);
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+process.pid+'.tmp';
 try{
  fs.writeFileSync(temp,JSON.stringify({schema:1,jobs}),{flag:'wx',mode:0o600});
  fs.renameSync(temp,file);
 }finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function freeBytes(home){
 const stat=fs.statfsSync(home,{bigint:true});
 return Number(stat.bavail*stat.bsize);
}
function prerequisites(opts={}){
 const home=opts.home||HOME,root=opts.root||PERSIST_ROOT,python=opts.python||PYTHON;
 const realHome=fs.realpathSync(home);
 if(realHome!==path.join(root,'home','tuser'))return {ok:false,code:'INSTALL_PERSISTENCE_REQUIRED'};
 const realPython=fs.realpathSync(python);
 const binary=fs.statSync(realPython);
 if(!binary.isFile()||!(binary.mode&0o111) || binary.uid!==0)
  return {ok:false,code:'INSTALL_TRUSTED_PYTHON_REQUIRED'};
 const free=opts.freeBytes===undefined?freeBytes(home):opts.freeBytes;
 if(!Number.isFinite(free)||free<MIN_FREE_BYTES)
  return {ok:false,code:'INSTALL_DISK_SPACE_LOW',freeBytes:free};
 return {ok:true,python,home,freeBytes:free};
}
function startInstall(input,opts={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='approval,tool_id' ||
    input.approval!==APPROVAL || typeof input.tool_id!=='string')
  return {httpStatus:400,code:'INSTALL_APPROVAL_REQUIRED'};
 const toolId=input.tool_id;
 if(!Object.hasOwn(PACKAGES,toolId))
  return {httpStatus:403,code:'INSTALL_TOOL_NOT_APPROVED'};
 if(active)return {httpStatus:409,code:'INSTALL_BUSY'};
 if(Date.now()-lastStarted<2000&&!opts.noThrottle)
  return {httpStatus:429,code:'INSTALL_RATE_LIMIT'};
 let env;
 try{env=prerequisites(opts);}catch(_){return {httpStatus:503,code:'INSTALL_ENVIRONMENT_UNAVAILABLE'};}
 if(!env.ok)return {httpStatus:503,code:env.code,freeBytes:env.freeBytes};
 const existing=readJobs(opts);
 if(existing[toolId]?.status==='succeeded'&&!opts.force)
  return {httpStatus:409,code:'INSTALL_ALREADY_SUCCEEDED',job:existing[toolId]};
 const job={tool_id:toolId,status:'running',startedAt:new Date().toISOString(),
   finishedAt:null,exitCode:null,output:''};
 try{writeJobs({...existing,[toolId]:job},opts);}
 catch(_){return {httpStatus:503,code:'INSTALL_STATE_UNWRITABLE'};}
 const command=[ '-m','pip','--isolated','install','--disable-pip-version-check',
   '--no-input','--no-cache-dir','--only-binary=:all:',PACKAGES[toolId] ];
 let child;
 try{
  child=(opts.spawnFn||spawn)(env.python,command,{
   cwd:env.home,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
   env:{HOME:env.home,PATH:'/usr/local/bin:/usr/bin:/bin',
    LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PYTHONNOUSERSITE:'1',PIP_NO_INPUT:'1'}
  });
 }catch(_){
  job.status='failed';job.finishedAt=new Date().toISOString();
  job.output='Could not start approved Python installer.';
  try{writeJobs({...existing,[toolId]:job},opts);}catch(_){}
  return {httpStatus:503,code:'INSTALL_START_FAILED'};
 }
 active=toolId;lastStarted=Date.now();
 let ended=false,timedOut=false,output='',timer;
 const append=chunk=>{output=(output+String(chunk||'')).slice(-3000);};
 function finish(code){
  if(ended)return;
  ended=true;clearTimeout(timer);active=null;
  job.status=timedOut?'timed_out':code===0?'succeeded':'failed';
  job.exitCode=Number.isInteger(code)?code:null;
  job.output=output;job.finishedAt=new Date().toISOString();
  try{writeJobs({...readJobs(opts),[toolId]:job},opts);}catch(e){
   console.error('Owner installer could not save completion status',e?.code||'UNKNOWN');
  }
 }
 child.stdout?.on('data',append);child.stderr?.on('data',append);
 child.on('error',e=>{append('Installer launch failed: '+(e?.code||'UNKNOWN'));finish(null);});
 child.on('close',finish);
 timer=setTimeout(()=>{timedOut=true;try{child.kill('SIGKILL');}catch(_){finish(null);}},MAX_DURATION_MS);
 timer.unref?.();
 return {httpStatus:202,job:{...job},freeBytes:env.freeBytes};
}
function catalogState(opts){return {jobs:readJobs(opts),busy:active!==null,
 autoInstallPolicy:'owner_approved_pinned_pip_only',approvedTools:Object.keys(PACKAGES)};}
module.exports={APPROVAL,PACKAGES,MIN_FREE_BYTES,readJobs,catalogState,startInstall,prerequisites};
