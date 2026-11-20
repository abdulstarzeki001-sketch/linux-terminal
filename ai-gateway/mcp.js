'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{isIP}=require('node:net');
const {exercise:labExercise,triage:labTriage}=require('./redteam-lab');
const tools=[
['star_status',{}],['memory_save',{text:{type:'string'},tag:{type:'string'}}],['memory_search',{query:{type:'string'}}],['memory_delete',{id:{type:'string'}}],
['agent_rules_get',{}],['github_read_file',{path:{type:'string'}}],['github_scan_file',{path:{type:'string'}}],
['github_stage_patch',{path:{type:'string'},content:{type:'string'},reason:{type:'string'}}],['github_pending_patches',{}],
['web_check_headers',{url:{type:'string'}}],['browserling_request',{url:{type:'string'},reason:{type:'string'}}],
['redteam_lab_scenario',{scenario:{type:'string'}}],['redteam_log_triage',{events:{type:'array',items:{type:'object'}}}]
].map(([name,properties])=>({name,description:{
star_status:'Read configuration and enabled capabilities; does not leak secrets.',
memory_save:'Save a user-selected memory fact for future chats (no credentials).',
memory_search:'Search saved memory.',memory_delete:'Delete one memory by ID.',
agent_rules_get:'Read administrator-configured Agent rules.',
github_read_file:'Read one safe source file from configured GitHub repository.',
github_scan_file:'Static code review of one safe file from configured GitHub repository.',
github_stage_patch:'Stage replacement source for human review; DOES NOT write to GitHub.',
github_pending_patches:'List staged code edits and PR URLs.',
web_check_headers:'Passive HEAD check of an explicitly authorized HTTPS host.',
browserling_request:'Queue an authorized browser-inspection request; DOES NOT open a paid Browserling session.',
redteam_lab_scenario:'Generate synthetic offline attack telemetry and defensive playbook. No execution or networking.',
redteam_log_triage:'Evaluate sanitized telemetry events for common suspicious behaviors. No commands are run.'
}[name],inputSchema:{type:'object',properties,additionalProperties:false,required:{memory_save:['text'],memory_search:['query'],memory_delete:['id'],github_read_file:['path'],github_scan_file:['path'],github_stage_patch:['path','content'],web_check_headers:['url'],browserling_request:['url'],redteam_lab_scenario:['scenario'],redteam_log_triage:['events']}[name]||[]}}));
const id=()=>crypto.randomBytes(12).toString('hex');
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&b.length>=32&&crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
const secret=s=>/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{20,}|(?:api[_-]?key|password|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_-]{16,}/i.test(s);
const safePath=p=>typeof p==='string'&&p.length<160&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>!x||x==='.'||x==='..'||/^\.(?:env|git|ssh|aws)/i.test(x)||x==='.github'||x==='node_modules')&&/^[A-Za-z0-9_.\/-]+$/.test(p)&&/\.(?:js|jsx|ts|tsx|py|json|html|css|md|yaml|yml|sh|txt|toml|ini)$/i.test(p)&&!/\.(?:key|pem|p12|pfx|db|sqlite|exe|bin|env)$/i.test(p);
function safeURL(s,allowed){try{const u=new URL(s);if(u.protocol!=='https:'||u.port||u.username||u.password||isIP(u.hostname)||/(?:^|\.)(?:local|localhost|internal|test|invalid)$/i.test(u.hostname))return null;return String(allowed||'').split(',').map(x=>x.trim().toLowerCase()).includes(u.hostname.toLowerCase())?u:null;}catch{return null;}}
function output(res,status,v,contentType='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(contentType.startsWith('application/json')?JSON.stringify(v):v);}
async function parse(req){let body='';for await(const ch of req){body+=ch.toString('utf8');if(Buffer.byteLength(body)>96000)throw Error('request too large');}return JSON.parse(body);}
const val=v=>({content:[{type:'text',text:JSON.stringify(v)}]});
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
function createMcpHandler({env=process.env,fetchFn=globalThis.fetch,modelConfigured=()=>false}={}){
  const file=env.STAR_AGENT_STATE_FILE||path.join(process.cwd(),'data','star-agent-mcp.json');
  const repo=/^[\w.-]+\/[\w.-]+$/.test(env.STAR_GITHUB_REPO||'')?env.STAR_GITHUB_REPO:null;
  const empty=()=>({memories:[],pending:[],audit:[]});
  function load(){try{if(fs.statSync(file).size>3000000)throw Error('state too large');return {...empty(),...JSON.parse(fs.readFileSync(file,'utf8'))};}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
  function change(fn){const state=load();const value=fn(state);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+id();try{fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}return value;}
  async function github(method,route,payload){
    if(!repo)throw Error('Set STAR_GITHUB_REPO before using GitHub tools');
    const token=env.STAR_GITHUB_TOKEN;
    if(method!=='GET'&&(!token||token.length<20))throw Error('Configure a limited STAR_GITHUB_TOKEN to write to GitHub');
    const response=await fetchFn('https://api.github.com/repos/'+repo+route,{method,redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json'}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})});
    const json=await response.json().catch(()=>({}));if(!response.ok)throw Error('GitHub API '+response.status);return json;
  }
  async function readFile(p){if(!safePath(p))throw Error('File path is outside permitted source files');
    const f=await github('GET','/contents/'+p.split('/').map(encodeURIComponent).join('/')+'?ref=main');
    if(f.type!=='file'||f.size>100000||f.encoding!=='base64')throw Error('Unsupported source file');
    const contents=Buffer.from(String(f.content).replace(/\s/g,''),'base64').toString('utf8');
    if(secret(contents))throw Error('Possible credential in file; not exposed to agent');
    return {contents,sha:f.sha};
  }
  async function runTool(name,a={}){
    if(name==='redteam_lab_scenario')return labExercise(a.scenario);
    if(name==='redteam_log_triage')return labTriage(a.events);
    if(name==='star_status')return {backendConfigured:!!modelConfigured(),repo:repo||null,githubReadEnabled:!!repo,githubWriteReady:!!(repo&&env.STAR_GITHUB_TOKEN&&env.STAR_REVIEW_KEY),
      storagePath:file,browserlingLiveAPI:false,allowedWebHosts:env.STAR_AUTHORIZED_HOSTS||'',note:'MCP tools do not themselves host a GPU model'};
    if(name==='agent_rules_get')return {rules:String(env.STAR_CUSTOM_INSTRUCTIONS||'').slice(0,3000),note:'Rules are set by service administrator, not by model.'};
    if(name==='memory_save'){const s=String(a.text||'').trim();if(!s||s.length>1800||secret(s))throw Error('Text too long or contains a possible credential');
      return change(db=>{const o={id:id(),text:s,tag:String(a.tag||'note').slice(0,30),date:new Date().toISOString()};db.memories.push(o);db.memories=db.memories.slice(-220);return {saved:true,id:o.id};});}
    if(name==='memory_search'){const q=String(a.query||'').toLowerCase().trim();if(!q)throw Error('query required');return {matches:load().memories.filter(x=>(x.text+' '+x.tag).toLowerCase().includes(q)).slice(-15).reverse()};}
    if(name==='memory_delete')return change(db=>{const n=db.memories.length;db.memories=db.memories.filter(m=>m.id!==a.id);return {deleted:n!==db.memories.length};});
    if(name==='github_read_file'){const f=await readFile(a.path);return {repo,path:a.path,sha:f.sha,content:f.contents.slice(0,15000)};}
    if(name==='github_scan_file'){const f=await readFile(a.path);const warnings=[];f.contents.split('\n').forEach((line,i)=>{for(const [re,reason] of [[/eval\s*\(/,'Dynamic evaluation'],[/shell\s*=\s*True/,'Shell enabled'],[/innerHTML\s*=/,'Potential XSS sink'],[/verify\s*=\s*False/,'TLS validation disabled'],[/exec\s*\(/,'Exec usage']])if(re.test(line))warnings.push({line:i+1,reason});});return {repo,path:a.path,findings:warnings.slice(0,100),note:'Heuristic findings only'};}
    if(name==='github_stage_patch'){const p=a.path,c=String(a.content||'');if(!safePath(p)||!c||c.length>30000||secret(c))throw Error('Invalid patch or suspected secret');
      const current=await readFile(p);return change(db=>{const item={id:id(),kind:'github_patch',path:p,sha:current.sha,content:c,reason:String(a.reason||'').slice(0,200),status:'pending'};db.pending.push(item);db.pending=db.pending.slice(-30);return {id:item.id,status:'pending_admin_review',path:p};});}
    if(name==='github_pending_patches')return {items:load().pending.map(p=>({id:p.id,kind:p.kind,path:p.path,url:p.url||null,status:p.status})).slice(-25)};
    if(name==='web_check_headers'){const url=safeURL(a.url,env.STAR_AUTHORIZED_HOSTS);if(!url)throw Error('Host not in STAR_AUTHORIZED_HOSTS');
      const resp=await fetchFn(url.toString(),{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)});return {status:resp.status,origin:url.origin,headers:Object.fromEntries(['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy'].map(k=>[k,resp.headers.get(k)]))};}
    if(name==='browserling_request'){const url=safeURL(a.url,env.STAR_AUTHORIZED_HOSTS);if(!url)throw Error('Host must be authorized');
      return change(db=>{const p={id:id(),kind:'browserling_request',url:url.toString(),status:'pending_manual_session',reason:String(a.reason||'').slice(0,200)};db.pending.push(p);return {id:p.id,status:p.status,note:'Manual Browserling session required; no API session was opened'};});}
    throw Error('Unsupported tool');
  }
  async function approve(patchId){
    if(!env.STAR_GITHUB_TOKEN)throw Error('STAR_GITHUB_TOKEN missing');
    const p=load().pending.find(p=>p.id===patchId&&p.kind==='github_patch'&&p.status==='pending');
    if(!p)throw Error('Proposal not found');
    const current=await readFile(p.path);if(current.sha!==p.sha)throw Error('File has changed since review staging');
    const head=(await github('GET','/git/ref/heads/main')).object.sha,branch='star-ai/review-'+p.id.slice(0,12);
    await github('POST','/git/refs',{ref:'refs/heads/'+branch,sha:head});
    await github('PUT','/contents/'+p.path.split('/').map(encodeURIComponent).join('/'),{message:'STAR AI reviewed change: '+p.path,content:Buffer.from(p.content).toString('base64'),sha:p.sha,branch});
    const pr=await github('POST','/pulls',{title:'STAR AI review: '+p.path,head:branch,base:'main',draft:true,body:'Submitted through STAR AI; human-approved review. '+p.reason});
    return change(db=>{const x=db.pending.find(y=>y.id===p.id);x.status='draft_pr';x.url=pr.html_url;x.content='';return {url:pr.html_url,status:x.status};});
  }
  async function handler(req,res){
    const u=(req.url||'').split('?')[0];
    if(u.startsWith('/star-review/')){
      if(!eq(req.headers['x-star-review-key'],env.STAR_REVIEW_KEY)){output(res,401,{error:'unauthorized'});return;}
      try{if(u==='/star-review/list'&&req.method==='GET'){output(res,200,{proposals:load().pending});return;}
        if(u==='/star-review/approve'&&req.method==='POST'){const a=await parse(req);if(a.confirm!=='APPROVE_DRAFT_PR')throw Error('Explicit approval required');output(res,200,await approve(a.id));return;}
        output(res,404,{error:'not_found'});}catch(e){output(res,400,{error:String(e.message).slice(0,200)});}return;
    }
    if(u!=='/mcp'){output(res,404,{error:'not_found'});return;}
    if(req.headers.origin && !String(env.STAR_MCP_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes(req.headers.origin)){
      output(res,403,{error:'origin_not_allowed'});return;
    }
    if(!eq(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''),env.STAR_MINIS_MCP_KEY)){output(res,401,{error:'unauthorized'});return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end();return;}
    let q;try{q=await parse(req);}catch{output(res,400,err(null,-32700,'Invalid JSON'));return;}
    if(q?.jsonrpc!=='2.0'||typeof q.method!=='string'){output(res,400,err(q?.id??null,-32600,'Invalid JSON-RPC'));return;}
    if(q.id===undefined){res.writeHead(202);res.end();return;}
    let result;
    try{if(q.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'STAR AI MCP',version:'1.0.0'}};
      else if(q.method==='ping')result={};else if(q.method==='tools/list')result={tools};
      else if(q.method==='tools/call')result=val(await runTool(q.params?.name,q.params?.arguments||{}));
      else{output(res,200,err(q.id,-32601,'Method not found'));return;}
      output(res,200,{jsonrpc:'2.0',id:q.id,result});
    }catch(e){output(res,200,{jsonrpc:'2.0',id:q.id,result:{...val({error:String(e.message).slice(0,200)}),isError:true}});}
  }
  return {handler,runTool,tools};
}
module.exports={createMcpHandler};