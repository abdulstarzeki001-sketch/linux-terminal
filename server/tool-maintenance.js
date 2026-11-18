'use strict';
// Owner-only manager of two explicitly reviewed, version-pinned Python tools.
// Installs run as the non-root Railway process in a dedicated persistent venv.
// Never execute request-supplied commands, URLs, package names or arguments.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);

const CATALOG=Object.freeze([
 Object.freeze({
  id:'frida',name:'Frida CLI',package:'frida-tools',version:'14.13.2',
  executable:'frida',source:'https://pypi.org/project/frida-tools/14.13.2/',
  explanation:'أدوات تحليل تطبيقات. التثبيت لا يشغّل تطبيقات ولا يتصل بأجهزة.'
 }),
 Object.freeze({
  id:'impacket',name:'Impacket',package:'impacket',version:'0.13.1',
  executable:'impacket-lookupsid',source:'https://pypi.org/project/impacket/0.13.1/',
  explanation:'مكتبة بروتوكولات Windows. التثبيت لا يفحص شبكات أو ينفذ اختبارات مصادقة.'
 })
]);
const HOME='/home/tuser';
const VENV=path.join(HOME,'.local','share','star-managed-tools','venv');
const STATE=path.join(HOME,'.config','wormstar','managed-tools.json');
const MIN_FREE_MIB=150;
const TIMEOUT_MS=150000;
let active=null;

