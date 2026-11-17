'use strict';
// One-time, non-interactive Railway diagnostics. No new HTTP routes, shell inputs,
// network scans, passwords, API keys, or AI answer text are written to logs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {checkAIStatus, askAI} = require('./ai');

const TOOLS = Object.freeze([
  'python3','node','npm','git','nmap','tshark','tcpdump','whois','dig','traceroute'
]);

function hasExecutable(name, searchPath=process.env.PATH || '') {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return false;
  for (const dir of String(searchPath).split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    try {
      fs.accessSync(path.join(dir,name),fs.constants.X_OK);
      return true;
    } catch (_) { /* next PATH entry */ }
  }
  return false;
}

function makeReport(root='/persist') {
  const report = {
    kind:'readonly_runtime',
    platform:os.type(),
    kernel:os.release(),
    node:process.version,
    uid:typeof process.getuid==='function' ? process.getuid() : null,
    cwd:process.cwd(),
    volume:root,
    tools:Object.fromEntries(TOOLS.map(name=>[name,hasExecutable(name)]))
  };
  try {
    const v=fs.statfsSync(root,{bigint:true});
    const mib=1024n*1024n;
    report.disk={
      totalMiB:Number((v.blocks*v.bsize)/mib),
      availableMiB:Number((v.bavail*v.bsize)/mib)
    };
  } catch (_) { report.disk={error:'VOLUME_STAT_UNAVAILABLE'}; }
  try { report.persistHome=fs.realpathSync('/home/tuser'); }
  catch (_) { report.persistHome='HOME_LINK_UNAVAILABLE'; }
  return report;
}
function safeCode(error) {
  const code=String(error?.message||'');
  return /^AI_[A-Z_]+$/.test(code) ? code : 'AI_NETWORK_ERROR';
}
async function runLiveCheck({
  root=process.env.HOME || '/home/tuser',
  healthFn=checkAIStatus,
  answerFn=askAI,
  fsImpl=fs,
  logger=console.info,
  warn=console.warn
}={}) {
  let health;
  try { health=await healthFn(); }
  catch (_) { health={ready:false,reason:'GATEWAY_UNREACHABLE'}; }
  const reason=/^[A-Z_]+$/.test(health?.reason||'') ? health.reason : 'GATEWAY_UNKNOWN';
  logger('[STAR BOOT AUDIT] AI_HEALTH='+reason);
  if (!health?.ready) return {state:'NOT_READY',reason};
  const marker=path.join(root,'.config','wormstar','ai-smoke-v2.attempted');
  try {
    fsImpl.mkdirSync(path.dirname(marker),{recursive:true,mode:0o700});
    fsImpl.writeFileSync(marker,'One-time AI connectivity check requested. No prompt or answer stored.\n',
      {flag:'wx',mode:0o600});
  } catch (error) {
    if (error?.code==='EEXIST') {
      logger('[STAR BOOT AUDIT] AI_LIVE=ALREADY_ATTEMPTED');
      return {state:'ALREADY_ATTEMPTED'};
    }
    warn('[STAR BOOT AUDIT] AI_LIVE=STATE_UNAVAILABLE');
    return {state:'STATE_UNAVAILABLE'};
  }
  try {
    // A single minimal provider request; answer text is deliberately discarded.
    const answer=await answerFn('Connection test: reply with exactly READY.');
    if (typeof answer!=='string' || !answer.trim()) {
      warn('[STAR BOOT AUDIT] AI_LIVE=EMPTY_RESPONSE');
      return {state:'EMPTY_RESPONSE'};
    }
    logger('[STAR BOOT AUDIT] AI_LIVE=SUCCESS');
    return {state:'SUCCESS'};
  } catch (error) {
    const code=safeCode(error);
    warn('[STAR BOOT AUDIT] AI_LIVE='+code);
    return {state:code};
  }
}
function startBootAudit() {
  try { console.info('[STAR BOOT AUDIT] '+JSON.stringify(makeReport())); }
  catch (_) { console.warn('[STAR BOOT AUDIT] RUNTIME_REPORT_FAILED'); }
  void runLiveCheck().catch(()=>console.warn('[STAR BOOT AUDIT] AI_LIVE=UNEXPECTED_ERROR'));
}
module.exports={TOOLS,hasExecutable,makeReport,runLiveCheck,startBootAudit};
