'use strict';

/**
 * STAR Training: non-exploit, evidence-based lab checks on the real Railway
 * runtime and immutable, explicitly labeled synthetic evidence fixtures.
 * No user-submitted shell commands, targets, URLs, files or scripts execute.
 * Only the resulting verified scores are saved on the existing volume.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const LAB_DIR=path.join(__dirname,'training-fixtures');
const STATE_PATH=process.env.STAR_TRAINING_STATE_PATH ||
  path.join(process.env.TERMINAL_HOME||'/home/tuser','.config','wormstar','training-progress.json');
const WEEK_IDS=['W01','W02','W03','W04','W05','W06','W07','W08'];
const MAX_ANSWERS=120;

const LABS=[
 {id:'W01',title:'فحص نظام Linux الحقيقي',mode:'live',file:null,
  objective:'افحص بيئة Railway مباشرة من الترمنال؛ هذه نتيجة النظام الحقيقي وليست بيانات تدريبية.',
  command:"uname -s && grep '^ID=' /etc/os-release",
  fields:[{key:'a',label:'ناتج uname -s'},{key:'b',label:'قيمة ID من /etc/os-release'}]},
 {id:'W02',title:'تحليل علاقات Active Directory',mode:'fixture',file:'ad_edges.csv',
  objective:'حلّل شبكة الصلاحيات التدريبية: كم وصلة في أقصر مسار من analyst إلى dc01؟ وما علاقة آخر وصلة؟',
  command:'cat /app/server/training-fixtures/ad_edges.csv',
  fields:[{key:'a',label:'عدد الوصلات في أقصر مسار'},{key:'b',label:'نوع علاقة آخر وصلة'}]},
 {id:'W03',title:'تحليل أحداث Kerberos',mode:'fixture',file:'kerberos_events.csv',
  objective:'استخرج عدد أحداث 4769 التي تستخدم 0x17 وبحالة نجاح 0x0، وحدد الحساب المرتبط بها.',
  command:"cat /app/server/training-fixtures/kerberos_events.csv",
  fields:[{key:'a',label:'عدد الأحداث المطابقة'},{key:'b',label:'اسم الحساب'}]},
 {id:'W04',title:'رصد الاتصالات الدورية',mode:'fixture',file:'network_beacons.csv',
  objective:'حدد الوجهة التي يظهر لها 4 اتصالات متتالية بفاصل زمني ثابت، ثم احسب الفاصل بالثواني.',
  command:'cat /app/server/training-fixtures/network_beacons.csv',
  fields:[{key:'a',label:'الوجهة التدريبية الدورية'},{key:'b',label:'الفاصل بالثواني'}]},
 {id:'W05',title:'التحقق من عزل الشبكات',mode:'fixture',file:'firewall_rules.csv',
  objective:'احسب عدد قواعد المنع deny، وحدد أول معرّف قاعدة منع.',
  command:"cat /app/server/training-fixtures/firewall_rules.csv",
  fields:[{key:'a',label:'عدد قواعد deny'},{key:'b',label:'أول Rule ID ممنوع'}]},
 {id:'W06',title:'مراجعة أثر Frida وتحليل TLS',mode:'fixture',file:'frida_trace.log',
  objective:'حدد اسم الدالة التي غيّرت mode إلى 0، واحسب عدد مرات هذا السلوك.',
  command:"grep 'mode=0' /app/server/training-fixtures/frida_trace.log",
  fields:[{key:'a',label:'اسم الدالة'},{key:'b',label:'عدد مرات mode=0'}]},
 {id:'W07',title:'فرز أعطال AFL++',mode:'fixture',file:'afl_crashes.log',
  objective:'حدد الدالة المرتبطة بأعطال SIGSEGV، واحسب عدد تلك الأعطال.',
  command:"grep 'SIGSEGV' /app/server/training-fixtures/afl_crashes.log",
  fields:[{key:'a',label:'اسم الدالة'},{key:'b',label:'عدد SIGSEGV'}]},
 {id:'W08',title:'فرز تقارير Syzkaller',mode:'fixture',file:'syzkaller_reports.log',
  objective:'حدد الدالة المتأثرة ببلاغات KASAN use-after-free واحسب عدد البلاغات.',
  command:"grep 'KASAN' /app/server/training-fixtures/syzkaller_reports.log",
  fields:[{key:'a',label:'اسم الدالة'},{key:'b',label:'عدد بلاغات KASAN'}]}
];

function fixture(filename) {
  if(!LABS.some(x=>x.file===filename))throw Error('TRAINING_UNKNOWN_FIXTURE');
  return fs.readFileSync(path.join(LAB_DIR,filename),'utf8');
}
function records(name) {
  const rows=fixture(name).trim().split(/\r?\n/).map(x=>x.split(','));
  const header=rows.shift();
  return rows.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]||''])));
}
function distanceForAD() {
  const edges=records('ad_edges.csv');
  const parent=new Map([['analyst',{hops:0,last:''}]]);
  const q=['analyst'];
  while(q.length) {
    const cur=q.shift();
    if(cur==='dc01')return parent.get(cur);
    for(const edge of edges.filter(e=>e.from===cur)) {
      if(!parent.has(edge.to)){
        parent.set(edge.to,{hops:parent.get(cur).hops+1,last:edge.relation});
        q.push(edge.to);
      }
    }
  }
  throw Error('TRAINING_NO_AD_PATH');
}
function getExpected(id){
  switch(id){
   case 'W01': {
     const distro=fs.readFileSync('/etc/os-release','utf8').match(/^ID="?([^"\r\n]+)"?/m)?.[1];
     if(!distro)throw Error('TRAINING_OS_UNKNOWN');
     return [os.type(),distro];
   }
   case 'W02': {const x=distanceForAD();return [String(x.hops),x.last];}
   case 'W03': {
     const rows=records('kerberos_events.csv').filter(x=>x.event_id==='4769'&&x.encryption==='0x17'&&x.status==='0x0');
     if(!rows.length)throw Error('TRAINING_EMPTY_CASE');
     return [String(rows.length),rows[0].account];
   }
   case 'W04': {
     const groups=new Map();
     for(const row of records('network_beacons.csv')){
       const sec=row.time.split(':').map(Number).reduce((acc,x)=>acc*60+x,0);
       if(!groups.has(row.destination))groups.set(row.destination,[]);
       groups.get(row.destination).push(sec);
     }
     for(const [destination,times] of groups){
       const gaps=times.slice(1).map((t,i)=>t-times[i]);
       if(times.length>=4 && gaps[0]>0 && gaps.every(x=>x===gaps[0]))
         return [destination,String(gaps[0])];
     }
     throw Error('TRAINING_NO_PERIODIC_FLOW');
   }
   case 'W05': {
     const denied=records('firewall_rules.csv').filter(x=>x.decision==='deny');
     if(!denied.length)throw Error('TRAINING_EMPTY_CASE');
     return [String(denied.length),denied[0].id];
   }
   case 'W06': {
     const lines=fixture('frida_trace.log').trim().split(/\r?\n/).filter(x=>x.includes('mode=0'));
     if(!lines.length)throw Error('TRAINING_EMPTY_CASE');
     return [lines[0].split(/\s+/)[1],String(lines.length)];
   }
   case 'W07': {
     const lines=fixture('afl_crashes.log').trim().split(/\r?\n/).filter(x=>x.includes('signal=SIGSEGV'));
     if(!lines.length)throw Error('TRAINING_EMPTY_CASE');
     return [lines[0].match(/function=([^\s]+)/)?.[1]||'',String(lines.length)];
   }
   case 'W08': {
     const lines=fixture('syzkaller_reports.log').trim().split(/\r?\n/).filter(x=>x.includes('BUG: KASAN:'));
     if(!lines.length)throw Error('TRAINING_EMPTY_CASE');
     return [lines[0].match(/in ([\w]+)\+/)?.[1]||'',String(lines.length)];
   }
   default: throw Error('TRAINING_WEEK_UNKNOWN');
  }
}
function readState(file=STATE_PATH){
 try {
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  return state?.schema===1&&typeof state.weeks==='object'&&state.weeks!==null
    ? state : {schema:1,weeks:{}};
 } catch(e) {
  if(e?.code==='ENOENT')return {schema:1,weeks:{}};
  throw e; // No silent resets on corrupt state.
 }
}
function writeState(state,file=STATE_PATH){
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const temp=file+'.tmp-'+process.pid+'-'+Date.now();
 try{
  fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600,flag:'wx'});
  fs.renameSync(temp,file);
 } finally{
  try{fs.unlinkSync(temp);}catch(e){if(e?.code!=='ENOENT')throw e;}
 }
}
function publicStatus(state=readState()){
 const weeks=LABS.map(lab=>{
   const r=state.weeks[lab.id]||{};
   return {id:lab.id,verified:r.verifiedAt!==undefined,verifiedAt:r.verifiedAt||null,
     attempts:Number(r.attempts)||0,lastScore:Number(r.lastScore)||0};
 });
 const completed=weeks.filter(x=>x.verified).length;
 return {schema:1,completed,total:LABS.length,percent:Math.round(100*completed/LABS.length),weeks};
}
function publicLabs(){
 return LABS.map(({id,title,mode,file,objective,command,fields})=>({
   id,title,mode,objective,command,fields,
   source:file?'مصدر تدريبي مصطنع داخل حاوية Railway':'النظام الفعلي للحاوية',
   evidence:file?fixture(file):null
 }));
}
function normalize(value){
 return typeof value==='string'?value.trim().toLowerCase().replace(/^["']|["']$/g,''):null;
}
function verify({week,answers},state=readState(),save=writeState){
 if(!WEEK_IDS.includes(week)||!answers||typeof answers!=='object'||
    Array.isArray(answers))return {httpStatus:400,code:'TRAINING_INVALID_REQUEST'};
 if(typeof answers.a!=='string'||typeof answers.b!=='string'||
    answers.a.length>MAX_ANSWERS||answers.b.length>MAX_ANSWERS)
    return {httpStatus:400,code:'TRAINING_INVALID_ANSWERS'};
 const expected=getExpected(week);
 const flags=[normalize(answers.a)===normalize(expected[0]),normalize(answers.b)===normalize(expected[1])];
 const today=new Date().toISOString().slice(0,10);
 const prior=state.weeks[week]||{};
 const attemptedToday=prior.day===today?(prior.attemptsToday||0):0;
 if(attemptedToday>=60)return {httpStatus:429,code:'TRAINING_RATE_LIMIT'};
 const passed=flags.every(Boolean),now=new Date().toISOString();
 state.weeks[week]={
  attempts:(prior.attempts||0)+1,day:today,attemptsToday:attemptedToday+1,
  lastScore:flags.filter(Boolean).length*50,lastAt:now,
  verifiedAt:prior.verifiedAt||(passed?now:null)
 };
 save(state);
 return {httpStatus:200,week,passed,score:flags.filter(Boolean).length*50,
   checks:flags.map((valid,i)=>({key:i===0?'a':'b',passed:valid})),
   mode:week==='W01'?'live':'fixture',verifiedAt:state.weeks[week].verifiedAt,
   summary:publicStatus(state)};
}
module.exports={LABS,WEEK_IDS,publicLabs,publicStatus,readState,writeState,verify,getExpected,STATE_PATH};