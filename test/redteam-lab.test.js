'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {names,exercise,triage}=require('../ai-gateway/redteam-lab');
const {createMcpHandler}=require('../ai-gateway/mcp');

test('redteam lab offers five safe offline scenarios',()=>{
  assert.equal(names().length,5);
  for(const scenario of names()){
    const x=exercise(scenario);
    assert.equal(x.environment,'Synthetic offline lab, no real targets');
    assert.ok(x.telemetry.length>0);
    assert.ok(x.defensiveActions.length>0);
  }
});
test('unknown scenario fails closed',()=>assert.throws(()=>exercise('execute_shell')));
test('scenario data is not mutable across requests',()=>{
  const a=exercise('credential_stuffing');a.telemetry[0].source='mutated';a.defensiveActions.pop();
  assert.equal(exercise('credential_stuffing').telemetry[0].source,'192.0.2.10');
  assert.ok(exercise('credential_stuffing').defensiveActions.length>=2);
});
test('synthetic authentication burst detected',()=>{
  const out=triage(exercise('credential_stuffing').telemetry);
  assert.ok(out.findings.some(f=>f.code==='AUTH_FAILURE_BURST'));
});
test('encoded traversal is flagged',()=>{
  assert.ok(triage(exercise('web_injection').telemetry).findings.some(f=>f.code==='WEB_INPUT_PROBE'));
});
test('sensitive file access detected without file reading',()=>{
  assert.ok(triage(exercise('sensitive_file_access').telemetry).findings.some(f=>f.code==='SENSITIVE_FILE_ACCESS'));
});
test('process anomaly is detected',()=>{
  assert.ok(triage(exercise('suspicious_process').telemetry).findings.some(f=>f.code==='UNUSUAL_PROCESS_CHAIN'));
});
test('network egress anomaly is detected',()=>{
  assert.ok(triage(exercise('unusual_egress').telemetry).findings.some(f=>f.code==='HIGH_EGRESS_VOLUME'));
});
test('normal telemetry produces no findings',()=>{
  assert.equal(triage([{kind:'auth',action:'success'},{kind:'http',path:'/dashboard'}]).findings.length,0);
});
test('malformed and excessive input rejected',()=>{
  assert.throws(()=>triage([]));
  assert.throws(()=>triage([{kind:'http',path:'x'.repeat(351)}]));
  assert.throws(()=>triage(Array.from({length:51},()=>({kind:'auth'}))));
});
test('findings do not echo raw user-provided secrets',()=>{
  const out=triage([{kind:'file',path:'private/.env',actor:'hidden-api-key-value'}]);
  assert.equal(JSON.stringify(out).includes('hidden-api-key-value'),false);
});
test('MCP advertises lab tools',()=>{
  const m=createMcpHandler({env:{},modelConfigured:()=>false});
  assert.ok(m.tools.some(t=>t.name==='redteam_lab_scenario'));
  assert.ok(m.tools.some(t=>t.name==='redteam_log_triage'));
});
test('MCP lab tools produce findings without sending external requests',async()=>{
  const m=createMcpHandler({env:{},fetchFn:()=>{throw Error('unexpected network call');},modelConfigured:()=>false});
  const a=await m.runTool('redteam_lab_scenario',{scenario:'credential_stuffing'});
  const b=await m.runTool('redteam_log_triage',{events:a.telemetry});
  assert.ok(b.findings.some(f=>f.code==='AUTH_FAILURE_BURST'));
});
