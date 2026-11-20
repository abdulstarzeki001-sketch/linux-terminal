'use strict';
// Offline threat-emulation scenarios only. Never executes commands or contacts targets.
const SCENARIOS=Object.freeze({
credential_stuffing:{name:'Credential stuffing detection',technique:'T1110',hypothesis:'Repeated login failures may signal password guessing.',actions:['Apply rate limiting','Enforce MFA','Monitor login failures and unusual success'],events:[{kind:'auth',action:'failed',source:'192.0.2.10',user:'test-user'},{kind:'auth',action:'failed',source:'192.0.2.10',user:'test-user'},{kind:'auth',action:'failed',source:'192.0.2.10',user:'test-user'},{kind:'auth',action:'failed',source:'192.0.2.10',user:'test-user'}]},
web_injection:{name:'Web input-validation',technique:'T1190 conceptual',hypothesis:'Encoded traversal and injection inputs can indicate reconnaissance.',actions:['Parameterized SQL','Contextual output encoding','Validate canonical paths'],events:[{kind:'http',path:'/home'},{kind:'http',path:'/view?path=%2e%2e%2fexample'}]},
sensitive_file_access:{name:'Unexpected secret file access',technique:'T1005 conceptual',hypothesis:'Sensitive file access outside normal execution is a warning signal.',actions:['Least-privilege service accounts','Credential isolation','Audit read events'],events:[{kind:'file',action:'read',path:'sample/.env'},{kind:'file',action:'read',path:'sample/notes.txt'}]},
suspicious_process:{name:'Suspicious process ancestry',technique:'T1059 conceptual',hypothesis:'A web worker spawning a shell may warrant investigation.',actions:['Monitor parent-child process trees','Restrict execution rights','Investigate anomalies'],events:[{kind:'process',name:'sh',parent:'web-worker'},{kind:'process',name:'node',parent:'service-manager'}]},
unusual_egress:{name:'Unexpected outbound volume',technique:'T1041 conceptual',hypothesis:'Large unusual egress deserves a data-loss review.',actions:['Set egress allowlists','Baseline traffic volumes','Confirm service dependencies'],events:[{kind:'network',destination:'198.51.100.10',bytesOut:2200000},{kind:'network',destination:'198.51.100.20',bytesOut:300}]}
});
const names=()=>Object.keys(SCENARIOS);
function exercise(name){
  if(typeof name!=='string'||!Object.hasOwn(SCENARIOS,name))throw Error('Unknown lab scenario: '+names().join(', '));
  const s=SCENARIOS[name];
  return {scenario:name,title:s.name,technique:s.technique,environment:'Synthetic offline lab, no real targets',attackerHypothesis:s.hypothesis,telemetry:s.events.map(x=>({...x})),defensiveActions:[...s.actions],note:'No malware, phishing kits, credential collection, network probes, or shell execution.'};
}
function triage(events){
  if(!Array.isArray(events)||!events.length||events.length>50||JSON.stringify(events).length>10000)throw Error('Pass 1-50 compact events (max 10 KB)');
  const f=[],failed=new Map();
  for(let i=0;i<events.length;i++){
    const e=events[i];if(!e||typeof e!=='object'||Array.isArray(e)||typeof e.kind!=='string')throw Error('Invalid event');
    for(const k of ['path','source','user','action','name','parent','destination'])if(e[k]!==undefined&&(typeof e[k]!=='string'||e[k].length>350))throw Error('Invalid telemetry field');
    if(e.kind==='auth'&&e.action==='failed'){const k=String(e.source||'unknown')+'|'+String(e.user||'unknown');failed.set(k,(failed.get(k)||0)+1);}
    if(e.kind==='http'&&/(?:%2e%2e|\.{2}|%3cscript|<script|union(?:\s|%20)+select)/i.test(e.path||''))
      f.push({index:i,code:'WEB_INPUT_PROBE',severity:'medium',recommendation:'Review input validation, parametrized queries and output encoding; preserve logs.'});
    if(e.kind==='file'&&/(?:^|\/)(?:\.env(?:\.|$)|id_rsa$|[^/]+\.pem$|[^/]+\.key$|secrets?(?:\.|\/|$))/i.test(e.path||''))
      f.push({index:i,code:'SENSITIVE_FILE_ACCESS',severity:'high',recommendation:'Audit access permissions and investigate credential exposure.'});
    if(e.kind==='process'&&/^(?:sh|bash|powershell|cmd(?:\.exe)?)$/i.test(e.name||'')&&/^(?:web-worker|web-server|http-service)$/i.test(e.parent||''))
      f.push({index:i,code:'UNUSUAL_PROCESS_CHAIN',severity:'high',recommendation:'Review the EDR process tree and confirm expected application behavior.'});
    if(e.kind==='network'&&typeof e.bytesOut==='number'&&Number.isFinite(e.bytesOut)&&e.bytesOut>1000000)
      f.push({index:i,code:'HIGH_EGRESS_VOLUME',severity:'medium',recommendation:'Correlate outbound volume with approved services and expected workloads.'});
  }
  for(const count of failed.values())if(count>=4)f.push({code:'AUTH_FAILURE_BURST',severity:'medium',count,recommendation:'Review auth telemetry and enforce throttling/MFA.'});
  return {eventsProcessed:events.length,findings:f.slice(0,100),counts:{high:f.filter(x=>x.severity==='high').length,medium:f.filter(x=>x.severity==='medium').length},note:'Heuristic detection only; never submit passwords, tokens or live cookies.'};
}
module.exports={names,exercise,triage};
