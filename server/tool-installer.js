'use strict';
// Approved, bounded installation plans. Inventory and planning are read-only.
// Execution is intentionally limited to an owner-operated terminal with sudo.
const fs = require('node:fs');
const path = require('node:path');
const {TOOLS, snapshot} = require('./tool-ops');
const {catalogState}=require('./tool-install-runner');

const PLANS = Object.freeze({
  certipy:{kind:'pip',package:'certipy-ad',command:'$HOME/.venv-py312/bin/python -m pip install certipy-ad==5.1.0',compatibility:'Linux; dedicated Python 3.12 persistent virtualenv for Certipy 5.1.0',risk:'medium'},
  impacket:{kind:'pip',package:'impacket',command:'$HOME/.venv/bin/python -m pip install impacket==0.13.1',compatibility:'Linux; isolated Python venv',risk:'medium'},
  netexec:{kind:'image',package:'netexec',command:null,compatibility:'NetExec 1.5.1 immutable CLI in Railway image; authenticated owner inventory only. Network tests require a separate authorized lab.',risk:'high'},
  frida:{kind:'pip',package:'frida-tools',command:'$HOME/.venv/bin/python -m pip install frida-tools==14.13.2',compatibility:'Linux; isolated Python venv',risk:'medium'},
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
// Every card receives a real target/runtime plan, including non-railway tools.
// This is not permission to install or start C2, credential dumping or tunnelling tools.
const PROFILES=Object.freeze({
  mythic:{target:'isolated_linux_service',readiness:'separate_environment',requirements:['Dedicated isolated Linux host','Container runtime and database','Private range-only network and access policy']},
  sliver:{target:'isolated_linux_vm',readiness:'separate_environment',requirements:['Dedicated Linux range VM','Host-only network isolation','Explicit lab change approval']},
  havoc:{target:'isolated_linux_vm',readiness:'separate_environment',requirements:['Dedicated Linux graphical VM','Compiler and GUI dependencies','Isolated authorized range']},
  caldera:{target:'isolated_linux_service',readiness:'separate_environment',requirements:['Dedicated application service','Python environment and required plugins','Isolated training targets']},
  bloodhound:{target:'dedicated_container_stack',readiness:'separate_environment',requirements:['BloodHound CE application container','Dedicated database and persistent storage','RAM and private service authentication']},
  certipy:{target:'railway_python_venv',readiness:'owner_approved',requirements:['Dedicated Python 3.12 virtualenv; Debian Python 3.11 remains untouched','Persistent Python virtual environment','Owner confirmation','At least 250 MiB free volume space']},
  impacket:{target:'railway_python_venv',readiness:'owner_approved',requirements:['Persistent Python virtual environment','Owner confirmation','At least 250 MiB free volume space']},
  netexec:{target:'railway_immutable_cli',readiness:'manual_review',requirements:['Version-pinned image CLI available without manual install','No automatic scans or access to external networks','Authorized isolated lab required before active testing']},
  rubeus:{target:'windows_vm',readiness:'incompatible_railway_linux',requirements:['Dedicated Windows laboratory VM','Authorization for identity testing','Local-only execution']},
  mimikatz:{target:'windows_vm',readiness:'incompatible_railway_linux',requirements:['Dedicated Windows VM','Privileged lab access','Sensitive credential handling controls']},
  ligolo:{target:'isolated_network_range',readiness:'separate_environment',requirements:['Separate relay host and isolated range','Explicit network route approval','No public proxy deployment']},
  frida:{target:'railway_python_venv',readiness:'owner_approved',requirements:['Persistent Python virtual environment','Owner confirmation','External device instrumentation requires separate approval']},
  ghidra:{target:'dedicated_analysis_vm',readiness:'manual_review',requirements:['Java runtime appropriate to selected Ghidra release','Large persistent workspace','Separate analysis VM recommended']},
  aflpp:{target:'railway_debian_apt',readiness:'owner_approved',requirements:['Signed Debian package repository','Owner confirmation','At least 750 MiB free root filesystem and 250 MiB free persistent volume']},
  syzkaller:{target:'dedicated_kernel_vm',readiness:'incompatible_railway_linux',requirements:['Dedicated kernel fuzzing VM','Controlled kernel snapshot and recovery','Privileged VM host unavailable in Railway terminal']}
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
  const installs=catalogState(opts);
  return {
    mode:'inventory_and_owner_install_plans',
    checkedAt:new Date().toISOString(),
    persistence:persist,
    jobs:installs.jobs,
    busy:installs.busy,
    pythonVersion:installs.pythonVersion,
    summary:{total:snap.tools.length,installed:snap.tools.filter(x=>x.installed).length,
     missing:snap.tools.filter(x=>!x.installed).length,
     automatedInstallsEnabled:true,approvedTools:installs.approvedTools},
    tools:snap.tools.map(t=>{
      const plan=PLANS[t.id];
      const profile=PROFILES[t.id];
      return {...t,install:{
        policy:installs.approvedTools.includes(t.id)?'owner_one_click':profile.readiness==='manual_review'?'manual_review':'separate_lab',
        method:plan?.kind||'separate_lab',
        target:profile.target,
        readiness:profile.readiness,
        requirements:profile.requirements,
        canInstall:installs.approvedTools.includes(t.id)&&!(t.id==='certipy'&&!installs.certipyPythonReady),
        blockedReason:t.id==='certipy'&&!installs.certipyPythonReady?'INSTALL_PYTHON_VERSION_UNSUPPORTED':null,
        package:plan?.package||null,
        command:plan?.command||null,
        compatibility:plan?.compatibility||LEGACY[t.id]||'Manual review required',
        requiresApproval:true,
        executed:installs.jobs[t.id]?.status==='succeeded',
        installedByManager:installs.jobs[t.id]?.status==='succeeded'&&!!t.installed
      }};
    })
  };
}
module.exports={PLANS,PROFILES,getCatalog,verifyManifest};
