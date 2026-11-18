'use strict';
// Approved, bounded installation plans. Inventory and planning are read-only.
// Execution is intentionally limited to an owner-operated terminal with sudo.
const fs = require('node:fs');
const path = require('node:path');
const {TOOLS, snapshot} = require('./tool-ops');

const PLANS = Object.freeze({
  certipy:{kind:'pip',package:'certipy-ad',command:'python3 -m pip install certipy-ad',compatibility:'Linux; isolated Python venv',risk:'medium'},
  impacket:{kind:'pip',package:'impacket',command:'python3 -m pip install impacket',compatibility:'Linux; isolated Python venv',risk:'medium'},
  netexec:{kind:'apt',package:'netexec',command:'sudo apt-get install --no-install-recommends netexec',compatibility:'Kali package; verify distro repository before installing',risk:'medium'},
  frida:{kind:'pip',package:'frida-tools',command:'python3 -m pip install frida-tools',compatibility:'Linux; isolated Python venv',risk:'medium'},
  aflpp:{kind:'apt',package:'afl++',command:'sudo apt-get install --no-install-recommends afl++',compatibility:'Debian/Kali supported package availability varies',risk:'medium'},
  ghidra:{kind:'manual',package:null,command:null,compatibility:'Needs JDK and headless or GUI architecture; separate image recommended',risk:'high'}
});
const LEGACY = Object.freeze({
  mythic:'Separate isolated C2 service; no in-process automatic install.',
  sliver:'Separate isolated red-team range; no automatic server setup.',
  havoc:'Separate isolated red-team range; no automatic server setup.',
  caldera:'Dedicated simulation service and permissions required.',
  bloodhound:'Dedicated service with database and isolated directory lab required.',
  rubeus:'Windows executable: not compatible with native Linux container.',
  mimikatz:'Credential access tooling: inventory only.',
  ligolo:'Network tunnel tool: inventory only; requires approved range.',
  syzkaller:'Kernel fuzzing requires its own VM and privileged kernel lab.'
});
const SAFE_NAMES=/^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$/;
function stateDir(root=process.env.WORMSTAR_PERSIST_ROOT||'/persist'){
  return path.join(root,'state');
}
function verifyManifest(root=process.env.WORMSTAR_PERSIST_ROOT||'/persist'){
  const dir=stateDir(root), status=path.join(dir,'restore-status.txt');
  const read=(filename,max)=>{try{return fs.readFileSync(path.join(dir,filename),'utf8').slice(0,max);}catch{return null;}};
  const apt=(read('apt-manual.txt',16000)||'').split(/\r?\n/).filter(x=>SAFE_NAMES.test(x)).slice(0,300);
  const restore=read('restore-status.txt',300);
  let initialized=false;
  try {initialized=fs.statSync(path.join(dir,'initialized')).isFile();} catch {}
  return {initialized,restoration:restore?.trim()||'unknown',aptSaved:apt,manifestPresent:fs.existsSync(status),
    persistenceRoot:root,homePersisted:fs.existsSync(path.join(root,'home','tuser'))};
}
function getCatalog(opts={}){
  const snap=opts.snapshot||snapshot();
  const persist=verifyManifest(opts.root);
  return {
    mode:'inventory_and_owner_install_plans',
    checkedAt:new Date().toISOString(),
    persistence:persist,
    tools:snap.tools.map(t=>{
      const plan=PLANS[t.id];
      return {...t,install:{
        policy:plan?plan.kind==='manual'?'manual_review':'owner_terminal_approval':'separate_lab',
        method:plan?.kind||'unsupported',
        package:plan?.package||null,
        command:plan?.command||null,
        compatibility:plan?.compatibility||LEGACY[t.id]||'Manual review required',
        requiresApproval:true,
        executed:false,
        installedByManager:false
      }};
    })
  };
}
module.exports={PLANS,getCatalog,verifyManifest};