function atomic(file,value){
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(4).toString('hex');
 try{
  fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,file);
 } finally{try{fs.unlinkSync(tmp);}catch(e){if(e?.code!=='ENOENT')throw e;}}
}
function read(file=STATE){
 try{
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  if(d?.schema===1&&Array.isArray(d.history))return d;
  throw Error('MANAGER_STATE_INVALID');
 }catch(e){if(e?.code==='ENOENT')return {schema:1,job:null,history:[]};throw e;}
}
function resolveRecord(file=STATE){
 const state=read(file);
 if(state.job?.status==='running'&&!active){
  // A deployment may have interrupted pip; do not pretend it succeeded.
  state.job={...state.job,status:'interrupted',finishedAt:new Date().toISOString(),errorCode:'INSTALL_INTERRUPTED'};
  state.history=[state.job,...state.history].slice(0,12);
  atomic(file,state);
 }
 return state;
}
function freeMiB(root='/persist'){
 const s=fs.statfsSync(root,{bigint:true});
 return Number((s.bavail*s.bsize)/(1024n*1024n));
}
const SAFE_ENV=Object.freeze({
 PATH:'/usr/local/bin:/usr/bin:/bin',
 HOME,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PIP_CONFIG_FILE:'/dev/null',
 PYTHONNOUSERSITE:'1',PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_NO_INPUT:'1'
});
function argvSafe(args){
 return Array.isArray(args)&&args.every(x=>typeof x==='string'&&!/[\0\n\r]/.test(x));
}
async function run(file,args,opts={}){
 if(!argvSafe(args))throw Error('INSTALL_INVALID_COMMAND');
 return execFileAsync(file,args,{
  timeout:TIMEOUT_MS,maxBuffer:16384,shell:false,cwd:'/tmp',
  windowsHide:true,env:{...SAFE_ENV},
  ...opts
 });
}
async function versionOf(record,opts={}){
 const venv=opts.venv||VENV;
 const python=path.join(venv,'bin','python');
 if(!fs.existsSync(python))return null;
 try{
  const out=await (opts.run||run)(python,['-c','import importlib.metadata as m,sys;print(m.version(sys.argv[1]))',record.package],{
   timeout:4000,maxBuffer:1024
  });
  return String(out.stdout||'').trim().slice(0,64)||null;
 }catch(_){return null;}
}
function isExecutable(file){
 try{return fs.statSync(file).isFile()&&!!(fs.statSync(file).mode&0o111);}
 catch(_){return false;}
}
async function status(opts={}){
 const state=resolveRecord(opts.stateFile||STATE);
 const venv=opts.venv||VENV;
 let remaining=null;
 try{remaining=freeMiB(opts.root||'/persist');}catch(_){}
 const installs=await Promise.all(CATALOG.map(async t=>{
  const found=await versionOf(t,opts);
  const executable=isExecutable(path.join(venv,'bin',t.executable));
  const installed=found===t.version&&executable;
  return {id:t.id,name:t.name,package:t.package,version:t.version,
    foundVersion:found,installed,executable,source:t.source,
    explanation:t.explanation,installable:true,
    note:installed?'مكتمل؛ البرنامج محفوظ على Volume Railway':
      found?'الإصدار أو الملف التنفيذي غير مطابق؛ يلزم إصلاح':'جاهز لتثبيت اختياري'};
 }));
 return {
  source:'railway_persistent_python',checkedAt:new Date().toISOString(),
  freeMiB:remaining,minFreeMiB:MIN_FREE_MIB,installRoot:'persistent_non_root_venv',
  packages:installs,job:state.job,history:state.history.slice(0,6),
  warning:'Curated package installation downloads third-party signed/published wheels; confirm before starting. No automatic exploit or shell execution.'
 };
}
async function execute(record,opts={}){
 const venv=opts.venv||VENV;
 const command=opts.run||run;
 if(!fs.existsSync(path.join(venv,'bin','python'))){
  await command('/usr/bin/python3',['-m','venv',venv],{timeout:25000,maxBuffer:2048});
 }
 const python=path.join(venv,'bin','python');
 // Binary wheels only: never run source builds or user-provided package scripts.
 await command(python,['-m','pip','install','--only-binary=:all:',
  '--no-cache-dir','--no-input','--disable-pip-version-check',
  '--index-url','https://pypi.org/simple',record.package+'=='+record.version],
  {timeout:TIMEOUT_MS,maxBuffer:16384});
 const got=await versionOf(record,{...opts,run:command});
 if(got!==record.version)throw Error('INSTALL_VERIFICATION_FAILED');
 if(!isExecutable(path.join(venv,'bin',record.executable)))
   throw Error('INSTALL_BINARY_MISSING');
 return true;
}
function safeError(e){
 const code=String(e?.message||'');
 if(['INSTALL_VERIFICATION_FAILED','INSTALL_BINARY_MISSING'].includes(code))return code;
 return e?.killed?'INSTALL_TIMEOUT':'INSTALL_FAILED';
}
function start({tool_id,confirm},opts={}){
 const record=CATALOG.find(t=>t.id===tool_id);
 if(!record||confirm!=='INSTALL_CURATED_PINNED')return {httpStatus:400,code:'INSTALL_NOT_APPROVED'};
 if(active)return {httpStatus:409,code:'INSTALL_BUSY'};
 const stateFile=opts.stateFile||STATE;
 let state;
 try{state=resolveRecord(stateFile);}catch(_){return {httpStatus:503,code:'INSTALL_STATE_UNAVAILABLE'};}
 if(typeof process.getuid==='function'&&(opts.uid??process.getuid())===0)
   return {httpStatus:403,code:'INSTALL_NON_ROOT_REQUIRED'};
 let available;
 try{available=opts.freeMiB??freeMiB(opts.root||'/persist');}
 catch(_){return {httpStatus:503,code:'INSTALL_STORAGE_UNAVAILABLE'};}
 if(available<MIN_FREE_MIB)return {httpStatus:507,code:'INSTALL_STORAGE_LOW'};
 // The request only queues exactly one pinned package; the user never supplies pip arguments.
 const job={
  id:crypto.randomUUID(),tool_id:record.id,package:record.package,version:record.version,
  status:'running',startedAt:new Date().toISOString(),finishedAt:null,errorCode:null
 };
 state.job=job;atomic(stateFile,state);
 active=(async()=>{
  let next;
  try{
   await (opts.execute||execute)(record,opts);
   next={...job,status:'verified',finishedAt:new Date().toISOString()};
  }catch(e){next={...job,status:'failed',finishedAt:new Date().toISOString(),errorCode:safeError(e)};}
  try{
   const updated=read(stateFile);
   // Do not overwrite another job if the container was replaced mid-install.
   if(updated.job?.id===job.id){
     updated.job=next;updated.history=[next,...updated.history].slice(0,12);
     atomic(stateFile,updated);
   }
  }finally{active=null;}
 })().catch(()=>{active=null;});
 return {httpStatus:202,job};
}
async function waitForIdle(){if(active)await active;}
module.exports={CATALOG,status,start,waitForIdle,execute,versionOf,read,resolveRecord,freeMiB,MIN_FREE_MIB};
